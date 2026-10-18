param(
  [Parameter(Mandatory = $true)][string]$Executable,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [string]$Arguments = "",
  [string]$Icon = "",
  [string]$UninstallScript = "",
  [string]$DisplayVersion = ""
)

$ErrorActionPreference = "Stop"
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$WorkingDirectory = (Resolve-Path -LiteralPath $WorkingDirectory).Path
if ($Icon) {
  $Icon = (Resolve-Path -LiteralPath $Icon).Path
}
$ShortcutPath = Join-Path ([Environment]::GetFolderPath("Programs")) "Memo.lnk"
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $Executable
$Shortcut.WorkingDirectory = $WorkingDirectory
$Shortcut.Arguments = $Arguments
$Shortcut.IconLocation = if ($Icon) { "$Icon,0" } else { "$Executable,0" }
$Shortcut.Save()

if ($UninstallScript) {
  $UninstallScript = (Resolve-Path -LiteralPath $UninstallScript).Path
  $UninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Memo"
  New-Item -Path $UninstallKey -Force | Out-Null
  Set-ItemProperty -Path $UninstallKey -Name "DisplayName" -Value "Memo"
  Set-ItemProperty -Path $UninstallKey -Name "DisplayIcon" -Value $Shortcut.IconLocation
  Set-ItemProperty -Path $UninstallKey -Name "DisplayVersion" -Value $DisplayVersion
  Set-ItemProperty -Path $UninstallKey -Name "Publisher" -Value "jsah-mc"
  Set-ItemProperty -Path $UninstallKey -Name "NoModify" -Type DWord -Value 1
  Set-ItemProperty -Path $UninstallKey -Name "NoRepair" -Type DWord -Value 1
  Set-ItemProperty -Path $UninstallKey -Name "UninstallString" -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$UninstallScript`""
  Set-ItemProperty -Path $UninstallKey -Name "QuietUninstallString" -Value "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$UninstallScript`" -Yes"
}
