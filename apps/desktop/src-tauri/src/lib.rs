use serde::{Deserialize, Serialize};
use std::{
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

#[derive(Default)]
struct GatewayProcess(Mutex<Option<Child>>);

#[derive(Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    workspace_path: Option<String>,
    resource_mode: Option<String>,
    composio_user_id: Option<String>,
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

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory.join("settings.json"))
}

fn read_settings(app: &AppHandle) -> Settings {
    settings_path(app)
        .ok()
        .and_then(|path| fs::read_to_string(path).ok())
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_settings(app: &AppHandle, settings: &Settings) -> Result<(), String> {
    fs::write(
        settings_path(app)?,
        serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())
}

fn composio_key() -> String {
    keyring::Entry::new("dev.memo.desktop", "composio")
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
    let workspace = settings.workspace_path.unwrap_or_else(|| {
        app.path()
            .app_data_dir()
            .unwrap_or_else(|_| root.clone())
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
        let key = composio_key();
        command
            .current_dir(&cwd)
            .env("GATEWAY_HOST", "127.0.0.1")
            .env("GATEWAY_PORT", "4010")
            .env("MEMO_COMPUTER_ENABLED", "1")
            .env("MEMO_SANDBOX_ROOT", workspace)
            .env("MEMO_RESOURCE_MODE", mode)
            .env("MEMO_SPEECH_CPU_THREADS", threads)
            .env("COMPOSIO_API_KEY", key)
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
    let destination = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("checkpoints")
        .join(format!(
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

#[tauri::command]
fn composio_key_status() -> serde_json::Value {
    serde_json::json!({ "hasKey": !composio_key().is_empty() })
}

#[tauri::command]
fn set_composio_key(
    key: String,
    app: AppHandle,
    state: State<'_, GatewayProcess>,
) -> Result<serde_json::Value, String> {
    if key.trim().is_empty() {
        return Err("Composio API key is required.".into());
    }
    keyring::Entry::new("dev.memo.desktop", "composio")
        .map_err(|error| error.to_string())?
        .set_password(key.trim())
        .map_err(|error| error.to_string())?;
    restart_gateway(state, app)?;
    Ok(serde_json::json!({ "saved": true }))
}

pub fn run() {
    tauri::Builder::default()
        .manage(GatewayProcess::default())
        .setup(|app| {
            launch_gateway(app.state::<GatewayProcess>().inner(), app.handle())?;
            let deadline = Instant::now() + Duration::from_secs(2);
            while Instant::now() < deadline && !gateway_online() {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            platform,
            minimize,
            toggle_maximize,
            close,
            gateway_status,
            restart_gateway,
            workspace_get,
            workspace_choose,
            workspace_checkpoint,
            resource_get,
            resource_set,
            composio_key_status,
            set_composio_key
        ])
        .run(tauri::generate_context!())
        .expect("error while running Memo");
}
