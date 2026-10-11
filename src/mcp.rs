use rmcp::{handler::server::wrapper::Parameters, schemars, tool, tool_router};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    env, fs,
    path::PathBuf,
    sync::{Arc, OnceLock},
    time::Duration,
};
use tokio::process::Command;

use crate::{api::run_cli, runtimes};

#[derive(Clone)]
pub struct MemoMcp {
    working_directory: PathBuf,
    cua_driver: Arc<OnceLock<Result<Arc<cua_driver_sdk::CuaDriver>, String>>>,
}

impl MemoMcp {
    pub fn new(
        working_directory: PathBuf,
        cua_driver: Arc<OnceLock<Result<Arc<cua_driver_sdk::CuaDriver>, String>>>,
    ) -> Self {
        Self {
            working_directory,
            cua_driver,
        }
    }

    fn cua_driver(&self) -> Result<&Arc<cua_driver_sdk::CuaDriver>, &str> {
        self.cua_driver
            .get_or_init(|| {
                cua_driver_sdk::CuaDriver::create(None)
                    .map_err(|error| format!("Could not initialize CUA Driver: {error}"))
            })
            .as_ref()
            .map_err(String::as_str)
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

#[derive(Clone, Copy, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommandTarget {
    #[default]
    Host,
    LocalVm,
    #[serde(alias = "vps")]
    Cloud,
}

#[derive(Debug, Deserialize, schemars::JsonSchema)]
pub struct RunCommandArgs {
    /// Shell command to execute.
    pub cmd: String,
    /// Execution destination. Defaults to this PC and never falls back between targets.
    #[serde(default)]
    pub target: CommandTarget,
    /// Working directory. Defaults to Memo's workspace on this PC and /workspace elsewhere.
    pub cwd: Option<String>,
    /// Maximum run time in seconds, from 1 through 300. Defaults to 60.
    pub timeout_seconds: Option<u64>,
}

const READ_ONLY_CUA_TOOLS: &[&str] = &[
    "clipboard_read",
    "get_accessibility_tree",
    "get_agent_cursor_state",
    "get_browser_state",
    "get_cursor_position",
    "get_desktop_state",
    "get_screen_size",
    "get_window_state",
    "list_apps",
    "list_windows",
    "parse_visual_regions",
    "verify_state",
    "zoom",
];

fn is_read_only_cua_tool(tool: &str) -> bool {
    READ_ONLY_CUA_TOOLS.contains(&tool)
}

fn home_directory() -> Result<PathBuf, String> {
    env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .map(PathBuf::from)
        .ok_or_else(|| "Home directory is unavailable".to_owned())
}

fn vps_setting(name: &str) -> Option<String> {
    let environment_name = format!("MEMO_VPS_SSH_{}", name.to_ascii_uppercase());
    if let Ok(value) = env::var(environment_name)
        && !value.trim().is_empty()
    {
        return Some(value);
    }
    let config = fs::read_to_string(home_directory().ok()?.join(".memo/config.toml")).ok()?;
    let value = config.parse::<toml::Value>().ok()?;
    let table = value.get("vps")?;
    let value = table.get(name).or_else(|| {
        (name == "identity_file")
            .then(|| table.get("identityFile"))
            .flatten()
    })?;
    value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_integer().map(|number| number.to_string()))
}

async fn local_container_engine() -> Result<&'static str, String> {
    for engine in ["podman", "docker"] {
        if Command::new(engine)
            .args(["container", "inspect", "memo-cua-desktop"])
            .output()
            .await
            .is_ok_and(|output| output.status.success())
        {
            return Ok(engine);
        }
    }
    Err("The memo-cua-desktop container is not running in Podman or Docker".into())
}

#[cfg(target_os = "macos")]
async fn macos_sandbox_engine() -> Result<&'static str, String> {
    for engine in ["podman", "docker"] {
        if Command::new(engine)
            .args(["image", "inspect", "memo-cua-desktop:local"])
            .output()
            .await
            .is_ok_and(|output| output.status.success())
        {
            return Ok(engine);
        }
    }
    Err("The memo-cua-desktop:local sandbox image is unavailable in Podman or Docker; the command was not run.".into())
}

fn append_limited(destination: &mut String, bytes: &[u8]) {
    const MAX_OUTPUT_BYTES: usize = 256 * 1024;
    let take = bytes.len().min(MAX_OUTPUT_BYTES);
    destination.push_str(&String::from_utf8_lossy(&bytes[..take]));
    if bytes.len() > take {
        destination.push_str("\n[output truncated by Memo]");
    }
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(windows)]
fn windows_sandbox_runner() -> Result<PathBuf, String> {
    let configured = env::var_os("MEMO_WINDOWS_SANDBOX_RUNNER")
        .filter(|value| !value.is_empty())
        .map(PathBuf::from);
    let executable_sibling = env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("MemoSandbox.exe")));
    let development_runner = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(".sandbox-build")
        .join("MemoSandbox.exe");

    configured
        .into_iter()
        .chain(executable_sibling)
        .chain([development_runner])
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Memo's Windows command sandbox is unavailable. Repair Memo or use target=local_vm; the command was not run."
                .to_owned()
        })
}

fn host_sandbox_name() -> &'static str {
    #[cfg(windows)]
    return "memo_windows_native";
    #[cfg(target_os = "macos")]
    return "macos_container";
    #[cfg(target_os = "linux")]
    return "linux_bubblewrap";
    #[allow(unreachable_code)]
    "unsupported"
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
        let driver = match self.cua_driver() {
            Ok(driver) => driver,
            Err(error) => return json!({"error": {"message": error}}).to_string(),
        };
        driver
            .list_tools_json()
            .await
            .unwrap_or_else(|error| json!({"error": {"message": error.to_string()}}).to_string())
    }

    #[tool(
        description = "Invoke a strictly read-only CUA Driver observation tool. Supports app/window discovery, desktop and window screenshots, accessibility trees, state verification, browser inspection, visual-region parsing, zoomed captures, cursor/screen state, and clipboard reads. Call cua_list_tools for exact schemas.",
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

        let driver = match self.cua_driver() {
            Ok(driver) => driver,
            Err(error) => return json!({"error": {"message": error}}).to_string(),
        };
        match driver
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
        let driver = match self.cua_driver() {
            Ok(driver) => driver,
            Err(error) => return json!({"error": {"message": error}}).to_string(),
        };
        match driver
            .call_tool(args.tool, args.arguments.to_string())
            .await
        {
            Ok(result) => result.raw_json,
            Err(error) => json!({"error": {"message": error.to_string()}}).to_string(),
        }
    }
    #[tool(
        description = "Run a shell command on one explicit destination: host (this PC), local_vm (the running memo-cua-desktop Podman/Docker container), or cloud/vps (the configured VPS over SSH). Targets never fall back to another machine.",
        annotations(
            title = "Run command",
            read_only_hint = false,
            destructive_hint = true,
            idempotent_hint = false,
            open_world_hint = true
        )
    )]
    async fn run_command(&self, Parameters(args): Parameters<RunCommandArgs>) -> String {
        if args.cmd.trim().is_empty() {
            return json!({"error": {"message": "cmd must not be empty"}}).to_string();
        }
        let timeout_seconds = args.timeout_seconds.unwrap_or(60);
        if !(1..=300).contains(&timeout_seconds) {
            return json!({"error": {"message": "timeout_seconds must be between 1 and 300"}})
                .to_string();
        }

        let target_name = match args.target {
            CommandTarget::Host => "host",
            CommandTarget::LocalVm => "local_vm",
            CommandTarget::Cloud => "cloud",
        };
        let sandbox_name = match args.target {
            CommandTarget::Host => host_sandbox_name(),
            CommandTarget::LocalVm => "local_vm_container",
            CommandTarget::Cloud => "cloud_cua_container",
        };
        let command = match args.target {
            CommandTarget::Host => {
                let cwd = args
                    .cwd
                    .as_deref()
                    .map(PathBuf::from)
                    .unwrap_or_else(|| self.working_directory.clone());
                if !cwd.is_dir() {
                    return json!({"error": {"message": format!("Working directory does not exist: {}", cwd.display())}}).to_string();
                }
                #[cfg(not(windows))]
                let cwd = match fs::canonicalize(&cwd) {
                    Ok(path) => path,
                    Err(error) => return json!({"error": {"message": format!("Could not resolve working directory: {error}")}}).to_string(),
                };
                #[cfg(windows)]
                {
                    let runner = match windows_sandbox_runner() {
                        Ok(runner) => runner,
                        Err(error) => return json!({"error": {"message": error}}).to_string(),
                    };
                    let mut command = Command::new(runner);
                    command.args(["--cwd", &cwd.to_string_lossy(), "--", &args.cmd]);
                    command.current_dir(cwd);
                    command
                }
                #[cfg(target_os = "macos")]
                {
                    let engine = match macos_sandbox_engine().await {
                        Ok(engine) => engine,
                        Err(error) => return json!({"error": {"message": error}}).to_string(),
                    };
                    let mount = format!("{}:/workspace:rw", cwd.display());
                    let mut command = Command::new(engine);
                    command.args([
                        "run",
                        "--rm",
                        "--network",
                        "none",
                        "--read-only",
                        "--cap-drop",
                        "ALL",
                        "--security-opt",
                        "no-new-privileges",
                        "--pids-limit",
                        "32",
                        "--memory",
                        "1g",
                        "--tmpfs",
                        "/tmp:rw,noexec,nosuid,size=64m",
                        "--volume",
                        &mount,
                        "--workdir",
                        "/workspace",
                        "--entrypoint",
                        "/bin/sh",
                        "memo-cua-desktop:local",
                        "-lc",
                        &args.cmd,
                    ]);
                    command
                }
                #[cfg(target_os = "linux")]
                {
                    if !Command::new("bwrap")
                        .arg("--version")
                        .output()
                        .await
                        .is_ok_and(|output| output.status.success())
                    {
                        return json!({"error": {"message": "Bubblewrap (bwrap) is unavailable; install it or use target=local_vm. The command was not run."}}).to_string();
                    }
                    let cwd_text = cwd.to_string_lossy().into_owned();
                    let path =
                        env::var("PATH").unwrap_or_else(|_| "/usr/local/bin:/usr/bin:/bin".into());
                    let mut command = Command::new("bwrap");
                    command.args([
                        "--die-with-parent",
                        "--new-session",
                        "--unshare-all",
                        "--ro-bind",
                        "/",
                        "/",
                        "--bind",
                        &cwd_text,
                        &cwd_text,
                        "--tmpfs",
                        "/tmp",
                        "--proc",
                        "/proc",
                        "--dev",
                        "/dev",
                        "--chdir",
                        &cwd_text,
                        "--clearenv",
                        "--setenv",
                        "PATH",
                        &path,
                        "--setenv",
                        "HOME",
                        "/tmp",
                        "--",
                        "/bin/sh",
                        "-lc",
                        &args.cmd,
                    ]);
                    command
                }
                #[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
                {
                    return json!({"error": {"message": "Sandboxed host commands are unsupported on this platform; the command was not run."}}).to_string();
                }
            }
            CommandTarget::LocalVm => {
                let engine = match local_container_engine().await {
                    Ok(engine) => engine,
                    Err(error) => return json!({"error": {"message": error}}).to_string(),
                };
                let mut command = Command::new(engine);
                command.args(["exec", "-w", args.cwd.as_deref().unwrap_or("/workspace")]);
                command.args(["memo-cua-desktop", "sh", "-lc", &args.cmd]);
                command
            }
            CommandTarget::Cloud => {
                let Some(host) = vps_setting("host") else {
                    return json!({"error": {"message": "Cloud VPS is not configured. Set [vps].host and [vps].user in ~/.memo/config.toml or MEMO_VPS_SSH_HOST and MEMO_VPS_SSH_USER."}}).to_string();
                };
                let Some(user) = vps_setting("user") else {
                    return json!({"error": {"message": "Cloud VPS SSH user is not configured"}})
                        .to_string();
                };
                let port = vps_setting("port").unwrap_or_else(|| "22".into());
                let mut command = Command::new("ssh");
                command.args([
                    "-o",
                    "BatchMode=yes",
                    "-o",
                    "ConnectTimeout=10",
                    "-p",
                    &port,
                ]);
                if let Some(identity_file) = vps_setting("identity_file") {
                    command.args(["-i", &identity_file]);
                }
                command.arg(format!("{user}@{host}"));
                let remote_command = format!(
                    "engine=$(command -v podman || command -v docker) || exit 127; \"$engine\" exec -w {} memo-cua-desktop sh -lc {}",
                    shell_quote(args.cwd.as_deref().unwrap_or("/workspace")),
                    shell_quote(&args.cmd),
                );
                command.args(["--", &remote_command]);
                command
            }
        };

        let mut command = command;
        command.kill_on_drop(true);
        let output = match tokio::time::timeout(
            Duration::from_secs(timeout_seconds),
            command.output(),
        )
        .await
        {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => {
                return json!({"error": {"message": format!("Could not run command on {target_name}: {error}")}}).to_string();
            }
            Err(_) => {
                return json!({"error": {"message": format!("Command on {target_name} timed out after {timeout_seconds} seconds")}}).to_string();
            }
        };
        let mut stdout = String::new();
        let mut stderr = String::new();
        append_limited(&mut stdout, &output.stdout);
        append_limited(&mut stderr, &output.stderr);
        json!({
            "target": target_name,
            "sandbox": sandbox_name,
            "os_isolated": true,
            "exit_code": output.status.code(),
            "success": output.status.success(),
            "stdout": stdout,
            "stderr": stderr,
        })
        .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::{CommandTarget, append_limited, is_read_only_cua_tool, shell_quote};

    #[test]
    fn observation_allowlist_excludes_actions() {
        for tool in [
            "clipboard_read",
            "get_accessibility_tree",
            "get_browser_state",
            "get_desktop_state",
            "get_window_state",
            "list_apps",
            "list_windows",
            "parse_visual_regions",
            "verify_state",
            "zoom",
        ] {
            assert!(is_read_only_cua_tool(tool));
        }

        for tool in ["click", "type_text", "launch_app", "clipboard_write"] {
            assert!(!is_read_only_cua_tool(tool));
        }
    }

    #[test]
    fn command_targets_are_explicit_and_default_to_host() {
        assert!(matches!(CommandTarget::default(), CommandTarget::Host));
        let local: CommandTarget = serde_json::from_str("\"local_vm\"").unwrap();
        let cloud: CommandTarget = serde_json::from_str("\"cloud\"").unwrap();
        let vps: CommandTarget = serde_json::from_str("\"vps\"").unwrap();
        assert!(matches!(local, CommandTarget::LocalVm));
        assert!(matches!(cloud, CommandTarget::Cloud));
        assert!(matches!(vps, CommandTarget::Cloud));
    }

    #[test]
    fn command_output_is_bounded() {
        let mut output = String::new();
        append_limited(&mut output, &vec![b'x'; 300 * 1024]);
        assert!(output.len() < 300 * 1024);
        assert!(output.ends_with("[output truncated by Memo]"));
    }

    #[test]
    fn remote_commands_are_shell_quoted() {
        assert_eq!(shell_quote("echo 'hello'"), "'echo '\\''hello'\\'''");
    }
}
