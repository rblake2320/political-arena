$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$target = Join-Path $repo '.wrangler/inference-b11065'
$archive = Join-Path $target 'llama-b11065-bin-win-vulkan-x64.zip'
$expected = '12733edc26574d117cb189fb5c95323d37a94d1d27123f540f788b328cf9d68b'
New-Item -ItemType Directory -Path $target -Force | Out-Null
if (-not (Test-Path -LiteralPath $archive)) {
    Invoke-WebRequest 'https://github.com/ggml-org/llama.cpp/releases/download/b11065/llama-b11065-bin-win-vulkan-x64.zip' -OutFile $archive
}
if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLower() -ne $expected) {
    throw 'Official release archive digest mismatch; do not execute it.'
}
$executable = Join-Path $target 'llama-server.exe'
if (-not (Test-Path -LiteralPath $executable)) {
    Expand-Archive -LiteralPath $archive -DestinationPath $target
}
Write-Output "Prepared isolated runtime: $executable (no PATH, driver, or service changes)"
