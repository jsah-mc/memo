use axum::{
    Json, Router,
    extract::State,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response, Sse, sse::Event},
    routing::{get, post},
};
use futures_util::stream;
use rmcp::transport::streamable_http_server::{
    StreamableHttpServerConfig, StreamableHttpService, session::local::LocalSessionManager,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    convert::Infallible,
    env,
    net::SocketAddr,
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, BufReader},
    process::Command,
    sync::{Mutex, Semaphore, mpsc, oneshot},
};
use tower_http::cors::{Any, CorsLayer};

use crate::{
    mcp::MemoMcp,
    runtimes::{self, Runtime},
};

#[derive(Clone)]
struct ApiState {
    working_directory: Arc<PathBuf>,
    cua_driver: Arc<std::sync::OnceLock<Result<Arc<cua_driver_sdk::CuaDriver>, String>>>,
    store: crate::storage::MemoStore,
    active: Arc<Mutex<HashMap<String, oneshot::Sender<()>>>>,
    concurrency: Arc<Semaphore>,
    started_at: Instant,
    api_token: Option<Arc<str>>,
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    conversation_id: Option<String>,
    #[serde(default)]
    permission_mode: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ResponsesRequest {
    model: String,
    input: Value,
    #[serde(default)]
    instructions: Option<String>,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    conversation_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ChatMessage {
    role: String,
    content: Value,
}

#[derive(Serialize)]
struct ModelObject {
    id: String,
    object: &'static str,
    created: u64,
    owned_by: &'static str,
}

enum CliStreamEvent {
    Delta(String),
    Error(String),
    Done,
}

fn background_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut command = Command::new(program);
    #[cfg(windows)]
    command.creation_flags(0x0800_0000);
    command
}

pub async fn serve() -> Result<(), String> {
    serve_in(env::current_dir().map_err(|error| error.to_string())?).await
}

pub async fn serve_in(working_directory: PathBuf) -> Result<(), String> {
    let cua_driver = Arc::new(std::sync::OnceLock::new());
    let address = env::var("MEMO_API_ADDR").unwrap_or_else(|_| "127.0.0.1:6734".into());
    let address = address
        .parse::<SocketAddr>()
        .map_err(|error| format!("Invalid MEMO_API_ADDR: {error}"))?;
    let state = ApiState {
        working_directory: Arc::new(working_directory),
        cua_driver,
        store: crate::storage::MemoStore::in_home()?,
        active: Arc::new(Mutex::new(HashMap::new())),
        concurrency: Arc::new(Semaphore::new(
            env::var("MEMO_MAX_CONCURRENT_AGENTS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(4),
        )),
        started_at: Instant::now(),
        api_token: env::var("MEMO_API_TOKEN")
            .ok()
            .filter(|token| !token.trim().is_empty())
            .map(Arc::from),
    };
    let mcp_directory = (*state.working_directory).clone();
    let mcp_cua_driver = state.cua_driver.clone();
    let mcp = StreamableHttpService::new(
        move || Ok(MemoMcp::new(mcp_directory.clone(), mcp_cua_driver.clone())),
        LocalSessionManager::default().into(),
        StreamableHttpServerConfig::default()
            .with_legacy_session_mode(false)
            .with_json_response(true),
    );
    let app = Router::new()
        .route("/health", get(health))
        .route("/v1/models", get(list_models))
        .route("/v1/chat/completions", post(chat_completions))
        .route("/v1/responses", post(responses))
        .route("/v1/requests/{request_id}/cancel", post(cancel_request))
        .nest_service("/mcp", mcp)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .layer(middleware::from_fn_with_state(state.clone(), authorize))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| format!("Could not bind {address}: {error}"))?;
    eprintln!("Memo OpenAI-compatible API listening on http://{address}");
    axum::serve(listener, app)
        .await
        .map_err(|error| error.to_string())
}

async fn authorize(
    State(state): State<ApiState>,
    request: Request<axum::body::Body>,
    next: Next,
) -> Response {
    if request.uri().path().starts_with("/health") || state.api_token.is_none() {
        return next.run(request).await;
    }
    let supplied = request
        .headers()
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if supplied == state.api_token.as_deref() {
        next.run(request).await
    } else {
        api_error(
            StatusCode::UNAUTHORIZED,
            "Missing or invalid bearer token".into(),
        )
    }
}

async fn health(State(state): State<ApiState>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "uptime_seconds": state.started_at.elapsed().as_secs(),
        "active_requests": state.active.lock().await.len(),
        "available_concurrency": state.concurrency.available_permits(),
        "database": state.store.path(),
        "cua": if state.cua_driver.get().is_some() { "initialized" } else { "lazy" },
        "runtimes": runtimes::statuses().into_iter().map(|status| json!({
            "id": status.runtime.id,
            "installed": status.installed,
        })).collect::<Vec<_>>(),
    }))
}

async fn cancel_request(
    State(state): State<ApiState>,
    axum::extract::Path(request_id): axum::extract::Path<String>,
) -> Response {
    match state.active.lock().await.remove(&request_id) {
        Some(cancel) => {
            let _ = cancel.send(());
            Json(json!({"cancelled": true, "request_id": request_id})).into_response()
        }
        None => api_error(StatusCode::NOT_FOUND, "Active request not found".into()),
    }
}

async fn list_models() -> Json<Value> {
    let created = unix_time();
    let data = runtimes::statuses()
        .into_iter()
        .filter(|status| status.installed)
        .flat_map(|status| {
            status.models.into_iter().map(move |model| ModelObject {
                id: format!("{}:{model}", status.runtime.id),
                object: "model",
                created,
                owned_by: "memo",
            })
        })
        .collect::<Vec<_>>();
    Json(json!({"object": "list", "data": data}))
}

async fn chat_completions(
    State(state): State<ApiState>,
    Json(request): Json<ChatRequest>,
) -> Response {
    let permission_mode = request.permission_mode.as_deref().unwrap_or("ask");
    if !matches!(permission_mode, "ask" | "approved") {
        return api_error(
            StatusCode::BAD_REQUEST,
            "permission_mode must be ask or approved".into(),
        );
    }
    let (runtime, model) = match resolve_model(&request.model) {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, error),
    };
    let prompt = conversation_prompt(&request.messages);
    if prompt.trim().is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "messages must contain text".into());
    }
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| format!("req_{}", unix_nanos()));
    let conversation_id = request
        .conversation_id
        .clone()
        .unwrap_or_else(|| request_id.clone());
    let input_json = serde_json::to_string(&request.messages).unwrap_or_else(|_| "[]".into());
    let id = format!("chatcmpl-{}", unix_nanos());
    if request.stream {
        let receiver = run_cli_stream(
            state.clone(),
            request_id,
            conversation_id,
            runtime,
            model,
            request.model.clone(),
            prompt,
            input_json,
            permission_mode.to_owned(),
        );
        let event_id = id.clone();
        let event_model = request.model.clone();
        let events = stream::unfold(receiver, move |mut receiver| {
            let id = event_id.clone();
            let model = event_model.clone();
            async move {
                let event = receiver.recv().await?;
                let event = match event {
                    CliStreamEvent::Delta(content) => Event::default().data(
                        json!({
                            "id": id,
                            "object": "chat.completion.chunk",
                            "created": unix_time(),
                            "model": model,
                            "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": Value::Null}]
                        })
                        .to_string(),
                    ),
                    CliStreamEvent::Error(message) => Event::default().data(
                        json!({"error": {"message": message, "type": "memo_error"}}).to_string(),
                    ),
                    CliStreamEvent::Done => Event::default().data("[DONE]"),
                };
                Some((Ok::<_, Infallible>(event), receiver))
            }
        });
        return Sse::new(events).into_response();
    }
    let started = Instant::now();
    let answer = match run_cli_controlled(
        &state,
        &request_id,
        runtime,
        model.clone(),
        prompt,
        permission_mode,
    )
    .await
    {
        Ok(answer) => answer,
        Err(error) => {
            let _ = state.store.record_request(
                &request_id,
                runtime.id,
                &model,
                "error",
                started.elapsed().as_millis(),
                Some(&error),
            );
            return api_error(StatusCode::BAD_GATEWAY, error);
        }
    };
    let _ = state.store.save_exchange(
        &conversation_id,
        &request.model,
        &input_json,
        &json!({"role": "assistant", "content": &answer}).to_string(),
    );
    let _ = state.store.record_request(
        &request_id,
        runtime.id,
        &model,
        "completed",
        started.elapsed().as_millis(),
        None,
    );
    Json(json!({
        "id": id,
        "object": "chat.completion",
        "created": unix_time(),
        "model": request.model,
        "choices": [{"index": 0, "message": {"role": "assistant", "content": answer}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    }))
    .into_response()
}

async fn responses(
    State(state): State<ApiState>,
    Json(request): Json<ResponsesRequest>,
) -> Response {
    let (runtime, model) = match resolve_model(&request.model) {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, error),
    };
    let mut prompt = responses_prompt(&request.input);
    if let Some(instructions) = request
        .instructions
        .filter(|value| !value.trim().is_empty())
    {
        prompt = format!("SYSTEM:\n{instructions}\n\n{prompt}");
    }
    if prompt.trim().is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "input must contain text".into());
    }
    let request_id = request
        .request_id
        .clone()
        .unwrap_or_else(|| format!("req_{}", unix_nanos()));
    let conversation_id = request
        .conversation_id
        .clone()
        .unwrap_or_else(|| request_id.clone());
    let input_json = request.input.to_string();
    let started = Instant::now();
    let answer = match run_cli_controlled(
        &state,
        &request_id,
        runtime,
        model.clone(),
        prompt,
        "ask",
    )
    .await
    {
        Ok(answer) => answer,
        Err(error) => {
            let _ = state.store.record_request(
                &request_id,
                runtime.id,
                &model,
                "error",
                started.elapsed().as_millis(),
                Some(&error),
            );
            return api_error(StatusCode::BAD_GATEWAY, error);
        }
    };
    let _ = state.store.save_exchange(
        &conversation_id,
        &request.model,
        &input_json,
        &json!({"role": "assistant", "content": &answer}).to_string(),
    );
    let _ = state.store.record_request(
        &request_id,
        runtime.id,
        &model,
        "completed",
        started.elapsed().as_millis(),
        None,
    );
    let id = format!("resp_{}", unix_nanos());
    let created = unix_time();
    let completed = json!({
        "id": id,
        "object": "response",
        "created_at": created,
        "status": "completed",
        "model": request.model,
        "output": [{
            "id": format!("msg_{}", unix_nanos()),
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{"type": "output_text", "text": answer, "annotations": []}]
        }],
        "output_text": answer,
        "usage": {"input_tokens": 0, "output_tokens": 0, "total_tokens": 0}
    });
    if request.stream {
        let created_event = json!({
            "type": "response.created",
            "sequence_number": 0,
            "response": {"id": id, "object": "response", "created_at": created, "status": "in_progress", "model": request.model, "output": []}
        });
        let delta_event = json!({
            "type": "response.output_text.delta",
            "sequence_number": 1,
            "item_id": completed["output"][0]["id"],
            "output_index": 0,
            "content_index": 0,
            "delta": answer
        });
        let completed_event = json!({
            "type": "response.completed",
            "sequence_number": 2,
            "response": completed
        });
        let events = stream::iter([
            Ok::<_, Infallible>(
                Event::default()
                    .event("response.created")
                    .data(created_event.to_string()),
            ),
            Ok(Event::default()
                .event("response.output_text.delta")
                .data(delta_event.to_string())),
            Ok(Event::default()
                .event("response.completed")
                .data(completed_event.to_string())),
        ]);
        return Sse::new(events).into_response();
    }
    Json(completed).into_response()
}

fn resolve_model(id: &str) -> Result<(Runtime, String), String> {
    if let Some((runtime_id, model)) = id.split_once(':') {
        let runtime = runtimes::runtime(runtime_id)?;
        if !runtime.installed() {
            return Err(format!("{} is not installed", runtime.label));
        }
        return Ok((runtime, model.to_owned()));
    }
    runtimes::RUNTIMES
        .iter()
        .copied()
        .find(|runtime| runtime.installed() && runtime.models().iter().any(|model| model == id))
        .map(|runtime| (runtime, id.to_owned()))
        .ok_or_else(|| format!("Unknown model: {id}. Use a runtime:model id from /v1/models."))
}

pub(crate) async fn run_cli(
    runtime: Runtime,
    model: String,
    prompt: String,
    cwd: PathBuf,
) -> Result<String, String> {
    let arguments = runtime.chat_command(&model, &prompt)?;
    let output = background_command(runtime.executable)
        .args(arguments)
        .current_dir(cwd)
        .stdin(Stdio::null())
        .output()
        .await
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
}

#[allow(clippy::too_many_arguments)]
fn run_cli_stream(
    state: ApiState,
    request_id: String,
    conversation_id: String,
    runtime: Runtime,
    model: String,
    requested_model: String,
    prompt: String,
    input_json: String,
    permission_mode: String,
) -> mpsc::Receiver<CliStreamEvent> {
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        let started = Instant::now();
        let result: Result<String, String> = async {
            let _permit = state
                .concurrency
                .clone()
                .acquire_owned()
                .await
                .map_err(|_| "Gateway is shutting down".to_string())?;
            let arguments = runtime.chat_command_with_permissions(&model, &prompt, &permission_mode)?;
            let mut command = background_command(runtime.executable);
            command
                .args(arguments)
                .current_dir(&*state.working_directory)
                .stdin(Stdio::null())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .kill_on_drop(true);
            let mut child = command
                .spawn()
                .map_err(|error| format!("Could not start {}: {error}", runtime.label))?;
            let stdout = child.stdout.take().ok_or("Runtime stdout was unavailable")?;
            let mut lines = BufReader::new(stdout).lines();
            let mut stderr = child.stderr.take().ok_or("Runtime stderr was unavailable")?;
            let stderr_task = tokio::spawn(async move {
                let mut text = String::new();
                let _ = stderr.read_to_string(&mut text).await;
                text
            });
            let (cancel_tx, mut cancel_rx) = oneshot::channel();
            state.active.lock().await.insert(request_id.clone(), cancel_tx);
            log_gateway(&request_id, "started", runtime.id, &model, None);
            let mut complete = String::new();
            let timeout_seconds = env::var("MEMO_REQUEST_TIMEOUT_SECONDS")
                .ok()
                .and_then(|value| value.parse().ok())
                .unwrap_or(900);
            let timeout = tokio::time::sleep(Duration::from_secs(timeout_seconds));
            tokio::pin!(timeout);
            loop {
                tokio::select! {
                    _ = &mut cancel_rx => {
                        let _ = child.kill().await;
                        return Err(format!("{} request was cancelled", runtime.label));
                    },
                    line = lines.next_line() => match line.map_err(|error| error.to_string())? {
                        Some(line) => {
                            let chunk = format!("{line}\n");
                            complete.push_str(&chunk);
                            if sender.send(CliStreamEvent::Delta(chunk)).await.is_err() {
                                let _ = child.kill().await;
                                return Err("Client disconnected".into());
                            }
                        }
                        None => break,
                    },
                    _ = &mut timeout => {
                        let _ = child.kill().await;
                        return Err(format!("{} timed out after {timeout_seconds} seconds", runtime.label));
                    }
                }
            }
            let status = child.wait().await.map_err(|error| error.to_string())?;
            let stderr = stderr_task.await.unwrap_or_default();
            state.active.lock().await.remove(&request_id);
            if !status.success() {
                return Err(runtime.chat_failure_message(&stderr, Some(&status.to_string())));
            }
            if complete.trim().is_empty() {
                return Err(runtime.chat_failure_message(&stderr, None));
            }
            Ok(complete.trim().to_owned())
        }
        .await;
        state.active.lock().await.remove(&request_id);
        match result {
            Ok(output) => {
                let _ = state.store.save_exchange(
                    &conversation_id,
                    &requested_model,
                    &input_json,
                    &json!({"role": "assistant", "content": output}).to_string(),
                );
                let _ = state.store.record_request(
                    &request_id,
                    runtime.id,
                    &model,
                    "completed",
                    started.elapsed().as_millis(),
                    None,
                );
                log_gateway(&request_id, "completed", runtime.id, &model, None);
            }
            Err(error) => {
                let _ = state.store.record_request(
                    &request_id,
                    runtime.id,
                    &model,
                    "error",
                    started.elapsed().as_millis(),
                    Some(&error),
                );
                log_gateway(&request_id, "error", runtime.id, &model, Some(&error));
                let _ = sender.send(CliStreamEvent::Error(error)).await;
            }
        }
        let _ = sender.send(CliStreamEvent::Done).await;
    });
    receiver
}

async fn run_cli_controlled(
    state: &ApiState,
    request_id: &str,
    runtime: Runtime,
    model: String,
    prompt: String,
    permission_mode: &str,
) -> Result<String, String> {
    let _permit = state
        .concurrency
        .clone()
        .acquire_owned()
        .await
        .map_err(|_| "Gateway is shutting down".to_string())?;
    let arguments = runtime.chat_command_with_permissions(&model, &prompt, permission_mode)?;
    let mut command = background_command(runtime.executable);
    command
        .args(arguments)
        .current_dir(&*state.working_directory)
        .stdin(Stdio::null())
        .kill_on_drop(true);
    let (cancel_tx, cancel_rx) = oneshot::channel();
    state
        .active
        .lock()
        .await
        .insert(request_id.to_owned(), cancel_tx);
    log_gateway(request_id, "started", runtime.id, &model, None);
    let timeout_seconds = env::var("MEMO_REQUEST_TIMEOUT_SECONDS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(900);
    let output = tokio::select! {
        result = command.output() => result.map_err(|error| format!("Could not start {}: {error}", runtime.label)),
        _ = cancel_rx => Err(format!("{} request was cancelled", runtime.label)),
        _ = tokio::time::sleep(Duration::from_secs(timeout_seconds)) => Err(format!("{} timed out after {timeout_seconds} seconds", runtime.label)),
    };
    state.active.lock().await.remove(request_id);
    let output = output?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    if !output.status.success() {
        let error = runtime.chat_failure_message(&stderr, Some(&output.status.to_string()));
        log_gateway(request_id, "error", runtime.id, &model, Some(&error));
        return Err(error);
    }
    if stdout.is_empty() {
        let error = runtime.chat_failure_message(&stderr, None);
        log_gateway(request_id, "error", runtime.id, &model, Some(&error));
        return Err(error);
    }
    log_gateway(request_id, "completed", runtime.id, &model, None);
    Ok(stdout)
}

fn log_gateway(request_id: &str, status: &str, runtime: &str, model: &str, error: Option<&str>) {
    let Some(home) = env::var_os("USERPROFILE").or_else(|| env::var_os("HOME")) else {
        return;
    };
    let directory = PathBuf::from(home).join(".memo").join("logs");
    if std::fs::create_dir_all(&directory).is_err() {
        return;
    }
    let path = directory.join("gateway.log");
    if path
        .metadata()
        .is_ok_and(|metadata| metadata.len() > 2_000_000)
    {
        let _ = std::fs::rename(&path, directory.join("gateway.log.1"));
    }
    let entry = json!({
        "time": unix_time(),
        "request_id": request_id,
        "status": status,
        "runtime": runtime,
        "model": model,
        "error": error,
    });
    use std::io::Write;
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
    {
        let _ = writeln!(file, "{entry}");
    }
}

fn conversation_prompt(messages: &[ChatMessage]) -> String {
    messages
        .iter()
        .filter_map(|message| content_text(&message.content).map(|text| (message, text)))
        .map(|(message, text)| format!("{}:\n{text}", message.role.to_uppercase()))
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn responses_prompt(input: &Value) -> String {
    if let Some(text) = input.as_str() {
        return format!("USER:\n{text}");
    }
    let Some(items) = input.as_array() else {
        return String::new();
    };
    items
        .iter()
        .filter_map(|item| {
            if let Some(text) = item.as_str() {
                return Some(format!("USER:\n{text}"));
            }
            let role = item.get("role").and_then(Value::as_str).unwrap_or("user");
            let content = item.get("content").and_then(content_text)?;
            Some(format!("{}:\n{content}", role.to_uppercase()))
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn content_text(content: &Value) -> Option<String> {
    if let Some(text) = content.as_str() {
        return Some(text.to_owned());
    }
    content.as_array().map(|parts| {
        parts
            .iter()
            .filter_map(|part| {
                matches!(
                    part.get("type").and_then(Value::as_str),
                    Some("text" | "input_text" | "output_text")
                )
                .then(|| part.get("text").and_then(Value::as_str))
                .flatten()
            })
            .collect::<Vec<_>>()
            .join("\n")
    })
}

fn api_error(status: StatusCode, message: String) -> Response {
    (
        status,
        Json(json!({"error": {"message": message, "type": "memo_error"}})),
    )
        .into_response()
}

fn unix_time() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn unix_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_openai_messages_for_cli() {
        let messages = vec![
            ChatMessage {
                role: "system".into(),
                content: json!("Be brief"),
            },
            ChatMessage {
                role: "user".into(),
                content: json!([{"type": "text", "text": "Hello"}, {"type": "image_url", "image_url": {"url": "data:"}}]),
            },
        ];
        assert_eq!(
            conversation_prompt(&messages),
            "SYSTEM:\nBe brief\n\nUSER:\nHello"
        );
    }

    #[test]
    fn formats_responses_input_for_cli() {
        assert_eq!(responses_prompt(&json!("Hello")), "USER:\nHello");
        assert_eq!(
            responses_prompt(
                &json!([{"role": "user", "content": [{"type": "input_text", "text": "Hi"}]}])
            ),
            "USER:\nHi"
        );
    }
}
