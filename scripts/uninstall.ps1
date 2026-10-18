param([switch]$Yes)

$ErrorActionPreference = "Stop"
$MemoRoot = Join-Path $HOME ".memo"

if (-not $Yes) {
  $Answer = Read-Host "Uninstall Memo, its desktop build, and managed source? [y/N]"
  if ($Answer -notmatch "^[Yy]$") {
    Write-Host "Memo was not uninstalled."
    exit 0
  }
}

$Shortcut = Join-Path ([Environment]::GetFolderPath("Programs")) "Memo.lnk"
Remove-Item -LiteralPath $Shortcut -Force -ErrorAction SilentlyContinue

$MemoBin = Join-Path $MemoRoot "bin"
$UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
$UserEntries = @($UserPath -split ";" | Where-Object {
  $_ -and -not [string]::Equals($_.TrimEnd("\"), $MemoBin.TrimEnd("\"), [System.StringComparison]::OrdinalIgnoreCase)
})
[Environment]::SetEnvironmentVariable("Path", ($UserEntries -join ";"), "User")

Remove-Item -LiteralPath "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Memo" -Recurse -Force -ErrorAction SilentlyContinue

$EscapedRoot = $MemoRoot.Replace("'", "''")
$Cleanup = Join-Path $env:TEMP "memo-uninstall-$PID.ps1"
@"
Start-Sleep -Seconds 1
Remove-Item -LiteralPath '$EscapedRoot' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath `$PSCommandPath -Force -ErrorAction SilentlyContinue
"@ | Set-Content -LiteralPath $Cleanup -Encoding utf8

Set-Location $HOME
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $Cleanup
)
Write-Host "Memo was removed. Open terminals will see the PATH change after restart."
