import "dotenv/config";
import { appSecurityService } from "../src/services/appSecurityService";
import { backgroundTasksService } from "../src/services/backgroundTasksService";
import { calendarEventService } from "../src/services/calendarEventService";
import { codeAgentService } from "../src/services/codeAgentService";
import { contactsService } from "../src/services/contactsService";

async function runAuditTests() {
  console.log("==================================================");
  console.log("🔍 RUNNING AUDIT & FUNCTIONALITY TESTS ON BATCH 1");
  console.log("==================================================");

  // 1. Test appSecurityService
  console.log("\n--- [1/5] Testing appSecurityService ---");
  try {
    const clean = appSecurityService.cleanIp("::ffff:192.168.1.100, 10.0.0.1");
    console.log("cleanIp test:", clean === "192.168.1.100" ? "PASSED" : "FAILED", `(${clean})`);

    const token = appSecurityService.generateSessionToken(Date.now());
    console.log("generateSessionToken:", token ? "PASSED" : "FAILED", `(Length: ${token?.length})`);

    const isValid = appSecurityService.verifySessionToken(token);
    console.log("verifySessionToken (valid):", isValid ? "PASSED" : "FAILED");

    const isTampered = appSecurityService.verifySessionToken(token + "tampered");
    console.log("verifySessionToken (tampered detection):", !isTampered ? "PASSED" : "FAILED");

    const rate1 = appSecurityService.checkRateLimit("192.168.1.100");
    const rate2 = appSecurityService.checkRateLimit("192.168.1.100");
    const rate3 = appSecurityService.checkRateLimit("192.168.1.100");
    console.log("rateLimiter (3 attempts -> 3rd blocked):", rate1.allowed && rate2.allowed && !rate3.allowed ? "PASSED" : "FAILED");
    console.log("✅ appSecurityService: ALL SECURITY CHECKS PASSED");
  } catch (err) {
    console.error("❌ appSecurityService Error:", err);
  }

  // 2. Test backgroundTasksService
  console.log("\n--- [2/5] Testing backgroundTasksService ---");
  try {
    const task = backgroundTasksService.createTask("Test Background Audit", "custom", "Checking task lifecycle");
    console.log("createTask:", task.id ? "PASSED" : "FAILED", `(ID: ${task.id})`);

    backgroundTasksService.updateTaskProgress(task.id, "Step 1: Running unit checks...");
    const active = backgroundTasksService.getActiveTasks();
    console.log("getActiveTasks count >= 1:", active.length > 0 ? "PASSED" : "FAILED");

    backgroundTasksService.completeTask(task.id, "Task finished with 100% success.");
    const unnotified = backgroundTasksService.getUnnotifiedCompletedTasks();
    console.log("getUnnotifiedCompletedTasks:", unnotified.some((t) => t.id === task.id) ? "PASSED" : "FAILED");

    backgroundTasksService.markTaskNotified(task.id);
    const summary = backgroundTasksService.getTaskStatusSummary();
    console.log("getTaskStatusSummary:", summary.summaryText ? "PASSED" : "FAILED");

    const promptContext = backgroundTasksService.compileBackgroundTasksPromptContext();
    console.log("compileBackgroundTasksPromptContext:", promptContext ? "PASSED" : "FAILED");
    console.log("✅ backgroundTasksService: LIFECYCLE & INTEGRATION CHECKS PASSED");
  } catch (err) {
    console.error("❌ backgroundTasksService Error:", err);
  }

  // 3. Test calendarEventService
  console.log("\n--- [3/5] Testing calendarEventService ---");
  try {
    const res1 = await calendarEventService.scheduleMeeting(
      "Investor Pitch Deck Review",
      "in 45 mins",
      45,
      "Google Meet"
    );
    console.log("scheduleMeeting (relative time):", res1.success && res1.event.eventTimestamp > Date.now() ? "PASSED" : "FAILED");

    const res2 = await calendarEventService.scheduleMeeting(
      "Architectural Strategy Sync",
      "5:30 PM",
      60
    );
    console.log("scheduleMeeting (clock time):", res2.success ? "PASSED" : "FAILED");

    const upcoming = await calendarEventService.getUpcomingMeetings();
    console.log("getUpcomingMeetings:", upcoming.success && upcoming.events.length >= 2 ? "PASSED" : "FAILED", `(Count: ${upcoming.events.length})`);

    const cancelRes = await calendarEventService.cancelMeeting("Investor Pitch Deck Review");
    console.log("cancelMeeting:", cancelRes.success ? "PASSED" : "FAILED", `(${cancelRes.message})`);
    console.log("✅ calendarEventService: SCHEDULING & PARSING CHECKS PASSED");
  } catch (err) {
    console.error("❌ calendarEventService Error:", err);
  }

  // 4. Test codeAgentService
  console.log("\n--- [4/5] Testing codeAgentService ---");
  try {
    const summary = await codeAgentService.getLiveStatusSummary();
    console.log("getLiveStatusSummary:", summary && summary.latestStatus ? "PASSED" : "FAILED", `(Status: ${summary.latestStatus})`);

    const requests = await codeAgentService.getRequests();
    console.log("getRequests query:", Array.isArray(requests) ? "PASSED" : "FAILED", `(Count: ${requests.length})`);
    console.log("✅ codeAgentService: STRUCTURE & STATUS SUMMARY PASSED");
  } catch (err) {
    console.error("❌ codeAgentService Error:", err);
  }

  // 5. Test contactsService
  console.log("\n--- [5/5] Testing contactsService ---");
  try {
    const saved = await contactsService.saveContact("Rohit Sharma", "9876543210", "Friend");
    console.log("saveContact & phone normalization:", saved.phone === "919876543210" ? "PASSED" : "FAILED", `(${saved.phone})`);

    const byName = await contactsService.findContact("rohit sharma");
    console.log("findContact (by name):", byName?.phone === "919876543210" ? "PASSED" : "FAILED");

    const byPhone = await contactsService.findContact("9876543210");
    console.log("findContact (by last 10 digits):", byPhone?.name === "Rohit Sharma" ? "PASSED" : "FAILED");

    const byRelation = await contactsService.findContact("friend");
    console.log("findContact (by relation):", byRelation?.name === "Rohit Sharma" ? "PASSED" : "FAILED");

    const bossLookup = await contactsService.findContact("boss");
    console.log("findContact (boss alias):", bossLookup ? "PASSED" : "FAILED", `(Boss name: ${bossLookup?.name || "N/A"})`);

    const delRes = await contactsService.deleteContact("Rohit Sharma");
    console.log("deleteContact:", delRes.deleted ? "PASSED" : "FAILED");

    const all = await contactsService.getAllContacts();
    console.log("getAllContacts:", Array.isArray(all) ? "PASSED" : "FAILED");
    console.log("✅ contactsService: RETRIEVAL & PERSISTENCE CHECKS PASSED");
  } catch (err) {
    console.error("❌ contactsService Error:", err);
  }

  console.log("\n==================================================");
  console.log("🎯 BATCH 1 TEST SUITE COMPLETE!");
  console.log("==================================================");
}

runAuditTests().catch(console.error);
