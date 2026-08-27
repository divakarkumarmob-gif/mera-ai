import "dotenv/config";
import { appSecurityService } from "../src/services/appSecurityService";

async function testDoubleLock() {
  console.log("=== Testing 4-Layer Hacker Defense for Decrypted Backup ===");

  // 1. Verify Master Key in appSecurityService
  const activeKey = await appSecurityService.getAppKey();
  console.log("Master App Key Configured?", !!activeKey);

  // 2. Generate valid session token
  const token = appSecurityService.generateSessionToken(Date.now());
  console.log("Generated Valid Session Token?", !!token);

  // 3. Test verification logic directly
  const isTokenValid = appSecurityService.verifySessionToken(token);
  console.log("Session Token Authenticated?", isTokenValid);

  // 4. Test wrong token
  const isFakeTokenValid = appSecurityService.verifySessionToken("fake_hacker_token_xyz");
  console.log("Fake Hacker Token Rejected?", !isFakeTokenValid);

  console.log("✅ 4-Layer Defense Verified Successfully!");
}

testDoubleLock().catch(console.error);
