# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **Cross-subnet Check IP discovery.** The plugin now owns one unconnected UDP
  `4002` listener and sends manual scans to device UDP `4001`, matching Govee's
  fixed reply-port behavior. Replies from arbitrary device source ports are
  accepted without competing with a SignalRGB-managed listener.
- **Raw UDP discovery responses.** SignalRGB socket callbacks provide packet
  JSON in `msg.data`, unlike framework discovery callbacks that use
  `value.response`. Both shapes are normalized before controller creation,
  with device ID and IP derived from the scan payload when necessary.
- **SignalRGB JavaScript compatibility.** Packet normalization avoids object
  spread syntax unsupported by SignalRGB's embedded JavaScript engine, which
  previously caused the plugin to disappear from the device list.
- **H6047 dual-bar layout.** Gaming Light Bars now appear as separate vertical
  `Left Light Bar` and `Right Light Bar` subdevices with six independently
  sampled zones. Slot-by-slot hardware probing showed each bar has ten
  bottom-to-top zones (slots 0-9 left, 10-19 right) and that the firmware
  remaps shorter packets unpredictably, so exactly 20 colors are streamed.

### Planned — v2.0.0-beta
- Port [WIZ Network Plugin](https://github.com/RobThePCGuy/SignalRGB-WIZ-Network-Plugin)'s
  device-health tracking: `lastRespondedAt` on each controller, green/red status
  dot in the device card, 55% dim on offline cards.
- Capability chips in the QML device list (`Razer` / `DreamView` / `Both` / `Static only`).
- Configurable `maxUpdatesPerSecond` rate limiter in `SendEncodedPacket`.

### Planned — v2.1.x
- Multi-device same-SKU disambiguation (key the controller cache by
  device-unique id from the scan response, not by SKU).
- `devices.override.json` sidecar so hand-edited device entries survive
  plugin reinstall.
- Idle color / idle behavior when SignalRGB pauses.
- Razer-mode keepalive heartbeat to prevent the community-documented
  ~60-second Razer-mode dropout.
- Diagnostic log toggle.

## [2.0.0-alpha.1] - 2026-04-22

Initial release of the RobThePCGuy fork. Foundational changes from upstream
`gitlab.com/signalrgb/Govee` Gui-Dev-BOMDIA branch (commit `a3a9d4f`,
2026-03-09).

### Added
- `.gitattributes` normalizing line endings (LF in repo, native on checkout).
- **H70BC** Netflix Curtain Lights device declaration. 20 IC subdevices,
  20 LEDs each, 400 total. Large-packet chunking is deferred to v2.0.1 —
  expect partial lighting on the real 400-LED device in this alpha.
- **H706A** Permanent Outdoor Lights Pro (100ft, 60 LEDs).
- **H706B** Permanent Outdoor Lights Pro (150ft, 90 LEDs).
- **H706C** Permanent Outdoor Lights Pro (200ft, 108 LEDs).
- **H607C** RGBICWW Floor Lamp 2.
- **H6088** RGBIC Cube Wall Sconces (all 6 cubes render the same color
  per [unmerged MR !34](https://gitlab.com/signalrgb/Govee/-/merge_requests/34);
  `supportRazer: false`, `supportDreamView: false`, `ledCount: 1`).
- **H6008** Wi-Fi + Bluetooth Smart LED Bulb (A19) — single-bulb Static.
- **H61E5** COB Strip Light Pro — Static-only placeholder; upgrade to
  per-LED if hardware testing confirms Razer Chroma support.

### Changed
- `Name()` returns `"Govee (Network)"` (was `"Govee"`) so users see which
  plugin is active when the official addon is also installed.
- `Version()` returns `"2.0.0-alpha.1"` (was `"1.0.0"`).
- `Publisher()` returns `"RobThePCGuy"` (was `"WhirlwindFX"`). Original
  upstream authors credited in [README.md](README.md).

### Fixed
- **RazerV2 silently fell through to Static.** Upstream switch-case had
  `case "RazerV1":` duplicated at Govee.js:673 so selecting RazerV2 in
  the protocolSelect combobox never reached `createRazerPacketV2`.
  Plan bug B1.
- **Deduplicated discovery handlers.** `Discovered` and `forceDiscovery`
  had byte-identical bodies except `forceDiscovery`'s leading
  `console.log`. Extracted a shared private `_handleDiscovery(value, forced)`
  so future fixes only need to be applied once. Plan bug B3.

### Known limitations in this alpha
- **B2 H619A duplicate.** Upstream has two H619A library entries
  (5m RGBIC Pro = 15 LEDs, 5m RGBIC with Cover = 30 LEDs). The later
  block silently overwrites the earlier at object-literal construction,
  so one of the two hardware variants works and the other doesn't. Will be
  properly fixed in v2.1.0 via multi-device same-SKU disambiguation.
- **B4a RazerV2 color-count field.** `createRazerPacketV2` uses
  `colors.length` (byte count) where it should likely be `colors.length / 3`
  (color count, matching RazerV1). If RazerV2 looks garbled on your
  hardware, this is the first suspect.
- **B4b RazerV2 size field.** Hardcoded `0x00, 0x0E`. `DreamviewV2`
  computes this dynamically; Razer V2 does not. Expect misbehavior on
  packets ≥ 256 bytes (H70BC at 1200 bytes is the canonical example).
- **H70BC chunking.** Not implemented in this alpha.
- **Online/offline card UI + capability chips** not yet ported from WIZ.
- **Rate limiter** not yet added.

## [1.0.0-upstream-snapshot] - 2026-03-09

Tagged provenance point from upstream `gitlab.com/signalrgb/Govee`
Gui-Dev-BOMDIA branch tip `a3a9d4f` by HarDBR. See the original
project's commit history for prior changes.
