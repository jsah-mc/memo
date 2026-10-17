param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory
)

$ErrorActionPreference = "Stop"
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$WorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
$ShortcutPath = Join-Path ([Environment]::GetFolderPath("Programs")) "Memo.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Executable
$Shortcut.WorkingDirectory = $WorkingDirectory
$Shortcut.IconLocation = "$Executable,0"
$Shortcut.Save()
