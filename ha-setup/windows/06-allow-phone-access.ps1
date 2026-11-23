# 06-allow-phone-access.ps1  —  OPTIONAL. FIREWALL CHANGE. Run only after you approve it.
# Only needed with the Wi-Fi/NAT setup (03b), and only if you want the phone to reach HA
# directly at home. NOT needed if you use Nabu Casa or Tailscale for remote access.
#
# What it does:
#   1. Forwards port 8123 on this PC to Home Assistant (172.30.10.2:8123).
#   2. Adds ONE Windows Firewall rule allowing TCP 8123 inbound, ONLY from your home
#      network (LocalSubnet) and ONLY when Windows treats the network as "Private".
# It does not change the network profile or any other firewall rule.
# Your phone then uses:  http://<this PC's Wi-Fi IP>:8123   (currently 192.168.0.23)
#
# Undo:
#   netsh interface portproxy delete v4tov4 listenport=8123 listenaddress=0.0.0.0
#   Remove-NetFirewallRule -DisplayName 'Home Assistant 8123 (home network only)'

#Requires -RunAsAdministrator
$wifi = Get-NetConnectionProfile | Where-Object InterfaceAlias -eq 'WiFi'
"Wi-Fi network '$($wifi.Name)' is classed as: $($wifi.NetworkCategory)"
if ($wifi.NetworkCategory -ne 'Private') {
  Write-Host 'Your Wi-Fi is classed as Public, so this rule would not apply. Nothing changed. Ask Claude about options.' -ForegroundColor Yellow
  return
}
if ((Read-Host 'Add port forward + one firewall rule for port 8123 (home network only)? Type YES') -ne 'YES') { 'Cancelled.'; return }

netsh interface portproxy add v4tov4 listenport=8123 listenaddress=0.0.0.0 connectport=8123 connectaddress=172.30.10.2 | Out-Null
if (-not (Get-NetFirewallRule -DisplayName 'Home Assistant 8123 (home network only)' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'Home Assistant 8123 (home network only)' -Direction Inbound -Protocol TCP `
    -LocalPort 8123 -RemoteAddress LocalSubnet -Profile Private -Action Allow | Out-Null
}
$ip = (Get-NetIPAddress -InterfaceAlias 'WiFi' -AddressFamily IPv4).IPAddress
Write-Host "`nDone. On your phone (on home Wi-Fi) open:  http://${ip}:8123" -ForegroundColor Green
