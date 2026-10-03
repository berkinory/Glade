param(
  [Parameter(Mandatory = $true)][string]$AssetsDirectory,
  [Parameter(Mandatory = $true)][string]$EvidenceDirectory
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
New-Item -ItemType Directory -Force -Path $EvidenceDirectory | Out-Null
$evidenceRoot = (Resolve-Path $EvidenceDirectory).Path
$report = [ordered]@{ outcome = 'inconclusive'; startedAt = [DateTime]::UtcNow.ToString('o'); scans = @() }

function Assert-Protection {
  param($Status)
  foreach ($property in @('AMServiceEnabled', 'AntivirusEnabled', 'AntispywareEnabled', 'RealTimeProtectionEnabled', 'BehaviorMonitorEnabled', 'IoavProtectionEnabled')) {
    if ($Status.$property -ne $true) { throw "Required Defender protection is unavailable: $property" }
  }
  if ($Status.AMRunningMode -ne 'Normal') { throw 'Defender must be in active Normal mode.' }
  if (-not $Status.AMEngineVersion -or -not $Status.AntivirusSignatureVersion) { throw 'Missing Defender version evidence.' }
  $updated = $Status.AntivirusSignatureLastUpdated.ToUniversalTime()
  if ($updated -gt [DateTime]::UtcNow -or ([DateTime]::UtcNow - $updated).TotalHours -gt 24) {
    throw 'Defender signatures are missing, future-dated or older than 24 hours.'
  }
}

try {
  if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or -not $IsWindows) {
    throw 'Release qualification must run on a disposable GitHub-hosted Windows runner.'
  }
  Get-MpComputerStatus | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $evidenceRoot 'status-initial.json')
  # Hosted runner images may disable these modes; only strengthen the disposable CI machine.
  Set-MpPreference -DisableRealtimeMonitoring $false -DisableArchiveScanning $false -DisableIOAVProtection $false -DisableBehaviorMonitoring $false -DisableScriptScanning $false
  Update-MpSignature
  for ($attempt = 0; $attempt -lt 12; $attempt++) {
    if ((Get-MpComputerStatus).RealTimeProtectionEnabled) { break }
    Start-Sleep -Seconds 5
  }
  $status = Get-MpComputerStatus
  $status | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $evidenceRoot 'status-before.json')
  Assert-Protection $status
  $preferences = Get-MpPreference
  $preferences | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $evidenceRoot 'preferences.json')
  if ($preferences.DisableArchiveScanning -or $preferences.DisableRealtimeMonitoring -or $preferences.DisableIOAVProtection -or $preferences.DisableBehaviorMonitoring -or $preferences.DisableScriptScanning) {
    throw 'Required Defender scan/protection modes are disabled.'
  }
  $platformRoot = Join-Path $env:ProgramData 'Microsoft/Windows Defender/Platform'
  $commands = @(Get-ChildItem "$platformRoot/*/MpCmdRun.exe" | Sort-Object { [version]$_.Directory.Name.Split('-')[0] } -Descending)
  if ($commands.Count -eq 0) { throw 'No versioned Defender scanner is available.' }
  $scanner = $commands[0].FullName
  $report.scanner = $scanner
  $installers = @(Get-ChildItem -LiteralPath $AssetsDirectory -File -Filter '*.exe')
  if ($installers.Count -ne 1) { throw 'Expected exactly one final Windows installer.' }
  $beforeDetections = @(Get-MpThreatDetection)
  $beforeDetections | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidenceRoot 'detections-before.json')
  foreach ($installer in $installers) {
    $hashBefore = (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
    # DisableRemediation scans archives and ignores exclusions; detections are reported in stdout.
    $output = @(& $scanner -Scan -ScanType 3 -File $installer.FullName -DisableRemediation 2>&1)
    $scanExitCode = $LASTEXITCODE
    $output | Out-String | Set-Content (Join-Path $evidenceRoot 'scan-output.txt')
    $text = $output | Out-String
    $hashAfter = if (Test-Path -LiteralPath $installer.FullName -PathType Leaf) {
      (Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256).Hash
    } else { $null }
    $report.scans += [ordered]@{ file = $installer.Name; sha256Before = $hashBefore; sha256After = $hashAfter; exitCode = $scanExitCode }
    if ($scanExitCode -ne 0 -or $text -notmatch '(?im)^\s*Scan finished\.\s*$' -or $text -notmatch '(?im)^\s*Scan of .+ found no threats\.\s*$') {
      throw 'The exact installer scan did not provide explicit clean completion evidence.'
    }
    if ($hashAfter -ne $hashBefore) { throw 'Installer disappeared or changed during the scan.' }
  }
  $afterDetections = @(Get-MpThreatDetection)
  $afterDetections | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidenceRoot 'detections-after.json')
  # A clean command output must not hide a concurrent detection or remediation by real-time protection.
  if ((ConvertTo-Json -InputObject $beforeDetections -Depth 8 -Compress) -ne (ConvertTo-Json -InputObject $afterDetections -Depth 8 -Compress)) {
    throw 'Defender detection/remediation history changed during qualification.'
  }
  foreach ($detection in $afterDetections) {
    foreach ($resource in $detection.Resources) {
      if ($resource -like "*$($installers[0].FullName)*") { throw 'Defender has a detection for this installer.' }
    }
  }
  $afterStatus = Get-MpComputerStatus
  $afterStatus | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $evidenceRoot 'status-after.json')
  Assert-Protection $afterStatus
  if (-not (Test-Path -LiteralPath $installers[0].FullName -PathType Leaf) -or
      (Get-FileHash -LiteralPath $installers[0].FullName -Algorithm SHA256).Hash -ne $hashBefore) {
    throw 'Installer changed before qualification completed.'
  }
  $report.outcome = 'clean'
} catch {
  $report.error = $_.Exception.Message
  throw
} finally {
  $report.finishedAt = [DateTime]::UtcNow.ToString('o')
  $report | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $evidenceRoot 'qualification.json')
}
