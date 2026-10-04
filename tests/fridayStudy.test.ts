import { describe, it, expect, beforeEach } from "vitest";
import { fridayStudyService, FIXED_STUDY_SLOTS } from "../src/services/fridayStudyService";

describe("Friday Study — NEET Preparation Routine & Tracker", () => {
  const testGroupJid = "120363012345678901@g.us";
  const testGroupName = "NEET 2026 Study Group";

  beforeEach(() => {
    fridayStudyService.registerStudyGroup(testGroupJid, testGroupName);
  });

  it("should correctly identify study groups by name", () => {
    expect(fridayStudyService.isStudyGroupName("Study Group")).toBe(true);
    expect(fridayStudyService.isStudyGroupName("NEET 2026 Study")).toBe(true);
    expect(fridayStudyService.isStudyGroupName("Boss NEET Prep")).toBe(true);
    expect(fridayStudyService.isStudyGroupName("Daily Padhai Group")).toBe(true);
    expect(fridayStudyService.isStudyGroupName("Friends Chill & Fun")).toBe(false);
  });

  it("should verify complete daily schedule slots and times", () => {
    expect(FIXED_STUDY_SLOTS.length).toBe(14);

    // 04:00 AM: Wake up
    const slot04 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_04_00")!;
    expect(slot04.hour).toBe(4);
    expect(slot04.minute).toBe(0);

    // 05:00 AM: Bio 1
    const slot05 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_05_00")!;
    expect(slot05.hour).toBe(5);
    expect(slot05.minute).toBe(0);
    expect(slot05.subject).toBe("Biology");

    // 06:00 AM: School
    const slot06 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_06_00")!;
    expect(slot06.hour).toBe(6);
    expect(slot06.minute).toBe(0);

    // 02:00 PM: Nap
    const slot14 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_14_00")!;
    expect(slot14.hour).toBe(14);
    expect(slot14.minute).toBe(0);

    // 02:50 PM: Wake up & Call to DK
    const slot1450 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_14_50")!;
    expect(slot1450.hour).toBe(14);
    expect(slot1450.minute).toBe(50);
    expect(slot1450.subject).toBe("Call");

    // 03:00 PM: Fresh up
    const slot1500 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_15_00")!;
    expect(slot1500.hour).toBe(15);
    expect(slot1500.minute).toBe(0);

    // 03:10 PM: Bio 2 (~1.5 hrs)
    const slot1510 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_15_10")!;
    expect(slot1510.hour).toBe(15);
    expect(slot1510.minute).toBe(10);
    expect(slot1510.durationMinutes).toBe(89);

    // 04:39 PM: Bio 2 check-in
    const slot1639 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_16_39")!;
    expect(slot1639.hour).toBe(16);
    expect(slot1639.minute).toBe(39);

    // 04:40 PM: Rest break & Call to DK
    const slot1640 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_16_40")!;
    expect(slot1640.hour).toBe(16);
    expect(slot1640.minute).toBe(40);
    expect(slot1640.subject).toBe("Call");

    // 05:00 PM: Physics (~1.5 hrs)
    const slot1700 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_17_00")!;
    expect(slot1700.hour).toBe(17);
    expect(slot1700.minute).toBe(0);
    expect(slot1700.durationMinutes).toBe(89);

    // 06:29 PM: Physics check-in
    const slot1829 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_18_29")!;
    expect(slot1829.hour).toBe(18);
    expect(slot1829.minute).toBe(29);

    // 06:30 PM: Refreshment break
    const slot1830 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_18_30")!;
    expect(slot1830.hour).toBe(18);
    expect(slot1830.minute).toBe(30);

    // 06:45 PM: Chemistry (~1.5 hrs)
    const slot1845 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_18_45")!;
    expect(slot1845.hour).toBe(18);
    expect(slot1845.minute).toBe(45);
    expect(slot1845.durationMinutes).toBe(85);

    // 08:10 PM: Chemistry wrap-up & scorecard
    const slot2010 = FIXED_STUDY_SLOTS.find((s) => s.id === "slot_20_10")!;
    expect(slot2010.hour).toBe(20);
    expect(slot2010.minute).toBe(10);
  });

  it("should handle @study schedule and display timetable", async () => {
    const res = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study schedule",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(res.handled).toBe(true);
    expect(res.replyText).toContain("DEFAULT NEET TIMETABLE");
    expect(res.replyText).toContain("04:00 AM");
    expect(res.replyText).toContain("Call to DK");
    expect(res.replyText).toContain("08:10 PM");
  });

  it("should set Current and Backlog topics via structured command", async () => {
    const res = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study set bio current: Genetics - DNA Replication backlog: Cell Division 50 MCQs",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(res.handled).toBe(true);
    expect(res.replyText).toContain("Genetics - DNA Replication");
    expect(res.replyText).toContain("Cell Division 50 MCQs");

    const plan = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(plan.biologyAfternoon.currentTopic).toBe("Genetics - DNA Replication");
    expect(plan.biologyAfternoon.backlogTopic).toBe("Cell Division 50 MCQs");
  });

  it("should set Current and Backlog topics via natural Hinglish message", async () => {
    const res = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "aaj physics me current Electrostatics aur backlog Kinematics Graphs",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(res.handled).toBe(true);
    expect(res.replyText).toContain("Electrostatics");
    expect(res.replyText).toContain("Kinematics Graphs");

    const plan = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(plan.physics.currentTopic).toBe("Electrostatics");
    expect(plan.physics.backlogTopic).toBe("Kinematics Graphs");
  });

  it("should mark session done and update scorecard", async () => {
    const res = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "bio done",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(res.handled).toBe(true);
    expect(res.replyText).toContain("COMPLETE");

    const plan = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(plan.biologyAfternoon.status).toBe("done");

    const scorecard = fridayStudyService.formatDailyScorecard(plan);
    expect(scorecard).toContain("Biology (Afternoon)");
    expect(scorecard).toContain("✅ Completed");
  });

  it("should add, view, and clear backlog items", async () => {
    // 1. Add backlog
    const addRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study add backlog chem: Thermodynamics Gibbs Free Energy",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(addRes.handled).toBe(true);
    expect(addRes.replyText).toContain("Thermodynamics Gibbs Free Energy");

    // 2. View backlog
    const viewRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study backlog",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(viewRes.handled).toBe(true);
    expect(viewRes.replyText).toContain("Thermodynamics Gibbs Free Energy");

    // 3. Clear backlog
    const clearRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study clear backlog Thermodynamics",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(clearRes.handled).toBe(true);
    expect(clearRes.replyText).toContain("Backlog Cleared");
  });

  it("should generate slot cards containing Call to DK reminder and topics", async () => {
    const plan = await fridayStudyService.getDailyPlan(testGroupJid);
    plan.biologyAfternoon.currentTopic = "Genetics";
    plan.biologyAfternoon.backlogTopic = "Cell Division";

    // Slot 14:50 (Call to DK)
    const card250 = fridayStudyService.generateSlotCard(FIXED_STUDY_SLOTS[4], plan);
    expect(card250).toContain("DK ko call karne ka time");

    // Slot 15:10 (Bio 2 Core Session)
    const card310 = fridayStudyService.generateSlotCard(FIXED_STUDY_SLOTS[6], plan);
    expect(card310).toContain("Genetics");
    expect(card310).toContain("Cell Division");
    expect(card310).toContain("~1.5 HOURS CORE");

    // Slot 16:40 (Call to DK & Rest)
    const card440 = fridayStudyService.generateSlotCard(FIXED_STUDY_SLOTS[8], plan);
    expect(card440).toContain("DK ko call kar lo");
  });

  it("should handle dual-phase reporting: Present Start -> Present Done to Backlog -> Backlog Done", async () => {
    // 1. Set targets for biology
    await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study set bio current: Biotechnology Principles backlog: Human Reproduction 30 MCQs",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    // 2. Boss reports starting Present topic for Biology
    const startPresentRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "bio current padh raha hu",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(startPresentRes.handled).toBe(true);
    expect(startPresentRes.replyText).toContain("PRESENT TOPIC SHURU");
    expect(startPresentRes.replyText).toContain("Biotechnology Principles");
    expect(startPresentRes.replyText).toContain("current done, ab backlog padh raha hu");

    const planAfterStart = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(planAfterStart.biologyAfternoon.currentStatus).toBe("in_progress");

    // 3. Boss reports finishing Present topic & switching to Backlog
    const switchBacklogRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "bio current done, ab backlog padh raha hu",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(switchBacklogRes.handled).toBe(true);
    expect(switchBacklogRes.replyText).toContain("SHABASH DK! PRESENT TOPIC COMPLETE");
    expect(switchBacklogRes.replyText).toContain("SWITCHED TO BACKLOG");
    expect(switchBacklogRes.replyText).toContain("Human Reproduction 30 MCQs");
    expect(switchBacklogRes.replyText).toContain("backlog done");

    const planAfterSwitch = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(planAfterSwitch.biologyAfternoon.currentStatus).toBe("done");
    expect(planAfterSwitch.biologyAfternoon.backlogStatus).toBe("in_progress");

    // 4. Boss reports finishing Backlog
    const backlogDoneRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "bio backlog done",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(backlogDoneRes.handled).toBe(true);
    expect(backlogDoneRes.replyText).toContain("MISSION ACCOMPLISHED! BACKLOG ALSO COMPLETED");
    expect(backlogDoneRes.replyText).toContain("100% SUCCESS");

    const planAfterAll = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(planAfterAll.biologyAfternoon.currentStatus).toBe("done");
    expect(planAfterAll.biologyAfternoon.backlogStatus).toBe("done");
    expect(planAfterAll.biologyAfternoon.status).toBe("done");
  });

  it("should support direct 'mai backlog padh raha hu' reporting", async () => {
    // Set target for chemistry
    await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study set chem current: Aldehydes & Ketones backlog: Chemical Bonding PYQs",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    // Start present
    await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "chem current padh raha hu",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    // User reports: "mai backlog padh raha hu"
    const res = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "chem mai backlog padh raha hu",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(res.handled).toBe(true);
    expect(res.replyText).toContain("SHABASH DK! PRESENT TOPIC COMPLETE");
    expect(res.replyText).toContain("Chemical Bonding PYQs");

    const plan = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(plan.chemistry.currentStatus).toBe("done");
    expect(plan.chemistry.backlogStatus).toBe("in_progress");

    // Complete backlog
    const doneRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "chem backlog done",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(doneRes.handled).toBe(true);
    expect(doneRes.replyText).toContain("MISSION ACCOMPLISHED");
    const planFinal = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(planFinal.chemistry.status).toBe("done");
  });

  it("should accurately parse three topics from comma, space, newline, numbered, and labelled strings", () => {
    // 1. Comma separated: x, y, z
    expect(fridayStudyService.parseThreeTopics("x, y, z")).toEqual(["x", "y", "z"]);
    expect(fridayStudyService.parseThreeTopics("x,y,z")).toEqual(["x", "y", "z"]);
    expect(fridayStudyService.parseThreeTopics("Genetics, Electrostatics, Thermodynamics")).toEqual([
      "Genetics",
      "Electrostatics",
      "Thermodynamics",
    ]);

    // 2. Space separated: x y z
    expect(fridayStudyService.parseThreeTopics("x y z")).toEqual(["x", "y", "z"]);
    expect(fridayStudyService.parseThreeTopics("Genetics Kinematics Thermodynamics")).toEqual([
      "Genetics",
      "Kinematics",
      "Thermodynamics",
    ]);

    // 3. Numbered: 1. x 2. y 3. z
    expect(fridayStudyService.parseThreeTopics("1. Cell Biology 2. Laws of Motion 3. Solutions")).toEqual([
      "Cell Biology",
      "Laws of Motion",
      "Solutions",
    ]);

    // 4. Newline separated
    expect(fridayStudyService.parseThreeTopics("Biotechnology\nMagnetism\nEquilibrium")).toEqual([
      "Biotechnology",
      "Magnetism",
      "Equilibrium",
    ]);

    // 5. Labelled: bio: ..., phys: ..., chem: ...
    expect(fridayStudyService.parseThreeTopics("bio: Human Physiology, phys: Optics, chem: Organic Chemistry")).toEqual([
      "Human Physiology",
      "Optics",
      "Organic Chemistry",
    ]);

    // 6. Invalid / incomplete inputs
    expect(fridayStudyService.parseThreeTopics("singleTopic")).toBeNull();
    expect(fridayStudyService.parseThreeTopics("two topics")).toBeNull();
    expect(fridayStudyService.parseThreeTopics("four words without comma")).toBeNull();
    expect(fridayStudyService.parseThreeTopics("")).toBeNull();
  });

  it("should execute 2:00 PM interactive flow: Running Chapters (x, y, z) -> Backlog Chapters (a, b, c)", async () => {
    // 1. 2:00 PM slot card asks the questions and sets setupState to awaiting_current
    const planInitial = await fridayStudyService.getDailyPlan(testGroupJid);
    const card2PM = fridayStudyService.generateSlotCard(FIXED_STUDY_SLOTS[3], planInitial); // slot_14_00
    expect(card2PM).toContain("RUNNING CHAPTERS SETUP");
    expect(card2PM).toContain("Running Biology Chapter");
    expect(card2PM).toContain("Running Physics Chapter");
    expect(card2PM).toContain("Running Chemistry Chapter");
    expect(card2PM).toContain("x, y, z");

    expect(planInitial.setupState).toBe("awaiting_current");

    // 2. User answers with comma-separated running chapters: "Genetics, Electrostatics, Thermodynamics"
    const currentReplyRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "Genetics, Electrostatics, Thermodynamics",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(currentReplyRes.handled).toBe(true);
    expect(currentReplyRes.replyText).toContain("Running Chapters Note Ho Gaye");
    expect(currentReplyRes.replyText).toContain("Genetics");
    expect(currentReplyRes.replyText).toContain("Electrostatics");
    expect(currentReplyRes.replyText).toContain("Thermodynamics");
    expect(currentReplyRes.replyText).toContain("RUNNING BACKLOG CHAPTERS");

    const planAfterCurrent = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(planAfterCurrent.setupState).toBe("awaiting_backlog");
    expect(planAfterCurrent.pendingCurrentTopics).toEqual({
      biology: "Genetics",
      physics: "Electrostatics",
      chemistry: "Thermodynamics",
    });

    // 3. User answers with space-separated backlog chapters: "CellDivision Kinematics Solutions"
    const backlogReplyRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "CellDivision Kinematics Solutions",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(backlogReplyRes.handled).toBe(true);
    expect(backlogReplyRes.replyText).toContain("AWESOME! AAJ KA NEET TARGET 100% SET HO GAYA");
    expect(backlogReplyRes.replyText).toContain("Genetics");
    expect(backlogReplyRes.replyText).toContain("CellDivision");
    expect(backlogReplyRes.replyText).toContain("Kinematics");
    expect(backlogReplyRes.replyText).toContain("Solutions");
    expect(backlogReplyRes.replyText).toContain("power nap le lo");

    // 4. Verify that DayStudyPlan now has both running and backlog topics saved
    const planFinal = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(planFinal.setupState).toBe("idle");
    expect(planFinal.pendingCurrentTopics).toBeUndefined();

    expect(planFinal.biologyAfternoon.currentTopic).toBe("Genetics");
    expect(planFinal.biologyAfternoon.backlogTopic).toBe("CellDivision");

    expect(planFinal.physics.currentTopic).toBe("Electrostatics");
    expect(planFinal.physics.backlogTopic).toBe("Kinematics");

    expect(planFinal.chemistry.currentTopic).toBe("Thermodynamics");
    expect(planFinal.chemistry.backlogTopic).toBe("Solutions");
  });

  it("should allow manual trigger via @study ask and cancellation via @study reset", async () => {
    // 1. Manual trigger
    const askRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study ask",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(askRes.handled).toBe(true);
    expect(askRes.replyText).toContain("RUNNING CHAPTERS SETUP");

    const plan = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(plan.setupState).toBe("awaiting_current");

    // 2. Cancel
    const cancelRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study reset",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(cancelRes.handled).toBe(true);
    expect(cancelRes.replyText).toContain("reset ho gaya hai");

    const planAfterReset = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(planAfterReset.setupState).toBe("idle");
  });

  it("should keep shared class chapters common while tracking individual attendance for every student", async () => {
    // 1. Set common class curriculum (same for everyone in the batch)
    await fridayStudyService.setSessionTopics(
      testGroupJid,
      "physics",
      "Electrostatics & Gauss Law",
      "Kinematics Graph Numericals"
    );

    // 2. Student 1 (DK Boss) starts current topic in Physics
    const dkRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "physics current padh raha hu",
      senderName: "DK",
      senderPhone: "919876543210",
      senderJid: "919876543210@s.whatsapp.net",
      isOwner: true,
    });

    expect(dkRes.handled).toBe(true);
    expect(dkRes.replyText).toContain("⭐ DK");
    expect(dkRes.replyText).toContain("Electrostatics & Gauss Law");

    // 3. Student 2 (Amit Kumar) does a direct attendance check-in
    const amitCheckinRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "present",
      senderName: "Amit Kumar",
      senderPhone: "919811111111",
      senderJid: "919811111111@s.whatsapp.net",
      isOwner: false,
    });

    expect(amitCheckinRes.handled).toBe(true);
    expect(amitCheckinRes.replyText).toContain("ATTENDANCE REGISTERED");
    expect(amitCheckinRes.replyText).toContain("Amit Kumar");
    expect(amitCheckinRes.replyText).toContain("Common Class Target");

    // 4. Student 3 (Rahul Sharma) progresses through Current -> Backlog -> Done in Physics
    const rahulStartRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "physics current padh raha hu",
      senderName: "Rahul Sharma",
      senderPhone: "919822222222",
      senderJid: "919822222222@s.whatsapp.net",
      isOwner: false,
    });
    expect(rahulStartRes.handled).toBe(true);
    expect(rahulStartRes.replyText).toContain("Rahul Sharma");

    const rahulSwitchRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "physics current done, ab backlog padh raha hu",
      senderName: "Rahul Sharma",
      senderPhone: "919822222222",
      senderJid: "919822222222@s.whatsapp.net",
      isOwner: false,
    });
    expect(rahulSwitchRes.handled).toBe(true);
    expect(rahulSwitchRes.replyText).toContain("RAHUL SHARMA");
    expect(rahulSwitchRes.replyText).toContain("SWITCHED TO BACKLOG");
    expect(rahulSwitchRes.replyText).toContain("Kinematics Graph Numericals");

    const rahulDoneRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "physics backlog done",
      senderName: "Rahul Sharma",
      senderPhone: "919822222222",
      senderJid: "919822222222@s.whatsapp.net",
      isOwner: false,
    });
    expect(rahulDoneRes.handled).toBe(true);
    expect(rahulDoneRes.replyText).toContain("Rahul Sharma");
    expect(rahulDoneRes.replyText).toContain("100% SUCCESS");

    // 5. Verify DayStudyPlan has tracked all 3 members individually
    const plan = await fridayStudyService.getDailyPlan(testGroupJid);
    expect(plan.membersAttendance).toBeDefined();

    const dkKey = fridayStudyService.getUserKey({ senderName: "DK", senderPhone: "919876543210" });
    const amitKey = fridayStudyService.getUserKey({ senderName: "Amit Kumar", senderPhone: "919811111111" });
    const rahulKey = fridayStudyService.getUserKey({ senderName: "Rahul Sharma", senderPhone: "919822222222" });

    expect(plan.membersAttendance![dkKey]).toBeDefined();
    expect(plan.membersAttendance![dkKey].userName).toBe("DK");
    expect(plan.membersAttendance![dkKey].isOwner).toBe(true);

    const activeSessionKey = fridayStudyService.getActiveOrRelevantSession().key;
    expect(plan.membersAttendance![amitKey]).toBeDefined();
    expect(plan.membersAttendance![amitKey].userName).toBe("Amit Kumar");
    expect(plan.membersAttendance![amitKey].sessions[activeSessionKey].attended).toBe(true);

    expect(plan.membersAttendance![rahulKey]).toBeDefined();
    expect(plan.membersAttendance![rahulKey].userName).toBe("Rahul Sharma");
    expect(plan.membersAttendance![rahulKey].sessions.physics.status).toBe("done");
    expect(plan.membersAttendance![rahulKey].sessions.physics.currentStatus).toBe("done");
    expect(plan.membersAttendance![rahulKey].sessions.physics.backlogStatus).toBe("done");
    expect(plan.membersAttendance![rahulKey].totalCompletedCount).toBe(1);

    // 6. Test @study attendance register output
    const attendanceRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "@study attendance",
      senderName: "DK",
      senderPhone: "919876543210",
      isOwner: true,
    });

    expect(attendanceRes.handled).toBe(true);
    expect(attendanceRes.replyText).toContain("BATCH ATTENDANCE REGISTER");
    expect(attendanceRes.replyText).toContain("⭐ DK");
    expect(attendanceRes.replyText).toContain("Amit Kumar");
    expect(attendanceRes.replyText).toContain("Rahul Sharma");
    expect(attendanceRes.replyText).toContain("Common Class Syllabus");
    expect(attendanceRes.replyText).toContain("Electrostatics & Gauss Law");

    // 7. Test formatDailyScorecard includes the batch leaderboard
    const scorecard = fridayStudyService.formatDailyScorecard(plan);
    expect(scorecard).toContain("Batch Leaderboard & Attendance");
    expect(scorecard).toContain("Rahul Sharma");
  });

  it("should support direct attendance check-ins like 'present', 'p', 'mai aa gaya'", async () => {
    const pRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "p",
      senderName: "Pooja",
      senderPhone: "919833333333",
      isOwner: false,
    });
    expect(pRes.handled).toBe(true);
    expect(pRes.replyText).toContain("ATTENDANCE REGISTERED");
    expect(pRes.replyText).toContain("Pooja");

    const aagayaRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: testGroupJid,
      groupName: testGroupName,
      text: "mai aa gaya",
      senderName: "Vikas",
      senderPhone: "919844444444",
      isOwner: false,
    });
    expect(aagayaRes.handled).toBe(true);
    expect(aagayaRes.replyText).toContain("ATTENDANCE REGISTERED");
    expect(aagayaRes.replyText).toContain("Vikas");
  });

  it("should detect study group activation triggers correctly", () => {
    expect(fridayStudyService.isStudyGroupActivationRequest("this is study group")).toBe(true);
    expect(fridayStudyService.isStudyGroupActivationRequest("this is a study group")).toBe(true);
    expect(fridayStudyService.isStudyGroupActivationRequest("ye study group hai")).toBe(true);
    expect(fridayStudyService.isStudyGroupActivationRequest("ye study group h")).toBe(true);
    expect(fridayStudyService.isStudyGroupActivationRequest("is group ko study group bana do")).toBe(true);
    expect(fridayStudyService.isStudyGroupActivationRequest("@study activate")).toBe(true);
    expect(fridayStudyService.isStudyGroupActivationRequest("kuch aur general baat")).toBe(false);
  });

  it("should handle 'this is study group' trigger with wait confirmation message and send request to Boss", async () => {
    const rawGroupJid = "120363999999999999@g.us";
    const rawGroupName = "Class 12 Batch";

    const res = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: rawGroupJid,
      groupName: rawGroupName,
      text: "this is study group",
      senderName: "Aman",
      senderPhone: "919811111111",
      isOwner: false,
    });

    expect(res.handled).toBe(true);
    expect(res.replyText).toContain("wait for confirmation from Boss");
    expect(fridayStudyService.hasPendingApproval()).toBe(true);

    const pending = fridayStudyService.getPendingApprovals();
    expect(pending.length).toBeGreaterThan(0);
    const item = pending.find((p) => p.groupJid === rawGroupJid);
    expect(item).toBeDefined();
    expect(item?.groupName).toBe("Class 12 Batch");
    expect(item?.requesterName).toBe("Aman");
  });

  it("should approve pending study group when Boss approves, notify group with mentor announcement, and enforce no-boss policy", async () => {
    const rawGroupJid = `120363888888_${Date.now()}@g.us`;
    const rawGroupName = "Target Batch 2026";

    // 1. Someone asks to declare it a study group
    const initRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: rawGroupJid,
      groupName: rawGroupName,
      text: "ye study group hai",
      senderName: "Pooja",
      senderPhone: "919822222222",
      isOwner: false,
    });
    expect(initRes.handled).toBe(true);
    expect(initRes.replyText).toContain("wait for confirmation from Boss");

    // 2. Boss approves
    const approveRes = await fridayStudyService.approveStudyGroup(rawGroupJid);
    expect(approveRes).not.toBeNull();
    expect(approveRes?.success).toBe(true);
    expect(approveRes?.announcement).toContain("Approved, now I am your mentor");
    expect(approveRes?.announcement).toContain("No Boss Policy");
    expect(approveRes?.announcement).toContain("No Wake-Word Needed");
    expect(approveRes?.bossConfirmation).toContain("ko NEET Study Group approve kar diya gaya hai");

    // 3. Now verify group is marked as approved study group
    expect(fridayStudyService.isApprovedStudyGroup(rawGroupJid)).toBe(true);
    expect(fridayStudyService.isStudyGroup(rawGroupJid, rawGroupName)).toBe(true);
  });

  it("should reply to all doubts/questions in study group WITHOUT requiring 'Friday' wake-word, acting as NEET mentor", async () => {
    const studyGroupJid = "120363777777777777@g.us";
    const studyGroupName = "NEET Biology Squad Study";

    // In a study group, a student asks a direct academic question without mentioning "Friday"
    const doubtRes = await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: studyGroupJid,
      groupName: studyGroupName,
      text: "cell wall kis cheez ki bani hoti hai plants me?",
      senderName: "Rohan",
      senderPhone: "919833333333",
      isOwner: false,
    });

    expect(doubtRes.handled).toBe(true);
    expect(doubtRes.replyText).toBeDefined();
    expect(doubtRes.replyText?.length).toBeGreaterThan(10);
    // Strict zero Boss policy: response should never call anyone "Boss"
    expect(doubtRes.replyText).not.toContain("Boss");
  });

  it("should handle Boss rejection of a pending study group request", async () => {
    const rawGroupJid = "120363666666666666@g.us";
    const rawGroupName = "Timepass Group";

    // Request activation
    await fridayStudyService.handleStudyGroupMessage({
      sock: null,
      groupJid: rawGroupJid,
      groupName: rawGroupName,
      text: "is group ko study group bana do",
      senderName: "Unknown",
      senderPhone: "919844444444",
      isOwner: false,
    });

    // Boss rejects
    const rejectRes = await fridayStudyService.rejectStudyGroup(rawGroupJid);
    expect(rejectRes).not.toBeNull();
    expect(rejectRes?.success).toBe(true);
    expect(rejectRes?.announcement).toContain("Study Group Request Not Approved");
    expect(rejectRes?.bossConfirmation).toContain("request reject kar di gayi hai");
    expect(fridayStudyService.isApprovedStudyGroup(rawGroupJid)).toBe(false);
  });
});
