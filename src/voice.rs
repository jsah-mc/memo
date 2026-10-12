use serde::{Deserialize, Serialize};
use std::env;

const ELEVENLABS_BASE_URL: &str = "https://api.elevenlabs.io/v1";

#[derive(Debug, Deserialize)]
pub struct SpeechRequest {
    pub input: String,
    #[serde(default)]
    pub voice_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
}

#[derive(Serialize)]
struct ElevenLabsRequest<'a> {
    text: &'a str,
    model_id: &'a str,
}

pub async fn synthesize(request: &SpeechRequest) -> Result<Vec<u8>, String> {
    let input = request.input.trim();
    if input.is_empty() {
        return Err("speech input cannot be empty".into());
    }

    let api_key = env::var("ELEVENLABS_API_KEY")
        .map_err(|_| "ELEVENLABS_API_KEY is not configured".to_string())?;
    let voice_id = request
        .voice_id
        .clone()
        .or_else(|| env::var("ELEVENLABS_VOICE_ID").ok())
        .or_else(|| env::var("ELEVENLABS_FALLBACK_VOICE_ID").ok())
        .ok_or_else(|| "ELEVENLABS_VOICE_ID is not configured".to_string())?;
    let model_id = request
        .model_id
        .clone()
        .or_else(|| env::var("ELEVENLABS_TTS_MODEL_ID").ok())
        .unwrap_or_else(|| "eleven_multilingual_v2".into());

    let url =
        format!("{ELEVENLABS_BASE_URL}/text-to-speech/{voice_id}?output_format=mp3_44100_128");
    let response = reqwest::Client::new()
        .post(url)
        .header("xi-api-key", api_key)
        .header(reqwest::header::ACCEPT, "audio/mpeg")
        .json(&ElevenLabsRequest {
            text: input,
            model_id: &model_id,
        })
        .send()
        .await
        .map_err(|error| format!("ElevenLabs request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let message = response
            .text()
            .await
            .unwrap_or_else(|_| "unknown ElevenLabs error".into());
        return Err(format!("ElevenLabs returned {status}: {message}"));
    }

    response
        .bytes()
        .await
        .map(|audio| audio.to_vec())
        .map_err(|error| format!("Could not read ElevenLabs audio: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn rejects_empty_input_before_reading_credentials() {
        let error = synthesize(&SpeechRequest {
            input: "   ".into(),
            voice_id: None,
            model_id: None,
        })
        .await
        .unwrap_err();
        assert_eq!(error, "speech input cannot be empty");
    }
}
