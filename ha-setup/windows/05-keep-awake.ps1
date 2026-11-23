# 05-keep-awake.ps1  —  POWER SETTING CHANGE. Run only after you approve it.
# If Windows sleeps, the Home Assistant VM is frozen and doorbell alerts stop.
# This sets "sleep after" and "hibernate after" to Never ON MAINS POWER ONLY, in the
# current power plan. Screen-off timeout and the screen lock are NOT changed (the
# display can still turn off; that's fine for HA).
#
# Shows the old values first so you can restore them, e.g.:
#   powercfg /change standby-timeout-ac 30

$sub='SUB_SLEEP'
Write-Host 'Current values (seconds, AC):'
powercfg /query SCHEME_CURRENT $sub STANDBYIDLE   | Select-String 'Current AC'
powercfg /query SCHEME_CURRENT $sub HIBERNATEIDLE | Select-String 'Current AC'
if ((Read-Host 'Set sleep and hibernate to Never on AC power? Type YES') -ne 'YES') { 'Cancelled.'; return }
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
'Done. PC will no longer sleep on mains power.'
