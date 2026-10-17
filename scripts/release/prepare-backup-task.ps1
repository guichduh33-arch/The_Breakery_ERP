# Prépare une définition de tâche inspectable ; ne crée aucune tâche Windows.
# Le compte, l'heure et les chemins réels doivent être validés avant installation.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$NodeExecutable,
  [Parameter(Mandatory)][string]$DailyScript,
  [Parameter(Mandatory)][string]$ConfigPath,
  [Parameter(Mandatory)][string]$PublicKeyPath,
  [Parameter(Mandatory)][string]$OutputDirectory,
  [Parameter(Mandatory)][string]$WindowsAccount,
  [Parameter(Mandatory)][ValidatePattern('^([01][0-9]|2[0-3]):[0-5][0-9]$')][string]$DailyTime,
  [string]$DriveConfigPath
)
$ErrorActionPreference = 'Stop'
$taskPaths = @($NodeExecutable, $DailyScript, $ConfigPath, $PublicKeyPath, $OutputDirectory)
if ($DriveConfigPath) { $taskPaths += $DriveConfigPath }
foreach ($taskInput in $taskPaths) {
  if (-not [IO.Path]::IsPathRooted($taskInput) -or $taskInput.Contains('"') -or
      $taskInput.Contains("`r") -or $taskInput.Contains("`n") -or -not (Test-Path -LiteralPath $taskInput)) {
    throw 'Every task path must be absolute, existing and free of quotes or newlines.'
  }
}
if (-not (Test-Path -LiteralPath $OutputDirectory -PathType Container)) {
  throw 'OutputDirectory must be an existing dedicated local directory.'
}
$argumentPaths = @($DailyScript, $ConfigPath, $PublicKeyPath, $OutputDirectory)
if ($DriveConfigPath) { $argumentPaths += @($DriveConfigPath, '--upload') }
$taskArguments = ($argumentPaths |
  ForEach-Object { '"' + $_ + '"' }) -join ' '
$taskAction = New-ScheduledTaskAction -Execute $NodeExecutable -Argument $taskArguments
$taskTrigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.Add([TimeSpan]::Parse($DailyTime)))
$taskPrincipal = New-ScheduledTaskPrincipal -UserId $WindowsAccount -LogonType S4U -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 1) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 15)
$preparedTask = New-ScheduledTask -Action $taskAction -Trigger $taskTrigger `
  -Principal $taskPrincipal -Settings $taskSettings `
  -Description 'Encrypted file backup. Optional Drive readback verification. Full application recovery requires a separate rehearsal.'
# Retour d'un objet en mémoire ; aucune commande Register-ScheduledTask.
$preparedTask
