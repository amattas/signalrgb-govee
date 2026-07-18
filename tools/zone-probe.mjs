#!/usr/bin/env node
// Zone-identification probe for Govee LAN devices in razer/DreamView mode.
//
// Lights one protocol slot at a time so you can note which physical zone
// responds to each slot index. Quit SignalRGB (or disable the Govee plugin)
// first so two streams don't fight over the device.
//
// Usage: node tools/zone-probe.mjs <device-ip> [slots=16] [dwellMs=2500]

import dgram from "node:dgram";

const [ip, slotsArg, dwellArg] = process.argv.slice(2);
if (!ip) {
	console.error("Usage: node tools/zone-probe.mjs <device-ip> [slots=16] [dwellMs=2500]");
	process.exit(1);
}
const SLOTS = Number(slotsArg ?? 16);
const DWELL_MS = Number(dwellArg ?? 2500);
const FRAME_MS = 100;
const PORT = 4003;

const socket = dgram.createSocket("udp4");

function sendJson(obj) {
	const payload = Buffer.from(JSON.stringify(obj));
	socket.send(payload, PORT, ip);
}

function xorChecksum(bytes) {
	return bytes.reduce((sum, b) => sum ^ b, 0);
}

function dreamViewV1(colors) {
	const packet = [0xBB, 0x00, 0x20, 0xB0, 0x01, colors.length / 3, ...colors];
	packet.push(xorChecksum(packet));
	return packet;
}

function sendFrame(colors) {
	const pt = Buffer.from(dreamViewV1(colors)).toString("base64");
	sendJson({ msg: { cmd: "razer", data: { pt } } });
}

const COLORS = [
	["RED", [255, 0, 0]],
	["BLUE", [0, 0, 255]],
	["GREEN", [0, 255, 0]],
];

function frameForSlot(slot) {
	const colors = new Array(SLOTS * 3).fill(0);
	const [, rgb] = COLORS[slot % COLORS.length];
	colors[slot * 3] = rgb[0];
	colors[slot * 3 + 1] = rgb[1];
	colors[slot * 3 + 2] = rgb[2];
	return colors;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`Probing ${ip}: ${SLOTS} slots, ${DWELL_MS}ms each. Colors cycle RED, BLUE, GREEN.`);
console.log("Write down which physical zone lights up for each slot.\n");

sendJson({ msg: { cmd: "razer", data: { pt: "uwABsQEK" } } }); // razer mode on
await sleep(500);

for (let slot = 0; slot < SLOTS; slot++) {
	const [name] = COLORS[slot % COLORS.length];
	console.log(`SLOT ${String(slot).padStart(2)} -> ${name}`);
	const frame = frameForSlot(slot);
	for (let elapsed = 0; elapsed < DWELL_MS; elapsed += FRAME_MS) {
		sendFrame(frame);
		await sleep(FRAME_MS);
	}
}

console.log("\nDone. Restoring normal mode.");
sendFrame(new Array(SLOTS * 3).fill(0));
await sleep(200);
sendJson({ msg: { cmd: "razer", data: { pt: "uwABsQAL" } } }); // razer mode off
await sleep(200);
socket.close();
