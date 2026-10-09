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
docker compose restart desktop
docker compose down
```

`docker compose down` preserves the volumes. To intentionally remove the
persistent desktop data as well, use `docker compose down --volumes`.

The image is based on CUA's canonical `trycua/cua-xfce:latest` sandbox, which
includes the XFCE desktop, control API, and noVNC service. Rebuild periodically
to pick up upstream security and driver updates.
