import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";

class MockUdpSocket {
	constructor() {
		this.calls = [];
		this.handlers = new Map();
		this.state = 1;
		this.BoundState = 1;
		this.writeResult = undefined;
	}
	on(event, callback) { this.handlers.set(event, callback); }
	bind(port) { this.calls.push(["bind", port]); }
	connect(address, port) { this.calls.push(["connect", address, port]); }
	write(packet, address, port) { this.calls.push(["write", packet, address, port]); return this.writeResult ?? packet.length; }
	send(packet) { this.calls.push(["send", packet]); return packet.length; }
	disconnect() { this.calls.push(["disconnect"]); }
	close() { this.calls.push(["close"]); }
	address() { return { address: "0.0.0.0", port: this.calls.find(call => call[0] === "bind")?.[1] ?? 0 }; }
	remoteAddress() { return { address: "mock", port: 0 }; }
}

function loadPlugin() {
	const sockets = [];
	const controllers = new Map();
	let parseCount = 0;
	const service = {
		controllers: [],
		logs: [],
		addedControllers: [],
		log(value) { this.logs.push(value); },
		getSetting() { return undefined; },
		saveSetting() {},
		removeSetting() {},
		addController(controller) {
			this.addedControllers.push(controller);
			controllers.set(controller.id, controller);
		},
		getController(id) { return controllers.get(id); },
		updateController() {},
		announceController() {},
		suppressController() {},
		removeController() {},
		broadcast() {},
	};
	const context = {
		JSON: {
			parse(value) { parseCount++; return JSON.parse(value); },
			stringify: JSON.stringify,
		},
		udp: {
			createSocket() {
				const socket = new MockUdpSocket();
				sockets.push(socket);
				return socket;
			},
		},
		device: {
			log() {},
			subdeviceColor(id, x, y) {
				return [id === "left" ? 10 : 20, x, y];
			},
		},
		LightingMode: "Canvas",
		service,
		console,
	};
	vm.createContext(context);

	const pluginPath = new URL("../GoveeNetwork.js", import.meta.url);
	const source = fs.readFileSync(pluginPath, "utf8")
		.replace(/^import udp from "@SignalRGB\/udp";\s*/m, "")
		.replace(/\bexport\s+/g, "")
		.concat(`
globalThis.__testExports = {
	DiscoveryService,
	UdpSocketServer,
	GoveeDeviceLibrary,
	GetRGBFromSubdevices,
	setSubdevicesForTest(value) { subdevices = value; },
};
`);
	vm.runInContext(source, context, { filename: pluginPath.pathname });

	return { ...context.__testExports, context, sockets, getParseCount: () => parseCount };
}

test("plugin source avoids object spread unsupported by SignalRGB", () => {
	const pluginPath = new URL("../GoveeNetwork.js", import.meta.url);
	const source = fs.readFileSync(pluginPath, "utf8");

	assert.doesNotMatch(source, /\.\.\.value/);
});

test("H6047 exposes two vertical six-zone light bars", () => {
	const runtime = loadPlugin();
	const h6047 = runtime.GoveeDeviceLibrary.H6047;

	assert.equal(h6047.usesSubDevices, true);
	assert.equal(h6047.ledCount, 0);
	assert.equal(h6047.subdevices.length, 2);
	assert.deepEqual(Array.from(h6047.subdevices, sd => sd.name), ["Left Light Bar", "Right Light Bar"]);
	assert.deepEqual(JSON.parse(JSON.stringify(h6047.subdevices.map(sd => sd.size))), [[1, 6], [1, 6]]);
	assert.deepEqual(JSON.parse(JSON.stringify(h6047.subdevices[0].ledPositions)), [[0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]]);
	assert.deepEqual(JSON.parse(JSON.stringify(h6047.subdevices[1].ledPositions)), [[0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]]);
});

test("H6047 flattens left then right protocol zones from bottom to top", () => {
	const runtime = loadPlugin();
	const subdevices = runtime.GoveeDeviceLibrary.H6047.subdevices;
	subdevices[0].id = "left";
	subdevices[1].id = "right";
	runtime.setSubdevicesForTest(subdevices);

	assert.deepEqual(Array.from(runtime.GetRGBFromSubdevices()), [
		10, 0, 5,
		10, 0, 4,
		10, 0, 3,
		10, 0, 2,
		10, 0, 1,
		10, 0, 0,
		20, 0, 5,
		20, 0, 4,
		20, 0, 3,
		20, 0, 2,
		20, 0, 1,
		20, 0, 0,
	]);
});

test("discovery owns one unconnected UDP 4002 listener", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;

	discovery.Initialize();

	assert.equal(discovery.UdpListenPort, 0);
	assert.equal(runtime.sockets.length, 1);
	assert.deepEqual(runtime.sockets[0].calls, [["bind", 4002]]);
});

test("unicast discovery uses the shared listener and targets device UDP 4001", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;

	discovery.Initialize();
	discovery.checkCachedDevice("10.4.28.131");

	assert.equal(runtime.sockets.length, 1);
	const socket = runtime.sockets[0];
	assert.deepEqual(socket.calls.at(-1).slice(0, 1).concat(socket.calls.at(-1).slice(2)), [
		"write",
		"10.4.28.131",
		4001,
	]);
	assert.deepEqual(JSON.parse(socket.calls.at(-1)[1]), {
		msg: { cmd: "scan", data: { account_topic: "reserve" } },
	});
});

test("invalid unicast addresses are rejected without writes", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();

	assert.equal(discovery.checkCachedDevice("10.4.28"), false);
	assert.equal(discovery.checkCachedDevice("10.4.28.999"), false);
	assert.equal(discovery.checkCachedDevice(null), false);
	assert.equal(discovery.checkCachedDevice(undefined), false);
	assert.equal(discovery.checkCachedDevice(10428131), false);
	assert.equal(runtime.sockets[0].calls.filter(call => call[0] === "write").length, 0);
});

test("failed unicast writes are logged and reported", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();
	runtime.sockets[0].writeResult = -1;

	assert.equal(discovery.checkCachedDevice("10.4.28.131"), false);
	assert.ok(runtime.context.service.logs.some(value => String(value).includes("Failed to send Govee unicast scan to 10.4.28.131:4001")));
});

test("discovery diagnostics use response wrapper source IP and port without changing the callback payload", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();
	const packet = {
		response: JSON.stringify({ msg: { cmd: "scan", data: { ip: "192.0.2.50", device: "device-id", sku: "H6047" } } }),
		ip: "10.4.28.131",
		port: 54321,
		id: "device-id",
	};
	let received;
	discovery.forceDiscovery = value => { received = value; };

	runtime.sockets[0].handlers.get("message")(packet);

	assert.strictEqual(received, packet);
	assert.ok(runtime.context.service.logs.some(value => String(value).includes("Govee discovery response received from 10.4.28.131:54321")));
});

test("raw SignalRGB UDP packets are normalized before discovery handling", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();
	const packet = {
		data: JSON.stringify({
			msg: {
				cmd: "scan",
				data: {
					ip: "10.4.28.131",
					device: "2D:0D:DD:6E:84:C6:68:6D",
					sku: "H6047",
				},
			},
		}),
		port: 55213,
	};

	runtime.sockets[0].handlers.get("message")(packet);

	assert.equal(runtime.context.service.addedControllers.length, 1);
	assert.equal(runtime.getParseCount(), 1);
	const controller = runtime.context.service.addedControllers[0];
	assert.equal(controller.id, "2D:0D:DD:6E:84:C6:68:6D");
	assert.equal(controller.ip, "10.4.28.131");
	assert.equal(controller.sku, "H6047");
	assert.ok(runtime.context.service.logs.some(value => String(value).includes("Govee discovery response received from 10.4.28.131:55213")));
});

test("framework discovery wrappers derive missing metadata and reuse the parsed response", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	const packet = {
		response: JSON.stringify({
			msg: {
				cmd: "scan",
				data: { ip: "10.4.28.131", device: "device-id", sku: "H6047" },
			},
		}),
		port: 54321,
	};
	const createControllerDevice = discovery.CreateControllerDevice;
	let createdWith;
	discovery.CreateControllerDevice = function(value) {
		createdWith = value;
		return createControllerDevice.call(this, value);
	};

	discovery.Discovered(packet);

	assert.notStrictEqual(createdWith, packet);
	assert.equal(createdWith.id, "device-id");
	assert.equal(createdWith.ip, "10.4.28.131");
	assert.equal(createdWith.parsedResponse.msg.data.device, "device-id");
	assert.equal(runtime.getParseCount(), 1);
	assert.equal(runtime.context.service.addedControllers.length, 1);
	assert.equal(runtime.context.service.addedControllers[0].id, "device-id");
	assert.equal(discovery.cache.Has("device-id"), true);
});

test("malformed discovery packets are ignored with a diagnostic", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();

	runtime.sockets[0].handlers.get("message")({ response: "not json", ip: "10.4.28.131", id: "bad" });

	assert.equal(runtime.context.service.addedControllers.length, 0);
	assert.ok(runtime.context.service.logs.some(value => String(value).includes("Malformed Govee discovery packet")));
});

test("unrelated discovery packets are ignored with a diagnostic", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();

	runtime.sockets[0].handlers.get("message")({
		response: JSON.stringify({ msg: { cmd: "devStatus", data: { ip: "10.4.28.131", sku: "H6047" } } }),
		ip: "10.4.28.131",
		id: "ignored",
	});

	assert.equal(runtime.context.service.addedControllers.length, 0);
	assert.ok(runtime.context.service.logs.some(value => String(value).includes("Ignoring Govee discovery packet")));
});

test("scan responses missing an IP are ignored with a diagnostic", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();

	runtime.sockets[0].handlers.get("message")({
		response: JSON.stringify({ msg: { cmd: "scan", data: { device: "device-id", sku: "H6047" } } }),
		ip: "10.4.28.131",
		port: 54321,
		id: "device-id",
	});

	assert.equal(runtime.context.service.addedControllers.length, 0);
	assert.ok(runtime.context.service.logs.some(value => String(value).includes("missing an IP field")));
});

test("discovery listener creates one controller for duplicate scan responses", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();
	const response = {
		id: "2D:0D:DD:6E:84:C6:68:6D",
		ip: "10.4.28.131",
		response: JSON.stringify({
			msg: {
				cmd: "scan",
				data: { ip: "10.4.28.131", device: "2D:0D:DD:6E:84:C6:68:6D", sku: "H6047" },
			},
		}),
	};
	const messageHandler = runtime.sockets[0].handlers.get("message");

	messageHandler(response);
	messageHandler(response);

	assert.equal(runtime.context.service.addedControllers.length, 1);
});

test("discovery shutdown closes the shared listener without disconnecting", () => {
	const runtime = loadPlugin();
	const discovery = new runtime.DiscoveryService();
	runtime.context.discovery = discovery;
	discovery.Initialize();

	discovery.Shutdown();

	assert.equal(runtime.sockets[0].calls.filter(call => call[0] === "close").length, 1);
	assert.equal(runtime.sockets[0].calls.filter(call => call[0] === "disconnect").length, 0);
});

test("control sockets remain connected to their target", () => {
	const runtime = loadPlugin();
	const server = new runtime.UdpSocketServer({
		ip: "10.4.28.131",
		broadcastPort: 4003,
	});

	server.start();

	assert.equal(runtime.sockets.length, 1);
	assert.deepEqual(runtime.sockets[0].calls, [
		["bind", 0],
		["connect", "10.4.28.131", 4003],
	]);
});

test("socket errors clear the failed handle and later writes fail closed", () => {
	const runtime = loadPlugin();
	const server = new runtime.UdpSocketServer({
		listenPort: 4002,
		connectOnStart: false,
		isDiscoveryServer: true,
	});
	server.start();
	const failedSocket = runtime.sockets[0];

	failedSocket.handlers.get("error")("EADDRINUSE", "address already in use");
	const result = server.write("packet", "10.4.28.131", 4001);

	assert.deepEqual(failedSocket.calls.filter(call => call[0] === "close"), [["close"]]);
	assert.equal(server.server, null);
	assert.equal(result, -1);
	assert.equal(runtime.sockets.length, 1);
	assert.equal(failedSocket.calls.filter(call => call[0] === "write").length, 0);
	assert.ok(runtime.context.service.logs.some(value => String(value).includes("Govee UDP socket unavailable")));
});
