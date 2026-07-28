# Memo

Memo is a modular OpenAI-compatible FastAPI gateway for a desktop AI app.
Chat and vision use Codex through the user's ChatGPT subscription. Speech
recognition and synthesis run fully locally.

## Stack

- Chat and image understanding: `chatgpt/gpt-5.4` through LiteLLM
- Speech-to-text: RealtimeSTT with faster-whisper `small.en`
- Text-to-speech: RealtimeTTS with PocketTTS
- Browser automation: Browser Use with visible Chromium
- Hardware tool: MoonKart over Bluetooth LE
- Chat storage: SQLite in `./data.sqlite`

## Requirements

- Python 3.13
- uv
- A signed-in Codex installation with `%USERPROFILE%\.codex\auth.json`
- Node.js and pnpm for the desktop app

Install the Python environment:

```powershell
uv sync
```

Configure `.env`:

```dotenv
GATEWAY_HOST=127.0.0.1
GATEWAY_PORT=4000
CHATGPT_TOKEN_DIR=C:\Users\Admin\.codex
CHATGPT_AUTH_FILE=auth.json
MEMO_WHISPER_MODEL=small.en
MEMO_WHISPER_DEVICE=cuda
MEMO_POCKETTTS_DEVICE=cuda
MEMO_SPEECH_CPU_THREADS=4
MEMO_BROWSER_HEADLESS=0
```

The first local speech run downloads the selected Whisper and PocketTTS model
files. No speech API key is required.

## Run

```powershell
uv run memo gateway
```

The default gateway is `http://127.0.0.1:4000`.

## OpenAI-compatible endpoints

- `GET /health/liveliness`
- `GET /v1/models`
- `POST /v1/responses`
- `POST /v1/chat/completions`
- `POST /v1/audio/transcriptions`
- `POST /v1/audio/speech`

The public model alias remains `codex`:

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:4000/v1",
    api_key="not-required",
)

response = client.chat.completions.create(
    model="codex",
    messages=[{"role": "user", "content": "Hello"}],
    stream=True,
)

for chunk in response:
    print(chunk.choices[0].delta.content or "", end="")
```

## Voice

Transcribe an existing file or record from the microphone:

```powershell
uv run memo-stt recording.wav
uv run memo-stt
```

Generate or play speech:

```powershell
uv run memo-tts "Hello from Memo"
uv run memo-tts "Save this" --output output.wav --no-play
```

The desktop uses the same audio endpoints. Dictation stops after speech followed
by silence, filters common Whisper silence hallucinations, and interrupts active
TTS when voice input starts.

## Browser and MoonKart tools

Browser requests open visible Chromium unless `MEMO_BROWSER_HEADLESS=1`.
MoonKart start and stop requests remain LiteLLM function calls and send `H` or
`S` only after an explicit user request.

## Structure

```text
utils/
  gateway/   FastAPI, LiteLLM, routing, streaming, and tool orchestration
  tools/     Browser, MoonKart, RealtimeSTT, and RealtimeTTS adapters
  browser/   Visible Browser Use agent
  program/   Desktop/runtime integration
```
