import { bossRoutineService } from "../src/services/bossRoutineService";

async function testBossRoutine() {
  console.log("=== Testing Boss Routine Service ===");

  // 1. Test Morning Gym Time (e.g. 6:15 AM)
  const testGymDate = new Date("2026-08-27T06:15:00+05:30");
  const gymResult = bossRoutineService.getCurrentHabit(testGymDate);
  console.log("\n[Test 1] 06:15 AM IST:", {
    slotTitle: gymResult.currentSlot.title,
    timeRange: gymResult.currentSlot.timeRangeStr,
    activity: gymResult.currentSlot.activity,
  });

  // 2. Test Lunch Break Time (e.g. 2:00 PM)
  const testLunchDate = new Date("2026-08-27T14:00:00+05:30");
  const lunchResult = bossRoutineService.getCurrentHabit(testLunchDate);
  console.log("\n[Test 2] 02:00 PM IST:", {
    slotTitle: lunchResult.currentSlot.title,
    timeRange: lunchResult.currentSlot.timeRangeStr,
    activity: lunchResult.currentSlot.activity,
  });

  // 3. Test Evening Walk Time (e.g. 7:15 PM)
  const testWalkDate = new Date("2026-08-27T19:15:00+05:30");
  const walkResult = bossRoutineService.getCurrentHabit(testWalkDate);
  console.log("\n[Test 3] 07:15 PM IST:", {
    slotTitle: walkResult.currentSlot.title,
    timeRange: walkResult.currentSlot.timeRangeStr,
    activity: walkResult.currentSlot.activity,
  });

  // 4. Test Night Sleep Time (e.g. 1:30 AM)
  const testSleepDate = new Date("2026-08-27T01:30:00+05:30");
  const sleepResult = bossRoutineService.getCurrentHabit(testSleepDate);
  console.log("\n[Test 4] 01:30 AM IST:", {
    slotTitle: sleepResult.currentSlot.title,
    timeRange: sleepResult.currentSlot.timeRangeStr,
    activity: sleepResult.currentSlot.activity,
  });

  // 5. Test Prompt Context Compilation
  const promptContext = await bossRoutineService.compileRoutinePromptContext(testGymDate);
  console.log("\n[Test 5] Compiled Prompt Context:\n", promptContext);

  // 6. Test Slot Update
  const updateRes = await bossRoutineService.updateRoutineSlot("gym", {
    startTimeStr: "06:00 AM",
    endTimeStr: "08:00 AM",
    activity: "Gym me intense weight training aur cardio workout",
  });
  console.log("\n[Test 6] Slot Update Result:", updateRes);

  console.log("\n=== ALL BOSS ROUTINE TESTS COMPLETED SUCCESSFULLY ===");
}

testBossRoutine().catch(console.error);
