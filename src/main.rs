use memo::{models::ModelRouter, runtimes};
use serde_json::json;
use std::{
    env, fs,
    fs::OpenOptions,
    path::PathBuf,
    process::{Command, ExitCode, Stdio},
    time::Duration,
};

#[tokio::main]
async fn main() -> ExitCode {
    let arguments = env::args().skip(1).collect::<Vec<_>>();
    let result = match arguments.as_slice() {
        [] => match gateway_up().await {
            Ok(_) => memo::tui::run().await.map(|_| None),
            Err(error) => Err(format!("Could not start the Memo MCP gateway: {error}")),
        },
        [gateway, action] if gateway == "gateway" && action == "up" => gateway_up()
            .await
            .map(|message| Some(json!({"status": message}))),
        [gateway, action] if gateway == "gateway" && action == "down" => gateway_down()
            .await
            .map(|message| Some(json!({"status": message}))),
        [gateway, action] if gateway == "gateway" && action == "serve" => {
            memo::api::serve().await.map(|_| None)
        }
        [command] if command == "runtimes" => serde_json::to_value(runtimes::statuses())
            .map(Some)
            .map_err(|error| error.to_string()),
        [command, text @ ..] if command == "route" && !text.is_empty() => {
            let route = ModelRouter::default().route(&json!({"input": text.join(" ")}));
            serde_json::to_value(route)
                .map(Some)
                .map_err(|error| error.to_string())
        }
        _ => Err("usage: memo | memo gateway <up|down> | memo runtimes | memo route TEXT".into()),
    };
    match result {
        Ok(Some(value)) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&value).expect("JSON serialization")
            );
            ExitCode::SUCCESS
        }
        Ok(None) => ExitCode::SUCCESS,
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}

fn memo_state_directory() -> Result<PathBuf, String> {
    let home = env::var_os("USERPROFILE")
        .or_else(|| env::var_os("HOME"))
        .ok_or("Home directory is unavailable")?;
    let directory = PathBuf::from(home).join(".memo");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn gateway_url() -> String {
    format!(
        "http://{}",
        env::var("MEMO_API_ADDR").unwrap_or_else(|_| "127.0.0.1:6734".into())
    )
}

async fn gateway_is_ready() -> bool {
    let Ok(client) = reqwest::Client::builder().no_proxy().build() else {
        return false;
    };
    client
        .get(format!("{}/health", gateway_url()))
        .timeout(Duration::from_millis(500))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

async fn gateway_up() -> Result<String, String> {
    if gateway_is_ready().await {
        return Ok(format!("gateway already running at {}", gateway_url()));
    }
    let state = memo_state_directory()?;
    let log_path = state.join("gateway.log");
    let log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .map_err(|error| format!("Could not open {}: {error}", log_path.display()))?;
    let mut command = Command::new(env::current_exe().map_err(|error| error.to_string())?);
    command
        .args(["gateway", "serve"])
        .stdin(Stdio::null())
        .stdout(Stdio::from(
            log.try_clone().map_err(|error| error.to_string())?,
        ))
        .stderr(Stdio::from(log));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0000_0008 | 0x0000_0200 | 0x0800_0000);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start Memo gateway: {error}"))?;
    let pid = child.id();
    fs::write(state.join("gateway.pid"), pid.to_string()).map_err(|error| error.to_string())?;
    for _ in 0..600 {
        if gateway_is_ready().await {
            return Ok(format!("gateway started at {} (pid {pid})", gateway_url()));
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            let _ = fs::remove_file(state.join("gateway.pid"));
            return Err(format!(
                "Gateway stopped during startup ({status}). See {}",
                log_path.display()
            ));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    let _ = child.kill();
    let _ = child.wait();
    let _ = fs::remove_file(state.join("gateway.pid"));
    Err(format!(
        "Gateway did not become ready within 60 seconds. See {}",
        log_path.display()
    ))
}

async fn gateway_down() -> Result<String, String> {
    let state = memo_state_directory()?;
    let pid_path = state.join("gateway.pid");
    let pid = match fs::read_to_string(&pid_path) {
        Ok(value) => value
            .trim()
            .parse::<u32>()
            .map_err(|_| format!("Invalid gateway PID in {}", pid_path.display()))?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return if gateway_is_ready().await {
                Err("A gateway is listening, but it was not started by `memo gateway up`. Stop that process directly.".into())
            } else {
                Ok("gateway is not running".into())
            };
        }
        Err(error) => return Err(error.to_string()),
    };
    #[cfg(windows)]
    let status = Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    #[cfg(unix)]
    let status = Command::new("kill")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
    let status =
        status.map_err(|error| format!("Could not stop gateway process {pid}: {error}"))?;
    if !status.success() && gateway_is_ready().await {
        return Err(format!("Could not stop gateway process {pid}"));
    }
    let _ = fs::remove_file(pid_path);
    for _ in 0..20 {
        if !gateway_is_ready().await {
            return Ok(format!("gateway stopped (pid {pid})"));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    Err(format!("Gateway process {pid} did not stop"))
}
