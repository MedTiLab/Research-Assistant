param(
  [string] $Version,
  [int] $InstallRounds = 2,
  [int] $InstallerTimeoutSeconds = 600,
  [ValidateSet('Offline')]
  [string] $Distribution = 'Offline'
)

$ErrorActionPreference = 'Stop'
Import-Module Microsoft.PowerShell.Utility -ErrorAction Stop

$rootDir = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
if (-not $Version) {
  $Version = (& node -p "require('$($rootDir.Replace('\', '/'))/package.json').version").Trim()
}

$distributionFolder = 'offline-desktop'
$releaseDir = Join-Path $rootDir "release\windows\$distributionFolder"
$installerPath = Join-Path $releaseDir "MedHelp-$Distribution-$Version-win-x64.exe"
$installerChecksumPath = "$installerPath.sha256"
$installRoot = Join-Path $env:ProgramFiles 'MedHelp'
$installedExe = Join-Path $installRoot "MedHelp-$Version.exe"
$unpackedExe = Join-Path $releaseDir "win-unpacked\MedHelp-$Version.exe"
$installedManifestPath = Join-Path $installRoot 'resources\kernel-runtime\security-manifest.json'
$installedSourceManifestPath = Join-Path $installRoot 'resources\desktop-resource-sources.json'
$installedRecoveryPath = Join-Path $installRoot 'resources\.medhelp-main.bin'
$installedRepairScriptPath = Join-Path $installRoot 'resources\.medhelp-executable-repair.ps1'
$executableRepairLogPath = Join-Path $installRoot 'executable-repair.log'
$runtimeStatePath = Join-Path $env:APPDATA 'MedHelp\runtime\desktop-local-kernel.json'
$reportPath = Join-Path $releaseDir "local-validation-$($Distribution.ToLowerInvariant())-$Version.json"
$offlineSourcePolicyPath = Join-Path $rootDir 'desktop\offline\resource-sources.json'
if (-not (Test-Path -LiteralPath $offlineSourcePolicyPath -PathType Leaf)) {
  throw "Offline resource source policy is missing: $offlineSourcePolicyPath"
}
$offlineSourcePolicy = Get-Content -LiteralPath $offlineSourcePolicyPath -Raw | ConvertFrom-Json
$localKernelSource = @($offlineSourcePolicy.bundled | Where-Object { $_.id -eq 'local-kernel' })[0]
if ($localKernelSource.skillCountSource -ne 'kernel-security-manifest') {
  throw 'Offline resource source policy must derive its skill count from the Kernel manifest.'
}

function Assert-ReleaseCondition {
  param([bool] $Condition, [string] $Message)
  if (-not $Condition) { throw $Message }
}

function Get-ExpectedChecksum {
  param([string] $Path)
  return (((Get-Content -LiteralPath $Path -Raw).Trim() -split '\s+')[0]).ToLowerInvariant()
}

function Get-MedHelpShortcuts {
  $roots = @(
    [pscustomobject]@{ Kind = 'Desktop'; Path = [Environment]::GetFolderPath('Desktop') },
    [pscustomobject]@{ Kind = 'Desktop'; Path = [Environment]::GetFolderPath('CommonDesktopDirectory') },
    [pscustomobject]@{ Kind = 'StartMenu'; Path = [Environment]::GetFolderPath('Programs') },
    [pscustomobject]@{ Kind = 'StartMenu'; Path = [Environment]::GetFolderPath('CommonPrograms') }
  )
  $shell = New-Object -ComObject WScript.Shell
  $records = @()
  foreach ($root in $roots) {
    if (-not $root.Path -or -not (Test-Path -LiteralPath $root.Path)) { continue }
    $records += Get-ChildItem -LiteralPath $root.Path -Filter 'MedHelp*.lnk' -Recurse -Force -ErrorAction SilentlyContinue |
      ForEach-Object {
        $shortcut = $shell.CreateShortcut($_.FullName)
        [pscustomobject]@{
          kind = $root.Kind
          path = $_.FullName
          target = $shortcut.TargetPath
          targetExists = Test-Path -LiteralPath $shortcut.TargetPath
        }
      }
  }
  return @($records)
}

function Wait-ForDesktopHealth {
  param([datetime] $Deadline)
  while ((Get-Date) -lt $Deadline) {
    if (Test-Path -LiteralPath $runtimeStatePath) {
      try {
        $state = Get-Content -LiteralPath $runtimeStatePath -Raw | ConvertFrom-Json
        $health = Invoke-RestMethod -Uri ($state.httpUrl.TrimEnd('/') + '/health') -TimeoutSec 3
        $runtimeProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)" -ErrorAction SilentlyContinue
        if (
          $health.ok -and
          $health.version -eq $Version -and
          $runtimeProcess -and
          $runtimeProcess.ExecutablePath -like "$installRoot*"
        ) {
          return [pscustomobject]@{ state = $state; health = $health; process = $runtimeProcess }
        }
      } catch {}
    }
    Start-Sleep -Milliseconds 500
  }
  throw "Desktop Kernel /health did not report version $Version before the timeout."
}

function Wait-ForInstalledExecutableStability {
  param([datetime] $Deadline, [int] $Round)
  while ((Get-Date) -lt $Deadline) {
    if (
      (Test-Path -LiteralPath $installedExe -PathType Leaf) -and
      -not (Test-Path -LiteralPath $installedRecoveryPath) -and
      -not (Test-Path -LiteralPath $installedRepairScriptPath)
    ) {
      return
    }
    Start-Sleep -Milliseconds 500
  }

  $repairLog = if (Test-Path -LiteralPath $executableRepairLogPath) {
    (Get-Content -LiteralPath $executableRepairLogPath -Raw).Trim()
  } else {
    '<missing>'
  }
  throw "Installed executable did not become stable after round $Round. Repair log: $repairLog"
}

Assert-ReleaseCondition (Test-Path -LiteralPath $installerPath) "Desktop installer is missing: $installerPath"
Assert-ReleaseCondition (Test-Path -LiteralPath $installerChecksumPath) "Desktop checksum is missing: $installerChecksumPath"
Assert-ReleaseCondition (Test-Path -LiteralPath $unpackedExe) "Unpacked desktop executable is missing: $unpackedExe"

$installerSha256 = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-ReleaseCondition ($installerSha256 -eq (Get-ExpectedChecksum $installerChecksumPath)) 'Desktop installer SHA-256 does not match its checksum file.'

$roundResults = @()
for ($round = 1; $round -le $InstallRounds; $round += 1) {
  $process = Start-Process -FilePath $installerPath -ArgumentList @('/S', '--updated') -PassThru
  if (-not $process.WaitForExit($InstallerTimeoutSeconds * 1000)) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    throw "Desktop installer round $round did not exit within $InstallerTimeoutSeconds seconds."
  }
  Assert-ReleaseCondition ($process.ExitCode -eq 0) "Desktop installer round $round failed with exit code $($process.ExitCode)."
  Wait-ForInstalledExecutableStability -Deadline (Get-Date).AddSeconds(150) -Round $round

  Assert-ReleaseCondition (Test-Path -LiteralPath $installedExe) "Installed executable is missing after round ${round}: $installedExe"
  Assert-ReleaseCondition (-not (Test-Path -LiteralPath $installedRecoveryPath)) "Executable recovery payload was not cleaned after round ${round}: $installedRecoveryPath"
  Assert-ReleaseCondition (-not (Test-Path -LiteralPath $installedRepairScriptPath)) "Executable repair script was not cleaned after round ${round}: $installedRepairScriptPath"
  Assert-ReleaseCondition (Test-Path -LiteralPath $installedManifestPath) "Installed Kernel manifest is missing after round $round."
  $manifest = Get-Content -LiteralPath $installedManifestPath -Raw | ConvertFrom-Json
  Assert-ReleaseCondition ($manifest.version -eq $Version) "Installed Kernel version is $($manifest.version), expected $Version."
  $installedSkillCount = [int] $manifest.assets.skillCount
  Assert-ReleaseCondition ($installedSkillCount -gt 0) 'Installed Kernel manifest does not declare a valid skill count.'
  Assert-ReleaseCondition (Test-Path -LiteralPath $installedSourceManifestPath) "Offline resource source manifest is missing after round $round."
  $sourceManifest = Get-Content -LiteralPath $installedSourceManifestPath -Raw | ConvertFrom-Json
  Assert-ReleaseCondition ($sourceManifest.distribution -eq 'offline-desktop') "Installed resource manifest is not for the offline desktop."
  Assert-ReleaseCondition ($sourceManifest.build.version -eq $Version) "Offline resource manifest version is $($sourceManifest.build.version), expected $Version."
  Assert-ReleaseCondition ($sourceManifest.build.platform -eq 'win32') "Offline resource manifest platform is not win32."
  Assert-ReleaseCondition ([int] $sourceManifest.build.skillCount -eq $installedSkillCount) "Offline resource manifest skill count does not match the installed Kernel manifest ($installedSkillCount)."

  $shortcuts = @(Get-MedHelpShortcuts)
  $desktopShortcuts = @($shortcuts | Where-Object { $_.kind -eq 'Desktop' -and $_.target -eq $installedExe -and $_.targetExists })
  $startMenuShortcuts = @($shortcuts | Where-Object { $_.kind -eq 'StartMenu' -and $_.target -eq $installedExe -and $_.targetExists })
  Assert-ReleaseCondition ($desktopShortcuts.Count -gt 0) "No working desktop shortcut targets $installedExe after round $round."
  Assert-ReleaseCondition ($startMenuShortcuts.Count -gt 0) "No working Start Menu shortcut targets $installedExe after round $round."

  Start-Process -FilePath $desktopShortcuts[0].path | Out-Null
  $runtime = Wait-ForDesktopHealth -Deadline (Get-Date).AddSeconds(90)
  Start-Sleep -Seconds 6
  $shortcuts = @(Get-MedHelpShortcuts)
  $staleShortcuts = @($shortcuts | Where-Object { $_.target -ne $installedExe -or -not $_.targetExists })
  Assert-ReleaseCondition ($staleShortcuts.Count -eq 0) "Stale MedHelp shortcuts remain after round $round."
  $runtimeProcess = $runtime.process
  Assert-ReleaseCondition ($runtimeProcess.ExecutablePath -like "$installRoot*") 'Desktop Kernel is not using the installed bundled Node runtime.'

  $roundResults += [pscustomobject]@{
    round = $round
    installerExitCode = $process.ExitCode
    installedExe = $installedExe
    installedExeSha256 = (Get-FileHash -LiteralPath $installedExe -Algorithm SHA256).Hash.ToLowerInvariant()
    unpackedExeSha256 = (Get-FileHash -LiteralPath $unpackedExe -Algorithm SHA256).Hash.ToLowerInvariant()
    kernelVersion = $manifest.version
    health = $runtime.health
    desktopShortcuts = $desktopShortcuts
    startMenuShortcuts = $startMenuShortcuts
    runtimePid = $runtime.state.pid
    runtimeExecutable = $runtimeProcess.ExecutablePath
  }
  Assert-ReleaseCondition ($roundResults[-1].installedExeSha256 -eq $roundResults[-1].unpackedExeSha256) "Installed EXE hash differs from win-unpacked after round $round."
}

$report = [ordered]@{
  ok = $true
  verifiedAt = (Get-Date).ToUniversalTime().ToString('o')
  version = $Version
  distribution = $Distribution
  node = (& node --version).Trim()
  installer = [ordered]@{ path = $installerPath; bytes = (Get-Item -LiteralPath $installerPath).Length; sha256 = $installerSha256 }
  expectedInstallRoot = $installRoot
  expectedExecutable = $installedExe
  installRounds = $roundResults
}
$report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $reportPath -Encoding UTF8
$report | ConvertTo-Json -Depth 12
Write-Output "Validation report: $reportPath"
