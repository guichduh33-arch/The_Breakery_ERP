# Mise à jour du PC boutique : tâche, arrêt, bascule du lanceur réel, redémarrage, retour automatique.
# Les contrôles de fichiers vivent dans install-shop.mjs ; ce script ne pilote que Windows.
param([string]$ConfigPath)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = $PSScriptRoot
$helper = Join-Path $root 'install-shop.mjs'
$lock = $null
$stopped = $false
$switched = $false
$config = $null
function Invoke-Helper($mode) {
  & $config.nodePath $helper $mode $ConfigPath
  return ($LASTEXITCODE -eq 0)
}
# Seuls les processus du Node vérifié qui exécutent le lanceur vérifié sont gérés.
function Get-ManagedProcesses {
  return ,@(Get-CimInstance Win32_Process | Where-Object {
    $_.ExecutablePath -eq $config.nodePath -and $_.CommandLine -and $_.CommandLine.Contains($config.launcherPath)
  })
}
function Stop-ManagedTask {
  Stop-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
  for ($i=0; $i -lt 10; $i++) { if ((Get-ManagedProcesses).Count -eq 0) { return }; Start-Sleep -Milliseconds 300 }
  foreach ($item in (Get-ManagedProcesses)) { Stop-Process -Id $item.ProcessId -ErrorAction Stop }
  for ($i=0; $i -lt 10; $i++) { if ((Get-ManagedProcesses).Count -eq 0) { return }; Start-Sleep -Milliseconds 300 }
  throw 'Managed launcher process did not stop'
}
# Recopie les seules règles d'accès : imposer le propriétaire échouerait sans élévation.
function Copy-AccessRules($path) {
  $target = Get-Acl -LiteralPath $path
  $target.SetSecurityDescriptorSddlForm($accessRules, 'Access')
  Set-Acl -LiteralPath $path -AclObject $target
}
function Wait-Helper($mode, $attempts) {
  for ($attempt=0; $attempt -lt $attempts; $attempt++) {
    Start-Sleep -Seconds 2
    if ((Get-ManagedProcesses).Count -eq 1 -and (Invoke-Helper $mode)) { return $true }
  }
  return $false
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
  if ($config.version -ne 2) { throw 'Unknown shop configuration; version 2 required' }
  $paths = @('nodePath','launcherPath','externalConfigPath','previousRelease','releasesDir','oldBridgeEntry','oldPosDist','caCertificate','archivePath')
  foreach ($field in $paths) {
    $value = $config.$field
    if (!$value -or ![IO.Path]::IsPathRooted($value) -or $value -match '[\r\n]') { throw 'Explicit absolute paths required' }
    $cursor = Get-Item -LiteralPath $value
    while ($null -ne $cursor) {
      if ($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Reparse points are forbidden' }
      $parentPath = [IO.Path]::GetDirectoryName($cursor.FullName.TrimEnd('\'))
      if (!$parentPath -or $parentPath -eq $cursor.FullName) { break }
      $cursor = Get-Item -LiteralPath $parentPath
    }
  }
  $lock = [IO.File]::Open((Join-Path $config.releasesDir '.shop-update.lock'),'OpenOrCreate','ReadWrite','None')
  $env:NODE_EXTRA_CA_CERTS = $config.caCertificate
  $accessRules = (Get-Acl -LiteralPath $config.launcherPath).GetSecurityDescriptorSddlForm('Access')
  $task = Get-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
  if ($task.State -ne 'Running' -or @($task.Actions).Count -ne 1 -or $task.Principal.UserId -ne $config.taskUser) { throw 'Expected one running cashier task with the verified account' }
  $action = $task.Actions[0]
  if (!($action.Arguments -and $action.Arguments.Contains($config.launcherPath)) -and $action.Execute -ne $config.launcherPath) { throw 'Task does not reference the verified launcher' }
  if ((Get-ManagedProcesses).Count -ne 1) { throw 'Expected exactly one verified launcher process' }
  # Archive, paquet, Node, configuration externe, lanceur et santé actuelle : tout est vérifié avant l'arrêt.
  if (!(Invoke-Helper 'stage')) { throw 'Verified staging failed before service interruption' }
  # Le helper a prouvé que ce SHA est celui du paquet (release.json) et de son archive CI.
  # Le nouveau lanceur porte déjà les droits de l'ancien : le renommage les conserve.
  Copy-AccessRules ($config.launcherPath + '.rollback-' + $config.sha)
  Copy-AccessRules ($config.launcherPath + '.update-' + $config.sha)
  $stopped = $true
  Stop-ManagedTask
  # Positionné AVANT l'appel : un échec après le renommage doit déclencher le retour.
  $switched = $true
  if (!(Invoke-Helper 'switch')) { throw 'Atomic launcher switch failed' }
  Start-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
  if (!(Wait-Helper 'verify' 10)) { throw 'New release could not be verified on every origin' }
  Write-Host ('SHOP_RELEASE_VERIFIED ' + $config.sha)
  Write-Host 'POS and bridge updated. Reload the cashier POS and tablets. Check the cashier printer before service.'
} catch {
  $failure = $_
  if ($switched) {
    try {
      Stop-ManagedTask
      if (!(Invoke-Helper 'restore')) { throw 'Launcher restore failed' }
      try { Copy-AccessRules $config.launcherPath } catch { Write-Host 'Launcher access rules could not be copied; check them after restart.' }
      Start-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath
      if (!(Wait-Helper 'restored' 10)) { throw 'Previous service could not be verified' }
      Write-Host 'Previous launcher restored and previous release served again. Reload the POS before use.'
    } catch { Write-Host 'Rollback incomplete. Keep the POS closed; the saved launcher is next to the current one.' }
  } elseif ($stopped) {
    try { Start-ScheduledTask -TaskName $config.taskName -TaskPath $config.taskPath } catch { Write-Host 'Previous task restart failed.' }
  }
  Write-Host ('Update not completed: ' + $failure.Exception.Message)
  Write-Error 'No browser storage, external configuration, registry, buffer or TLS file was changed by the installer.'
  exit 1
} finally { if ($null -ne $lock) { $lock.Dispose() } }
