$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot "native\windows\MemoSandbox.cs"
$outputDir = Join-Path $projectRoot ".sandbox-build"
$output = Join-Path $outputDir "MemoSandbox.exe"
$compiler = "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler)) { throw "Windows C# compiler is unavailable." }
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
& $compiler /nologo /optimize+ /target:exe "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw "Memo sandbox compilation failed." }
Write-Output $output
