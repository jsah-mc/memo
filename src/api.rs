use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
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
    convert::Infallible,
    env,
    net::SocketAddr,
    path::PathBuf,
    process::Stdio,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::process::Command;
use tower_http::cors::{Any, CorsLayer};

use crate::{
    mcp::MemoMcp,
    runtimes::{self, Runtime},
};

#[derive(Clone)]
struct ApiState {
    working_directory: Arc<PathBuf>,
    cua_driver: Arc<cua_driver_sdk::CuaDriver>,
}

#[derive(Debug, Deserialize)]
struct ChatRequest {
    model: String,
    messages: Vec<ChatMessage>,
    #[serde(default)]
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ResponsesRequest {
    model: String,
    input: Value,
    #[serde(default)]
    instructions: Option<String>,
    #[serde(default)]
    stream: bool,
}

#[derive(Debug, Deserialize)]
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

pub async fn serve() -> Result<(), String> {
    serve_in(env::current_dir().map_err(|error| error.to_string())?).await
}

pub async fn serve_in(working_directory: PathBuf) -> Result<(), String> {
    let cua_driver = cua_driver_sdk::CuaDriver::create(None)
        .map_err(|error| format!("Could not initialize CUA Driver: {error}"))?;
    let address = env::var("MEMO_API_ADDR").unwrap_or_else(|_| "127.0.0.1:6734".into());
    let address = address
        .parse::<SocketAddr>()
        .map_err(|error| format!("Invalid MEMO_API_ADDR: {error}"))?;
    let state = ApiState {
        working_directory: Arc::new(working_directory),
        cua_driver,
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
        .route("/health", get(|| async { Json(json!({"status": "ok"})) }))
        .route("/v1/models", get(list_models))
        .route("/v1/chat/completions", post(chat_completions))
        .route("/v1/responses", post(responses))
        .nest_service("/mcp", mcp)
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| format!("Could not bind {address}: {error}"))?;
    eprintln!("Memo OpenAI-compatible API listening on http://{address}");
    axum::serve(listener, app)
        .await
        .map_err(|error| error.to_string())
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
    let (runtime, model) = match resolve_model(&request.model) {
        Ok(value) => value,
        Err(error) => return api_error(StatusCode::BAD_REQUEST, error),
    };
    let prompt = conversation_prompt(&request.messages);
    if prompt.trim().is_empty() {
        return api_error(StatusCode::BAD_REQUEST, "messages must contain text".into());
    }
    let cwd = (*state.working_directory).clone();
    let answer = match run_cli(runtime, model.clone(), prompt, cwd).await {
        Ok(answer) => answer,
        Err(error) => return api_error(StatusCode::BAD_GATEWAY, error),
    };
    let id = format!("chatcmpl-{}", unix_nanos());
    if request.stream {
        let chunk = json!({
            "id": id,
            "object": "chat.completion.chunk",
            "created": unix_time(),
            "model": request.model,
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": answer}, "finish_reason": "stop"}]
        });
        let events = stream::iter([
            Ok::<_, Infallible>(Event::default().data(chunk.to_string())),
            Ok(Event::default().data("[DONE]")),
        ]);
        return Sse::new(events).into_response();
    }
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
    let cwd = (*state.working_directory).clone();
    let answer = match run_cli(runtime, model, prompt, cwd).await {
        Ok(answer) => answer,
        Err(error) => return api_error(StatusCode::BAD_GATEWAY, error),
    };
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
    let output = Command::new(runtime.executable)
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
