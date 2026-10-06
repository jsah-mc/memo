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
    with (
        tempfile.TemporaryDirectory() as data,
        tempfile.TemporaryFile(mode="w+") as log,
    ):
        try:
            debug = port()
            env = {
                key: value
                for key, value in os.environ.items()
                if key not in {"MEMO_GATEWAY_ROOT", "MEMO_GATEWAY_PYTHON"}
            }
            env.update(XDG_CONFIG_HOME=data, MEMO_DESKTOP_GATEWAY_PORT=str(port()))
            process = subprocess.Popen(
                [
                    str(APP / "Memo"),
                    "--ozone-platform=headless",
                    f"--remote-debugging-port={debug}",
                    f"--user-data-dir={data}/chromium",
                ],
                cwd=data,
                env=env,
                stdout=log,
                stderr=log,
                start_new_session=True,
            )
            for _ in range(120):
                if process.poll() is not None:
                    raise RuntimeError(f"Desktop exited: {process.returncode}")
                try:
                    with CLIENT.open(
                        f"http://127.0.0.1:{debug}/json", timeout=1
                    ) as response:
                        pages = json.load(response)
                    page = next(
                        (page for page in pages if page["type"] == "page"), None
                    )
                    if page:
                        connection = websocket.create_connection(
                            page["webSocketDebuggerUrl"],
                            suppress_origin=True,
                            timeout=5,
                        )
                        break
                except OSError:
                    pass
                time.sleep(0.1)
            else:
                raise RuntimeError("Desktop debugger did not become ready")
            next_id = 0

            def command(method: str, params: dict):
                nonlocal next_id
                next_id += 1
                connection.send(
                    json.dumps({"id": next_id, "method": method, "params": params})
                )
                while True:
                    reply = json.loads(connection.recv())
                    if reply.get("id") == next_id:
                        return reply.get("result", {})

            def evaluate(expression: str):
                return (
                    command("Runtime.evaluate", {"expression": expression})
                    .get("result", {})
                    .get("value")
                )

            def wait_text(text: str):
                for _ in range(900):
                    if text in (evaluate("document.body.innerText") or ""):
                        return
                    time.sleep(0.1)
                raise RuntimeError(f"Desktop did not show: {text}")

            def fill(selector: str, value: str):
                evaluate(
                    f"document.querySelector({json.dumps(selector)}).focus(); document.querySelector({json.dumps(selector)}).select()"
                )
                command("Input.insertText", {"text": value})

            def onboard():
                wait_text("Meet your first agent")
                evaluate("document.querySelector('form').requestSubmit()")
                wait_text("Warm")
                evaluate(
                    "Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Warm')).click()"
                )
                evaluate("document.querySelector('form').requestSubmit()")
                wait_text("Description")
                fill("form input", "Nova")
                fill("form textarea", "A patient research partner.")
                evaluate("document.querySelector('form').requestSubmit()")
                wait_text("Working instructions")
                fill("form textarea", "Be curious, honest, and kind.")
                evaluate("document.querySelector('form').requestSubmit()")
                wait_text("Model")
                evaluate("document.querySelector('form').requestSubmit()")
                wait_text("Enable app integrations for this agent")
                evaluate("document.querySelector('form').requestSubmit()")
                wait_text("New agent")
                assert "Nova" in evaluate("document.body.innerText")
                saved = list(Path(data).rglob("agents.json"))
                assert len(saved) == 1, saved
                profiles = json.loads(saved[0].read_text())
                assert profiles[0]["name"] == "Nova"
                assert profiles[0]["style"] == "warm"
                assert profiles[0]["description"] == "A patient research partner."
                assert profiles[0]["soul"] == "Be curious, honest, and kind."
                # A renderer reload must restore the agent and skip onboarding.
                command("Page.reload", {})
                wait_text("New agent")
                assert "Meet your first agent" not in evaluate(
                    "document.body.innerText"
                )
                assert "Nova" in evaluate("document.body.innerText")
                # Removing the last agent should return to onboarding.
                evaluate(
                    "document.querySelector('[aria-label=\"Delete Nova\"]').click()"
                )
                wait_text("Meet your first agent")
                assert json.loads(saved[0].read_text()) == []
                print(
                    "Agent onboarding, personality persistence, reload and last-agent deletion passed"
                )

            saw_loading = False
            for _ in range(900):
                text = evaluate("document.body.innerText") or ""
                saw_loading |= "Starting Memo" in text
                if broken and "Memo couldn’t start" in text:
                    assert "bundled gateway is missing" in text
                    assert "Try again" in text
                    hidden.rename(entry)
                    evaluate(
                        "Array.from(document.querySelectorAll('button')).find(b => b.innerText === 'Try again').click()"
                    )
                    break
                if not broken and "Meet your first agent" in text:
                    assert (
                        saw_loading
                    ), "Expected the loading screen before the app became ready"
                    onboard()
                    print("Packaged desktop loading screen -> onboarding passed")
                    return
                time.sleep(0.1)
            else:
                raise RuntimeError("Expected startup screen state was not reached")
            for _ in range(900):
                if "Meet your first agent" in (
                    evaluate("document.body.innerText") or ""
                ):
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
