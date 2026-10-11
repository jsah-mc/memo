use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::OnceLock;

pub const DEFAULT_MODEL: &str = "chatgpt/gpt-5.6-luna";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RouteKind {
    Vision,
    Light,
    Heavy,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRoute {
    pub kind: RouteKind,
    pub model: String,
    pub reasoning_effort: Option<String>,
    pub fallback_model: Option<String>,
}

#[derive(Clone, Debug)]
pub struct ModelRouter {
    pub light_model: String,
    pub heavy_model: String,
    pub vision_model: String,
}

impl Default for ModelRouter {
    fn default() -> Self {
        Self::new(DEFAULT_MODEL, DEFAULT_MODEL, DEFAULT_MODEL)
    }
}

impl ModelRouter {
    pub fn new(
        light: impl Into<String>,
        heavy: impl Into<String>,
        vision: impl Into<String>,
    ) -> Self {
        Self {
            light_model: light.into(),
            heavy_model: heavy.into(),
            vision_model: vision.into(),
        }
    }

    pub fn route(&self, payload: &Value) -> ModelRoute {
        let input = payload.get("input").unwrap_or(&Value::Null);
        let text = latest_user_text(input);
        if has_image(input) {
            return ModelRoute {
                kind: RouteKind::Vision,
                model: self.vision_model.clone(),
                reasoning_effort: None,
                fallback_model: None,
            };
        }
        if complexity_score(&text, input) >= 2 {
            return ModelRoute {
                kind: RouteKind::Heavy,
                model: self.heavy_model.clone(),
                reasoning_effort: None,
                fallback_model: Some(self.light_model.clone()),
            };
        }
        ModelRoute {
            kind: RouteKind::Light,
            model: self.light_model.clone(),
            reasoning_effort: None,
            fallback_model: None,
        }
    }
}

pub fn latest_user_text(input: &Value) -> String {
    if let Some(text) = input.as_str() {
        return text.trim().to_owned();
    }
    let Some(items) = input.as_array() else {
        return String::new();
    };
    items
        .iter()
        .rev()
        .find(|item| item.get("role").and_then(Value::as_str) == Some("user"))
        .map(|item| content_text(item.get("content").unwrap_or(&Value::Null)))
        .unwrap_or_default()
        .trim()
        .to_owned()
}

fn content_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_owned();
    }
    content
        .as_array()
        .into_iter()
        .flatten()
        .filter(|part| {
            matches!(
                part.get("type").and_then(Value::as_str),
                Some("text" | "input_text" | "output_text")
            )
        })
        .filter_map(|part| part.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}

fn has_image(input: &Value) -> bool {
    input.as_array().is_some_and(|items| {
        items.iter().any(|item| {
            item.get("content")
                .and_then(Value::as_array)
                .is_some_and(|parts| {
                    parts.iter().any(|part| {
                        matches!(
                            part.get("type").and_then(Value::as_str),
                            Some("input_image" | "image_url")
                        )
                    })
                })
        })
    })
}

fn complexity_score(text: &str, input: &Value) -> u8 {
    let mut score = if text.len() >= 700 {
        2
    } else if text.len() >= 300 {
        1
    } else {
        0
    };
    if heavy_task().is_match(text) {
        score += 2;
    }
    if text.matches('\n').count() >= 8 {
        score += 1;
    }
    if input.as_array().is_some_and(|items| items.len() >= 8) {
        score += 1;
    }
    if text.contains("```") {
        score += 1;
    }
    score
}

fn heavy_task() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(
        r"(?i)\b(?:analy[sz]e|architect|benchmark|build|debug|deep\s+dive|design|diagnose|evaluate|implement|investigate|optimi[sz]e|plan|prove|reason|refactor|research|review|solve|strategy|write\s+(?:code|a\s+program))\b"
    ).expect("model-routing regex must compile"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn routes_simple_text_to_light_model() {
        let route = ModelRouter::new("light", "heavy", "vision").route(&json!({"input": "hello"}));
        assert_eq!(route.kind, RouteKind::Light);
        assert_eq!(route.model, "light");
    }

    #[test]
    fn routes_complex_work_with_fallback() {
        let route = ModelRouter::new("light", "heavy", "vision")
            .route(&json!({"input": "Please architect and implement this service"}));
        assert_eq!(route.kind, RouteKind::Heavy);
        assert_eq!(route.model, "heavy");
        assert_eq!(route.fallback_model.as_deref(), Some("light"));
    }

    #[test]
    fn routes_images_to_vision_model() {
        let input = json!([{"role": "user", "content": [
            {"type": "input_text", "text": "what is this?"},
            {"type": "input_image", "image_url": "data:image/png;base64,AA=="}
        ]}]);
        let route = ModelRouter::new("light", "heavy", "vision").route(&json!({"input": input}));
        assert_eq!(route.kind, RouteKind::Vision);
        assert_eq!(route.model, "vision");
    }
}
