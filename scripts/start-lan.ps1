param(
  [int]$Port = 3000,
  [string]$BindAddress = "0.0.0.0",
  [string]$DataPath = "",
  [string]$EnvFile = "",
  [switch]$Build
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $ProjectRoot

if (-not $DataPath) {
  $InstallRoot = Split-Path $ProjectRoot -Parent
  $DataPath = Join-Path $InstallRoot "data\wrangler"
}
$DataPath = [System.IO.Path]::GetFullPath($DataPath)

if (-not (Test-Path "node_modules")) {
  & npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
}

if ($Build -or -not (Test-Path "dist\server\index.js")) {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE" }
}

New-Item -ItemType Directory -Force -Path $DataPath | Out-Null
$Wrangler = Join-Path $ProjectRoot "node_modules\wrangler\bin\wrangler.js"
$Config = Join-Path $ProjectRoot "wrangler.lan.jsonc"

$PreviousCi = $env:CI
$env:CI = "true"
try {
  & node $Wrangler d1 migrations apply DB --local --config $Config --persist-to $DataPath
  if ($LASTEXITCODE -ne 0) { throw "Database migration failed with exit code $LASTEXITCODE" }
} finally {
  $env:CI = $PreviousCi
}

$Arguments = @(
  $Wrangler,
  "dev",
  "--config", $Config,
  "--local",
  "--ip", $BindAddress,
  "--port", $Port,
  "--persist-to", $DataPath,
  "--var", "LOCAL_DEV_ACCOUNT_ENABLED:false",
  "--show-interactive-dev-session=false"
)
if ($EnvFile) {
  $ResolvedEnvFile = [System.IO.Path]::GetFullPath($EnvFile)
  if (-not (Test-Path $ResolvedEnvFile)) { throw "Environment file not found: $ResolvedEnvFile" }
  $ReservedDevelopmentSetting = Select-String -LiteralPath $ResolvedEnvFile -Pattern '^\s*(export\s+)?LOCAL_DEV_ACCOUNT_(ENABLED|PASSWORD)\s*=' -Quiet
  if ($ReservedDevelopmentSetting) {
    throw "LAN environment files cannot set LOCAL_DEV_ACCOUNT_ENABLED or LOCAL_DEV_ACCOUNT_PASSWORD."
  }
  $Arguments += @("--env-file", $ResolvedEnvFile)
}

Write-Host "Agentic Analog IC Schematic Editor LAN"
Write-Host "  Listen  : http://${BindAddress}:$Port"
Write-Host "  Data    : $DataPath"
if ($BindAddress -eq "0.0.0.0") {
  $LanAddresses = Get-NetIPAddress -AddressFamily IPv4 -AddressState Preferred -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne "127.0.0.1" -and $_.IPAddress -notlike "169.254.*" } |
    Select-Object -ExpandProperty IPAddress -Unique
  foreach ($LanAddress in $LanAddresses) {
    Write-Host "  Open    : http://${LanAddress}:$Port"
  }
}
Write-Host "Press Ctrl+C to stop."
& node @Arguments
exit $LASTEXITCODE
