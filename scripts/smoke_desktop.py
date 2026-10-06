"""Linux headless integration check for loading, ready, failure and retry states.

Run with the bundled Python after Electron packaging. All app data and processes
are isolated. Only the generated output's entry file is temporarily moved, then
restored, to simulate an incomplete installation.
"""
from __future__ import annotations

import json
import os
import signal
import socket
import subprocess
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "apps/desktop/out/Memo-linux-x64"
CLIENT = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def check(*, broken: bool) -> None:
    entry = APP / "resources/gateway/app/gateway_entry.py"
    hidden = entry.with_suffix(".smoke-backup")
    if broken:
        entry.rename(hidden)
    process = None
    connection = None
    with tempfile.TemporaryDirectory() as data, tempfile.TemporaryFile(mode="w+") as log:
        try:
            debug = port()
            env = {key: value for key, value in os.environ.items()
                   if key not in {"MEMO_GATEWAY_ROOT", "MEMO_GATEWAY_PYTHON"}}
            env.update(XDG_CONFIG_HOME=data, MEMO_DESKTOP_GATEWAY_PORT=str(port()))
            process = subprocess.Popen([str(APP / "Memo"), "--ozone-platform=headless",
                        f"--remote-debugging-port={debug}", f"--user-data-dir={data}/chromium"],
                        cwd=data, env=env, stdout=log, stderr=log, start_new_session=True)
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError(f"Desktop exited: {process.returncode}")
                try:
                    with CLIENT.open(f"http://127.0.0.1:{debug}/json", timeout=1) as response:
                        pages = json.load(response)
                    page = next((page for page in pages if page["type"] == "page"), None)
                    if page:
                        connection = websocket.create_connection(page["webSocketDebuggerUrl"],
                                                                 suppress_origin=True, timeout=5)
                        break
                except OSError:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Desktop debugger did not become ready")
            next_id = 0

            def evaluate(expression: str):
                nonlocal next_id
                next_id += 1
                connection.send(json.dumps({"id": next_id, "method": "Runtime.evaluate",
                                           "params": {"expression": expression}}))
                while True:
                    reply = json.loads(connection.recv())
                    if reply.get("id") == next_id:
                        return reply.get("result", {}).get("result", {}).get("value")

            saw_loading = False
            for _ in range(240):
                text = evaluate("document.body.innerText") or ""
                saw_loading |= "Starting Memo" in text
                if broken and "Memo couldn’t start" in text:
                    assert "bundled gateway is missing" in text
                    assert "Try again" in text
                    hidden.rename(entry)
                    evaluate("Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Try again').click()")
                    break
                if not broken and "New agent" in text:
                    assert saw_loading, "Expected the loading screen before the app became ready"
                    print("Packaged desktop loading screen -> ready passed")
                    return
                time.sleep(0.1)
            else:
                raise RuntimeError("Expected startup screen state was not reached")
            for _ in range(240):
                if "New agent" in (evaluate("document.body.innerText") or ""):
                    print("Packaged desktop error screen -> retry -> ready passed")
                    return
                time.sleep(0.1)
            raise RuntimeError("Retry did not start the restored bundled gateway")
        except Exception:
            log.seek(0)
            print(log.read()[-6000:])
            raise
        finally:
            if hidden.exists():
                hidden.rename(entry)
            if connection:
                try:
                    connection.send(json.dumps({"id": 9999, "method": "Browser.close"}))
                except OSError:
                    pass
                connection.close()
            if process:
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGTERM)
                    process.wait(timeout=10)


if __name__ == "__main__":
    check(broken=False)
    check(broken=True)
