$ErrorActionPreference = "Stop"

$MemoRoot = Join-Path $HOME ".memo"
$MemoApp = Join-Path $MemoRoot "app"
$MemoLauncher = Join-Path $MemoRoot "memo.ps1"
$Repository = "https://github.com/jsah-mc/memo.git"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw "Git is required. Install Git, then run this installer again."
}

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Host "Installing uv..."
  Invoke-RestMethod https://astral.sh/uv/install.ps1 | Invoke-Expression
  $env:Path = "$HOME\.local\bin;$env:Path"
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "Installing pnpm..."
  Invoke-WebRequest https://get.pnpm.io/install.ps1 -UseBasicParsing | Invoke-Expression
  $env:PNPM_HOME = Join-Path $env:LOCALAPPDATA "pnpm"
  $env:Path = "$env:PNPM_HOME;$env:Path"
}

New-Item -ItemType Directory -Force $MemoRoot | Out-Null
if (Test-Path (Join-Path $MemoApp ".git")) {
  git -C $MemoApp fetch --tags origin
  git -C $MemoApp pull --ff-only
} elseif (Test-Path $MemoApp) {
  throw "$MemoApp exists but is not a Git checkout. Move it aside and retry."
} else {
  git clone $Repository $MemoApp
}

Push-Location $MemoApp
try {
  uv sync --locked
  pnpm install --frozen-lockfile
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build_windows_sandbox.ps1
} finally {
  Pop-Location
}

@"
`$ErrorActionPreference = "Stop"
Set-Location -LiteralPath "$MemoApp"
`$env:MEMO_GATEWAY_ROOT = "$MemoApp"
pnpm --filter @memo/desktop start
"@ | Set-Content -LiteralPath $MemoLauncher -Encoding utf8

$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath("Desktop")) "Memo.lnk"))
$Shortcut.TargetPath = "powershell.exe"
$Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$MemoLauncher`""
$Shortcut.WorkingDirectory = $MemoApp
$Shortcut.IconLocation = (Join-Path $MemoApp "node_modules\\electron\\dist\\electron.exe") + ",0"
$Shortcut.Save()

Write-Host "Memo installed in $MemoApp. Launch it from the Memo desktop shortcut."
