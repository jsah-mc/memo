"""Build a relocatable gateway runtime from the project's locked dependencies.

POSIX builds use uv's relocatable Python distribution. Windows uses a complete
Python 3.13 installation (actions/setup-python in CI). Speech uses CPU wheels;
no user credentials, model caches, development checkout or venv paths are copied.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / ".gateway-build"


def run(*args: str, **kwargs):
    return subprocess.run(args, check=True, cwd=ROOT, **kwargs)


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    os.environ["UV_CACHE_DIR"] = str(BUILD / "uv-cache")
    if sys.platform != "win32":
        run("uv", "python", "install", "3.13")
    interpreter = run(
        "uv", "python", "find", *([] if sys.platform == "win32" else ["--managed-python"]),
        "3.13", capture_output=True, text=True,
    ).stdout.strip()
    env = BUILD / "env"
    run("uv", "venv", "--clear", "--python", interpreter, str(env))
    python = env / ("Scripts/python.exe" if sys.platform == "win32" else "bin/python")
    exported = run(
        "uv", "export", "--frozen", "--no-dev", "--no-hashes", "--no-emit-project",
        "--format", "requirements-txt", capture_output=True, text=True,
    ).stdout
    # Retain pinned versions/markers for every dependency except the deliberate
    # CUDA -> CPU speech substitution. Install CPU torch separately so no other
    # dependencies can accidentally resolve from the PyTorch index.
    requirements = []
    for line in exported.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("-"):
            raise RuntimeError(f"Unexpected non-package requirement: {line}")
        name = re.split(r"[=\[; <!]", line, maxsplit=1)[0].lower().replace("_", "-")
        if name in {"torch", "torchaudio", "triton"} or name.startswith(("nvidia-", "cuda-")):
            continue
        requirements.append(line)
    requirement_file = BUILD / "requirements.txt"
    requirement_file.write_text("\n".join(requirements) + "\n", encoding="utf-8")
    locked = tomllib.loads((ROOT / "uv.lock").read_text())
    versions = {package["version"].split("+")[0] for package in locked["package"]
                if package["name"] in {"torch", "torchaudio"}}
    if len(versions) != 1:
        raise RuntimeError("Expected one matching torch/torchaudio version in uv.lock")
    version = versions.pop() + ("" if sys.platform == "darwin" else "+cpu")
    index = "https://pypi.org/simple" if sys.platform == "darwin" else "https://download.pytorch.org/whl/cpu"
    run("uv", "pip", "install", "--python", str(python), "--no-deps", "--index", index,
        f"torch=={version}", f"torchaudio=={version}")
    run("uv", "pip", "install", "--python", str(python), "--no-deps", "-r", str(requirement_file))
    run("uv", "pip", "check", "--python", str(python))
    layout = json.loads(run(str(python), "-c", (
        "import json,sys,sysconfig; print(json.dumps({'base':sys.base_prefix,"
        "'site':sysconfig.get_path('purelib')}))"
    ), capture_output=True, text=True).stdout)
    bundle = BUILD / "gateway"
    if bundle.exists():
        shutil.rmtree(bundle)
    base = Path(layout["base"])
    target = bundle / "runtime"
    # Omit the base interpreter's unrelated packages and bytecode. Following
    # symlinks copies real files rather than links to CI/build machine paths.
    shutil.copytree(base, target, symlinks=False, ignore=shutil.ignore_patterns(
        "site-packages", "__pycache__", "*.pyc", "*.pyo", "uv-receipt.json",
    ))
    site = target / ("Lib/site-packages" if sys.platform == "win32" else "lib/python3.13/site-packages")
    shutil.copytree(layout["site"], site, symlinks=False, ignore=shutil.ignore_patterns(
        "__pycache__", "*.pyc", "*.pyo", "_virtualenv.py", "_virtualenv.pth",
    ))
    # Ship native audio libraries too. macOS PyAudio wheels built by Homebrew
    # otherwise retain an absolute /opt/homebrew dependency on PortAudio.
    native = target / "lib"
    native.mkdir(exist_ok=True)
    if sys.platform == "darwin":
        prefix = run("brew", "--prefix", "portaudio", capture_output=True, text=True).stdout.strip()
        audio = Path(prefix) / "lib/libportaudio.2.dylib"
        shutil.copy2(audio, native / audio.name)
        for extension in site.glob("pyaudio/*.so"):
            links = run("otool", "-L", str(extension), capture_output=True, text=True).stdout
            for line in links.splitlines()[1:]:
                dependency = line.strip().split(" (", 1)[0]
                if "libportaudio" in dependency:
                    relative = os.path.relpath(native / audio.name, extension.parent)
                    run("install_name_tool", "-change", dependency, "@loader_path/" + relative, str(extension))
                    run("codesign", "--force", "--sign", "-", str(extension))
    elif sys.platform == "linux":
        for extension in site.glob("pyaudio/*.so"):
            links = run("ldd", str(extension), capture_output=True, text=True).stdout
            for line in links.splitlines():
                if any(name in line for name in ("libportaudio", "libasound", "libjack")):
                    fields = line.strip().split()
                    if len(fields) < 3 or not Path(fields[2]).is_file():
                        raise RuntimeError(f"Missing audio library: {line}")
                    shutil.copy2(fields[2], native / fields[0])
    app = bundle / "app"
    shutil.copytree(ROOT / "utils", app / "utils", ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    shutil.copy2(ROOT / "system.txt", app / "system.txt")
    shutil.copy2(ROOT / "scripts/gateway_entry.py", app / "gateway_entry.py")
    manifest = {
        "python": "runtime/python.exe" if sys.platform == "win32" else "runtime/bin/python3",
        "entry": "app/gateway_entry.py", "speech_device": "cpu", "python_version": "3.13",
    }
    (bundle / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    # Installed files must remain readable/executable after a root-owned install.
    bundle.chmod(0o755)
    for item in bundle.rglob("*"):
        if item.is_dir():
            item.chmod(0o755)
        elif item.is_file():
            item.chmod(0o755 if item.stat().st_mode & 0o111 else 0o644)
    shutil.rmtree(env)
    shutil.rmtree(BUILD / "uv-cache", ignore_errors=True)
    print(f"Gateway bundle: {bundle}")


if __name__ == "__main__":
    main()
