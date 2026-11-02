# Bascule locale du seul lanceur validé ; configuration persistante hors releases.
param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
$lock = $null
$stopped = $false
$changed = $false
$original = $null
function Find-Bridge($entry) {
  return ,@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $config.nodePath -and $_.CommandLine -and $_.CommandLine.Contains($entry) })
}
function Stop-BridgeTask($entry) {
  Stop-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
  for ($i=0; $i -lt 10; $i++) { if ((Find-Bridge $entry).Count -eq 0) { return }; Start-Sleep -Milliseconds 300 }
  # Seulement les processus Node dont l'exécutable et l'entrée ont été vérifiés.
  foreach ($process in (Find-Bridge $entry)) { Stop-Process -Id $process.ProcessId -ErrorAction Stop }
  for ($i=0; $i -lt 10; $i++) { if ((Find-Bridge $entry).Count -eq 0) { return }; Start-Sleep -Milliseconds 300 }
  throw 'Managed bridge process did not stop'
}
function Restore-Launcher {
  $restore = $config.launcherPath + '.restore-' + $release.sha
  [IO.File]::WriteAllText($restore,$original,(New-Object Text.UTF8Encoding($false)))
  Set-Acl -LiteralPath $restore -AclObject (Get-Acl -LiteralPath $config.launcherPath)
  [IO.File]::Replace($restore,$config.launcherPath,$null)
}
try {
  if (!$ConfigPath) {
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.Title = 'Select the verified shop-update.json configuration'
    $dialog.Filter = 'Shop update configuration|shop-update.json'
    if ($dialog.ShowDialog() -ne 'OK') { throw 'Installation cancelled before changes' }
    $ConfigPath = $dialog.FileName
  }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if ($config.version -ne 1) { throw 'Unknown shop configuration' }
  foreach ($field in @('nodePath','launcherPath','previousRelease','releasesDir','oldBridgeEntry','oldPosDist','caCertificate')) {
    $value = $config.$field
    if (!$value -or ![IO.Path]::IsPathRooted($value) -or $value -match '[\r\n]') { throw 'Explicit absolute paths required' }
  }
  foreach ($path in @($config.nodePath,$config.launcherPath,$config.previousRelease,$config.releasesDir,$config.oldBridgeEntry,$config.oldPosDist,$config.caCertificate) + @($config.persistentPaths)) {
    $cursor = Get-Item -LiteralPath $path
    while ($null -ne $cursor) {
      if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are forbidden' }
      $parentPath = [IO.Path]::GetDirectoryName($cursor.FullName.TrimEnd('\'))
      if (!$parentPath -or $parentPath -eq $cursor.FullName) { break }
      $cursor = Get-Item -LiteralPath $parentPath
    }
  }
  if (@($config.persistentPaths).Count -lt 4) { throw 'Registry, buffer and TLS paths must be confirmed' }
  $previous = [IO.Path]::GetFullPath($config.previousRelease).TrimEnd('\') + '\'
  foreach ($path in @($config.persistentPaths) + @($config.launcherPath)) {
    if ([IO.Path]::GetFullPath($path).StartsWith($previous,[StringComparison]::OrdinalIgnoreCase)) { throw 'Persistent configuration must be outside releases' }
  }
  $lock = [IO.File]::Open((Join-Path $config.releasesDir '.shop-update.lock'),'OpenOrCreate','ReadWrite','None')
  $env:NODE_EXTRA_CA_CERTS = $config.caCertificate
  & $config.nodePath (Join-Path $root 'verify-shop.mjs') --install
  if ($LASTEXITCODE -ne 0) { throw 'Package verification failed' }
  $release = Get-Content -LiteralPath (Join-Path $root 'release.json') -Raw | ConvertFrom-Json
  $destination = Join-Path $config.releasesDir $release.sha
  $newEntry = Join-Path $destination 'apps\print-bridge\dist\server.js'
  if (Test-Path -LiteralPath $destination) { throw 'Release exists; verify its installation report before retrying' }
  $task = Get-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
  if ($task.State -ne 'Running' -or @($task.Actions).Count -ne 1) { throw 'Expected one running cashier task' }
  $action = $task.Actions[0]
  if (!$action.Arguments.Contains($config.launcherPath) -and $action.Execute -ne $config.launcherPath) { throw 'Task does not reference the verified launcher' }
  if ((Find-Bridge $config.oldBridgeEntry).Count -ne 1) { throw 'Expected exactly one verified previous bridge process' }
  $previousHealth = Invoke-RestMethod -Uri ($config.origin.TrimEnd('/') + '/health') -TimeoutSec 10
  if ($previousHealth.status -ne 'ok') { throw 'Previous service is not healthy' }
  $bytes = [IO.File]::ReadAllBytes($config.launcherPath)
  if ((Get-FileHash -LiteralPath $config.launcherPath -Algorithm SHA256).Hash -ne $config.launcherSha256) { throw 'Launcher changed; refresh the local configuration' }
  if ($bytes -contains 0 -or ($bytes.Length -gt 2 -and $bytes[0] -eq 239 -and $bytes[1] -eq 187)) { throw 'Launcher must be UTF-8 without BOM' }
  $original = [Text.Encoding]::UTF8.GetString($bytes)
  if (!$original.Contains($config.oldBridgeEntry) -or !$original.Contains($config.oldPosDist)) { throw 'Launcher layout is not verified' }
  $updated = $original.Replace($config.oldBridgeEntry,(Join-Path $destination 'apps\print-bridge\dist\server.js')).Replace($config.oldPosDist,(Join-Path $destination 'apps\pos\dist'))
  if ($updated.Contains($config.previousRelease)) { throw 'Other release-local configuration would be lost' }
  Copy-Item -LiteralPath (Join-Path $root 'payload') -Destination $destination -Recurse
  & $config.nodePath (Join-Path $root 'verify-shop.mjs') --installed $destination
  if ($LASTEXITCODE -ne 0) { throw 'Installed payload verification failed before stopping service' }
  $backup = $config.launcherPath + '.rollback-' + $release.sha
  Copy-Item -LiteralPath $config.launcherPath -Destination $backup
  Set-Acl -LiteralPath $backup -AclObject (Get-Acl -LiteralPath $config.launcherPath)
  $journal = Join-Path $destination 'installation.json'
  @{ state='staged'; sha=$release.sha; previousRelease=$config.previousRelease } | ConvertTo-Json | Set-Content -LiteralPath $journal
  $stopped = $true
  Stop-BridgeTask $config.oldBridgeEntry
  $temp = $config.launcherPath + '.update-' + $release.sha
  [IO.File]::WriteAllText($temp,$updated,(New-Object Text.UTF8Encoding($false)))
  Set-Acl -LiteralPath $temp -AclObject (Get-Acl -LiteralPath $config.launcherPath)
  [IO.File]::Replace($temp,$config.launcherPath,$null)
  $changed = $true
  Start-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
  $healthy = $false
  for ($attempt=0; $attempt -lt 10; $attempt++) {
    Start-Sleep -Seconds 2
    & $config.nodePath (Join-Path $root 'verify-shop.mjs') --served $config.origin
    if ($LASTEXITCODE -eq 0 -and (Find-Bridge $newEntry).Count -eq 1) { $healthy=$true; break }
  }
  if (!$healthy) { throw 'New release health or served assets could not be verified' }
  @{ state='verified'; sha=$release.sha; previousRelease=$config.previousRelease; at=(Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json | Set-Content -LiteralPath $journal
  Write-Host 'POS and bridge updated. Reload the cashier POS and tablets. Check the cashier printer before service.'
} catch {
  if ($changed) {
    try {
      Stop-BridgeTask $newEntry
      Restore-Launcher
      Start-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
      $restored = $false
      for ($i=0; $i -lt 10; $i++) {
        Start-Sleep -Seconds 2
        try {
          $health = Invoke-RestMethod -Uri ($config.origin.TrimEnd('/') + '/health') -TimeoutSec 5
          if ($health.status -eq 'ok' -and (Find-Bridge $config.oldBridgeEntry).Count -eq 1) { $restored=$true; break }
        } catch { }
      }
      if (!$restored) { throw 'Previous service restart could not be verified' }
      @{ state='rolled-back'; sha=$release.sha; previousRelease=$config.previousRelease } | ConvertTo-Json | Set-Content -LiteralPath $journal
      Write-Host 'Previous launcher and running bridge restored. Reload the POS before use.'
    } catch { Write-Host 'Rollback incomplete. Keep the POS closed and restore the saved launcher.' }
  } elseif ($stopped) {
    try { Start-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath } catch { Write-Host 'Previous task restart failed.' }
  }
  Write-Error 'Update not completed. No browser storage, registry, buffer or TLS files were changed.'
  exit 1
} finally { if ($null -ne $lock) { $lock.Dispose() } }
