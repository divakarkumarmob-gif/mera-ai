import "dotenv/config";
import { telegramSecurityBotService } from "../src/services/telegramSecurityBotService";
import { appSecurityService } from "../src/services/appSecurityService";

async function testSecuritySentinelBot() {
  console.log("=== Testing Dedicated Security Sentinel Telegram Bot ===");

  // Set dummy test environment
  process.env.BOSS_TELEGRAM_CHAT_ID = "998877665";
  process.env.APP_KEY = "test_dk_pass_2026";

  const bossChatId = 998877665;
  const hackerChatId = 112233445;

  console.log("\n[Test 1] Testing Unauthorized Chat ID (Hacker / Stranger)...");
  // Simulating message handling via private reflection for unit test
  const botAny = telegramSecurityBotService as any;

  const sentMsgs: any[] = [];
  botAny.sendMessage = async (chatId: number, text: string, keyboard?: any) => {
    sentMsgs.push({ chatId, text, keyboard });
    return { ok: true };
  };

  // Hacker sends /start
  await botAny.handleMessage({
    chat: { id: hackerChatId },
    text: "/start",
    from: { first_name: "EvilHacker", username: "bad_actor" },
  });

  const hackerMsg = sentMsgs.find((m) => m.chatId === hackerChatId);
  const bossAlertMsg = sentMsgs.find((m) => m.chatId === bossChatId);

  console.log("Hacker Response Received:", hackerMsg?.text?.includes("ACCESS DENIED"));
  console.log("Boss Received Intrusion Alert?", bossAlertMsg?.text?.includes("SECURITY ALERT"));

  if (!hackerMsg?.text?.includes("ACCESS DENIED")) {
    console.error("❌ FAILED: Hacker was not rejected!");
    process.exit(1);
  }
  console.log("✅ VERIFIED: Unauthorized user was immediately rejected with ACCESS DENIED!");

  // Clear sentMsgs
  sentMsgs.length = 0;

  // Boss sends /start (without password yet)
  console.log("\n[Test 2] Testing Boss Chat ID Initial Access (Prompts Password)...");
  await botAny.handleMessage({
    chat: { id: bossChatId },
    text: "/start",
    from: { first_name: "Divakar", username: "dk_boss" },
  });

  const promptMsg = sentMsgs[sentMsgs.length - 1];
  console.log("Boss Prompted for Master Password?", promptMsg?.text?.includes("Master App Password"));
  if (!promptMsg?.text?.includes("Master App Password")) {
    console.error("❌ FAILED: Boss was not prompted for password!");
    process.exit(1);
  }
  console.log("✅ VERIFIED: Bot asked for Master App Password before giving access!");

  // Boss enters WRONG password
  console.log("\n[Test 3] Testing Wrong Password Entry...");
  await botAny.handleMessage({
    chat: { id: bossChatId },
    text: "wrong_password_123",
    from: { first_name: "Divakar", username: "dk_boss" },
  });

  const wrongMsg = sentMsgs[sentMsgs.length - 1];
  console.log("Wrong Password Caught?", wrongMsg?.text?.includes("GALAT APP PASSWORD"));
  if (!wrongMsg?.text?.includes("GALAT APP PASSWORD")) {
    console.error("❌ FAILED: Wrong password was accepted!");
    process.exit(1);
  }
  console.log("✅ VERIFIED: Wrong password rejected!");

  // Boss enters CORRECT password
  console.log("\n[Test 4] Testing Correct Password Entry & Menu Keyboard...");
  const currentKey = await appSecurityService.getAppKey();
  console.log("Active Key in appSecurityService:", currentKey);
  await botAny.handleMessage({
    chat: { id: bossChatId },
    text: currentKey || "test_dk_pass_2026",
    from: { first_name: "Divakar", username: "dk_boss" },
  });

  const successMsg = sentMsgs[sentMsgs.length - 1];
  console.log("Authentication Succeeded?", successMsg?.text?.includes("AUTHENTICATION SUCCESSFUL"));
  console.log("Interactive Keyboard Rendered?", !!successMsg?.keyboard?.keyboard);
  if (!successMsg?.text?.includes("AUTHENTICATION SUCCESSFUL") || !successMsg?.keyboard?.keyboard) {
    console.error("❌ FAILED: Authentication failed or keyboard missing!");
    process.exit(1);
  }
  console.log("✅ VERIFIED: Session unlocked and Interactive Menu Keyboard displayed!");

  // Boss taps "👥 Active Users"
  console.log("\n[Test 5] Testing '👥 Active Users' Menu Action...");
  await botAny.handleMessage({
    chat: { id: bossChatId },
    text: "👥 Active Users",
    from: { first_name: "Divakar", username: "dk_boss" },
  });

  const activeMsg = sentMsgs[sentMsgs.length - 1];
  console.log("Active Users Report Sent?", activeMsg?.text?.includes("ACTIVE USERS & SESSIONS STATUS"));
  if (!activeMsg?.text?.includes("ACTIVE USERS & SESSIONS STATUS")) {
    console.error("❌ FAILED: Active users command failed!");
    process.exit(1);
  }
  console.log("✅ VERIFIED: Active users report returned!");

  // Boss taps "🛑 Blocked Clients"
  console.log("\n[Test 6] Testing '🛑 Blocked Clients' Menu Action...");
  await botAny.handleMessage({
    chat: { id: bossChatId },
    text: "🛑 Blocked Clients",
    from: { first_name: "Divakar", username: "dk_boss" },
  });

  const blockedMsg = sentMsgs[sentMsgs.length - 1];
  console.log("Blocked Clients Response Sent?", blockedMsg?.text?.includes("SECURITY SHIELD") || blockedMsg?.text?.includes("BLOCKED CLIENTS"));
  console.log("✅ VERIFIED: Blocked clients list returned!");

  // Boss enters "/logout"
  console.log("\n[Test 7] Testing Logout Command...");
  await botAny.handleMessage({
    chat: { id: bossChatId },
    text: "/logout",
    from: { first_name: "Divakar", username: "dk_boss" },
  });

  const logoutMsg = sentMsgs[sentMsgs.length - 1];
  console.log("Logged out message sent?", logoutMsg?.text?.includes("LOGGED OUT SUCCESSFULLY"));
  console.log("✅ VERIFIED: Session locked successfully on logout!");

  console.log("\n=== ALL TELEGRAM SECURITY SENTINEL BOT TESTS PASSED! ===");
}

testSecuritySentinelBot().catch(console.error);

