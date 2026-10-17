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

Download `install.ps1` from the latest GitHub release, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

Open a new terminal after installation and run `memo`. To install and launch the
desktop application, run `memo desktop`. Its first run builds Electron and adds
Memo to the Windows Start menu. Closing its window keeps Memo running in the
system tray; use the tray menu to reopen or quit it.

### Linux and macOS

Download `install.sh` from the latest GitHub release, then run:

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
an update is available, it can fast-forward `~/.memo/app`, run `uv sync
--locked` and `pnpm install --frozen-lockfile`, and restart. Updates stop when
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
uv run memo-legacy gateway --host 127.0.0.1 --port 4010
```

### MCP server

Memo can act as a local stdio MCP server for AI agents. Register it with every
detected supported client (Codex, Claude Code, Cursor, and VS Code) with:

```console
memo mcp install
memo mcp status
```

Use `memo mcp install --agent cursor` to configure one client, or
`memo mcp serve` to start the server directly. The server exposes Memo's agent,
enabled named bots, and runtime status.

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
