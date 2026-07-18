import udp from "@SignalRGB/udp";
export function Name() { return "Govee (Network)"; }
export function Version() { return "2.0.0-alpha.1"; }
export function Type() { return "network"; }
export function Publisher() { return "RobThePCGuy"; }
export function Size() { return [22, 1]; }
export function SubdeviceController() { return true; }
/* global
controller:readonly
discovery: readonly
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
TurnOffOnShutdown:readonly
protocolSelect:readonly
*/
export function ControllableParameters() {
	return [
		{property:"shutdownColor", group:"lighting", label:"Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", min:"0", max:"360", type:"color", default:"#000000"},
		{property:"LightingMode", group:"lighting", label:"Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", type:"combobox", values:["Canvas", "Forced"], default:"Canvas"},
		{property:"forcedColor", group:"lighting", label:"Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", min:"0", max:"360", type:"color", default:"#009bde"},
		{property:"TurnOffOnShutdown", group:"settings", label:"Turn off on unlink process", description: "This turns off the device during the unlink/disabling of the device process or shutdown of the app", type:"boolean", default:"false"},
		{property:"protocolSelect", group:"settings", label:"Protocol", description: "Determines which protocol will be used to control the device. (Not all protocols works on a device)", type:"combobox", values:["DreamviewV1", "DreamviewV2", "RazerV1", "RazerV2", "Static"], default:"DreamviewV1"},
	];
}

/** @type {GoveeProtocol} */
let govee;
/** @type {Array} Registered subdevices for SKUs with usesSubDevices:true */
let subdevices = [];

export function Initialize(){
	device.addFeature("base64");

	device.setName(controller.sku);
	device.setImageFromUrl(controller.deviceImage);

	if(UDPServer !== undefined) {
		UDPServer.stop();
		UDPServer = undefined;
	}
	//Make sure we don't have a server floating around still.

	UDPServer = new UdpSocketServer({
		ip : controller.ip,
		broadcastPort : 4003,
	});

	UDPServer.start();
	//Establish a new udp server. This is now required for using udp.send.

	ClearSubdevices();
	fetchDeviceInfoFromTableAndConfigure();

	govee = new GoveeProtocol(controller.ip, controller.supportDreamView, controller.supportRazer);

	govee.setDeviceState(true);
	govee.SetRazerMode(true);
}

export function Render(){
	govee.SendRGB();
	device.pause(10);
}

export function Shutdown(SystemSuspending){
	const color = SystemSuspending ? "#000000" : shutdownColor;
	govee.SendRGB(color);
	device.pause(10);

	govee.SetRazerMode(false);

	if(TurnOffOnShutdown){
		govee.setDeviceState(false);
	}
}

function fetchDeviceInfoFromTableAndConfigure() {
	if(GoveeDeviceLibrary.hasOwnProperty(controller.sku)){
		const GoveeDeviceInfo = GoveeDeviceLibrary[controller.sku];
		device.setName(`Govee ${GoveeDeviceInfo.sku} - ${GoveeDeviceInfo.name}`);

		if(GoveeDeviceInfo.usesSubDevices && Array.isArray(GoveeDeviceInfo.subdevices)){
			device.SetIsSubdeviceController(true);
			for(const sd of GoveeDeviceInfo.subdevices){
				CreateSubDevice(sd);
			}
			const total = GoveeDeviceInfo.subdevices.reduce((s, sd) => s + (sd.ledCount || 0), 0);
			device.log(`Subdevice SKU ${GoveeDeviceInfo.sku}: ${GoveeDeviceInfo.subdevices.length} subdevices / ${total} LEDs total`);
		}else{
			device.SetIsSubdeviceController(false);
			device.addChannel(`Channel 1`, GoveeDeviceInfo.ledCount);
			device.channel(`Channel 1`).SetLedLimit(GoveeDeviceInfo.ledCount);
			device.SetLedLimit(GoveeDeviceInfo.ledCount);
		}
	}else{
		device.log(`SKU (${controller.sku}) not found on the library, using 30 LEDs!`);
		device.setName(`Govee: ${controller.sku}`);
		device.SetIsSubdeviceController(false);
		device.addChannel(`Channel 1`, 30);
		device.channel(`Channel 1`).SetLedLimit(30);
		device.SetLedLimit(30);
	}
}

function ClearSubdevices(){
	for(const sd of device.getCurrentSubdevices()){
		device.removeSubdevice(sd);
	}
	subdevices = [];
}

function CreateSubDevice(subdevice){
	const count = device.getCurrentSubdevices().length;
	subdevice.id = `${subdevice.name} ${count + 1}`;
	device.createSubdevice(subdevice.id);
	device.setSubdeviceName(subdevice.id, subdevice.name);
	device.setSubdeviceImage(subdevice.id, controller.deviceImage);
	device.setSubdeviceSize(subdevice.id, subdevice.size[0], subdevice.size[1]);
	device.setSubdeviceLeds(subdevice.id, subdevice.ledNames, subdevice.ledPositions);
	subdevices.push(subdevice);
}

function GetRGBFromSubdevices(overrideColor){
	const RGBData = [];
	let idx = 0;
	for(const sd of subdevices){
		for(let i = 0; i < sd.ledPositions.length; i++){
			const pos = sd.ledPositions[i];
			let color;
			if(overrideColor){
				color = hexToRgb(overrideColor);
			}else if(LightingMode === "Forced"){
				color = hexToRgb(forcedColor);
			}else{
				try {
					color = device.subdeviceColor(sd.id, pos[0], pos[1]);
				} catch(e) {
					color = [0, 0, 0];
				}
			}
			RGBData[idx * 3    ] = color[0];
			RGBData[idx * 3 + 1] = color[1];
			RGBData[idx * 3 + 2] = color[2];
			idx++;
		}
	}
	return RGBData;
}

function hexToRgb(hex){
	const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	if(!m) return [0, 0, 0];
	return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

// -------------------------------------------<( Discovery Service )>--------------------------------------------------
let UDPServer;
let DiscoveryUDPServer;
const GoveeScanRequest = JSON.stringify({
	msg: { cmd: "scan", data: { account_topic: "reserve" } },
});

function isValidIPv4(value){
	if(typeof value !== "string") return false;
	const parts = value.split(".");
	return parts.length === 4 && parts.every(part => {
		if(!/^\d{1,3}$/.test(part)) return false;
		const number = Number(part);
		return number >= 0 && number <= 255;
	});
}

export function DiscoveryService() {
	this.IconUrl = "https://assets.signalrgb.com/brands/govee/logo.png";
	this.firstRun = true;

	this._normalizeDiscoveryValue = function(value){
		if(typeof value?.response === "string"){
			service.log(`Govee discovery response received from ${value.ip ?? "unknown"}:${value.port ?? "unknown"}`);
			return value;
		}

		const responseText = value?.data;
		let response;
		try{
			response = JSON.parse(responseText);
		}catch(error){
			return Object.assign({}, value, {response: responseText});
		}

		const responseData = response?.msg?.data;
		const normalizedValue = Object.assign({}, value, {
			response: responseText,
			ip: value?.ip ?? value?.address ?? responseData?.ip,
			id: value?.id ?? responseData?.device,
			parsedResponse: response,
		});
		service.log(`Govee discovery response received from ${normalizedValue.ip ?? "unknown"}:${normalizedValue.port ?? "unknown"}`);
		return normalizedValue;
	};

	this.Initialize = function(){
		service.log("Searching for Govee network devices...");
		if(DiscoveryUDPServer === undefined){
			DiscoveryUDPServer = new UdpSocketServer({
				listenPort: 4002,
				connectOnStart: false,
				isDiscoveryServer: true,
			});
			DiscoveryUDPServer.setCallbackFunction(value => this.forceDiscovery(this._normalizeDiscoveryValue(value)));
			DiscoveryUDPServer.start();
		}
	};

	this.UdpBroadcastPort = 4001;
	this.UdpListenPort = 0;
	this.UdpBroadcastAddress = "239.255.255.250";

	this.lastPollTime = 0;
	this.PollInterval = 60000;

	this.cache = new IPCache();

	this.LoadCachedDevices = function(){
		service.log("Loading Cached Devices...");

		for(const [key, value] of this.cache.Entries()){
			service.log(`Found Cached Device: [${key}: ${JSON.stringify(value)}]`);
			
			this.CreateControllerDevice(value);
			this.checkCachedDevice(value.ip);

			if(value.paired === true){ 
				this.link(value)
			}
		}
	};

	this.checkCachedDevice = function(ipAddress){
		if(!isValidIPv4(ipAddress)){
			service.log(`Invalid Govee IPv4 address: ${ipAddress}`);
			return false;
		}
		if(DiscoveryUDPServer === undefined){
			service.log("Govee discovery listener is not initialized.");
			return false;
		}
		service.log(`Sending Govee unicast scan to ${ipAddress}:4001`);
		const bytesWritten = DiscoveryUDPServer.write(GoveeScanRequest, ipAddress, 4001);
		if(bytesWritten === -1){
			service.log(`Failed to send Govee unicast scan to ${ipAddress}:4001`);
			return false;
		}
		return true;
	};

	this.CheckForDevices = function(){
		if(Date.now() - discovery.lastPollTime < discovery.PollInterval){
			return;
		}

		discovery.lastPollTime = Date.now();
		service.log("Broadcasting device scan...");
		service.broadcast(GoveeScanRequest);
	};

	this._handleDiscovery = function(value, forced) {
		let response = value?.parsedResponse;
		const responseText = value?.response ?? value?.data;
		if(response === undefined){
			try{
				response = JSON.parse(responseText);
			}catch(error){
				service.log(`Malformed Govee discovery packet: ${error.message}`);
				return;
			}
		}

		const responseData = response?.msg?.data;
		const normalizedValue = value?.parsedResponse === undefined ? Object.assign({}, value, {
			response: responseText,
			ip: value?.ip ?? value?.address ?? responseData?.ip,
			id: value?.id ?? responseData?.device,
			parsedResponse: response,
		}) : value;
		if(response?.msg?.cmd !== "scan"){
			service.log(`Ignoring Govee discovery packet with command: ${response?.msg?.cmd}`);
			return;
		}

		if(!responseData?.ip){
			service.log(`Potential Govee device ${responseData?.sku} discarded since it's missing an IP field. If this is a Matter device, is not supported yet.`);
			if(responseData !== undefined){
				service.log(responseData);
			}
			return;
		}

		if(!this.cache.Has(normalizedValue.id)){
			service.log(`Potential Govee device ${responseData.sku} found at ${responseData.ip}`);

			service.log(`Govee device ${responseData.sku} discovered!`);
			this.CreateControllerDevice(normalizedValue);

		}else if(normalizedValue.ip !== this.cache.Get(normalizedValue.id).ip){
			service.log(`Updating Govee device found at ${normalizedValue.ip}`);
			const cachedController = this.cache.Get(normalizedValue.id);
			const controller = service.getController(cachedController.id);
			if(controller){
				controller.updateWithValue(normalizedValue);
			}
		}
	};

	this.Discovered = function(value) {
		this._handleDiscovery(value, false);
	};

	this.forceDiscovery = function(value) {
		this._handleDiscovery(value, true);
	};

	this.purgeIPCache = function() {
		this.cache.PurgeCache();
	};

	this.Update = function(){

		if(this.firstRun){
			this.LoadCachedDevices();
			this.firstRun = false;
		}

		for(const cont of service.controllers){
			cont.obj.update();
		}

		this.CheckForDevices();
	};

	this.Shutdown = function(){
		if(DiscoveryUDPServer !== undefined){
			DiscoveryUDPServer.stop();
			DiscoveryUDPServer = undefined;
			service.log("Govee discovery listener stopped.");
		}
	};

	this.remove = function(controllerObj = false){

		if (controllerObj) {
			service.log(`Removing from cache: ${controllerObj.id}`);
			this.cache.Remove(controllerObj.id)
			
			service.log(`Removing controller: ${controllerObj.id}`);
			service.suppressController(controllerObj);
			service.removeController(controllerObj);
		} else {
			this.cache.PurgeCache();
			const cachedDevices = this.cache.Entries()
			console.log(cachedDevices);
	
			for(const [key, value] of cachedDevices){
				service.log(`Removing Cached Device: [${key}: ${JSON.stringify(value)}]`);
				service.suppressController(value);
				service.removeController(value);
			}

			this.cache.DumpCache();
		}

	};

	this.CreateControllerDevice = function(value){

		if(this.cache.Has(value.id)){
			service.log("Device found in cache, updating controller!")
			const cachedController = this.cache.Get(value.id)
			const controller = service.getController(cachedController.id);
			
			if(controller === undefined){
				service.log("Device controller not found, creating controller!")
				service.addController(new GoveeController(value));
			}else{
				controller.updateWithValue(value);
			}
		} else {
			service.log("Device not found in cache, creating controller!")
			service.addController(new GoveeController(value));
		}
	};

	this.link = function(controllerObj){
		service.log(`Linking controller: ${controllerObj.id} - Paired: ${controllerObj.paired} `);

		const cachedController = this.cache.Get(controllerObj.id)
		const controller = service.getController(cachedController.id);

		controller.paired = true;

		// Update controller
		controller.updateWithValue(controller);
		service.announceController(controller);

		// Update cache
		this.cacheControllerInfo(controller);

		service.log(`Linked controller: ${controller.id} - Paired: ${controller.paired} `);
	}

	this.unlink = function(controllerObj) {
		service.log(`Unlinking controller: ${JSON.stringify(controllerObj)}`);

		const cachedController = this.cache.Get(controllerObj.id)
		const controller = service.getController(cachedController.id);

		controller.paired = false;

		controller.updateWithValue(controller);
		service.suppressController(controller);

		// Update cache
		this.cacheControllerInfo(controller);
	}

	this.cacheControllerInfo = function(value) {
		discovery.cache.Add(
			value.id, {
				id: value.id,
				paired: value.paired,
				ip: value.ip,
				name: value.sku,
				GoveeInfo: value.GoveeInfo,
				supportDreamView: value.GoveeInfo.supportDreamView,
				supportRazer: value.GoveeInfo.supportRazer,
				deviceImage: value.GoveeInfo.deviceImage,
				device: value.device,
				sku: value.sku,
				bleVersionHard: value.bleVersionHard,
				bleVersionSoft: value.bleVersionSoft,
				wifiVersionHard: value.wifiVersionHard,
				wifiVersionSoft: value.wifiVersionSoft,
				initialized: value.initialized
			}
		);
	}
}

class GoveeController{
	 constructor(value){
		this.id = value?.id ?? "Unknown ID";
		this.paired = value?.paired ?? false;

		let response;

		// Handle discovery or cached device
		if (value.response) {
			const packet = value.parsedResponse?.msg ?? JSON.parse(value.response).msg;
			response = packet.data;
		} else {
			response = value
		}

		service.log(response);

		this.ip = response?.ip ?? "Unknown IP";
		this.name = response?.sku ?? "Unknown SKU";


		this.GoveeInfo = this.GetGoveeDevice(response.sku);
		this.supportDreamView = this.GoveeInfo?.supportDreamView;
		this.supportRazer = this.GoveeInfo?.supportRazer;
		this.deviceImage = this.GoveeInfo?.deviceImage;

		this.device = response.device;
		this.sku = response?.sku ?? "Unknown Govee SKU";
		this.bleVersionHard = response?.bleVersionHard ?? "Unknown";
		this.bleVersionSoft = response?.bleVersionSoft ?? "Unknown";
		this.wifiVersionHard = response?.wifiVersionHard ?? "Unknown";
		this.wifiVersionSoft = response?.wifiVersionSoft ?? "Unknown";
		this.initialized = false;

		this.DumpControllerInfo();

		if(this.name !== "Unknown SKU") {
			this.cacheControllerInfo(this);
		}
	}

	GetGoveeDevice(sku){
		if(GoveeDeviceLibrary.hasOwnProperty(sku)){
		  return GoveeDeviceLibrary[sku];
		}

		return {
			name: "Unknown",
			supportDreamView: false,
			supportRazer: false,
			deviceImage: "https://assets.signalrgb.com/brands/products/govee_ble/icon@2x.png"
		};
	}

	DumpControllerInfo(){
		service.log(`id: ${this.id}`);
		service.log(`ip: ${this.ip}`);
		service.log(`device: ${this.device}`);
		service.log(`sku: ${this.sku}`);
		service.log(`bleVersionHard: ${this.bleVersionHard}`);
		service.log(`bleVersionSoft: ${this.bleVersionSoft}`);
		service.log(`wifiVersionHard: ${this.wifiVersionHard}`);
		service.log(`wifiVersionSoft: ${this.wifiVersionSoft}`);
		service.log(`Supports Razer: ${this.supportRazer ? 'yes': 'no'}`);
		service.log(`Supports DreamView: ${this.supportDreamView ? 'yes': 'no'}`);
	}

	updateWithValue(value){
		this.id = value.id;
		this.paired = value.paired;

		let response;

		// Handle discovery or cached device
		if (value.response) {
			response = value.parsedResponse?.msg?.data ?? JSON.parse(value.response).msg.data;
		} else {
			response = value
		}

		this.ip = response?.ip ?? "Unknown IP";
		this.device = response.device;
		this.sku = response?.sku ?? "Unknown Govee SKU";
		this.bleVersionHard = response?.bleVersionHard ?? "Unknown";
		this.bleVersionSoft = response?.bleVersionSoft ?? "Unknown";
		this.wifiVersionHard = response?.wifiVersionHard ?? "Unknown";
		this.wifiVersionSoft = response?.wifiVersionSoft ?? "Unknown";

		service.updateController(this);
	}

	update(){
		if(!this.initialized){
			this.initialized = true;
			service.updateController(this);
		}
	}

	cacheControllerInfo(value){
		discovery.cache.Add(
			value.id, {
				id: value.id,
				paired: value.paired,
				ip: value.ip,
				name: value.sku,
				GoveeInfo: value.GoveeInfo,
				supportDreamView: value.GoveeInfo.supportDreamView,
				supportRazer: value.GoveeInfo.supportRazer,
				deviceImage: value.GoveeInfo.deviceImage,
				device: value.device,
				sku: value.sku,
				bleVersionHard: value.bleVersionHard,
				bleVersionSoft: value.bleVersionSoft,
				wifiVersionHard: value.wifiVersionHard,
				wifiVersionSoft: value.wifiVersionSoft,
				initialized: value.initialized
			}
		);
	}
}

class GoveeProtocol {

	constructor(ip, supportDreamView, supportRazer){
		this.ip = ip;
		this.port = 4003;
		this.lastPacket = 0;
		this.supportDreamView = supportDreamView;
		this.supportRazer = supportRazer;
	}

	setDeviceState(on){
		UDPServer.send(JSON.stringify({
			"msg": {
				"cmd": "turn",
				"data": {
					"value": on ? 1 : 0
				}
			}
		}));
	}

	SetBrightness(value) {
		UDPServer.send(JSON.stringify({
			"msg": {
				"cmd":"brightness",
				"data": {
					"value":value
				}
			}
		}));
	}

	SetRazerMode(enable){
		UDPServer.send(JSON.stringify({msg:{cmd:"razer", data:{pt:enable?"uwABsQEK":"uwABsQAL"}}}));
	}

	calculateXorChecksum(packet) {
		let checksum = 0;

		for (let i = 0; i < packet.length; i++) {
		  checksum ^= packet[i];
		}

		return checksum;
	}

	createDreamViewPacketV1(colors) {
		// Define the Dreamview protocol header
		const header = [0xBB, 0x00, 0x20, 0xB0, 0x01, colors.length / 3];
		const fullPacket = header.concat(colors);
		const checksum = this.calculateXorChecksum(fullPacket);
		fullPacket.push(checksum);

		return fullPacket;
	}

	createDreamViewPacketV2(colors) {
		// Define the Dreamview protocol header

		const packetToCheck = [0x01, colors.length / 3].concat(colors);

		const header = [0xBB, (packetToCheck.length >> 8 & 0xff), (packetToCheck.length & 0xff), 0xB0];
		const fullPacket = header.concat(packetToCheck);
		const checksum = this.calculateXorChecksum(fullPacket);
		fullPacket.push(checksum);

		return fullPacket;
	}

	createRazerPacketV1(colors) {
		// Define the Razer protocol header
		const header = [0xBB, 0x00, 0x0E, 0xB0, 0x01, colors.length / 3];
		const fullPacket = header.concat(colors);
		fullPacket.push(0); // Checksum

		return fullPacket;
	}

	createRazerPacketV2(colors) {
		// Define the Razer protocol header
		const header = [0xBB, 0x00, 0x0E, 0xB0, 0x01, colors.length];
		const fullPacket = header.concat(colors);
		fullPacket.push(this.calculateXorChecksum(fullPacket)); // Checksum

		return fullPacket;
	}

	SetStaticColor(RGBData){
		UDPServer.send(JSON.stringify({
			msg: {
				cmd: "colorwc",
				data: {
					color: {r: RGBData[0], g: RGBData[1], b: RGBData[2]},
					colorTemInKelvin: 0
				}
			}
		}));
		device.pause(100);
	}

	SendEncodedPacket(packet){
		const command = base64.Encode(packet);

		const now = Date.now();

		if (now - this.lastPacket > 1000) {
			UDPServer.send(JSON.stringify({
				msg: {
					cmd: "status",
					data: {}
				}
			}));
			this.lastPacket = now;
		}

		UDPServer.send(JSON.stringify({
			msg: {
				cmd: "razer",
				data: {
					pt: command,
				},
			},
		}));
	}

	SendRGB(overrideColor) {
		let RGBData = [];
		let packet  = [];

		if(subdevices.length > 0){
			RGBData = GetRGBFromSubdevices(overrideColor);
		}else{
			const ChannelLedCount = device.channel(`Channel 1`).LedCount();
			const componentChannel = device.channel(`Channel 1`);

			if(overrideColor) {
				RGBData = device.createColorArray(overrideColor, ChannelLedCount, "Inline");
			}else if(LightingMode === "Forced"){
				RGBData = device.createColorArray(forcedColor, ChannelLedCount, "Inline");
			}else if(componentChannel.shouldPulseColors()){
				const pulseColor = device.getChannelPulseColor(`Channel 1`);
				const pulseCount = device.channel(`Channel 1`).LedLimit();
				RGBData = device.createColorArray(pulseColor, pulseCount, "Inline");
			}else{
				RGBData = device.channel(`Channel 1`).getColors("Inline");
			}
		}

		switch (protocolSelect) {
			case "DreamviewV1":
				packet = this.createDreamViewPacketV1(RGBData);
				this.SendEncodedPacket(packet);
				break;
			case "DreamviewV2":
				packet = this.createDreamViewPacketV2(RGBData);
				this.SendEncodedPacket(packet);
				break;
			case "RazerV1":
				packet = this.createRazerPacketV1(RGBData);
				this.SendEncodedPacket(packet);
				break;
			case "RazerV2":
				packet = this.createRazerPacketV2(RGBData);
				this.SendEncodedPacket(packet);
				break;
			case "Static":
				this.SetStaticColor(RGBData.slice(0, 3));
				break;
		
			default:
				this.SetStaticColor(RGBData.slice(0, 3));
				break;
		}
	}
}

class UdpSocketServer{
	constructor (args) {
		this.count = 0;
		/** @type {udpSocket | null} */
		this.server = null;
		this.listenPort = args?.listenPort ?? 0;
		this.broadcastPort = args?.broadcastPort ?? 4001;
		this.ipToConnectTo = args?.ip ?? "239.255.255.250";
		this.isDiscoveryServer = args?.isDiscoveryServer ?? false;
		this.connectOnStart = args?.connectOnStart ?? true;

		this.log = (msg) => { this.isDiscoveryServer ? service.log(msg) : device.log(msg); };

		this.responseCallbackFunction = (msg) => { this.log("No Response Callback Set Callback cannot function"); msg; };
	}

	setCallbackFunction(responseCallbackFunction) {
		this.responseCallbackFunction = responseCallbackFunction;
	}

	write(packet, address, port) {
		if(!this.server) {
			this.log("Govee UDP socket unavailable; cannot write packet.");
			return -1;
		}

		return this.server.write(packet, address, port);
	}

	send(packet) {
		if(!this.server) {
			this.server = udp.createSocket();
			this.log("Defining new UDP Socket so we can send data.");
		}

		this.server.send(packet);
	}

	start(){
		this.server = udp.createSocket();

		if(this.server){
			// Given we're passing class methods to the server, we need to bind the context (this instance) to the function pointer
			this.server.on('error', this.onError.bind(this));
			this.server.on('message', this.onMessage.bind(this));
			this.server.on('listening', this.onListening.bind(this));
			this.server.on('connection', this.onConnection.bind(this));
			this.server.bind(this.listenPort);
			if(this.connectOnStart){
				this.server.connect(this.ipToConnectTo, this.broadcastPort);
			}
		}
	};

	stop(){
		if(this.server){
			if(this.connectOnStart){
				this.server.disconnect();
			}
			this.server.close();
			this.server = null;
		}
	}

	onConnection(){
		this.log('Connected to remote socket!');
		this.log("Remote Address:");
		this.log(this.server.remoteAddress(), {pretty: true});

		if(this.isDiscoveryServer) {
			this.log("Sending Check to socket");

			const bytesWritten = this.server.send(JSON.stringify({
				msg: {
					cmd: "scan",
					data: {
						account_topic: "reserve",
					},
				}
			}));

			if(bytesWritten === -1){
				this.log('Error sending data to remote socket');
			}
		}
	};

	onListenerResponse(msg) {
		this.log('Data received from client');
		this.log(msg, {pretty: true});
	}

	onListening(){
		const address = this.server.address();
		this.log(`Server is listening at port ${address.port}`);

		// Check if the socket is bound (no error means it's bound but we'll check anyway)
		this.log(`Socket Bound: ${this.server.state === this.server.BoundState}`);
	};
	onMessage(msg){
		this.log('Data received from client');
		this.responseCallbackFunction(msg);
	};
	onError(code, message){
		this.log(`Error: ${code} - ${message}`);
		if(this.server){
			this.server.close(); // We're done here
			this.server = null;
		}
		this.log("Govee UDP socket entered a failed state.");
	};
}

class IPCache{
	constructor(){
		this.cacheMap = new Map();
		this.persistanceId = "ipCache";
		this.persistanceKey = "cache";

		this.PopulateCacheFromStorage();
	}
	Add(key, value){
		service.log(`Adding ${key} to IP Cache...`);

		this.cacheMap.set(key, value);
		this.Persist();
	}

	Remove(key){
		this.cacheMap.delete(key);
		this.Persist();
	}
	Has(key){
		return this.cacheMap.has(key);
	}
	Get(key){
		return this.cacheMap.get(key);
	}
	Entries(){
		return this.cacheMap.entries();
	}

	PurgeCache() {
		service.removeSetting(this.persistanceId, this.persistanceKey);
		service.log("Purging IP Cache from storage!");
	}

	PopulateCacheFromStorage(){
		service.log("Populating IP Cache from storage...");

		const storage = service.getSetting(this.persistanceId, this.persistanceKey);

		if(storage === undefined){
			service.log(`IP Cache is empty...`);

			return;
		}

		let mapValues;

		try{
			mapValues = JSON.parse(storage);
		}catch(e){
			service.log(e);
		}

		if(mapValues === undefined){
			service.log("Failed to load cache from storage! Cache is invalid!");

			return;
		}

		if(mapValues.length === 0){
			service.log(`IP Cache is empty...`);
		}

		this.cacheMap = new Map(mapValues);
	}

	Persist(){
		service.log("Saving IP Cache...");
		service.saveSetting(this.persistanceId, this.persistanceKey, JSON.stringify(Array.from(this.cacheMap.entries())));
	}

	DumpCache(){
		for(const [key, value] of this.cacheMap.entries()){
			service.log([key, value]);
		}
	}
}

// eslint-disable-next-line max-len
/** @typedef { {name: string, deviceImage: string, sku: string, state: number, supportRazer: boolean, supportDreamView: boolean, ledCount: number, hasVariableLedCount?: boolean } } GoveeDevice */
/** @type {Object.<string, GoveeDevice>} */
const GoveeDeviceLibrary = {
	H6061: {
		name: "Glide Hexa Light Panels",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6061.png",
		sku: "H6061",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 30
	},
	H6062: {
		name: "Glide Wall Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6062.png",
		sku: "H6062",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 29, // This can support more? 5 * Segment Count - 1?
		hasVariableLedCount: true,
	},
	H6065: {
		name: "Glide Y Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6065.png",
		sku: "H6065",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H6066: {
		name: "Glide Hexa Pro Light Panels",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6066.png",
		sku: "H6066",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H6067: {
		name: "Glide Tri Light Panels",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6067.png",
		sku: "H6067",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H6609: {
		name: "Gaming Light Strip G1",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6609.png",
		sku: "H6609",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 20
	},
	H610A: {
		name: "Glide Lively Wall Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h610a.png",
		sku: "H610A",
		state: 1,
		supportRazer: false,
		supportDreamView: true,
		ledCount: 24
	},
	H610B: {
		name: "Glide Music Wall Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h610b.png",
		sku: "H610B",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6087: {
		name: "RGBIC Fixture Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6087.png",
		sku: "H6087",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6056: {
		name: "Flow Plus Light Bar",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6056.png",
		sku: "H6056",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 0,
		usesSubDevices: true,
		subdevices: [
			{
				name: "Flow Plus Light Bar",
				ledCount: 3,
				size: [1, 3],
				ledNames: ["Led 1", "Led 2", "Led 3"],
				ledPositions: [[0, 0], [0, 1], [0, 2]],
			},
			{
				name: "Flow Plus Light Bar",
				ledCount: 3,
				size: [1, 3],
				ledNames: ["Led 1", "Led 2", "Led 3"],
				ledPositions: [[0, 0], [0, 1], [0, 2]],
			},
		]
	},
	H6046: {
		name: "RGBIC TV Light Bars",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6046.png",
		sku: "H6046",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 0,
		usesSubDevices: true,
		subdevices: [
			{
				name: "RGBIC TV Light Bars",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
			},
			{
				name: "RGBIC TV Light Bars",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
			},
		]
	},
	H6047: {
		name: "RGBIC Gaming Light Bars",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6047.png",
		sku: "H6047",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 0,
		usesSubDevices: true,
		// Zone-probed: the firmware remaps shorter packets unpredictably, so
		// always stream 20 colors — slots 0-9 run up the left bar, 10-19 up
		// the right bar.
		subdevices: [
			{
				name: "Left Light Bar",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 9], [0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]],
			},
			{
				name: "Right Light Bar",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 9], [0, 8], [0, 7], [0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0]],
			},
		]
	},
	H6048: {
		name: "RGBIC TV Light Bars Pro",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6048.png",
		sku: "H6048",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 0,
		usesSubDevices: true,
		subdevices: [
			{
				name: "RGBIC TV Light Bars Pro",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
			},
			{
				name: "RGBIC TV Light Bars Pro",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
			},
		]
	},
	H6051: {
		name: "Table Lamp Lite",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6052.png",
		sku: "H6051",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 15
	},
	H6059: {
		name: "RGB Night Light Mini",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6059.png",
		sku: "H6059",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6052: {
		name: "RGBICWW Table Lamp",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6052.png",
		sku: "H6052",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H61A0: {
		name: "3m RGBIC Neon Rope Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61a0.png",
		sku: "H61A0",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H61A1: {
		name: "2m RGBIC Neon Rope Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61a0.png",
		sku: "H61A1",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H61A2: {
		name: "5m RGBIC Neon Rope Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61a0.png",
		sku: "H61A2",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 70
	},
	H61A3: {
		name: "4m RGBIC Neon Rope Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61a0.png",
		sku: "H61A3",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H619A: {
		name: "5m RGBIC Pro Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h619a.png",
		sku: "H619A",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H619B: {
		name: "7.5m RGBIC Pro Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h619a.png",
		sku: "H619B",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H619C: {
		name: "10m RGBIC Pro Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h619a.png",
		sku: "H619C",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H619D: {
		name: "2*7.5m RGBIC Pro Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h619a.png",
		sku: "H619D",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H619E: {
		name: "2*10m RGBIC Pro Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h619a.png",
		sku: "H619E",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 30
	},
	H619Z: {
		name: "3m RGBIC Pro Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h619a.png",
		sku: "H619Z",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 12
	},
	H61B2: {
		name: "3m RGBIC Neon TV Backlight",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61b2.png",
		sku: "H61B2",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H61B5: {
		name: "3m RGBIC Neon TV Backlight",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61b2.png",
		sku: "H61B5",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 15
	},
	H61C2: {
		name: "RGBIC LED Neon Rope Lights for Desks",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61c2.png",
		sku: "H61C2",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 16
	},
	H61C3: {
		name: "RGBIC LED Neon Rope Lights for Desks",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61c2.png",
		sku: "H61C3",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 42
	},
	H61C5: {
		name: "RGBIC LED Neon Rope Lights for Desks",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61c2.png",
		sku: "H61C5",
		state: 1,
		supportDreamView: true,
		supportRazer: true,
		ledCount: 15
	},
	H61E0: {
		name: "LED Strip Light M1",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61e0.png",
		sku: "H61E0",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 20
	},
	H61E1: {
		name: "LED Strip Light M1",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61e0.png",
		sku: "H61E1",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H6172: {
		name: "10m Outdoor RGBIC Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6172.png",
		sku: "H6172",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H615A: {
		name: "5m RGB Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h615a.png",
		sku: "H615A",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6110: {
		name: "2*5m MultiColor Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6110.png",
		sku: "H6110",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H618A: {
		name: "5m RGBIC Basic Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h618a.png",
		sku: "H618A",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1,
		usesSubDevices: true,
		subdevices: [
			{
				name: "RGBIC Basic Strip Light",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
			},
		]
	},
	H618C: {
		name: "10m RGBIC Basic Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h618a.png",
		sku: "H618C",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 12
	},
	H618E: {
		name: "2*10m RGBIC Bassic Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h618a.png",
		sku: "H618E",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6117: {
		name: "2*5m RGBIC Strip Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6117.png",
		sku: "H6117",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H61A5: {
		name: "10m RGBIC Neon Rope Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61a0.png",
		sku: "H61A5",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 30
	},
	H615B: {
		name: "10m RGB Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h615a.png",
		sku: "H615B",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H615C: {
		name: "15m RGB Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h615a.png",
		sku: "H615C",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H615D: {
		name: "15m RGB Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h615a.png",
		sku: "H615D",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H618F: {
		name: "2*15m RGBIC LED Strip Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h618a.png",
		sku: "H618F",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6072: {
		name: "RGBICWW Floor Lamp",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6072.png",
		sku: "H6072",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 8
	},
	H6073: {
		name: "Smart RGB Floor Lamp",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6073.png",
		sku: "H6073",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6076: {
		name: "RGBICW Floor Lamp Basic",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6076.png",
		sku: "H6076",
		state: 1,
		supportRazer: false,
		supportDreamView: true,
		ledCount: 68
	},
	H6079: {
		name: "RGBICWW Floor Lamp Pro",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6079.png",
		SKU: "H6079",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 10,
	},
	H7060: {
		name: "4 Pack RGBIC Flood Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h7060.png",
		sku: "H7060",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H7061: {
		name: "2 Pack RGBIC Flood Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h7060.png",
		sku: "H7061",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H7062: {
		name: "6 Pack RGBIC Flood Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h7060.png",
		sku: "H7062",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H70B1: {
		name: "Curtain Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h70b1.png",
		sku: "H70B1",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 10
	},
	H61D5: {
		name: "RGBIC Neon Lights 2",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61d5.png",
		sku: "H61D5",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 7
	},
	H6167: {
		name: "RGBIC TV Light Bars",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6168.png",
		sku: "H6167",
		state: 1,
		supportDreamView: true,
		supportRazer: true,
		ledCount: 10
	},
	H6168: {
		name: "RGBIC TV Light Bars",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6168.png",
		sku: "H6168",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 0,
		usesSubDevices: true,
		subdevices: [
			{
				name: "RGBIC TV Light Bars",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
			},
			{
				name: "RGBIC TV Light Bars",
				ledCount: 10,
				size: [1, 10],
				ledNames: ["Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6", "Led 7", "Led 8", "Led 9", "Led 10"],
				ledPositions: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6], [0, 7], [0, 8], [0, 9]],
			},
		]
	},
	H7075: {
		name: "Govee Outdoor Wall Light, 1500LM",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h7075.png",
		sku: "H7075",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 10
	},
	H606A: {
		name: "Hex Glide Ultra",
		deviceImage : "https://assets.signalrgb.com/devices/brands/govee/wifi/h606a.png",
		sku: "H606A",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 10, // Linked panels that goes up to 21 per controller
		hasVariableLedCount: true
	},
	H8022 : {
		name: "RGBIC Table Lamp",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h8022.png",
		sku: "H8022",
		state: 1,
		supportDreamView: true,
		supportRazer: true,
		ledCount: 15
	},
	H8072: {
		name: "RGBIC Floor Lamp",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h8072.png",
		sku: "H8072",
		state: 1,
		supportDreamView: true,
		supportRazer: true,
		ledCount: 15
	},
	H7053: {
		name: "Outdoor Ground Lights 2",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h7053.png",
		sku: "H7053",
		state: 1,
		supportRazer: false,
		supportDreamView: true,
		ledCount: 30
	},
	H61B3: {
		name: "3m RGBIC LED Strip Light with Cover",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61b2.png",
		sku: "H61B3",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 30
	},
	H7039: {
		name: "Smart Outdoor String Lights 2",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h7039.png",
		sku: "H7039",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 45
	},
	H60A1: {
		name: "Smart Ceiling Light",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h60a1.png",
		sku: "H60A1",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 13
	},
	H702A: {
		name: "S14 Bulb Outdoor String Lights 2",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h702a.png",
		sku: "H702A",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H61E6: {
		name: "COB LED Strip Light Pro",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61e6.png",
		sku: "H61E6",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 60
	},
	H612C: {
		name: " RGBIC LED Strip Lights With Protective Coating",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h612c.png",
		sku: "H612C",
		state: 1,
		supportRazer: false,
		supportDreamView: true,
		ledCount: 20
	},
	H619A: {
		name: "5m RGBIC LED Strip Light with Cover",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h619a.png",
		sku: "H619A",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 30
	},
	H70BC: {
		name: "Netflix Curtain Lights",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h70b1.png",
		sku: "H70BC",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 0,
		usesSubDevices: true,
		subdevices: [
			{ name: "IC1",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC2",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC3",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC4",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC5",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC6",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC7",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC8",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC9",  ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC10", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC11", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC12", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC13", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC14", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC15", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC16", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC17", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC18", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC19", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
			{ name: "IC20", ledCount: 20, size: [1, 20], ledNames: ["Led 1","Led 2","Led 3","Led 4","Led 5","Led 6","Led 7","Led 8","Led 9","Led 10","Led 11","Led 12","Led 13","Led 14","Led 15","Led 16","Led 17","Led 18","Led 19","Led 20"], ledPositions: [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[0,7],[0,8],[0,9],[0,10],[0,11],[0,12],[0,13],[0,14],[0,15],[0,16],[0,17],[0,18],[0,19]] },
		]
	},
	H706A: {
		name: "Permanent Outdoor Lights Pro (100ft, 60 LED)",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h706a.png",
		sku: "H706A",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 60
	},
	H706B: {
		name: "Permanent Outdoor Lights Pro (150ft, 90 LED)",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h706a.png",
		sku: "H706B",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 90
	},
	H706C: {
		name: "Permanent Outdoor Lights Pro (200ft, 108 LED)",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h706a.png",
		sku: "H706C",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 108
	},
	H607C: {
		name: "RGBICWW Floor Lamp 2",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6072.png",
		sku: "H607C",
		state: 1,
		supportRazer: true,
		supportDreamView: true,
		ledCount: 15
	},
	H6088: {
		name: "RGBIC Cube Wall Sconces",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6087.png",
		sku: "H6088",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H6008: {
		name: "Wi-Fi + Bluetooth Smart LED Bulb (A19)",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h6008.png",
		sku: "H6008",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
	H61E5: {
		name: "COB Strip Light Pro",
		deviceImage: "https://assets.signalrgb.com/devices/brands/govee/wifi/h61e5.png",
		sku: "H61E5",
		state: 1,
		supportRazer: false,
		supportDreamView: false,
		ledCount: 1
	},
};
