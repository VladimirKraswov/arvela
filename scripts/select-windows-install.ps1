function Select-DesktopInstallation {
  [CmdletBinding()]
  param(
    [object[]]$Entries,
    [Parameter(Mandatory = $true)][string]$ExpectedVersion
  )

  # Renaming the product must not make legacy installations invisible. Never
  # silently accept an arbitrary/stale entry when legacy and current product names exist.
  $desktops = @($Entries | Where-Object {
    $_.DisplayName -in @('Arvela', 'AgentMesh Desktop', 'OpenCode Desktop')
  })
  $matches = @($desktops | Where-Object { $_.DisplayVersion -eq $ExpectedVersion })
  if ($matches.Count -gt 1) {
    throw "Multiple Desktop installations report version $ExpectedVersion; verify the running executable manually."
  }
  if ($matches.Count -eq 1) { return $matches[0] }
  if ($desktops.Count -eq 0) { throw 'Arvela (including legacy Desktop names) is not installed for this user.' }
  $versions = ($desktops | ForEach-Object { "$($_.DisplayName) $($_.DisplayVersion)" }) -join ', '
  throw "Installed versions ($versions) differ from source $ExpectedVersion."
}
