# Memo CUA desktop

An isolated Linux desktop with CUA already installed. The same Compose project
runs in Podman or Docker on Windows/macOS/Linux or on an x86_64 Linux VPS.
Memo prefers Podman when both engines are installed and falls back to Docker.

The service API is bound to `127.0.0.1` by default. This prevents an
internet-facing VPS from exposing desktop control directly.

## Start locally

```powershell
cd deploy/cua-desktop
Copy-Item .env.example .env
# Replace CUA_ENV_TOKEN in .env with: openssl rand -hex 24
podman compose up -d --build
podman compose ps
# If Podman is not installed, use Docker instead:
docker compose up -d --build
docker compose ps
```

The CUA API endpoint is `http://127.0.0.1:3211`; the built-in noVNC desktop
viewer is at `http://127.0.0.1:3212/vnc.html`. Authenticate with the token from
`.env`.
Files under `/workspace` survive container replacement in a named Compose
volume (ordinary container restarts preserve the full container filesystem).

## Included desktop tools

The Memo layer adds a practical application set for CUA Driver automation:

- Chromium or Firefox (whichever the base distribution provides)
- LibreOffice Writer, Calc, and Impress
- Thunar, Mousepad, XFCE Terminal, and Galculator
- Evince PDF viewer, Ristretto image viewer, and Xarchiver
- Clipboard, accessibility, archive, Git, curl, jq, Python, and common fonts

The underlying CUA image continues to provide the complete Linux driver tool
registry. That includes app/window discovery and launch, accessibility trees,
screenshots, browser inspection, clicks, pointer gestures, typing, shortcuts,
clipboard access, batched steps, scripts, verification, sessions, cursor
overlays, and trajectory recording. Memo exposes this evolving registry through
`cua_list_tools`, `cua_observe`, and `cua_call` rather than duplicating a stale
hard-coded subset.

Memo's `run_command` MCP tool can execute on `host`, `local_vm`, or `cloud`
(`vps` is also accepted). Cloud commands use the SSH connection in
`~/.memo/config.toml`:

```toml
[vps]
host = "vps.example.com"
user = "ubuntu"
port = 22
identityFile = "C:\\Users\\you\\.ssh\\id_ed25519"
```

The equivalent environment variables are `MEMO_VPS_SSH_HOST`,
`MEMO_VPS_SSH_USER`, `MEMO_VPS_SSH_PORT`, and
`MEMO_VPS_SSH_IDENTITY_FILE`. Commands execute inside the
`memo-cua-desktop` container on Local VM and VPS targets; Memo never falls
back to this PC if the selected destination is unavailable.

## Run on a VPS

Copy this directory to an x86_64 Linux VPS with Docker, create `.env`, and run:

```bash
docker compose up -d --build
```

Keep the port bound to localhost and tunnel it from your computer:

```bash
ssh -N -L 3211:127.0.0.1:3211 user@your-vps
```

Then connect to `http://127.0.0.1:3211` locally. Do not publish port 3211 to
`0.0.0.0`; the bearer token is necessary but is not a substitute for a private
network, SSH tunnel, or authenticated reverse proxy with TLS.

## Connect CUA

Install the CUA client on the machine running the agent, then register the
space. This small Python example follows CUA's stable SDK API:

```python
import asyncio
import os

import cua

async def main():
    spaces = cua.embedded().spaces()
    info = await spaces.add(
        "http://127.0.0.1:3211",
        os.environ["CUA_ENV_TOKEN"],
        "memo-desktop",
    )
    print(info.id)

asyncio.run(main())
```

Install and run it with:

```bash
pip install cua
python connect.py
```

## Operations

```bash
docker compose logs -f desktop
docker compose ps # Wait for the service to report healthy
docker compose restart desktop
docker compose down
```

`docker compose down` preserves the volumes. To intentionally remove the
persistent desktop data as well, use `docker compose down --volumes`.

The image is based on CUA's canonical `trycua/cua-xfce:latest` sandbox, which
includes the XFCE desktop, control API, and noVNC service. Rebuild periodically
to pick up upstream security and driver updates.
