# 01-check-pc.ps1  —  READ-ONLY. Changes nothing, installs nothing, needs no admin.
# Reports CPU, RAM, storage, Windows edition, virtualization and network adapters
# so we can choose Hyper-V vs VirtualBox for Home Assistant OS.
# Run:  powershell -ExecutionPolicy Bypass -File .\01-check-pc.ps1

$ErrorActionPreference = 'SilentlyContinue'
function H($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }

H 'Windows'
$os = Get-CimInstance Win32_OperatingSystem
"{0}  (build {1})" -f $os.Caption, $os.BuildNumber
if ($os.Caption -match 'Home') { 'NOTE: Windows Home edition -> Hyper-V Manager is not available.' }

H 'Processor'
Get-CimInstance Win32_Processor | ForEach-Object {
  "{0}" -f $_.Name.Trim()
  "Cores: {0}   Threads: {1}" -f $_.NumberOfCores, $_.NumberOfLogicalProcessors
  "Virtualization enabled in firmware (BIOS): {0}" -f $_.VirtualizationFirmwareEnabled
  "SLAT supported: {0}" -f $_.SecondLevelAddressTranslationExtensions
}

H 'Memory'
$cs = Get-CimInstance Win32_ComputerSystem
"Total RAM: {0:N1} GB   Free now: {1:N1} GB" -f ($cs.TotalPhysicalMemory/1GB), ($os.FreePhysicalMemory*1KB/1GB)
"Hypervisor already running (Hyper-V / VBS / WSL2 / Claude VM): {0}" -f $cs.HypervisorPresent

H 'Storage (fixed drives)'
Get-Volume | Where-Object { $_.DriveType -eq 'Fixed' -and $_.DriveLetter } |
  ForEach-Object { "{0}:  {1:N0} GB free of {2:N0} GB  ({3})" -f $_.DriveLetter, ($_.SizeRemaining/1GB), ($_.Size/1GB), $_.FileSystem }

H 'Hyper-V / virtualization info'
Get-ComputerInfo -Property HyperV* | Format-List | Out-String | Write-Host
# Feature state (only readable from an elevated prompt; harmless if it fails)
$f = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
if ($f) { "Hyper-V feature: $($f.State)" } else { 'Hyper-V feature state: (run as Administrator to see)' }
$vmp = Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
if ($vmp) { "Virtual Machine Platform: $($vmp.State)" }

H 'Existing virtualization software (name match only)'
$keys = 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*'
Get-ItemProperty $keys | Where-Object { $_.DisplayName -match 'VirtualBox|VMware|Claude' } |
  Select-Object DisplayName, DisplayVersion | Format-Table -AutoSize | Out-String | Write-Host

H 'Network adapters that are up (read-only)'
Get-NetAdapter | Where-Object Status -eq 'Up' |
  Select-Object Name, InterfaceDescription, LinkSpeed, MediaType | Format-Table -AutoSize | Out-String | Write-Host
Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway } | ForEach-Object {
  "Adapter '{0}': IP {1}  gateway {2}" -f $_.InterfaceAlias, $_.IPv4Address.IPAddress, $_.IPv4DefaultGateway.NextHop
}

H 'Power (sleep settings, read-only)'
powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE | Select-String 'Current AC Power Setting Index'

Write-Host "`nDone. Copy everything above and paste it back to Claude." -ForegroundColor Green
