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
    expect(switchBacklogRes.replyText).toContain("SHABASH BOSS! PRESENT TOPIC COMPLETE");
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
    expect(res.replyText).toContain("SHABASH BOSS! PRESENT TOPIC COMPLETE");
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
});
