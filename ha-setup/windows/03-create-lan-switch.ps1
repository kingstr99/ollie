# 03-create-lan-switch.ps1  —  NETWORK CHANGE. Run only after you approve it.
# Creates a Hyper-V "External" virtual switch so the Home Assistant VM gets its own
# address on your home LAN (needed for your phone to reach HA, and for the
# doorbell/NVR to talk to HA).
#
# What actually changes: Windows binds the chosen physical adapter to the virtual
# switch and moves its IP config onto a new "vEthernet (HA-LAN)" adapter. Your PC keeps
# the same IP/DHCP settings, but the network DROPS FOR A FEW SECONDS while this happens.
# -> Close trading platforms / do this outside market hours.
#
# Undo later (also drops network for a few seconds):  Remove-VMSwitch -Name 'HA-LAN'
#
# Usage (elevated):  .\03-create-lan-switch.ps1 -AdapterName 'Ethernet'
# Use the adapter name from 01-check-pc.ps1 output. A wired Ethernet adapter is strongly
# recommended; Wi-Fi adapters work poorly with external switches.

#Requires -RunAsAdministrator
param([Parameter(Mandatory)][string]$AdapterName)

if (Get-VMSwitch -Name 'HA-LAN' -ErrorAction SilentlyContinue) { "Switch 'HA-LAN' already exists."; return }
$nic = Get-NetAdapter -Name $AdapterName -ErrorAction Stop
if ($nic.Status -ne 'Up') { throw "Adapter '$AdapterName' is not connected." }

Write-Host "About to bind '$AdapterName' ($($nic.InterfaceDescription)) to a new switch 'HA-LAN'." -ForegroundColor Yellow
if ((Read-Host "Network will drop for a few seconds. Type YES to continue") -ne 'YES') { 'Cancelled.'; return }

New-VMSwitch -Name 'HA-LAN' -NetAdapterName $AdapterName -AllowManagementOS $true | Out-Null
Start-Sleep 10
Get-NetIPConfiguration -InterfaceAlias 'vEthernet (HA-LAN)' | Format-List InterfaceAlias, IPv4Address, IPv4DefaultGateway
'Switch created. Check your PC still has internet before continuing.'
