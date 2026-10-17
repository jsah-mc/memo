$ErrorActionPreference = "Stop"

$MemoRoot = Join-Path $HOME ".memo"
$MemoApp = Join-Path $MemoRoot "app"
$MemoBin = Join-Path $MemoRoot "bin"
$MemoCommand = Join-Path $MemoBin "memo.cmd"
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

New-Item -ItemType Directory -Force $MemoRoot, $MemoBin | Out-Null
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
} finally {
  Pop-Location
}

@"
@echo off
setlocal
set "MEMO_APP=$MemoApp"
if /I "%~1"=="desktop" (
  shift
  node "%MEMO_APP%\scripts\launch-desktop.mjs" %*
  exit /b
)
cd /d "%MEMO_APP%"
uv run memo-legacy %*
"@ | Set-Content -LiteralPath $MemoCommand -Encoding ascii

$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$UserEntries = @($UserPath -split ";" | Where-Object { $_ })
if ($UserEntries -notcontains $MemoBin) {
  [Environment]::SetEnvironmentVariable("Path", ((@($UserEntries) + $MemoBin) -join ";"), "User")
}
if (($env:Path -split ";") -notcontains $MemoBin) {
  $env:Path = "$MemoBin;$env:Path"
}

Write-Host "Memo CLI installed in $MemoApp and added to PATH."
Write-Host "Open a new terminal and run 'memo'. Run 'memo desktop' to build and launch the desktop app."
