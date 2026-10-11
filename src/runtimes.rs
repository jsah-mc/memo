use serde::{Deserialize, Serialize};
use std::{
    env,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

const MEMO_MCP_URL: &str = "http://127.0.0.1:6734/mcp";
const MEMO_ONLY_INSTRUCTIONS: &str = "You are running inside Memo. Use only tools exposed by the Memo MCP server. Do not use built-in shell, filesystem, browser, web, computer-control, delegation, plugin, skill, memory, or other external tools. If a required capability is not available through Memo, explain that it is unavailable instead of using another tool.";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NativeToolsPolicy {
    Isolated,
    Disabled,
    NotApplicable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelOutput {
    Lines,
    Table,
    TabSeparated,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Runtime {
    pub id: &'static str,
    pub label: &'static str,
    pub executable: &'static str,
    pub model_flag: Option<&'static str>,
    pub native_tools_policy: NativeToolsPolicy,
    pub default_model: &'static str,
    #[serde(skip)]
    pub fallback_models: &'static [&'static str],
    #[serde(skip)]
    pub model_query: Option<(&'static [&'static str], ModelOutput)>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    #[serde(flatten)]
    pub runtime: Runtime,
    pub installed: bool,
    pub models: Vec<String>,
}

impl Runtime {
    pub fn installed(self) -> bool {
        executable_path(self.executable).is_some()
    }

    pub fn command(self, model: &str, arguments: &[String]) -> Result<Vec<String>, String> {
        let model = model.trim();
        if model.is_empty() {
            return Err("model must be a non-empty string".into());
        }
        let mut command = vec![self.executable.to_owned()];
        if let Some(flag) = self.model_flag {
            command.extend([flag.to_owned(), model.to_owned()]);
        }
        command.extend(arguments.iter().cloned());
        Ok(command)
    }

    pub fn chat_failure_message(self, stderr: &str, exit_status: Option<&str>) -> String {
        let detail = stderr.trim();
        let normalized = detail.to_ascii_lowercase();
        if [
            "usage limit",
            "rate limit",
            "rate_limit",
            "too many requests",
            "insufficient_quota",
            "quota exceeded",
            "credits exhausted",
            "limit reached",
            "weekly limit",
            "weighted tokens left",
        ]
        .iter()
        .any(|needle| normalized.contains(needle))
        {
            return format!(
                "{} usage limit reached. Switch to another model or runtime, or wait until your limit resets.",
                self.label
            );
        }
        if normalized.contains("context length") || normalized.contains("context_length_exceeded") {
            return format!(
                "{} could not continue because this chat is too long for the selected model. Start a new chat or shorten the conversation.",
                self.label
            );
        }
        if normalized.contains("unauthorized")
            || normalized.contains("authentication")
            || normalized.contains("not logged in")
        {
            return format!(
                "{} is not authenticated. Sign in to that CLI, then try again.",
                self.label
            );
        }
        if !detail.is_empty() {
            return detail.to_owned();
        }
        exit_status.map_or_else(
            || format!("{} returned no response", self.label),
            |status| format!("{} exited with {status}", self.label),
        )
    }

    pub fn models(self) -> Vec<String> {
        let Some((arguments, format)) = self.model_query else {
            return self
                .fallback_models
                .iter()
                .map(|model| (*model).to_owned())
                .collect();
        };
        discover_models(self.executable, arguments, format)
            .filter(|models| !models.is_empty())
            .unwrap_or_else(|| {
                self.fallback_models
                    .iter()
                    .map(|model| (*model).to_owned())
                    .collect()
            })
    }

    pub fn chat_command(self, model: &str, prompt: &str) -> Result<Vec<String>, String> {
        self.chat_command_with_permissions(model, prompt, "ask")
    }

    pub fn chat_command_with_permissions(
        self,
        model: &str,
        prompt: &str,
        permission_mode: &str,
    ) -> Result<Vec<String>, String> {
        let model = model.trim();
        if model.is_empty() {
            return Err("model must be a non-empty string".into());
        }
        if prompt.trim().is_empty() {
            return Err("prompt must be a non-empty string".into());
        }
        let prompt = format!("{MEMO_ONLY_INSTRUCTIONS}\n\nUSER REQUEST:\n{prompt}");
        let args = match self.id {
            "codex" => {
                let mut args = vec![
                    "exec".into(),
                    "--model".into(),
                    model.into(),
                    "--ignore-user-config".into(),
                    "--ignore-rules".into(),
                    "--ephemeral".into(),
                ];
                match permission_mode {
                    "auto" => args.push("--approve-for-me".into()),
                    "allow" => args.push("--dangerously-bypass-approvals-and-sandbox".into()),
                    "ask" | "allowlist" | "custom" => {
                        args.extend(["--sandbox".into(), "read-only".into()]);
                    }
                    _ => return Err(format!("Unknown permission mode: {permission_mode}")),
                }
                args.extend([
                    "--config".into(),
                    format!("mcp_servers.memo.url=\"{MEMO_MCP_URL}\""),
                    "--color".into(),
                    "never".into(),
                    "--skip-git-repo-check".into(),
                    prompt,
                ]);
                args
            }
            "hermes" => {
                let mut args = vec![
                    "chat".into(),
                    "--oneshot".into(),
                    "--quiet".into(),
                    "--ignore-rules".into(),
                    "--toolsets".into(),
                    "memo".into(),
                ];
                if model != "default" {
                    args.extend(["--model".into(), model.into()]);
                }
                args.extend(["--query".into(), prompt]);
                args
            }
            "antigravity" => vec![
                "--print".into(),
                prompt,
                "--model".into(),
                model.into(),
                "--output-format".into(),
                "text".into(),
                "--disable-slash-commands".into(),
                "--sandbox".into(),
            ],
            "ollama" => vec!["run".into(), model.into(), prompt],
            _ => {
                return Err(format!(
                    "{} chat integration is not implemented yet",
                    self.label
                ));
            }
        };
        Ok(args)
    }
}

pub const RUNTIMES: &[Runtime] = &[
    Runtime {
        id: "codex",
        label: "Codex CLI",
        executable: "codex",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Isolated,
        default_model: "gpt-5.6-luna",
        fallback_models: &[
            "gpt-5.6-luna",
            "gpt-5.6-sol",
            "gpt-6-sol",
            "gpt-6.1-sol",
            "gpt-6-astra",
        ],
        model_query: None,
    },
    Runtime {
        id: "claude",
        label: "Claude Code",
        executable: "claude",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Disabled,
        default_model: "sonnet",
        fallback_models: &["sonnet"],
        model_query: None,
    },
    Runtime {
        id: "antigravity",
        label: "Antigravity CLI",
        executable: "agy",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Isolated,
        default_model: "gemini-2.5-pro",
        fallback_models: &["gemini-2.5-pro"],
        model_query: Some((&["models"], ModelOutput::TabSeparated)),
    },
    Runtime {
        id: "opencode",
        label: "OpenCode",
        executable: "opencode",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Isolated,
        default_model: "default",
        fallback_models: &["default"],
        model_query: Some((&["models"], ModelOutput::Lines)),
    },
    Runtime {
        id: "ollama",
        label: "Ollama",
        executable: "ollama",
        model_flag: None,
        native_tools_policy: NativeToolsPolicy::NotApplicable,
        default_model: "qwen3",
        fallback_models: &["qwen3"],
        model_query: Some((&["list"], ModelOutput::Table)),
    },
    Runtime {
        id: "lmstudio",
        label: "LM Studio",
        executable: "lms",
        model_flag: None,
        native_tools_policy: NativeToolsPolicy::NotApplicable,
        default_model: "local-model",
        fallback_models: &["local-model"],
        model_query: Some((&["ls"], ModelOutput::Table)),
    },
    Runtime {
        id: "grok-build",
        label: "Grok Build",
        executable: "grok-build",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Isolated,
        default_model: "grok-4.6",
        fallback_models: &["grok-4.6"],
        model_query: None,
    },
    Runtime {
        id: "cursor",
        label: "Cursor Agent",
        executable: "cursor-agent",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Isolated,
        default_model: "auto",
        fallback_models: &["auto"],
        model_query: None,
    },
    Runtime {
        id: "hermes",
        label: "Hermes Agent",
        executable: "hermes",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Disabled,
        default_model: "default",
        fallback_models: &[
            "default",
            "anthropic/claude-sonnet-4",
            "anthropic/claude-opus-4",
            "openai/gpt-5.5",
            "openrouter:anthropic/claude-sonnet-4",
            "openrouter:google/gemini-2.5-pro",
            "openrouter:qwen/qwen3-coder",
        ],
        model_query: None,
    },
    Runtime {
        id: "pi",
        label: "Pi",
        executable: "pi",
        model_flag: Some("--model"),
        native_tools_policy: NativeToolsPolicy::Disabled,
        default_model: "default",
        fallback_models: &["default"],
        model_query: None,
    },
];

pub fn runtime(id: &str) -> Result<Runtime, String> {
    RUNTIMES
        .iter()
        .copied()
        .find(|runtime| runtime.id == id)
        .ok_or_else(|| format!("unknown runtime: {id}"))
}

pub fn statuses() -> Vec<RuntimeStatus> {
    RUNTIMES
        .iter()
        .copied()
        .map(|runtime| RuntimeStatus {
            installed: runtime.installed(),
            models: if runtime.installed() {
                runtime.models()
            } else {
                Vec::new()
            },
            runtime,
        })
        .collect()
}

fn discover_models(
    executable: &str,
    arguments: &[&str],
    format: ModelOutput,
) -> Option<Vec<String>> {
    let mut child = Command::new(executable)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline {
        if child.try_wait().ok().flatten().is_some() {
            let output = child.wait_with_output().ok()?;
            if !output.status.success() {
                return None;
            }
            return Some(parse_models(
                &String::from_utf8_lossy(&output.stdout),
                format,
            ));
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    None
}

fn parse_models(output: &str, format: ModelOutput) -> Vec<String> {
    let mut models = output
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .filter_map(|line| match format {
            ModelOutput::TabSeparated => line.split_once('\t').map(|(id, _)| id.trim()),
            ModelOutput::Table => line.split_whitespace().next(),
            ModelOutput::Lines => line.split_whitespace().next(),
        })
        .filter(|model| {
            !matches!(
                model.to_ascii_lowercase().as_str(),
                "name" | "model" | "models" | "fetching" | "available"
            )
        })
        .map(str::to_owned)
        .collect::<Vec<_>>();
    models.sort();
    models.dedup();
    models
}

fn executable_path(executable: &str) -> Option<PathBuf> {
    let extensions: Vec<String> = if cfg!(windows) {
        env::var("PATHEXT")
            .unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into())
            .split(';')
            .map(str::to_owned)
            .collect()
    } else {
        vec![String::new()]
    };
    env::split_paths(&env::var_os("PATH")?).find_map(|directory| {
        extensions.iter().find_map(|extension| {
            let candidate = directory.join(format!("{executable}{extension}"));
            candidate.is_file().then_some(candidate)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exposes_every_existing_runtime() {
        assert_eq!(RUNTIMES.len(), 10);
        assert_eq!(runtime("codex").unwrap().default_model, "gpt-5.6-luna");
        assert!(runtime("missing").is_err());
    }

    #[test]
    fn builds_model_aware_commands() {
        let args = vec!["run".to_owned()];
        assert_eq!(
            runtime("codex")
                .unwrap()
                .command("gpt-6-sol", &args)
                .unwrap(),
            ["codex", "--model", "gpt-6-sol", "run"]
        );
        assert_eq!(
            runtime("ollama").unwrap().command("qwen3", &args).unwrap(),
            ["ollama", "run"]
        );
    }

    #[test]
    fn parses_cli_model_formats() {
        assert_eq!(
            parse_models(
                "Fetching available models...\ngemini-pro\tGemini Pro\ngemini-flash\tGemini Flash\n",
                ModelOutput::TabSeparated,
            ),
            ["gemini-flash", "gemini-pro"]
        );
        assert_eq!(
            parse_models(
                "NAME ID SIZE\ngemma4:latest abc 9GB\nqwen3:latest def 5GB\n",
                ModelOutput::Table,
            ),
            ["gemma4:latest", "qwen3:latest"]
        );
    }

    #[test]
    fn builds_non_interactive_chat_commands() {
        let codex = runtime("codex")
            .unwrap()
            .chat_command("gpt-6-sol", "hello")
            .unwrap();
        assert!(
            codex
                .windows(2)
                .any(|args| args == ["--sandbox", "read-only"])
        );
        assert!(codex.iter().any(|arg| arg == "--ignore-user-config"));
        assert!(codex.iter().any(|arg| arg.contains("mcp_servers.memo.url")));
        assert!(codex.last().unwrap().contains(MEMO_ONLY_INSTRUCTIONS));

        let hermes = runtime("hermes")
            .unwrap()
            .chat_command("default", "hello")
            .unwrap();
        assert!(hermes.windows(2).any(|args| args == ["--toolsets", "memo"]));
        assert!(hermes.iter().any(|arg| arg == "--ignore-rules"));
        assert!(hermes.last().unwrap().contains(MEMO_ONLY_INSTRUCTIONS));
    }

    #[test]
    fn maps_memo_permission_modes_to_codex_flags() {
        let codex = runtime("codex").unwrap();
        let automatic = codex
            .chat_command_with_permissions("gpt-6-sol", "hello", "auto")
            .unwrap();
        assert!(automatic.iter().any(|arg| arg == "--approve-for-me"));

        let full_access = codex
            .chat_command_with_permissions("gpt-6-sol", "hello", "allow")
            .unwrap();
        assert!(
            full_access
                .iter()
                .any(|arg| arg == "--dangerously-bypass-approvals-and-sandbox")
        );
        assert!(!full_access.iter().any(|arg| arg == "--sandbox"));
    }

    #[test]
    fn explains_usage_limits_without_cli_noise() {
        let message = runtime("codex").unwrap().chat_failure_message(
            "OpenAI Codex v0.156.1\nsession id: secret\nYou've hit your usage limit",
            Some("exit code: 1"),
        );
        assert!(message.contains("usage limit reached"));
        assert!(message.contains("Switch to another model or runtime"));
        assert!(!message.contains("session id"));
    }
}
