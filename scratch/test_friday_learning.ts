import { fridayLearningService } from "../src/services/fridayLearningService";
import fs from "fs";
import path from "path";

async function testFridayLearningEngine() {
  console.log("=== Testing Friday Self-Correction & Learning Engine ===");

  // 1. Check Initial Seeded Lessons
  const initialLessons = await fridayLearningService.getAllLessons();
  console.log(`\n[Test 1] Initial Lessons count: ${initialLessons.length}`);
  console.log("Seeded lesson title:", initialLessons[0]?.whatFridayDidWrong);

  // 2. Record a New Lesson from Boss
  const recordRes = await fridayLearningService.recordLesson({
    whatFridayDidWrong: "Said 'Main ek AI hoon, mujhe feelings nahi pata'",
    whatBossTaught: "Boss told Friday: 'Mere se dost jaise baat karo, machine bankar excuse mat do'",
    goldenRule: "Always respond like a living, loyal best friend with empathy and humor; never make AI excuses.",
    triggerContext: "Emotional and feelings questions",
  });
  console.log("\n[Test 2] Record New Lesson Result:", recordRes.success, recordRes.message);

  // 3. Verify All Lessons
  const allLessons = await fridayLearningService.getAllLessons();
  console.log(`\n[Test 3] Updated Lessons count: ${allLessons.length}`);

  // 4. Compile Prompt Context
  const compiledPrompt = await fridayLearningService.compileLearningPromptContext();
  console.log("\n[Test 4] Compiled Wisdom Context:\n", compiledPrompt);

  // 5. Verify server.ts integration
  const serverContent = fs.readFileSync(path.resolve("./server.ts"), "utf-8");
  const checks = [
    "fridayLearningService.compileLearningPromptContext()",
    "record_ai_self_correction",
    "get_ai_learned_lessons",
    "/api/learning/lessons",
    "/api/learning/record",
    "SELF-LEARNING FROM MISTAKES & HUMILITY PROTOCOL",
    "PLAYFUL BANTER, TEASING & LIFE ARCS FOLLOW-UP",
  ];

  for (const check of checks) {
    if (serverContent.includes(check)) {
      console.log(`✅ Verified in server.ts: "${check}"`);
    } else {
      console.error(`❌ Missing in server.ts: "${check}"`);
      process.exit(1);
    }
  }

  console.log("\n=== ALL FRIDAY SELF-LEARNING TESTS COMPLETED SUCCESSFULLY ===");
}

testFridayLearningEngine().catch(console.error);
