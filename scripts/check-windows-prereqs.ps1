[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'This prerequisite check must run on Windows.'
}

$requiredCommands = @('git.exe', 'node.exe', 'npm.cmd', 'rustup.exe', 'rustc.exe', 'cargo.exe')
foreach ($command in $requiredCommands) {
  $resolved = Get-Command $command -ErrorAction SilentlyContinue
  if (-not $resolved -and $command -in @('rustup.exe', 'rustc.exe', 'cargo.exe')) {
    $cargoBinCandidate = Join-Path $env:USERPROFILE ".cargo\bin\$command"
    if (Test-Path -LiteralPath $cargoBinCandidate -PathType Leaf) {
      $resolved = Get-Item -LiteralPath $cargoBinCandidate
    }
  }
  if (-not $resolved) {
    throw "Missing required command: $command"
  }
  $resolvedPath = if ($resolved.Source) { $resolved.Source } else { $resolved.FullName }
  Write-Host "OK $command -> $resolvedPath"
}

$nodeOutput = & node.exe --version
if ($LASTEXITCODE -ne 0) { throw 'node.exe --version failed.' }
$nodeVersion = [version]($nodeOutput.TrimStart('v'))
if (-not (($nodeVersion.Major -eq 24 -and $nodeVersion -ge [version]'24.15.0') -or $nodeVersion.Major -ge 26)) {
  throw "Use Node.js 24 LTS >=24.15.0 or >=26.0.0 with this lockfile; found $nodeVersion"
}
Write-Host "OK Node.js $nodeVersion"

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
  throw 'Visual Studio Installer (vswhere.exe) was not found.'
}
$vsInstall = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Workload.VCTools -property installationPath
if ($LASTEXITCODE -ne 0) { throw 'Visual Studio detection failed.' }
if (-not $vsInstall) {
  throw 'Visual Studio Build Tools with the Desktop C++ workload were not found.'
}
Write-Host "OK Visual Studio C++ workload -> $vsInstall"

$webViewClients = @(
  'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
  'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
)
$webViewVersion = $webViewClients |
  Where-Object { Test-Path -LiteralPath $_ } |
  ForEach-Object { (Get-ItemProperty -LiteralPath $_ -ErrorAction SilentlyContinue).pv } |
  Where-Object { $_ } |
  Select-Object -First 1
if (-not $webViewVersion) {
  throw 'Microsoft Edge WebView2 Evergreen Runtime was not found.'
}
Write-Host "OK WebView2 $webViewVersion"
Write-Host 'Windows build prerequisites are ready.'
