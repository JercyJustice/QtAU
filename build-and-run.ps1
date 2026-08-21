# Build QtAU and start the compiled exe.
# Usage: powershell -ExecutionPolicy Bypass -File .\build-and-run.ps1

$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

if ($env:ELECTRON_RUN_AS_NODE) {
  Remove-Item Env:ELECTRON_RUN_AS_NODE
}

Get-Process -Name QtAU, electron -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Milliseconds 400

if (-not (Test-Path 'node_modules')) {
  npm install
}

npm run dist
if ($LASTEXITCODE -ne 0) {
  throw "Build failed with exit code $LASTEXITCODE"
}

$unpacked = Join-Path $PSScriptRoot 'dist\win-unpacked\QtAU.exe'
$portable = Join-Path $PSScriptRoot 'dist\QtAU.exe'
$exe = if (Test-Path $unpacked) { $unpacked } else { $portable }

if (-not (Test-Path $exe)) {
  throw "Built exe not found"
}

Write-Host "Starting $exe"
Start-Process $exe
