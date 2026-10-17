# Memo

Memo is a local-first AI desktop app built with Electron, React, TypeScript and
Python. The Electron process manages the FastAPI gateway, window, tray,
workspace settings and updates. Chat, browser automation, computer tools and
local speech run through the Python gateway.

## Install

Memo installs into `~/.memo/app` as a managed clone of this repository. Git must
already be installed. The installers add `uv` and `pnpm` when they are missing,
then install the locked Python and JavaScript dependencies.

### Windows

Download `install.ps1` from the latest GitHub release, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

The installer creates a Memo desktop shortcut. It launches Electron with its
terminal hidden. Closing the window keeps Memo running in the system tray; use
the tray menu to reopen or quit it.

### Linux and macOS

Download `install.sh` from the latest GitHub release, then run:

```sh
sh install.sh
```

The launcher is written to `~/.memo/bin/memo-desktop`. Linux also receives a
desktop-menu entry.

## Updates

Memo checks the official `main` branch after launch and every four hours. When
an update is available, it can fast-forward `~/.memo/app`, run `uv sync
--locked` and `pnpm install --frozen-lockfile`, and restart. Updates stop when
the managed checkout has local modifications so user work is never overwritten.

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
