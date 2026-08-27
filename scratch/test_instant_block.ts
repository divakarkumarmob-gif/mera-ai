import "dotenv/config";
import { appSecurityService } from "../src/services/appSecurityService";

async function testInstantBlockAndUnblock() {
  console.log("=== Testing Instant IP Block on Direct Hit & Bot Unblock ===");

  const testIp = "192.168.99.99";
  const testAgent = "Mozilla/5.0 HackerProbeBot/1.0";

  // 1. Trigger Instant Block
  console.log("\n[Test 1] Triggering Instant Block on Direct Sensitive Probe...");
  await appSecurityService.blockClient(testIp, testAgent, "Direct unauthorized probe on /api/memory/export/decrypted-backup");

  const isBlocked = appSecurityService.isIpBlocked(testIp);
  console.log("Is Attacker IP immediately blocked?", isBlocked);

  if (!isBlocked) {
    console.error("❌ FAILED: Attacker was not blocked immediately!");
    process.exit(1);
  }
  console.log("✅ VERIFIED: Attacker IP was blocked INSTANTLY on first probe!");

  // 2. Test Bot Command: /unblock <ip> from Boss
  console.log("\n[Test 2] Testing Boss Telegram/WhatsApp Bot Command: /unblock 192.168.99.99...");
  const botRes = await appSecurityService.handleOwnerSecurityMessage(
    `/unblock ${testIp}`,
    true, // isOwner
    "Divakar (Boss)",
    "telegram"
  );

  console.log("Bot Command Handled?", botRes.handled);
  console.log("Bot Reply Message:\n", botRes.replyText);

  const isStillBlocked = appSecurityService.isIpBlocked(testIp);
  console.log("Is IP still blocked after Boss unblocked?", isStillBlocked);

  if (isStillBlocked) {
    console.error("❌ FAILED: IP is still blocked after Boss unblock command!");
    process.exit(1);
  }
  console.log("✅ VERIFIED: Boss successfully unblocked the client via Bot command!");

  console.log("\n=== ALL INSTANT BLOCK & UNBLOCK TESTS PASSED! ===");
}

testInstantBlockAndUnblock().catch(console.error);
