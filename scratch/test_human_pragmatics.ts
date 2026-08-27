import fs from "fs";
import path from "path";

function testHumanPragmaticsInServer() {
  console.log("=== Testing 7 Pillars of Human Comprehension in server.ts ===");

  const serverTsContent = fs.readFileSync(path.resolve("./server.ts"), "utf-8");

  const pillars = [
    "MASTER PROTOCOL: THE 7 PILLARS OF TRUE HUMAN COMPREHENSION",
    "INDIRECT NEED DECODER & PRAGMATICS",
    "SELF-CORRECTION & MID-SENTENCE PIVOTS",
    "DESI SLANG, BIHARI & HINGLISH IDIOMS GROUNDING",
    "CONTEXTUAL THREADING & PRONOUN RESOLUTION",
    "PROACTIVE COMPANION CARE & ANTICIPATION",
    "ACOUSTIC PERCEPTION & MOOD REFLECTION",
    "ACTIVE LISTENING & NATURAL HUMAN FLOW",
  ];

  for (const pillar of pillars) {
    if (serverTsContent.includes(pillar)) {
      console.log(`✅ Found Pillar/Protocol: "${pillar}"`);
    } else {
      console.error(`❌ Missing Pillar/Protocol: "${pillar}"`);
      process.exit(1);
    }
  }

  // Check key phrases
  const keyPhrases = [
    "Pet me chuhe kood rahe hain",
    "Aman ko phone lagao... nahi nahi chhoro pehle Rahul ko WhatsApp",
    "Kissa khatam karo",
    "Bohot bawal hai!",
    "Thoda jhol lag raha hai",
    "bossRoutineService.compileRoutinePromptContext",
    "get_boss_daily_routine",
    "update_boss_daily_routine",
  ];

  for (const phrase of keyPhrases) {
    if (serverTsContent.includes(phrase)) {
      console.log(`✅ Found Key Phrase: "${phrase}"`);
    } else {
      console.error(`❌ Missing Key Phrase: "${phrase}"`);
      process.exit(1);
    }
  }

  console.log("\n=== ALL 7 PILLARS OF HUMAN COMPREHENSION VERIFIED SUCCESSFULLY ===");
}

testHumanPragmaticsInServer();
