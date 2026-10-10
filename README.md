# Memo

Memo is a modular OpenAI-compatible FastAPI gateway for a desktop AI app.
Chat and vision use Codex through the user's ChatGPT subscription. Speech
recognition and synthesis run fully locally.

## Stack

- Chat and image understanding: `chatgpt/gpt-5.6-luna` through direct Codex OAuth HTTP
- Speech-to-text: RealtimeSTT with faster-whisper `small.en`
- Text-to-speech: RealtimeTTS with PocketTTS
- Browser automation: Browser Use with visible Chromium
- Chat storage: SQLite in `./data.sqlite`

## Agent onboarding and app integrations

Memo opens agent onboarding when there are no saved agents. Choose a purpose,
communication style, name, role, description, soul (values and personality),
working instructions, runtime, and optional app access. Existing profiles migrate
with a balanced style and their instructions as the initial soul. Profiles and
chat history stay in the desktop user-data directory across updates. Deleting
the last agent opens onboarding again.

Settings includes a system-health panel for the managed gateway and Codex login.
If credentials are missing or expired, run `codex login`, return to Memo, and
refresh the panel. Diagnostics report credential state and expiry only; tokens
never cross into the renderer.

Settings searches Composio's app catalog, shows connection status, supports reconnecting or
adding accounts, and lets you disconnect an account. Sign-in opens in your
browser; Memo refreshes the connection status while you complete it. Each agent
can restrict the app toolkits it uses. The gateway reuses sessions and executes
integration tool calls, then returns their results to the model. Connection
credentials never enter the renderer.

## Direct model providers

The gateway and terminal runtime share a direct HTTP adapter; LiteLLM is not a
dependency. The default `chatgpt/<model>` reads Codex CLI OAuth credentials,
refreshes expired tokens while preserving the login file, and uses native
Responses streaming. Run `codex login` when a login is missing or revoked.

Other configured upstream model prefixes are `openai`, `anthropic`, `ollama`,
`lmstudio`, `minimax`, `xai`, `groq`, and `openrouter`. Anthropic uses its native
Messages API; the others use OpenAI-compatible Chat Completions. Set the matching
provider key (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `MINIMAX_API_KEY`,
`XAI_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY`). Local Ollama and LM Studio
require no API key. Set `CODEX_MODEL=ollama/qwen3`, for example, to choose the
upstream, and `<PROVIDER>_API_BASE` to override its URL. `CHATGPT_API_BASE` remains
the Codex endpoint override. CLI selection is saved as agent configuration;
Memo's gateway model transport uses the configured upstream.

## Requirements

- Python 3.13
- uv
- A signed-in Codex installation with `%USERPROFILE%\.codex\auth.json`
- Node.js and pnpm for the desktop app
- On Linux/Debian: `portaudio19-dev` for PyAudio compilation (`sudo apt-get install portaudio19-dev`)

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
MEMO_STT_PRELOAD=0
MEMO_BROWSER_HEADLESS=0
```

The first local speech run downloads the selected Whisper and PocketTTS model
files. No speech API key is required.

## Run

Launch the terminal UI:

```powershell
uv run memo
```

Start only the HTTP gateway:

```powershell
uv run memo gateway
```

The default manually launched gateway is `http://127.0.0.1:4000`. The desktop
uses its own managed gateway on `http://127.0.0.1:4010` so an older or manually
configured process on port 4000 cannot silently disable desktop-only tools.
Override the desktop port with `MEMO_DESKTOP_GATEWAY_PORT` if needed.

## Linux development and checks

Use Python 3.13, Node.js 24, and pnpm 11.15.1 (also pinned in
`mise.toml` and `package.json`). On Debian/Ubuntu, install the PortAudio
headers before syncing Python dependencies:

```bash
sudo apt-get update
sudo apt-get install -y portaudio19-dev
uv python install 3.13
uv sync --locked --python "$(uv python find --managed-python 3.13)"
npm exec --yes --package=pnpm@11.15.1 -- pnpm install --frozen-lockfile
```

The uv-managed Python includes development headers for compiling PyAudio.
If using a system Python instead, install its matching Python 3.13 development
headers too. The lockfile includes CUDA-enabled PyTorch packages, so allow
several gigabytes for downloads and installed dependencies even on CPU hosts.

For a CPU-only gateway without a graphical session:

```bash
export MEMO_WHISPER_DEVICE=cpu
export MEMO_POCKETTTS_DEVICE=cpu
export MEMO_STT_PRELOAD=0
export MEMO_BROWSER_HEADLESS=1
uv run --no-sync memo gateway --host 127.0.0.1 --port 4000
```

In another terminal, check `/health/liveliness` for `"status":"ok"` and
`/v1/models` for the `codex` model. These endpoints do not require a chat login.
Live chat requires a signed-in Codex installation, normally at
`~/.codex/auth.json` on Linux; `CHATGPT_TOKEN_DIR` can select another directory.
Keep credentials out of the repository.

`pnpm dev:vite` serves the React frontend for layout development. It does not
provide Electron IPC or the desktop-managed gateway. Use `pnpm dev:desktop`
from a graphical desktop session to test the complete application.

Run the same checks as CI:

```bash
# Repository root
uv run --no-sync python -m unittest discover -s tests
pnpm typecheck
pnpm lint
pnpm --filter @memo/desktop exec vite build
```

CI runs Python tests on Linux, Windows, and macOS, plus frontend typechecking,
lint, and the renderer build on Linux and macOS. macOS runners install PortAudio
with Homebrew and use standard PyTorch packages rather than CUDA builds. These tests do not validate a live ChatGPT account or
physical devices. For manual integration testing, verify authenticated chat
first, then speech (model downloads and audio devices), browser automation
(Chromium), and finally desktop control with the required desktop session and
explicit permissions.

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
TTS when voice input starts. Its managed gateway enables background STT preload,
so the persistent `small.en` model is normally ready before dictation. For a
manually launched gateway, set `MEMO_STT_PRELOAD=1` to get the same behavior.

## Browser tools

Browser requests open visible Chromium unless `MEMO_BROWSER_HEADLESS=1`.

## Restricted computer tools

For an isolated desktop that can run locally or on a VPS, see
[`deploy/cua-desktop`](deploy/cua-desktop/README.md). It uses CUA's canonical
Linux sandbox image, persists `/workspace` in a Docker volume, and binds
the control endpoint to localhost for SSH-tunnel access.

The Textual program can run a deliberately small set of commands and open
Windows apps. Command files are confined to `.memo-sandbox/`;
supported workspace commands are `echo`, `pwd`, `dir`, `type`, `mkdir`,
`write`, and `delete`. Read-only host commands are limited to `whoami`,
`hostname`, `ipconfig`, `tasklist`, and `systeminfo`. The allowed apps are
Notepad, Calculator, Paint, and File Explorer; Explorer opens the sandbox
directory. Requests for any other installed app that Windows can resolve, such
as `open Chrome`, `launch Spotify`, or `start VS Code`, are routed through the
permission-gated Windows shell.

Arbitrary shell commands use a separate `run_shell_command` tool. Before any
shell process starts, Memo pauses and shows the exact command and working
directory. The Textual program displays an Allow once/Deny modal, while the
desktop app displays a native Windows permission dialog. Denial, dismissal, or
no answer prevents execution. Every command needs a new approval; approvals
are never remembered. Commands time out after 60 seconds, output is capped, and
credential-like environment variables are not passed to the child shell.

Visible desktop tasks use `inspect_computer_screen` and `control_computer`.
These tools use the pinned `cua-driver` Python SDK (installed by `uv sync`).
After one explicit Allow once decision, Memo can capture the primary desktop
display, send scaled screenshots to the configured vision-capable model, and
perform bounded batches of clicks, typing, key presses, hotkeys, scrolling, and
short waits. It captures the result after each action batch so the model can
continue from what is actually visible. This control session ends with the
current response and is never reused by a later message. Each tool call closes
its CUA runtime after capture or the complete action batch, including failures.
CUA handles native input on supported macOS, Windows, and Linux desktops; the
host must have the desktop permissions and session access required by
[CUA Driver](https://cua.ai/docs/how-to-guides/driver/install).
Linux capture depends on CUA’s compositor support. On the development host,
CUA 0.23.2 initializes successfully but full-screen capture returns an X11
`GetImage` error in the Wayland session; live desktop control is not verified
on that host. Driver errors are returned to the model rather than treated as
successful actions.
Memo no longer invokes `hyprctl`, `ydotool`, `wtype`, or Windows input APIs
directly for desktop control. Shell and workspace commands retain their
existing executors and permission rules.
Requests such as `see my screen and tell me what's on it` go directly into this
screen-inspection flow rather than relying on the model to decide whether it has
screen access.

Examples include `run echo hello`, `write hello to notes/hello.txt`, and
`open calculator`. Arbitrary app launches and requests such as
`search air in my Downloads` are also
routed to the permission-gated Windows shell, and short confirmations such as
`yeah do it` approve the immediately preceding app-launch request exactly once.
That conversational approval is bound to the named app, consumed by the first
action, and never remembered for later actions. The executor
checks the original user message, so the model cannot substitute another
allowlisted command or open an app that was not explicitly named.

This is a capability-policy sandbox, not virtual-machine or container
isolation. Allowlisted commands and apps still run on Windows. An approved
shell starts in `.memo-sandbox/`, but it can use absolute paths or change
directories and therefore can access the host with the current user's
permissions. The permission dialog states this explicitly. Do not approve a
command you do not understand, and do not treat the working directory as a
security boundary for hostile native code. Desktop control likewise operates
as the signed-in Windows user and can interact with anything visible on the
unlocked desktop, so approve it only for tasks you intend Memo to perform.

The HTTP gateway keeps computer control disabled by default. To opt in, set
`MEMO_COMPUTER_ENABLED=1` and send `X-Memo-Computer-Tools: 1` on each
`/v1/responses` or `/v1/chat/completions` request. Keep such a gateway bound to
localhost; the header is a capability switch, not authentication. Set
`MEMO_SANDBOX_ROOT` to relocate the command workspace. The desktop app supplies
both settings to the localhost gateway process that it manages.

## Structure

```text
utils/
  gateway/   FastAPI, direct provider HTTP, routing, streaming, and tool orchestration
  tools/     Computer, Browser, RealtimeSTT, and RealtimeTTS adapters
    ai/      Shared AI runtime, settings, SDK, routing, and tool turns
  browser/   Visible Browser Use agent
  program/   Desktop/runtime integration
```

The program and future messaging integrations can use `from utils.tools.ai import AI, AISettings`. Each `AI` instance owns its conversation history and permission broker; create one per conversation, consume `events()` or `stream()`, and call `close()` when finished. Legacy `utils.program` AI imports remain compatible.

## Release prebuilds

Installers include the Electron desktop app, Python 3.13, and the gateway's
runtime dependencies. Memo starts its gateway automatically and shows a loading
screen until it is ready. Startup errors offer a retry button. No Python
installation, uv, or source checkout is needed to run an installed release.
The bundled speech runtime uses CPU packages; speech models download on first
use. AI backends still need their own login, CLI installation, or credentials.

Available packages:

- Windows x64: Squirrel setup executable.
- macOS Apple Silicon: DMG (drag Memo to Applications) and ZIP.
- Debian/Ubuntu x64: DEB (`sudo apt install ./memo_*.deb`).
- RPM distributions x64: RPM (install with your distribution's package manager).
- Arch Linux x64: `.pkg.tar.zst` (`sudo pacman -U ./memo-*.pkg.tar.zst`).
- Other Linux x64 systems: portable ZIP; system desktop/audio libraries are required.

Chat history, agent profiles, and computer-tool workspace files live in Memo's
user-data directory, outside the installed application. Reinstalling or
updating the application does not remove those files. `MEMO_CHAT_DATABASE` can
select another chat database. Developers can still override the bundled gateway
with `MEMO_GATEWAY_ROOT` and `MEMO_GATEWAY_PYTHON`.

The **Release prebuilds** workflow builds and smoke-tests the standalone gateway
on each platform before building installers. Run it manually from GitHub Actions
to test packaging without publishing; artifacts remain available for 14 days.
To publish, commit the desktop package version and matching lockfile, then push
a matching tag, for example:

```bash
git tag v1.1.2
git push origin v1.1.2
```

After all builds pass, the workflow publishes installers and `SHA256SUMS.txt`.
Tags containing a hyphen create prereleases. Windows builds are unsigned.
macOS packaging clears extended attributes with `xattr -cr`, then ad-hoc signs
and verifies the complete app with `codesign`. Clearing attributes alone does
not sign an app. macOS builds are not Apple Developer signed or notarized.

For local packaging, install PortAudio development headers on Linux or
`brew install portaudio` on macOS, plus Python 3.13 and uv. From the repository
root:

```bash
python scripts/build_gateway.py
python scripts/smoke_gateway.py
pnpm make
# Linux only, after packaging the app:
python scripts/build_arch.py
```

The builder uses a relocatable uv-managed Python on Linux/macOS and a complete
Python installation on Windows. It preserves the lockfile's dependency versions
and replaces CUDA speech packages with CPU PyTorch wheels for release builds.
Build environments and dependencies are excluded from Git. Native code and
package makers must run on the matching target platform; Windows/macOS installers
are validated by their GitHub Actions runners.
