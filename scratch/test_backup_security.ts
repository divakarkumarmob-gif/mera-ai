import "dotenv/config";
import http from "http";

// Test unauthorized hit to /api/memory/export/decrypted-backup
async function testUnauthorizedAccess() {
  console.log("=== Testing Endpoint Defense for Decrypted Backup ===");

  // Simulating an unauthorized hacker hit with fetch/http without token
  const testUrl = "http://localhost:3000/api/memory/export/decrypted-backup";

  try {
    const res = await fetch(testUrl);
    const data = await res.json();
    console.log("Hacker HTTP Status:", res.status);
    console.log("Hacker Response Body:", data);

    if (res.status === 401 && (data as any)?.error === "ACCESS_LOCKED") {
      console.log("✅ VERIFIED: Server strictly blocked unauthorized hacker attempt with 401 ACCESS_LOCKED!");
    } else {
      console.log("Server response:", data);
    }
  } catch (err: any) {
    console.log("Connection result (Server might be stopped):", err?.message || err);
  }
}

testUnauthorizedAccess().catch(console.error);
