# 02-enable-hyperv.ps1  —  SYSTEM CHANGE. Run only after you approve it.
# Turns on the built-in Windows Hyper-V feature (Windows 11 Pro/Enterprise/Education).
# Installs nothing from the internet and removes nothing.
# REQUIRES A RESTART, which this script will NOT do. Restart yourself when convenient
# (e.g. outside trading hours).
# Run from an elevated PowerShell:  powershell -ExecutionPolicy Bypass -File .\02-enable-hyperv.ps1

#Requires -RunAsAdministrator
$f = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All
if ($f.State -eq 'Enabled') { 'Hyper-V is already enabled. Nothing to do.'; return }

Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -All -NoRestart
Write-Host "`nHyper-V enabled. Restart Windows yourself when convenient, then continue with step 03." -ForegroundColor Yellow
