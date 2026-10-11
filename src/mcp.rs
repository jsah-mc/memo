use rmcp::{handler::server::wrapper::Parameters, schemars, tool, tool_router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{path::PathBuf, sync::Arc};

use crate::{api::run_cli, runtimes};

#[derive(Clone)]
pub struct MemoMcp {
    working_directory: PathBuf,
    cua_driver: Arc<cua_driver_sdk::CuaDriver>,
}

impl MemoMcp {
    pub fn new(working_directory: PathBuf, cua_driver: Arc<cua_driver_sdk::CuaDriver>) -> Self {
        Self {
            working_directory,
            cua_driver,
        }
    }
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct ChatArgs {
    /// Model identifier from list_models, formatted as runtime:model.
    pub model: String,
    /// Prompt to send to the selected model.
    pub prompt: String,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct CuaCallArgs {
    /// CUA Driver tool name returned by cua_list_tools.
    pub tool: String,
    /// JSON arguments for the selected CUA Driver tool.
    #[serde(default)]
    pub arguments: Value,
}

const READ_ONLY_CUA_TOOLS: &[&str] = &[
    "get_agent_cursor_state",
    "get_cursor_position",
    "get_desktop_state",
    "get_screen_size",
    "get_window_state",
    "list_apps",
    "list_windows",
];

fn is_read_only_cua_tool(tool: &str) -> bool {
    READ_ONLY_CUA_TOOLS.contains(&tool)
}

#[tool_router(server_handler)]
impl MemoMcp {
    #[tool(description = "List installed Memo AI runtimes and their available model identifiers")]
    fn list_models(&self) -> String {
        let models = runtimes::statuses()
            .into_iter()
            .filter(|status| status.installed)
            .flat_map(|status| {
                status
                    .models
                    .into_iter()
                    .map(move |model| format!("{}:{model}", status.runtime.id))
            })
            .collect::<Vec<_>>();
        serde_json::to_string_pretty(&models).unwrap_or_else(|_| "[]".into())
    }

    #[tool(description = "Send a prompt to an installed Memo AI runtime and return its response")]
    async fn chat(&self, Parameters(args): Parameters<ChatArgs>) -> String {
        let Some((runtime_id, model)) = args.model.split_once(':') else {
            return "Error: model must use the runtime:model format from list_models".into();
        };
        let runtime = match runtimes::runtime(runtime_id) {
            Ok(runtime) if runtime.installed() => runtime,
            Ok(runtime) => return format!("Error: {} is not installed", runtime.label),
            Err(error) => return format!("Error: {error}"),
        };
        match run_cli(
            runtime,
            model.to_owned(),
            args.prompt,
            self.working_directory.clone(),
        )
        .await
        {
            Ok(answer) => answer,
            Err(error) => format!("Error: {error}"),
        }
    }
    #[tool(
        description = "List the CUA Driver computer-control tools available through Memo",
        annotations(
            title = "List CUA Driver tools",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn cua_list_tools(&self) -> String {
        self.cua_driver
            .list_tools_json()
            .await
            .unwrap_or_else(|error| json!({"error": {"message": error.to_string()}}).to_string())
    }

    #[tool(
        description = "Invoke a strictly read-only CUA Driver observation tool. Allowed tools: get_agent_cursor_state, get_cursor_position, get_desktop_state, get_screen_size, get_window_state, list_apps, and list_windows.",
        annotations(
            title = "Observe computer state",
            read_only_hint = true,
            destructive_hint = false,
            idempotent_hint = true,
            open_world_hint = false
        )
    )]
    async fn cua_observe(&self, Parameters(args): Parameters<CuaCallArgs>) -> String {
        if !is_read_only_cua_tool(&args.tool) {
            return json!({
                "error": {
                    "message": format!(
                        "{} is not a read-only CUA tool; use cua_call for state-changing actions",
                        args.tool
                    )
                }
            })
            .to_string();
        }

        match self
            .cua_driver
            .call_tool(args.tool, args.arguments.to_string())
            .await
        {
            Ok(result) => result.raw_json,
            Err(error) => json!({"error": {"message": error.to_string()}}).to_string(),
        }
    }

    #[tool(
        description = "Invoke a state-changing CUA Driver tool. Observe with cua_observe before every action and verify state afterward.",
        annotations(
            title = "Perform a computer action",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    async fn cua_call(&self, Parameters(args): Parameters<CuaCallArgs>) -> String {
        match self
            .cua_driver
            .call_tool(args.tool, args.arguments.to_string())
            .await
        {
            Ok(result) => result.raw_json,
            Err(error) => json!({"error": {"message": error.to_string()}}).to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_read_only_cua_tool;

    #[test]
    fn observation_allowlist_excludes_actions() {
        for tool in [
            "get_desktop_state",
            "get_window_state",
            "list_apps",
            "list_windows",
        ] {
            assert!(is_read_only_cua_tool(tool));
        }

        for tool in ["click", "type_text", "launch_app", "clipboard_write"] {
            assert!(!is_read_only_cua_tool(tool));
        }
    }
}
