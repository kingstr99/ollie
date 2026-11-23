# 04-create-ha-vm.ps1  —  DOWNLOAD + VM CREATION. Run only after you approve it.
# Downloads the official Home Assistant OS Hyper-V disk (from the home-assistant GitHub
# releases) and creates a VM that:
#   - starts automatically whenever Windows boots (no login needed)
#   - shuts the HA guest down cleanly when Windows shuts down/restarts
#   - uses fixed RAM and no automatic checkpoints (avoids disk bloat)
# Does not touch any other VM, program or setting.
#
# Usage (elevated):  .\04-create-ha-vm.ps1                 (defaults: 2 vCPU, 2 GB RAM)
#                    .\04-create-ha-vm.ps1 -Cpu 2 -RamGB 3 -VmRoot 'D:\HyperV'

#Requires -RunAsAdministrator
param(
  [int]$Cpu = 2,
  [int]$RamGB = 2,
  [string]$VmRoot = "$env:PUBLIC\Documents\Hyper-V\HomeAssistant",
  [string]$SwitchName = 'HA-LAN',
  [string]$VmName = 'HomeAssistant'
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # PS 5.1 downloads are ~10x slower with the progress bar
Write-Host "Downloading Home Assistant OS (~500 MB). This can take a few minutes with no output..."
if (Get-VM -Name $VmName -ErrorAction SilentlyContinue) { "VM '$VmName' already exists."; return }
Get-VMSwitch -Name $SwitchName | Out-Null   # fails early if step 03 wasn't done

New-Item -ItemType Directory -Force -Path $VmRoot | Out-Null
# Newest stable release that actually contains a Hyper-V disk (some releases are Raspberry Pi only)
$releases = Invoke-RestMethod 'https://api.github.com/repos/home-assistant/operating-system/releases?per_page=15'
$rel = $releases | Where-Object { -not $_.prerelease -and -not $_.draft -and ($_.assets.name -match '^haos_ova-.*\.vhdx\.zip$') } | Select-Object -First 1
if (-not $rel) { throw 'Could not find a Hyper-V image in recent releases. Send this screen to Claude.' }
$asset = $rel.assets | Where-Object name -match '^haos_ova-.*\.vhdx\.zip$' | Select-Object -First 1
"Home Assistant OS $($rel.tag_name)  ->  $($asset.name)"
$zip = Join-Path $VmRoot $asset.name
Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing

# Verify the download against the official SHA256SUMS file, when the release has one
$sums = $rel.assets | Where-Object name -eq 'SHA256SUMS'
if ($sums) {
  $sumText = (Invoke-WebRequest $sums.browser_download_url -UseBasicParsing).Content
  if ($sumText -is [byte[]]) { $sumText = [Text.Encoding]::UTF8.GetString($sumText) }
  $line = ($sumText -split "`n") | Where-Object { $_ -match [regex]::Escape($asset.name) } | Select-Object -First 1
  if ($line) {
    $expected = ($line -split '\s+')[0].ToLower()
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected -ne $actual) { Remove-Item $zip; throw 'Checksum MISMATCH - download deleted. Send this screen to Claude.' }
    Write-Host 'Checksum verified OK.' -ForegroundColor Green
  } else { 'Note: this file is not listed in SHA256SUMS; skipping checksum.' }
}
Expand-Archive $zip -DestinationPath $VmRoot -Force
Remove-Item $zip
$vhdx = Get-ChildItem $VmRoot -Filter 'haos_ova-*.vhdx' | Select-Object -First 1

New-VM -Name $VmName -Generation 2 -MemoryStartupBytes ($RamGB*1GB) -VHDPath $vhdx.FullName `
       -SwitchName $SwitchName -Path $VmRoot | Out-Null
Set-VMFirmware  -VMName $VmName -EnableSecureBoot Off          # HAOS requirement
Set-VMProcessor -VMName $VmName -Count $Cpu
Set-VMMemory    -VMName $VmName -DynamicMemoryEnabled $false
Set-VM -Name $VmName -AutomaticStartAction Start -AutomaticStartDelay 30 `
       -AutomaticStopAction ShutDown -AutomaticCheckpointsEnabled $false -CheckpointType Disabled
Enable-VMIntegrationService -VMName $VmName -Name 'Guest Service Interface','Shutdown','Heartbeat' -ErrorAction SilentlyContinue

Start-VM -Name $VmName
Write-Host "`nVM started. Wait ~5-10 minutes, then open http://homeassistant.local:8123" -ForegroundColor Green
Write-Host "If that name doesn't resolve, find the VM's IP in Hyper-V Manager > Networking tab, or your router's device list."
