[CmdletBinding()]
param(
  [string]$InstallerPath = '',
  [string]$HealthUrl = 'http://127.0.0.1:4096/global/health',
  [switch]$ArtifactOnly
)

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This artifact check must run on Windows.'
}

if (-not $InstallerPath) {
  $bundleDir = Join-Path $PSScriptRoot '..\src-tauri\target\release\bundle\nsis'
  $candidate = Get-ChildItem -LiteralPath $bundleDir -Filter '*-setup.exe' -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $candidate) {
    throw "No NSIS installer found in $bundleDir"
  }
  $InstallerPath = $candidate.FullName
}

$installer = Get-Item -LiteralPath $InstallerPath
$hash = Get-FileHash -Algorithm SHA256 -LiteralPath $installer.FullName
$signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName

$uninstallRoot = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
$installed = Get-ChildItem -LiteralPath $uninstallRoot -ErrorAction SilentlyContinue |
  ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue } |
  Where-Object { $_.DisplayName -eq 'OpenCode Desktop' } |
  Select-Object -First 1

$health = $null
if (-not $ArtifactOnly) {
  $health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 5
  if ($health.healthy -ne $true) { throw 'OpenCode did not report healthy=true.' }
  if (-not $installed) { throw 'OpenCode Desktop is not installed for this user.' }
  $package = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json
  if ($installed.DisplayVersion -ne $package.version) {
    throw "Installed version $($installed.DisplayVersion) differs from source $($package.version)."
  }
}

[pscustomobject]@{
  Installer = $installer.FullName
  InstallerBytes = $installer.Length
  SHA256 = $hash.Hash
  SignatureStatus = [string]$signature.Status
  InstalledVersion = $installed.DisplayVersion
  InstallLocation = $installed.InstallLocation
  OpenCodeHealthy = [bool]$health.healthy
  OpenCodeVersion = $health.version
} | Format-List

if ($installer.Length -eq 0) {
  throw 'Installer is empty.'
}
Write-Host 'Windows artifact checks completed. UI and agent acceptance require separate live tests.'
