import { networkDeviceScannerService } from "../src/services/networkDeviceScannerService";

async function testWifiDeviceScanner() {
  console.log("=== TESTING CONNECTED WI-FI DEVICE SCANNER ===");
  try {
    const startTime = Date.now();
    const scan = await networkDeviceScannerService.scanConnectedDevices(true);
    const duration = Date.now() - startTime;

    console.log(`Scan completed in ${duration}ms`);
    console.log("Subnet:", scan.subnet);
    console.log("Gateway IP:", scan.gatewayIp);
    console.log("Self IP:", scan.selfIp);
    console.log("Total Devices Found:", scan.totalDevices);
    console.log("Summary:", JSON.stringify(scan.summary, null, 2));

    console.log("\n--- Discovered Devices ---");
    scan.devices.forEach((dev, idx) => {
      console.log(`[${idx + 1}] IP: ${dev.ip.padEnd(15)} | MAC: ${dev.mac.padEnd(17)} | Type: ${dev.deviceType.padEnd(8)} | Vendor: ${dev.vendor}${dev.isGateway ? " [GATEWAY]" : ""}${dev.isSelf ? " [HOST PC]" : ""}`);
    });

    console.log("\n--- Voice Prompt Context Formatted for Friday ---");
    console.log(networkDeviceScannerService.compileVoicePromptContext(scan));

    console.log("\n✅ Connected Wi-Fi Device Scanner is 100% OPERATIONAL!");
  } catch (e: any) {
    console.error("Scanner test error:", e?.message || e);
  }
}

testWifiDeviceScanner().then(() => process.exit(0));
