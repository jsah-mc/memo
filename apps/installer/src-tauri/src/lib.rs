use serde::Serialize;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize)]
struct Prerequisite {
    name: String,
    installed: bool,
    required: bool,
    path: Option<String>,
}

#[derive(Serialize)]
struct InstallStatus {
    installed: bool,
    app_dir: String,
    version: Option<String>,
}

fn memo_root() -> PathBuf {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_else(|_| ".".to_string());
    PathBuf::from(home).join(".memo")
}

fn command_path(cmd: &str) -> Option<String> {
    let finder = if cfg!(windows) { "where" } else { "which" };
    Command::new(finder)
        .arg(cmd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .next()
                .map(|l| l.trim().to_string())
        })
}

fn find_install_script(app: &AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "install.ps1"
    } else {
        "install.sh"
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        candidates.push(dir.join(name));
    }
    // Dev fallback: repo root relative to this crate.
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("..")
            .join(name),
    );
    candidates.into_iter().find(|p| p.exists())
}

#[tauri::command]
fn prerequisites() -> Vec<Prerequisite> {
    let check = |name: &str, cmd: &str, required: bool| {
        let path = command_path(cmd);
        Prerequisite {
            name: name.to_string(),
            installed: path.is_some(),
            required,
            path,
        }
    };
    vec![
        check("Git", "git", true),
        check("Node.js", "node", false),
        check("pnpm", "pnpm", false),
        check("uv", "uv", false),
    ]
}

#[tauri::command]
fn install_status() -> InstallStatus {
    let app_dir = memo_root().join("app");
    let version = std::fs::read_to_string(app_dir.join("package.json"))
        .ok()
        .and_then(|s| {
            serde_json::from_str::<serde_json::Value>(&s)
                .ok()
                .and_then(|v| v["version"].as_str().map(String::from))
        });
    InstallStatus {
        installed: app_dir.join(".git").exists(),
        app_dir: app_dir.display().to_string(),
        version,
    }
}

fn spawn_reader(app: AppHandle, stream: &'static str, reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        for line in BufReader::new(reader).lines() {
            match line {
                Ok(l) => {
                    let _ = app.emit(
                        "install:output",
                        serde_json::json!({ "stream": stream, "line": l }),
                    );
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
async fn run_install(app: AppHandle) -> Result<i32, String> {
    let script = find_install_script(&app)
        .ok_or_else(|| "Could not locate the Memo install script.".to_string())?;

    tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = if cfg!(windows) {
            let mut c = Command::new("powershell.exe");
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"])
                .arg(&script);
            c
        } else {
            let mut c = Command::new("sh");
            c.arg(&script);
            c
        };
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Failed to start installer: {e}"))?;

        let stdout = child.stdout.take().expect("stdout piped");
        let stderr = child.stderr.take().expect("stderr piped");
        spawn_reader(app.clone(), "stdout", Box::new(stdout));
        spawn_reader(app.clone(), "stderr", Box::new(stderr));

        let status = child.wait().map_err(|e| format!("Installer failed: {e}"))?;
        let code = status.code().unwrap_or(-1);
        let _ = app.emit("install:done", code);
        Ok::<i32, String>(code)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn launch_memo(target: &str) -> Result<(), String> {
    let bin = memo_root().join("bin");
    let program = if cfg!(windows) {
        bin.join("memo.cmd")
    } else {
        bin.join("memo")
    };
    if !program.exists() {
        return Err("Memo CLI not found. Run the installer first.".to_string());
    }
    let mut cmd = if cfg!(windows) {
        let mut c = Command::new("cmd.exe");
        c.args(["/c", &format!("\"{}\" {}", program.display(), target)]);
        c
    } else {
        let mut c = Command::new(&program);
        c.arg(target);
        c
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.spawn()
        .map_err(|e| format!("Failed to launch Memo: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            prerequisites,
            install_status,
            run_install,
            launch_memo
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
