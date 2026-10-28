param([string]$Architecture = 'arm64-v8a')
$ErrorActionPreference = 'Stop'
$mobileRoot = Split-Path -Parent $PSScriptRoot
$oldApp = $env:ALRAQI_APP
try {
    $env:ALRAQI_APP = 'operations'
    Push-Location $mobileRoot
    & node scripts/install-product-hook.cjs
    if ($LASTEXITCODE -ne 0) { throw 'Native product configuration failed' }
    & ./android/gradlew.bat -p android :app:assembleRelease '-PalraqiApp=operations' "-PreactNativeArchitectures=$Architecture" '-Pkotlin.compiler.execution.strategy=in-process' --max-workers=2 --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Operations build failed' }
} finally {
    Pop-Location
    $env:ALRAQI_APP = $oldApp
}
