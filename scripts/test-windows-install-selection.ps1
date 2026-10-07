$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'select-windows-install.ps1')

function Entry([string]$Name, [string]$Version) {
  [pscustomobject]@{ DisplayName = $Name; DisplayVersion = $Version }
}
function Expect-Failure([object[]]$Entries, [string]$Message) {
  try { Select-DesktopInstallation -Entries $Entries -ExpectedVersion '0.2.21' | Out-Null }
  catch {
    if ($_.Exception.Message -notlike "*$Message*") { throw }
    return
  }
  throw "Expected failure containing $Message"
}

$current = Entry 'AgentMesh Desktop' '0.2.21'
$legacy = Entry 'OpenCode Desktop' '0.2.21'
$stale = Entry 'OpenCode Desktop' '0.2.18'
foreach ($entries in @(@($current), @($legacy), @($stale, $current), @($current, $stale))) {
  $selected = Select-DesktopInstallation -Entries $entries -ExpectedVersion '0.2.21'
  if ($selected.DisplayVersion -ne '0.2.21') { throw 'Selected stale version' }
}
Expect-Failure @() 'not installed'
Expect-Failure @($stale) 'differ from source'
Expect-Failure @((Entry 'Other App' '0.2.21')) 'not installed'
Expect-Failure @($legacy, $current) 'Multiple Desktop installations'
Write-Host 'PASS: 8 installation selection cases; no registry or user data changed.'
