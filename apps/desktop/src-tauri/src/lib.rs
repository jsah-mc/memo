use serde::{Deserialize, Serialize};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    sync::Mutex,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager, State, WebviewWindow};

const GATEWAY_ADDRESS: &str = "127.0.0.1:4010";
const RUST_API_ADDRESS: &str = "127.0.0.1:6734";
const MEMO_MCP_URL: &str = "http://127.0.0.1:6734/mcp";
const COMPOSIO_BROKER_URL: &str = "https://memo-composio-broker.vercel.app";
static CHAT_HISTORY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Default)]
struct GatewayProcess(Mutex<Option<Child>>);

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    workspace_path: Option<String>,
    resource_mode: Option<String>,
    composio_user_id: Option<String>,
    permission_mode: Option<String>,
}

fn memo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap_or_else(|_| PathBuf::from("../.."))
}

fn gateway_online() -> bool {
    let Some(address) = GATEWAY_ADDRESS.parse::<SocketAddr>().ok() else {
        return false;
    };
    let Some(mut stream) = TcpStream::connect_timeout(&address, Duration::from_millis(350)).ok()
    else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    if stream
        .write_all(
            b"GET /health/liveliness HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n",
        )
        .is_err()
    {
        return false;
    }
    let mut response = [0_u8; 64];
    stream
        .read(&mut response)
        .is_ok_and(|size| response[..size].starts_with(b"HTTP/1.1 200"))
}

fn rust_api_online() -> bool {
    RUST_API_ADDRESS
        .parse::<SocketAddr>()
        .ok()
        .is_some_and(|address| {
            TcpStream::connect_timeout(&address, Duration::from_millis(350)).is_ok()
        })
}

fn configure_mcp_clients() {
    let registrations: &[(&str, &[&str])] = &[
        ("codex", &["mcp", "add", "memo", "--url", MEMO_MCP_URL]),
        ("hermes", &["mcp", "add", "memo", "--url", MEMO_MCP_URL]),
        (
            "agy",
            &["mcp", "add", "--type", "http", "memo", MEMO_MCP_URL],
        ),
    ];
    for (executable, arguments) in registrations {
        if memo::runtimes::RUNTIMES
            .iter()
            .any(|runtime| runtime.executable == *executable && runtime.installed())
        {
            let mut command = Command::new(executable);
            command
                .args(*arguments)
                .stdin(Stdio::piped())
                .stdout(Stdio::null())
                .stderr(Stdio::null());
            #[cfg(windows)]
            command.creation_flags(0x08000000);
            if let Ok(mut child) = command.spawn() {
                if let Some(mut stdin) = child.stdin.take() {
                    let _ = stdin.write_all(b"n\ny\n");
                }
                let _ = child.wait();
            }
        }
    }
}

fn memo_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .home_dir()
        .map_err(|error| error.to_string())?
        .join(".memo");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(memo_data_dir(app)?.join("config.toml"))
}

fn read_settings(app: &AppHandle) -> Settings {
    if let Some(settings) = settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| toml::from_str(&text).ok())
    {
        return settings;
    }

    let legacy = app
        .path()
        .app_data_dir()
        .ok()
        .map(|directory| directory.join("settings.json"))
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str::<Settings>(&text).ok());
    if let Some(settings) = legacy {
        let _ = write_settings(app, &settings);
        return settings;
    }
    Settings::default()
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    fs::write(
        settings_path(app)?,
        toml::to_string_pretty(settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn chat_history_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(memo_data_dir(app)?.join("chat-history.json"))
}

fn read_chat_history(app: &AppHandle) -> BTreeMap<String, String> {
    chat_history_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_chat_history(app: &AppHandle, history: &BTreeMap<String, String>) -> Result<(), String> {
    fs::write(
        chat_history_path(app)?,
        serde_json::to_vec_pretty(history).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
async fn chat_history_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHAT_HISTORY_LOCK
            .lock()
            .map_err(|_| "Chat history lock poisoned")?;
        Ok(read_chat_history(&app).remove(&key))
    })
    .await
    .map_err(|error| format!("Chat history read task failed: {error}"))?
}

#[tauri::command]
async fn chat_history_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHAT_HISTORY_LOCK
            .lock()
            .map_err(|_| "Chat history lock poisoned")?;
        let mut history = read_chat_history(&app);
        history.insert(key, value);
        write_chat_history(&app, &history)
    })
    .await
    .map_err(|error| format!("Chat history write task failed: {error}"))?
}

#[tauri::command]
async fn chat_history_remove(app: AppHandle, key: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = CHAT_HISTORY_LOCK
            .lock()
            .map_err(|_| "Chat history lock poisoned")?;
        let mut history = read_chat_history(&app);
        history.remove(&key);
        write_chat_history(&app, &history)
    })
    .await
    .map_err(|error| format!("Chat history write task failed: {error}"))?
}

#[tauri::command]
fn permission_mode_get(app: AppHandle) -> String {
    read_settings(&app)
        .permission_mode
        .filter(|mode| {
            matches!(
                mode.as_str(),
                "ask" | "auto" | "allow" | "allowlist" | "custom"
            )
        })
        .unwrap_or_else(|| "ask".into())
}

#[tauri::command]
fn permission_mode_set(app: AppHandle, mode: String) -> Result<(), String> {
    if !matches!(
        mode.as_str(),
        "ask" | "auto" | "allow" | "allowlist" | "custom"
    ) {
        return Err("Invalid permission mode.".into());
    }
    let mut settings = read_settings(&app);
    settings.permission_mode = Some(mode);
    write_settings(&app, &settings)
}

fn composio_broker_token() -> String {
    keyring::Entry::new("dev.memo.desktop", "composio-broker")
        .ok()
        .and_then(|entry| entry.get_password().ok())
        .unwrap_or_default()
}

fn launch_gateway(state: &GatewayProcess, app: &AppHandle) -> Result<(), String> {
    if gateway_online() {
        return Ok(());
    }
    let mut managed = state.0.lock().map_err(|_| "Gateway lock poisoned")?;
    if managed
        .as_mut()
        .is_some_and(|child| child.try_wait().ok().flatten().is_none())
    {
        return Ok(());
    }

    let root = memo_root();
    let resource_gateway = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?
        .join("gateway");
    let bundled_python = resource_gateway.join(if cfg!(windows) {
        "runtime/python.exe"
    } else {
        "runtime/bin/python3"
    });
    let development_python = if cfg!(windows) {
        root.join(".venv/Scripts/python.exe")
    } else {
        root.join(".venv/bin/python")
    };
    let (mut command, cwd) = if bundled_python.exists() {
        let mut command = Command::new(bundled_python);
        command.args([resource_gateway.join("app/gateway_entry.py").as_os_str()]);
        (command, resource_gateway)
    } else if development_python.exists() {
        let mut command = Command::new(development_python);
        command.args([root.join("main.py").as_os_str(), "gateway".as_ref()]);
        (command, root.clone())
    } else {
        let mut command = Command::new(if cfg!(windows) { "uv.exe" } else { "uv" });
        command.args(["run", "memo", "gateway"]);
        (command, root.clone())
    };
    let settings = read_settings(app);
    let data_directory = memo_data_dir(app).unwrap_or_else(|_| root.join(".memo"));
    let workspace = settings.workspace_path.unwrap_or_else(|| {
        data_directory
            .clone()
            .join("workspace")
            .to_string_lossy()
            .into_owned()
    });
    let mode = settings.resource_mode.as_deref().unwrap_or("balanced");
    let threads = match mode {
        "low" => "2",
        "performance" => "8",
        _ => "4",
    };
    let mut command = {
        let broker_token = composio_broker_token();
        command
            .current_dir(&cwd)
            .env("GATEWAY_HOST", "127.0.0.1")
            .env("GATEWAY_PORT", "4010")
            .env("MEMO_COMPUTER_ENABLED", "1")
            .env("MEMO_AGENT_STORE", data_directory.join("agents.json"))
            .env("MEMO_SANDBOX_ROOT", workspace)
            .env("MEMO_RESOURCE_MODE", mode)
            .env("MEMO_SPEECH_CPU_THREADS", threads)
            .env("MEMO_COMPOSIO_BROKER_URL", COMPOSIO_BROKER_URL)
            .env("MEMO_COMPOSIO_BROKER_TOKEN", broker_token)
            .env("MEMO_COMPOSIO_USER_ID", "memo-desktop")
            .env("MEMO_SPEECH_PRELOAD", "0")
            .env("MEMO_STT_PRELOAD", "0");
        command
    };
    let child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Could not start Memo gateway: {error}"))?;
    *managed = Some(child);
    Ok(())
}

#[tauri::command]
fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

#[tauri::command]
async fn runtime_list() -> Result<Vec<memo::runtimes::RuntimeStatus>, String> {
    tauri::async_runtime::spawn_blocking(memo::runtimes::statuses)
        .await
        .map_err(|error| format!("Runtime discovery task failed: {error}"))
}

#[tauri::command]
async fn runtime_chat(
    app: AppHandle,
    runtime: String,
    model: String,
    prompt: String,
    permission_mode: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = memo::runtimes::runtime(&runtime)?;
        if !runtime.installed() {
            return Err(format!(
                "{} is not installed or is not on PATH",
                runtime.label
            ));
        }
        let arguments =
            runtime.chat_command_with_permissions(&model, &prompt, &permission_mode)?;
        let mut command = Command::new(runtime.executable);
        command.args(arguments).stdin(Stdio::null());
        if let Some(workspace) = read_settings(&app).workspace_path
            && Path::new(&workspace).is_dir()
        {
            command.current_dir(workspace);
        }
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let output = command
            .output()
            .map_err(|error| format!("Could not start {}: {error}", runtime.label))?;
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
        if !output.status.success() {
            return Err(runtime.chat_failure_message(&stderr, Some(&output.status.to_string())));
        }
        if stdout.is_empty() {
            return Err(runtime.chat_failure_message(&stderr, None));
        }
        Ok(stdout)
    })
    .await
    .map_err(|error| format!("Runtime chat task failed: {error}"))?
}

#[tauri::command]
fn minimize(window: WebviewWindow) -> Result<(), String> {
    window.minimize().map_err(|error| error.to_string())
}

#[tauri::command]
fn toggle_maximize(window: WebviewWindow) -> Result<(), String> {
    if window.is_maximized().map_err(|error| error.to_string())? {
        window.unmaximize()
    } else {
        window.maximize()
    }
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn close(window: WebviewWindow) -> Result<(), String> {
    window.close().map_err(|error| error.to_string())
}

#[tauri::command]
fn open_external(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only secure web links can be opened.".into());
    }
    let status = if cfg!(target_os = "windows") {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .status()
    } else if cfg!(target_os = "macos") {
        Command::new("open").arg(&url).status()
    } else {
        Command::new("xdg-open").arg(&url).status()
    }
    .map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err("Could not open the sign-in page.".into())
    }
}

#[tauri::command]
fn gateway_status() -> serde_json::Value {
    let online = gateway_online();
    serde_json::json!({
        "state": if online { "online" } else { "connecting" },
        "running": online,
        "latencyMs": null
    })
}

#[tauri::command]
fn restart_gateway(state: State<'_, GatewayProcess>, app: AppHandle) -> Result<(), String> {
    if let Ok(mut managed) = state.0.lock()
        && let Some(mut child) = managed.take()
    {
        let _ = child.kill();
    }
    launch_gateway(&state, &app)
}

fn run_git(workspace: &str, args: &[&str]) -> Result<Output, String> {
    Command::new("git")
        .args(args)
        .current_dir(workspace)
        .output()
        .map_err(|error| error.to_string())
}

fn workspace_value(path: Option<String>) -> serde_json::Value {
    let Some(path) = path.filter(|value| Path::new(value).exists()) else {
        return serde_json::json!({ "path": "", "name": "No project selected", "git": false, "changes": 0 });
    };
    let status = run_git(&path, &["status", "--porcelain"]);
    let git = status.as_ref().is_ok_and(|output| output.status.success());
    let changes = status
        .ok()
        .map(|output| String::from_utf8_lossy(&output.stdout).lines().count())
        .unwrap_or(0);
    let name = Path::new(&path)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Workspace");
    serde_json::json!({ "path": path, "name": name, "git": git, "changes": changes })
}

#[tauri::command]
fn workspace_get(app: AppHandle) -> serde_json::Value {
    workspace_value(read_settings(&app).workspace_path)
}

#[tauri::command]
fn workspace_choose(
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<serde_json::Value, String> {
    let Some(path) = rfd::FileDialog::new()
        .set_title("Choose project workspace")
        .pick_folder()
    else {
        return Ok(workspace_get(app));
    };
    let mut settings = read_settings(&app);
    settings.workspace_path = Some(path.to_string_lossy().into_owned());
    write_settings(&app, &settings)?;
    restart_gateway(state, app.clone())?;
    Ok(workspace_get(app))
}

#[tauri::command]
fn workspace_checkpoint(label: String, app: AppHandle) -> Result<serde_json::Value, String> {
    let workspace = read_settings(&app)
        .workspace_path
        .ok_or("Choose a project workspace first.")?;
    let status = run_git(&workspace, &["status", "--porcelain"])?;
    if !status.status.success() {
        return Err("Checkpoints currently require a Git project.".into());
    }
    let diff = run_git(&workspace, &["diff", "--binary", "HEAD"])?;
    let untracked = run_git(&workspace, &["ls-files", "--others", "--exclude-standard"])?;
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis()
        .to_string();
    let safe_label: String = label
        .chars()
        .map(|value| {
            if value.is_ascii_alphanumeric() || value == '-' || value == '_' {
                value
            } else {
                '-'
            }
        })
        .take(48)
        .collect();
    let destination = memo_data_dir(&app)?.join("checkpoints").join(format!(
        "{id}-{}",
        if safe_label.is_empty() {
            "checkpoint"
        } else {
            &safe_label
        }
    ));
    fs::create_dir_all(&destination).map_err(|error| error.to_string())?;
    fs::write(destination.join("changes.patch"), diff.stdout).map_err(|error| error.to_string())?;
    let changes = String::from_utf8_lossy(&status.stdout).lines().count();
    let untracked_files = String::from_utf8_lossy(&untracked.stdout).lines().count();
    fs::write(destination.join("checkpoint.json"), serde_json::to_vec_pretty(&serde_json::json!({ "id": id, "label": label, "workspacePath": workspace, "changes": changes, "untrackedFiles": untracked_files })).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
    Ok(
        serde_json::json!({ "id": id, "path": destination, "changes": changes, "untrackedFiles": untracked_files }),
    )
}

#[tauri::command]
fn resource_get(app: AppHandle) -> serde_json::Value {
    serde_json::json!({ "mode": read_settings(&app).resource_mode.unwrap_or_else(|| "balanced".into()) })
}

#[tauri::command]
fn resource_set(
    mode: String,
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<serde_json::Value, String> {
    if !["low", "balanced", "performance"].contains(&mode.as_str()) {
        return Err("Invalid resource mode.".into());
    }
    let mut settings = read_settings(&app);
    settings.resource_mode = Some(mode.clone());
    write_settings(&app, &settings)?;
    restart_gateway(state, app)?;
    Ok(serde_json::json!({ "mode": mode }))
}

pub fn run() {
    tauri::Builder::default()
        .manage(GatewayProcess::default())
        .setup(|app| {
            launch_gateway(app.state::<GatewayProcess>().inner(), app.handle())?;
            let rust_api_workspace = read_settings(app.handle())
                .workspace_path
                .map(PathBuf::from)
                .filter(|path| path.is_dir())
                .unwrap_or_else(memo_root);
            tauri::async_runtime::spawn(async move {
                if let Err(error) = memo::api::serve_in(rust_api_workspace).await {
                    eprintln!("Memo Rust API stopped: {error}");
                }
            });
            std::thread::spawn(|| {
                let deadline = Instant::now() + Duration::from_secs(5);
                while Instant::now() < deadline && !rust_api_online() {
                    std::thread::sleep(Duration::from_millis(100));
                }
                if rust_api_online() {
                    configure_mcp_clients();
                }
            });
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline && !gateway_online() {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform,
            runtime_list,
            runtime_chat,
            chat_history_get,
            chat_history_set,
            chat_history_remove,
            permission_mode_get,
            permission_mode_set,
            minimize,
            toggle_maximize,
            close,
            open_external,
            gateway_status,
            restart_gateway,
            workspace_get,
            workspace_choose,
            workspace_checkpoint,
            resource_get,
            resource_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running Memo");
}
