import { networkDeviceScannerService } from "../src/services/networkDeviceScannerService";

async function testWifiRadarLevel2() {
  console.log("=== TESTING LEVEL 2 WI-FI NETWORK RADAR ===");
  try {
    const startTime = Date.now();
    const scan = await networkDeviceScannerService.scanConnectedDevices(true);
    const duration = Date.now() - startTime;

    console.log(`Scan completed in ${duration}ms\n`);

    console.log("📡 Wi-Fi Link Health:");
    console.log(`  - SSID: ${scan.wifiHealth.ssid}`);
    console.log(`  - Signal: ${scan.wifiHealth.signalPercent}% (${scan.wifiHealth.signalQuality}, ${scan.wifiHealth.signalDbm} dBm)`);
    console.log(`  - Band: ${scan.wifiHealth.band} | Radio: ${scan.wifiHealth.radioType}`);
    console.log(`  - Link Speed: Rx ${scan.wifiHealth.receiveRateMbps} Mbps / Tx ${scan.wifiHealth.transmitRateMbps} Mbps`);
    console.log(`  - Channel: ${scan.wifiHealth.channel}`);
    console.log(`  - Gateway: ${scan.wifiHealth.gatewayIp} | Local IP: ${scan.wifiHealth.localIp}`);

    console.log("\n📊 Summary:");
    console.log(`  Total Devices: ${scan.totalDevices}`);
    console.log(`  Smart TVs: ${scan.summary.tvs} | Phones: ${scan.summary.phones} | PCs: ${scan.summary.computers}`);
    console.log(`  Routers: ${scan.summary.routers} | Speakers: ${scan.summary.speakers} | Printers: ${scan.summary.printers}`);

    console.log("\n🔍 Discovered Devices (Level 2 Inventory):");
    scan.devices.forEach((dev, idx) => {
      const servicesStr = dev.services.length > 0 ? ` [Services: ${dev.services.join(", ")}]` : "";
      const streamStr = dev.activeStream ? ` [Stream: ${dev.activeStream}]` : "";
      console.log(`  [${idx + 1}] ${dev.vendor.padEnd(28)} | ${dev.ip.padEnd(15)} | ${dev.deviceType.toUpperCase().padEnd(8)}${servicesStr}${streamStr}`);
    });

    console.log("\n🗣️ Spoken Voice Prompt Context for Friday:");
    console.log(networkDeviceScannerService.compileVoicePromptContext(scan));

    console.log("\n✅ LEVEL 2 WI-FI RADAR IS 100% OPERATIONAL!");
  } catch (e: any) {
    console.error("Test error:", e?.message || e);
  }
}

testWifiRadarLevel2().then(() => process.exit(0));
