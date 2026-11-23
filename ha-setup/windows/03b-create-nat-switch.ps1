# 03b-create-nat-switch.ps1  —  Wi-Fi-friendly networking for the HA VM. Run only after you approve it.
# Use this INSTEAD of 03-create-lan-switch.ps1 while the PC is on Wi-Fi.
#
# Creates a private network inside the PC (172.30.10.0/24) and lets the HA VM reach your
# home network and the internet through the PC (NAT), like a phone hotspot.
#   - Your WiFi and Ethernet adapters are NOT modified. No network drop.
#   - Adds one new virtual adapter "vEthernet (HA-NAT)" with IP 172.30.10.1.
#   - Home Assistant will live at 172.30.10.2 (set inside HA in a later step).
#
# Undo:  Remove-NetNat -Name HA-NAT -Confirm:$false; Remove-VMSwitch -Name HA-NAT -Force
#
# Run (elevated):  powershell -ExecutionPolicy Bypass -File C:\HA-Setup\03b-create-nat-switch.ps1

#Requires -RunAsAdministrator
$ErrorActionPreference = 'Stop'
$prefix = '172.30.10.0/24'; $hostIp = '172.30.10.1'

# Safety checks: don't collide with anything already on this PC
$existingNat = Get-NetNat -ErrorAction SilentlyContinue | Where-Object Name -ne 'HA-NAT'
if ($existingNat) {
  $existingNat | Format-Table Name, InternalIPInterfaceAddressPrefix
  throw 'Another NAT network already exists (Windows allows only one). Send this screen to Claude; nothing was changed.'
}
if (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '172.30.10.*' -and $_.InterfaceAlias -ne 'vEthernet (HA-NAT)' }) {
  throw '172.30.10.x is already in use on this PC. Send this screen to Claude; nothing was changed.'
}

if (-not (Get-VMSwitch -Name 'HA-NAT' -ErrorAction SilentlyContinue)) {
  New-VMSwitch -Name 'HA-NAT' -SwitchType Internal | Out-Null
  Start-Sleep 3
}
$if = 'vEthernet (HA-NAT)'
if (-not (Get-NetIPAddress -InterfaceAlias $if -IPAddress $hostIp -ErrorAction SilentlyContinue)) {
  New-NetIPAddress -InterfaceAlias $if -IPAddress $hostIp -PrefixLength 24 | Out-Null
}
if (-not (Get-NetNat -Name 'HA-NAT' -ErrorAction SilentlyContinue)) {
  New-NetNat -Name 'HA-NAT' -InternalIPInterfaceAddressPrefix $prefix | Out-Null
}
Write-Host "`nDone. Private HA network ready: PC side $hostIp, Home Assistant will be 172.30.10.2" -ForegroundColor Green
Write-Host "Next: create the VM with  -SwitchName HA-NAT"
