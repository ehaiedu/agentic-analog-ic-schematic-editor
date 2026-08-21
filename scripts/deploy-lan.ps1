param(
  [string]$InstallRoot = "",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$SourceRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Head = & git -C $SourceRoot rev-parse --verify HEAD 2>$null
if ($LASTEXITCODE -ne 0 -or -not $Head) {
  throw "The source repository has no commit. Create the initial Git commit before deploying."
}
$DirtyFiles = @(& git -C $SourceRoot status --porcelain)
if ($LASTEXITCODE -ne 0) { throw "Unable to inspect the source Git worktree." }
if ($DirtyFiles.Count -gt 0) {
  throw "The source worktree has uncommitted changes. Commit them before deploying so the clone cannot silently miss files."
}
if (-not $InstallRoot) {
  $InstallRoot = Join-Path (Split-Path $SourceRoot -Parent) "analog-studio-lan"
}
$InstallRoot = [System.IO.Path]::GetFullPath($InstallRoot)
$AppRoot = Join-Path $InstallRoot "app"

New-Item -ItemType Directory -Force -Path $InstallRoot | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "data\wrangler") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "logs") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $InstallRoot "backups") | Out-Null

if (-not (Test-Path (Join-Path $AppRoot ".git"))) {
  & git clone $SourceRoot $AppRoot
  if ($LASTEXITCODE -ne 0) { throw "Git clone failed with exit code $LASTEXITCODE" }
} else {
  & git -C $AppRoot pull --ff-only
  if ($LASTEXITCODE -ne 0) { throw "Git update failed. Resolve deployment worktree changes before retrying." }
}

if (-not $SkipInstall) {
  & npm.cmd ci --prefix $AppRoot
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE" }
}

Push-Location $AppRoot
try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE" }
} finally {
  Pop-Location
}

Write-Host "Deployment prepared at: $AppRoot"
Write-Host "Persistent data at:      $(Join-Path $InstallRoot 'data\wrangler')"
Write-Host "Start with:"
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$(Join-Path $AppRoot 'scripts\start-lan.ps1')`""
