# Memo

Memo is a local-first AI desktop app built with Electron, React, TypeScript and
Python. The Electron process manages the FastAPI gateway, window, tray,
workspace settings and updates. Chat, browser automation, computer tools and
local speech run through the Python gateway.

## Install

Memo installs into `~/.memo/app` as a managed clone of this repository. Git must
already be installed. The installers add `uv` and `pnpm` when they are missing,
install the locked dependencies, and add the `memo` command to your user PATH.
The desktop application is not built during installation.

### Windows

Download `scripts/install.ps1` from the GitHub repository's `main` branch, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Open a new terminal after installation and run `memo`, or launch Memo from the
Windows Start menu. The first Start menu launch or `memo desktop` command builds
the Electron application; later launches reuse that build. Closing its window
keeps Memo running in the system tray; use the tray menu to reopen or quit it.
Memo also appears in Windows Installed Apps. Remove it there or run
`memo uninstall` from a terminal.

### Linux and macOS

Download `scripts/install.sh` from the GitHub repository's `main` branch, then run:

```sh
sh install.sh
```

The launcher is written to `~/.memo/bin/memo` and added to the shell PATH. Run
`memo desktop` to build and launch Electron. That command adds Memo to the Linux
application menu or `~/Applications` on macOS after a successful build.

The desktop build is cached. `memo desktop` rebuilds it only when the managed
source revision changes.

## Updates

Memo desktop checks the official `main` branch after launch and every four hours. When
an update is available, it fast-forwards `~/.memo/app`, refreshes dependencies,
rebuilds the installed desktop application and launcher, and restarts. Updates stop when
the managed checkout has local modifications so user work is never overwritten.

Use **Settings → Updates** to check manually and install an update from the
desktop app. From a terminal, use `memo update --check` to check without making
changes or `memo update` to install the latest source and locked dependencies.

Running either installer again performs the same safe update and dependency
sync.

## Development

Requirements:

- Python 3.13
- `uv`
- Node.js 24
- `pnpm` 11.20.0

```powershell
uv sync --locked
pnpm install --frozen-lockfile
pnpm dev
```

Run the Python gateway separately with:

```powershell
uv run memo gateway --host 127.0.0.1 --port 4010
```

## Validation

```powershell
uv run python -m unittest discover -s tests
pnpm typecheck
pnpm lint
node --test scripts/tests/*.test.mjs
```

Chat history and settings are stored under the platform Electron user-data
directory. The managed application source and its virtual environment live
under `~/.memo/app`.

## License

MIT. See [LICENSE](./LICENSE).
