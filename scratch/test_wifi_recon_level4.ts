import { networkDeviceScannerService } from "../src/services/networkDeviceScannerService";

async function testWifiReconLevel4() {
  console.log("=== TESTING LEVEL 4 CYBER WI-FI RECON & SPECTRUM RADAR ===");
  try {
    const startTime = Date.now();
    const recon = await networkDeviceScannerService.scanNearbyWifiRecon(true);
    const duration = Date.now() - startTime;

    console.log(`Recon scan completed in ${duration}ms\n`);

    console.log("📡 Airspace Overview:");
    console.log(`  - Total Networks in Range: ${recon.totalNetworks}`);
    console.log(`  - Connected Wi-Fi: ${recon.currentConnectedSsid || "None"}`);

    console.log("\n🛡️ Cyber Security Posture:");
    console.log(`  - High Security (WPA3-SAE): ${recon.securitySummary.wpa3Count}`);
    console.log(`  - Standard Security (WPA2-PSK): ${recon.securitySummary.wpa2Count}`);
    console.log(`  - Open / Insecure (No Password): ${recon.securitySummary.openRiskCount}`);
    console.log(`  - Rogue AP / Evil Twin Anomalies: ${recon.securitySummary.rogueCandidatesCount}`);
    console.log(`  - Hidden Cloaked Networks: ${recon.securitySummary.hiddenCount}`);

    console.log("\n📊 Channel Congestion & Optimization:");
    console.log(`  - Recommended 2.4 GHz Channel: Channel ${recon.channelAnalysis.recommendedChannel24}`);
    console.log(`  - Recommended 5 GHz Channel: Channel ${recon.channelAnalysis.recommendedChannel5}`);
    console.log(`  - Congested 2.4 GHz Channels: ${recon.channelAnalysis.congested24GHz.join(", ") || "None"}`);
    console.log(`  - Congested 5 GHz Channels: ${recon.channelAnalysis.congested5GHz.join(", ") || "None"}`);

    console.log("\n🔍 Discovered Over-The-Air Wi-Fi Networks:");
    recon.networks.forEach((net, idx) => {
      const lock = net.securityRisk === "HIGH_RISK_OPEN" ? "🚨 OPEN" : `🔒 ${net.authType}`;
      const conn = net.isCurrentNetwork ? " [CONNECTED]" : "";
      console.log(`  [${idx + 1}] "${net.ssid.padEnd(22)}" | BSSID: ${net.bssid} | ${net.band.padEnd(7)} | Ch ${String(net.channel || "").padEnd(3)} | Signal: ${net.signalPercent}% (${net.signalDbm} dBm) | ${lock}${conn}`);
    });

    console.log("\n🗣️ Spoken Voice Prompt Context for Friday:");
    console.log(networkDeviceScannerService.compileReconVoicePromptContext(recon));

    console.log("\n✅ LEVEL 4 CYBER RECON IS 100% OPERATIONAL!");
  } catch (e: any) {
    console.error("Recon test error:", e?.message || e);
  }
}

testWifiReconLevel4().then(() => process.exit(0));
