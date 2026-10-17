#!/bin/sh
set -eu

MEMO_ROOT="${HOME}/.memo"
MEMO_APP="${MEMO_ROOT}/app"
MEMO_BIN="${MEMO_ROOT}/bin"
REPOSITORY="https://github.com/jsah-mc/memo.git"

command -v git >/dev/null 2>&1 || { echo "Git is required. Install Git and retry." >&2; exit 1; }

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Administrator access is required to install PortAudio." >&2
    exit 1
  fi
}

install_audio_dependencies() {
  case "$(uname -s)" in
    Linux)
      if command -v pkg-config >/dev/null 2>&1 && pkg-config --exists portaudio-2.0; then
        return
      fi
      if command -v apt-get >/dev/null 2>&1; then
        run_privileged apt-get update
        run_privileged apt-get install -y portaudio19-dev
      elif command -v dnf >/dev/null 2>&1; then
        run_privileged dnf install -y portaudio-devel
      elif command -v pacman >/dev/null 2>&1; then
        run_privileged pacman -S --needed --noconfirm portaudio
      else
        echo "Install the PortAudio development package for your distribution, then retry." >&2
        exit 1
      fi
      ;;
    Darwin)
      command -v brew >/dev/null 2>&1 || {
        echo "Homebrew is required to install PortAudio. Install it from https://brew.sh and retry." >&2
        exit 1
      }
      brew list portaudio >/dev/null 2>&1 || brew install portaudio
      ;;
  esac
}

if ! command -v uv >/dev/null 2>&1; then
  echo "Installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  PATH="${HOME}/.local/bin:${PATH}"
fi

if ! command -v pnpm >/dev/null 2>&1; then
  echo "Installing pnpm..."
  curl -fsSL https://get.pnpm.io/install.sh | sh -
  export PNPM_HOME="${HOME}/.local/share/pnpm"
  PATH="${PNPM_HOME}:${PATH}"
fi

install_audio_dependencies

mkdir -p "${MEMO_ROOT}" "${MEMO_BIN}"
if [ -d "${MEMO_APP}/.git" ]; then
  git -C "${MEMO_APP}" fetch --tags origin
  git -C "${MEMO_APP}" pull --ff-only
elif [ -e "${MEMO_APP}" ]; then
  echo "${MEMO_APP} exists but is not a Git checkout. Move it aside and retry." >&2
  exit 1
else
  git clone "${REPOSITORY}" "${MEMO_APP}"
fi

cd "${MEMO_APP}"
uv sync --locked
pnpm install --frozen-lockfile

cat > "${MEMO_BIN}/memo-desktop" <<EOF
#!/bin/sh
cd "${MEMO_APP}"
export MEMO_GATEWAY_ROOT="${MEMO_APP}"
nohup pnpm --filter @memo/desktop start >>"${MEMO_ROOT}/desktop.log" 2>&1 &
EOF
chmod +x "${MEMO_BIN}/memo-desktop"

case "$(uname -s)" in
  Linux)
    mkdir -p "${HOME}/.local/share/applications"
    cat > "${HOME}/.local/share/applications/memo.desktop" <<EOF
[Desktop Entry]
Name=Memo
Comment=Local AI assistant
Exec=${MEMO_BIN}/memo-desktop
Icon=${MEMO_APP}/apps/desktop/assets/memo-icon.svg
Terminal=false
Type=Application
Categories=Utility;
EOF
    ;;
esac

echo "Memo installed in ${MEMO_APP}. Run ${MEMO_BIN}/memo-desktop."
