"""Run a copied bundle away from the checkout and verify functional endpoints."""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--bundle", type=Path, default=ROOT / ".gateway-build/gateway")
    bundle = parser.parse_args().bundle.resolve()
    manifest = json.loads((bundle / "manifest.json").read_text())
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
    with tempfile.TemporaryDirectory() as data:
        env = {k: v for k, v in os.environ.items() if k not in {"PYTHONHOME", "PYTHONPATH", "VIRTUAL_ENV", "LD_LIBRARY_PATH", "DYLD_FALLBACK_LIBRARY_PATH"}}
        env["LD_LIBRARY_PATH"] = str(bundle / "runtime/lib")
        env["DYLD_FALLBACK_LIBRARY_PATH"] = str(bundle / "runtime/lib")
        env.update(GATEWAY_PORT=str(port), MEMO_COMPUTER_ENABLED="1", MEMO_STT_PRELOAD="0",
                   MEMO_SPEECH_PRELOAD="0", MEMO_AGENT_STORE=str(Path(data) / "agents.json"))
        subprocess.run([str(bundle / manifest["python"]), "-s", "-B", "-c",
                        "import pyaudio, torch, torchaudio; assert not torch.cuda.is_available(); print('Bundled audio and CPU torch imports passed')"],
                       env=env, cwd=data, check=True)
        with tempfile.TemporaryFile(mode="w+") as log:
            process = subprocess.Popen([str(bundle / manifest["python"]), "-s", "-B",
                                        str(bundle / manifest["entry"])],
                                       cwd=data, env=env, stdout=log, stderr=log)
            try:
                # Bypass only the HTTP proxy for requests to this local process.
                client = urllib.request.build_opener(urllib.request.ProxyHandler({}))
                for _ in range(120):
                    if process.poll() is not None:
                        raise RuntimeError(f"Bundled gateway exited: {process.returncode}")
                    try:
                        with client.open(f"http://127.0.0.1:{port}/health/liveliness", timeout=1) as r:
                            health = json.load(r)
                        assert health["status"] == "ok" and health["desktop_control"] is True
                        with client.open(f"http://127.0.0.1:{port}/v1/models", timeout=2) as r:
                            assert json.load(r)["data"][0]["id"] == "codex"
                        payload = {"name": "Smoke", "role": "Test", "instructions": "Test.",
                                   "cli": "codex", "model": "gpt-5.6-luna", "color": "blue"}
                        request = urllib.request.Request(f"http://127.0.0.1:{port}/v1/agents",
                                  data=json.dumps(payload).encode(), headers={"Content-Type": "application/json"})
                        with client.open(request, timeout=2) as r:
                            assert json.load(r)["name"] == "Smoke"
                        assert (Path(data) / "agents.json").is_file()
                        print("Bundled gateway health, models, and persistent agent creation passed")
                        break
                    except (OSError, urllib.error.URLError):
                        time.sleep(0.5)
                else:
                    raise RuntimeError("Bundled gateway startup timed out")
            except Exception:
                log.seek(0)
                print(log.read())
                raise
            finally:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()


if __name__ == "__main__":
    main()
