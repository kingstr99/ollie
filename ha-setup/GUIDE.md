# Home Assistant on Windows 11 → Reolink doorbell picture alerts on Samsung

Legend: 🟢 safe / read-only · 🟡 change that needs your OK · 👤 only you can do it (passwords, phone, router, BIOS, restarts)

Nothing here touches trading software, uninstalls anything, or changes security settings
(Windows Firewall, Defender, BitLocker and UAC are not touched).

---

## Step 1 — Check the PC 🟢
Run `windows/01-check-pc.ps1` (no admin needed) and paste the output back to me.

Minimum for this job: 4+ threads, 8 GB RAM (HA uses 3–4 GB), 40 GB free on an SSD,
virtualization enabled in BIOS. If "Virtualization enabled in firmware" says False → 👤 turn on
Intel VT-x / AMD-V (SVM) in BIOS. I'll walk you through that if needed.

## Step 2 — Which VM software
| | Hyper-V (recommended) | VirtualBox |
|---|---|---|
| Windows edition | Pro / Enterprise / Education | any, including Home |
| Works alongside Claude Desktop | ✅ Uses the same Windows hypervisor Claude Desktop's VM features use; no conflict | ⚠️ Runs *on top of* Hyper-V when it's on, which is slower and less reliable |
| Auto-start at boot without login | ✅ Built in | ❌ Needs an extra service wrapper |
| Official HAOS image | `.vhdx` | `.vdi` |
| Extra software to install | none (it's part of Windows) | yes |

**Decision:** Hyper-V if you have Pro. If you have Home, tell me and I'll give you the VirtualBox version.

## Step 3 — Install Home Assistant OS (in a VM, Windows stays as it is)
1. 🟡 `02-enable-hyperv.ps1` (admin): turns on the Windows Hyper-V feature. No download needed.
2. 👤 **Restart Windows yourself** when convenient. The script never restarts.
3. 🟡 `03-create-lan-switch.ps1 -AdapterName "Ethernet"`: see Step 4.
4. 🟡 `04-create-ha-vm.ps1` (admin): downloads the official HAOS disk from GitHub, creates a VM
   (2 vCPU, 4 GB fixed RAM, Secure Boot off, auto-start on), and starts it.
5. 👤 After about 10 minutes, open `http://homeassistant.local:8123` and create your HA owner account.
   **You choose and type the password; I never see it.** Set location and time zone.

## Step 4 — Networking 🟡
HA needs its own address on your home network so (a) your phone can reach it and (b) it can talk
to the doorbell and NVR. Hyper-V's built-in "Default Switch" uses NAT and hides HA behind the PC,
so we create an **External switch** instead.

- The only host change: your Ethernet adapter gets bound to the switch. **The network drops for about 5 s**,
  so close trading apps or do it outside market hours. Your IP and DNS settings carry over.
- Use **wired Ethernet**. External switches on Wi-Fi are unreliable.
- 👤 Router (recommended): make the **doorbell, the NVR and HA** keep a fixed IP (called a "DHCP reservation").
  Then the integration never loses the devices.
- Undo anytime: `Remove-VMSwitch HA-LAN` (another short network drop).

## Step 5 — Reolink integration
👤 In the Reolink app/NVR web UI:
1. **Settings → Network → Advanced → Server/Port settings**: enable **HTTP** (or HTTPS), **RTSP**, **RTMP**, **ONVIF**.
2. Create a **dedicated user** (e.g. `homeassistant`, Admin role required for some controls) with its own password.
3. Update doorbell + NVR firmware.

In HA: **Settings → Devices & services → Add integration → Reolink**.
- **Recommended: add the doorbell by its own IP** (it's PoE, so it's on your LAN even when plugged into the NVR).
  Doorbell-press events are fastest and most reliable this way. You can *also* add the NVR for the other cameras.
- 👤 Type the Reolink username/password into the HA form yourself.

Afterwards, open the doorbell device and note these entity IDs (names vary):
`binary_sensor.<name>_visitor`, `binary_sensor.<name>_person`, `camera.<name>_fluent`.
Test: press the bell and watch "Visitor" flip to *Detected*.

## Step 6 — Automations
1. 🟡 Add `homeassistant/configuration-additions.yaml` to `/config/configuration.yaml`
   (install the **File editor** add-on: Settings → Add-ons → Add-on store). Restart HA.
2. Paste each block from `homeassistant/doorbell-automations.yaml` as a new automation
   (Settings → Automations → Create → ⋮ → Edit in YAML), after replacing the placeholder entity IDs.

What they do:
- **Bell pressed** → snapshot saved to `/media/doorbell/` → high-priority notification with the picture → tap opens live view.
- **Person detected** → same, normal priority, no more than once every 2 minutes, skipped if the bell was just pressed.
- **Nightly cleanup** deletes snapshots older than 14 days.
- **"HA is online"** alert after every restart, so you know it survived a Windows Update reboot.

## Step 7 — Samsung phone 👤
1. Install **Home Assistant** (Companion app) from Google Play, log in to your HA.
2. Allow notifications. Settings → Apps → Home Assistant → Battery → **Unrestricted**
   (One UI's battery saver otherwise delays alerts).
3. Your phone appears as `notify.mobile_app_<phone_name>` (Developer tools → Actions, search "mobile_app").
   Put that name into the automations.
4. After the first alert arrives, long-press it → set the **Doorbell** channel's sound and turn on "pop up on screen".
5. **Away from home:** the alert itself always arrives, but the *picture* is fetched from HA, so it only
   loads if the phone can reach HA remotely. Options: **Home Assistant Cloud (Nabu Casa)**, paid and easiest,
   or the free **Tailscale** add-on. No router port-forwarding needed with either. Tell me which and I'll set it up.

## Step 8 — Survive restarts and idle
- ✅ VM auto-starts 30 s after Windows boots, with nobody logged in (set by `04-create-ha-vm.ps1`).
- ✅ VM shuts down cleanly when Windows restarts (protects HA's database).
- 🟡 `05-keep-awake.ps1`: sets **sleep and hibernate to Never on mains power**. If the PC sleeps, alerts stop.
  The screen can still turn off and the lock screen is unchanged.
- Optional 👤: Windows Update → Advanced → Active hours, so update reboots avoid your trading day.

## Step 9 — Test checklist
- [ ] Hyper-V Manager shows *HomeAssistant: Running*
- [ ] `http://homeassistant.local:8123` opens from the PC **and** the phone (on Wi-Fi)
- [ ] Press doorbell → picture alert in < 5 s
- [ ] Walk past → "Person" alert with a picture
- [ ] Phone on mobile data (Wi-Fi off) → alert and picture (needs remote access, Step 7.5)
- [ ] Restart Windows (when convenient) → "HA is online" alert, with nobody logged in
- [ ] Leave PC idle for an hour → still alerts

## Maintenance
| When | What |
|---|---|
| Monthly | Settings → **Updates**: install Core / OS / add-on updates (HA makes a backup first). Skim release notes for "breaking changes". |
| Automatic | Settings → System → **Backups**: turn on automatic daily backups, keep 7. Add an off-PC location (Google Drive / OneDrive add-on, or Nabu Casa cloud backup). |
| Monthly | Reolink app: check doorbell and NVR firmware. |
| If alerts stop | 1) Is the VM running? 2) Is the Reolink integration showing errors? 3) Phone battery set to Unrestricted? 4) Did the doorbell IP change? (the router reservation prevents this) |
| Disk | The VM disk grows to about 32 GB max. Snapshots are auto-pruned. |
| Never | Don't take Hyper-V checkpoints of a running HA as "backups". Use HA backups. |

**Rollback / remove everything:** Hyper-V Manager → stop and delete VM → delete the VM folder →
`Remove-VMSwitch HA-LAN` → optionally turn off the Hyper-V feature. Windows is back to how it was.
