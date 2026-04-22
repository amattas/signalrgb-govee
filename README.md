# SignalRGB Govee Network Plugin

[![Add to SignalRGB](https://raw.githubusercontent.com/SRGBmods/QMK-Images/main/images/add-to-signalrgb.png)](https://srgbmods.net/s?p=addon/install?url=https://github.com/RobThePCGuy/SignalRGB-Govee-Network-Plugin)

Community fork of the official [SignalRGB Govee plugin](https://gitlab.com/signalrgb/Govee).
Forked at commit `a3a9d4f` (Gui-Dev-BOMDIA branch, 2026-03-09) to ship bug fixes,
additional device SKUs, and quality-of-life improvements without waiting on upstream review.

## Setup Requirements

- Govee device connected to 2.4 GHz Wi-Fi via the Govee Home app
- LAN Control enabled in the device's app settings
- Reserved / static IP recommended (multicast discovery can be flaky on some routers)
- SignalRGB v2.2+ with developer mode enabled

## What's different vs. upstream

Compared to upstream `gitlab.com/signalrgb/Govee main` as of April 2026:

- **Bug fix: `RazerV2` protocol selection actually works.** The upstream switch-case
  had `case "RazerV1":` duplicated, so selecting `RazerV2` in the `protocolSelect`
  combobox silently fell through to `Static` (single color). Fixed.
- **Bug fix: device discovery handlers deduplicated.** `Discovered` and
  `forceDiscovery` had byte-identical bodies; they now share a single
  `_handleDiscovery` implementation so future fixes only need to be applied once.
- **Additional SKUs** that have been asked for in forum threads but not yet
  upstreamed:
  - H70BC — Netflix Curtain Lights (20 IC subdevices × 20 LEDs, 400 total)
  - H706A/B/C — Permanent Outdoor Lights Pro family (60/90/108 LEDs)
  - H607C — RGBICWW Floor Lamp 2
  - H6088 — RGBIC Cube Wall Sconces
  - H6008 — Wi-Fi + Bluetooth Smart LED Bulb (A19)
  - H61E5 — COB Strip Light Pro
- **Plus everything on Gui-Dev-BOMDIA** that hasn't been merged upstream yet:
  V1/V2 Dreamview + Razer packet builders, `protocolSelect` combobox, shutdown
  color, components-channel rewrite, grid UI with search box, cache-update-on-IP-change,
  Matter-device log hint, sync-on-init.

## Roadmap

This release is `v2.0.0-alpha.1` — foundational fork with upstream bug fixes and
new SKUs. Subsequent releases will layer on:

- **v2.0.0-beta** — WIZ-plugin-style online/offline device health tracking,
  capability chips (Razer / DreamView / Both / Static), configurable rate
  limiter on `SendEncodedPacket`.
- **v2.1.0** — Multi-device same-SKU disambiguation. Fixes the "only one of my
  two identical strips shows up" bug.
- **v2.1.1** — `devices.override.json` sidecar so hand-edited device entries
  survive plugin reinstall.
- **v2.1.2** — Cross-subnet / unicast scan fallback for VLAN-segmented networks.
- **v2.1.3** — Idle-color-when-paused; Razer-mode keepalive heartbeat (prevents
  the ~60 s Razer-mode dropout).
- **v2.1.4** — Diagnostic log toggle.
- **v2.2.x (experimental)** — Auto-detect LED count via device status query;
  components JSON schema for complex layouts.

Full plan details in the repo issue tracker.

## Installation

Click the badge at the top of this README, or manually drop `Govee.js` and
`Govee.qml` into `%USERPROFILE%\Documents\WhirlwindFX\Plugins\Govee\`.

If you already have the official SignalRGB Govee plugin installed, uninstall it
first — both plugins share the same PID/VID match logic and you want this fork
to be the one that picks up your devices.

## Troubleshooting

- **Device not discovered** — verify LAN Control is enabled in the Govee Home
  app, reserve a static IP for the device in your router, and try the
  "Cache Device" button in the plugin settings with the device's IP typed in.
- **RazerV2 doesn't work** — if colors look shifted or the wrong LEDs light up,
  switch to DreamviewV2 in the `Protocol` dropdown. `RazerV2` is the protocol
  most affected by the byte-count field ambiguity (see project plan bug B4a).
- **H70BC Netflix Curtain looks partially lit** — expected for this alpha.
  Large-packet chunking for 400-LED devices is deferred to `v2.0.1` once
  hardware verification establishes the per-packet LED limit on the real
  device. Follow the tracking issue for progress.
- **Logs** — `%AppData%\WhirlwindFX\SignalRGB\logs`, sort by "Date modified".

## Contributing

SKU requests, bug reports, and diffs welcome via GitHub Issues and Pull Requests.
For bug reports please enable diagnostic logging (coming in v2.1.4) and paste the
relevant log excerpt.

## Credits

- Original upstream plugin by the SignalRGB team (Heal-Bot, TheDordo, HarDBR),
  hosted at [gitlab.com/signalrgb/Govee](https://gitlab.com/signalrgb/Govee).
  This fork retains the original commit history through `v1.0.0-upstream-snapshot`.
- Packet-format reverse engineering documented at
  [egold555/Govee-Reverse-Engineering](https://github.com/egold555/Govee-Reverse-Engineering)
  and in the Draft [OpenRGB MR !2172](https://gitlab.com/CalcProgrammer1/OpenRGB/-/merge_requests/2172).
- LAN protocol reference: Govee's [official LAN guide](https://app-h5.govee.com/user-manual/wlan-guide)
  and [wez/govee2mqtt LAN docs](https://github.com/wez/govee2mqtt/blob/main/docs/LAN.md).
- Related community plugins that informed design decisions:
  [fu-raz/signalrgb-govee-direct-connect](https://github.com/fu-raz/signalrgb-govee-direct-connect),
  [omidchini/signalrgb_govee](https://github.com/omidchini/signalrgb_govee).

## License

MIT. See [LICENSE](LICENSE).
