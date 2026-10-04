/**
 * Friday Study Service — NEET Routine & Backlog Tracker
 *
 * Designed for WhatsApp study groups (where groupName includes "study").
 * Automates the fixed daily study schedule (04:00 AM - 08:10 PM IST):
 *  - 04:00 AM: Wake up, bathing, ready for school
 *  - 05:00 - 06:00 AM: Session 1: Biology (1 hr)
 *  - 06:00 AM - 02:00 PM: School Time (Quiet mode)
 *  - 02:00 - 02:49 PM: Nap / Rest (49 mins)
 *  - 02:50 PM: Wake up & Call to DK alert
 *  - 03:00 - 03:10 PM: Fresh up (10 mins)
 *  - 03:10 - 04:39 PM: Session 2: Biology (~1.5 hrs: Current + Backlog)
 *  - 04:39 PM: Bio Session 2 Check-in
 *  - 04:40 - 05:00 PM: Rest break & Call to DK alert
 *  - 05:00 - 06:29 PM: Session 3: Physics (~1.5 hrs: Current + Backlog)
 *  - 06:29 PM: Physics Session 3 Check-in
 *  - 06:30 - 06:44 PM: Short Break (15 mins)
 *  - 06:45 - 08:10 PM: Session 4: Chemistry (~1.5 hrs: Current + Backlog)
 *  - 08:10 PM: Chemistry Session 4 Check-in & Daily NEET Wrap-up Scorecard
 */

import { db } from "./firebaseAdmin";

export interface StudySlot {
  id: string;
  hour: number;        // 0 - 23 IST
  minute: number;      // 0 - 59 IST
  title: string;
  subject: "Biology" | "Physics" | "Chemistry" | "School" | "Rest" | "Call" | "Routine" | "Wrapup";
  type: "session_start" | "session_end" | "alert" | "routine" | "break";
  durationMinutes?: number;
  timeRangeStr: string;
}

export interface SubjectTopics {
  currentTopic: string;
  backlogTopic: string;
  currentStatus: "pending" | "in_progress" | "done";
  currentStartedAt?: number;
  currentCompletedAt?: number;
  currentDurationMinutes?: number;
  backlogStatus: "pending" | "in_progress" | "done";
  backlogStartedAt?: number;
  backlogCompletedAt?: number;
  backlogDurationMinutes?: number;
  status: "pending" | "in_progress" | "done" | "missed";
  notes?: string;
  updatedAt?: number;
}

export interface MemberSessionProgress {
  attended: boolean;
  currentStatus: "pending" | "in_progress" | "done";
  currentStartedAt?: number;
  currentCompletedAt?: number;
  currentDurationMinutes?: number;
  backlogStatus: "pending" | "in_progress" | "done";
  backlogStartedAt?: number;
  backlogCompletedAt?: number;
  backlogDurationMinutes?: number;
  status: "pending" | "in_progress" | "done";
  lastReportedAt: number;
  lastAction?: string;
}

export interface MemberAttendance {
  userKey: string;
  userName: string;
  userPhone?: string;
  isOwner?: boolean;
  sessions: {
    bio1: MemberSessionProgress;
    bio2: MemberSessionProgress;
    physics: MemberSessionProgress;
    chem: MemberSessionProgress;
  };
  totalCompletedCount: number;
  updatedAt: number;
}

export interface MemberInfo {
  senderName: string;
  senderPhone?: string;
  senderJid?: string;
  isOwner?: boolean;
}

export interface DayStudyPlan {
  dateStr: string;     // YYYY-MM-DD (IST)
  groupId: string;     // Target group JID
  groupName?: string;
  biologyMorning: SubjectTopics;   // Session 1 (05:00 - 06:00) — COMMON CLASS SYLLABUS
  biologyAfternoon: SubjectTopics; // Session 2 (03:10 - 04:39) — COMMON CLASS SYLLABUS
  physics: SubjectTopics;          // Session 3 (05:00 - 06:29) — COMMON CLASS SYLLABUS
  chemistry: SubjectTopics;        // Session 4 (06:45 - 08:10) — COMMON CLASS SYLLABUS
  dispatchedSlots: string[];       // slot ids dispatched today
  setupState?: "idle" | "awaiting_current" | "awaiting_backlog";
  pendingCurrentTopics?: {
    biology: string;
    physics: string;
    chemistry: string;
  };
  setupPromptSentAt?: number;
  membersAttendance?: Record<string, MemberAttendance>; // INDIVIDUAL STUDENT ATTENDANCE REGISTER
  createdAt: number;
  updatedAt: number;
}

export interface NeetBacklogItem {
  id: string;
  subject: "Biology" | "Physics" | "Chemistry";
  topic: string;
  status: "pending" | "done";
  addedAt: number;
  completedAt?: number;
}

// ── Daily Default Schedule Slots ───────────────────────────────────────────
export const FIXED_STUDY_SLOTS: StudySlot[] = [
  {
    id: "slot_04_00",
    hour: 4,
    minute: 0,
    title: "Wake up, Bathing & School Prep",
    subject: "Routine",
    type: "routine",
    durationMinutes: 60,
    timeRangeStr: "04:00 AM - 05:00 AM",
  },
  {
    id: "slot_05_00",
    hour: 5,
    minute: 0,
    title: "Session 1: Biology (Morning Power Hour)",
    subject: "Biology",
    type: "session_start",
    durationMinutes: 60,
    timeRangeStr: "05:00 AM - 06:00 AM",
  },
  {
    id: "slot_06_00",
    hour: 6,
    minute: 0,
    title: "School Time Departure",
    subject: "School",
    type: "routine",
    durationMinutes: 480,
    timeRangeStr: "06:00 AM - 02:00 PM",
  },
  {
    id: "slot_14_00",
    hour: 14,
    minute: 0,
    title: "School Over & Power Nap",
    subject: "Rest",
    type: "break",
    durationMinutes: 49,
    timeRangeStr: "02:00 PM - 02:49 PM",
  },
  {
    id: "slot_14_50",
    hour: 14,
    minute: 50,
    title: "Wake Up & Call to DK",
    subject: "Call",
    type: "alert",
    timeRangeStr: "02:50 PM",
  },
  {
    id: "slot_15_00",
    hour: 15,
    minute: 0,
    title: "10-Min Quick Fresh Up",
    subject: "Routine",
    type: "routine",
    durationMinutes: 10,
    timeRangeStr: "03:00 PM - 03:10 PM",
  },
  {
    id: "slot_15_10",
    hour: 15,
    minute: 10,
    title: "Session 2: Biology (~1.5 Hours Core Session)",
    subject: "Biology",
    type: "session_start",
    durationMinutes: 89,
    timeRangeStr: "03:10 PM - 04:39 PM",
  },
  {
    id: "slot_16_39",
    hour: 16,
    minute: 39,
    title: "Biology Session 2 Check-in",
    subject: "Biology",
    type: "session_end",
    timeRangeStr: "04:39 PM",
  },
  {
    id: "slot_16_40",
    hour: 16,
    minute: 40,
    title: "Rest Break & Call to DK",
    subject: "Call",
    type: "break",
    durationMinutes: 20,
    timeRangeStr: "04:40 PM - 05:00 PM",
  },
  {
    id: "slot_17_00",
    hour: 17,
    minute: 0,
    title: "Session 3: Physics (~1.5 Hours Core Session)",
    subject: "Physics",
    type: "session_start",
    durationMinutes: 89,
    timeRangeStr: "05:00 PM - 06:29 PM",
  },
  {
    id: "slot_18_29",
    hour: 18,
    minute: 29,
    title: "Physics Session 3 Check-in",
    subject: "Physics",
    type: "session_end",
    timeRangeStr: "06:29 PM",
  },
  {
    id: "slot_18_30",
    hour: 18,
    minute: 30,
    title: "15-Min Refreshment Break",
    subject: "Rest",
    type: "break",
    durationMinutes: 14,
    timeRangeStr: "06:30 PM - 06:44 PM",
  },
  {
    id: "slot_18_45",
    hour: 18,
    minute: 45,
    title: "Session 4: Chemistry (~1.5 Hours Core Session)",
    subject: "Chemistry",
    type: "session_start",
    durationMinutes: 85,
    timeRangeStr: "06:45 PM - 08:10 PM",
  },
  {
    id: "slot_20_10",
    hour: 20,
    minute: 10,
    title: "Chemistry Wrap-up & Daily NEET Wrap-up Scorecard",
    subject: "Wrapup",
    type: "session_end",
    timeRangeStr: "08:10 PM",
  },
];

const sessionsCol = () => db?.collection("friday_study_sessions");
const backlogsCol = () => db?.collection("friday_study_backlogs");
const approvedGroupsCol = () => db?.collection("friday_study_approved_groups");

export function parseThreeTopics(text: string): [string, string, string] | null {
  if (!text) return null;
  const raw = text.trim();

  // Strip common leading phrases
  const cleaned = raw
    .replace(/^(?:aaj\s+ke\s+(?:running\s+)?chapters?\s+(?:hai|hain)?[:\-]?\s*)/i, "")
    .replace(/^(?:running\s+chapters?\s*[:\-]?\s*)/i, "")
    .replace(/^(?:(?:running\s+)?backlogs?\s*[:\-]?\s*)/i, "")
    .trim();

  // 1. Labelled format: bio: ..., physics: ..., chem: ...
  const labelMatch = cleaned.match(
    /(?:(?:1\.|1\)|\b(?:bio|biology)\b\s*[:\-])\s*)([^,\n]+?)(?:,|\n)\s*(?:(?:2\.|2\)|\b(?:phys|physics)\b\s*[:\-])\s*)([^,\n]+?)(?:,|\n)\s*(?:(?:3\.|3\)|\b(?:chem|chemistry)\b\s*[:\-])\s*)(.+)$/i
  );
  if (labelMatch) {
    const t1 = labelMatch[1].trim();
    const t2 = labelMatch[2].trim();
    const t3 = labelMatch[3].trim();
    if (t1 && t2 && t3) return [t1, t2, t3];
  }

  // 2. Comma, semicolon, or slash separated: e.g. "x, y, z" or "x,y,z"
  if (cleaned.includes(",") || cleaned.includes(";") || cleaned.includes("/")) {
    const delimiter = cleaned.includes(",") ? "," : cleaned.includes(";") ? ";" : "/";
    const parts = cleaned
      .split(delimiter)
      .map((p) => p.replace(/^\s*(?:[1-3][.)\-:]|\b(?:bio(?:logy)?|phys(?:ics)?|chem(?:istry)?)\b\s*[:\-])\s*/i, "").trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  // 3. Newline separated
  const lines = cleaned
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[1-3][.)\-:]|\b(?:bio(?:logy)?|phys(?:ics)?|chem(?:istry)?)\b\s*[:\-])\s*/i, "").trim())
    .filter(Boolean);
  if (lines.length >= 3) {
    return [lines[0], lines[1], lines[2]];
  }

  // 4. Dash or pipe separated (e.g. x - y - z or x | y | z)
  if (cleaned.includes(" - ") || cleaned.includes(" | ")) {
    const parts = cleaned
      .split(/\s*[-|]\s*/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      return [parts[0], parts[1], parts[2]];
    }
  }

  // 5. Numbered in single line: e.g. "1. x 2. y 3. z" or "1) x 2) y 3) z"
  const numberedMatch = cleaned.match(/1[.)\s]+(.+?)\s+2[.)\s]+(.+?)\s+3[.)\s]+(.+)$/i);
  if (numberedMatch) {
    return [numberedMatch[1].trim(), numberedMatch[2].trim(), numberedMatch[3].trim()];
  }

  // 6. Space separated: e.g. "x y z" or "Genetics Kinematics Thermodynamics"
  const spaceTokens = cleaned.split(/\s+/).filter(Boolean);
  if (spaceTokens.length === 3) {
    return [spaceTokens[0], spaceTokens[1], spaceTokens[2]];
  }

  return null;
}

export class FridayStudyService {
  private sock: any = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isChecking = false;
  private inMemoryPlans: Map<string, DayStudyPlan> = new Map();
  private inMemoryBacklogs: NeetBacklogItem[] = [];
  private lastTriggeredMinuteKey: string = "";
  private cachedStudyGroups: Set<string> = new Set();
  private approvedStudyGroups: Set<string> = new Set();
  private pendingApprovals: Map<
    string,
    {
      groupJid: string;
      groupName: string;
      requesterName: string;
      requesterPhone: string;
      requestedAt: number;
    }
  > = new Map();
  private latestPendingApprovalGroupJid: string | null = null;

  constructor() {
    this.preloadBacklogs().catch(() => {});
    this.loadApprovedGroups().catch(() => {});
  }

  public setSocket(sock: any) {
    this.sock = sock;
    if (sock) {
      this.refreshStudyGroupsCache().catch(() => {});
    }
  }

  public start(sock?: any) {
    if (sock) this.setSocket(sock);
    if (this.intervalHandle) return;

    // Check schedule every 30 seconds
    this.intervalHandle = setInterval(() => {
      this.checkScheduleTicker().catch((e) => {
        console.warn("[FridayStudy] Error in checkScheduleTicker:", e?.message || e);
      });
    }, 30 * 1000);

    console.log("[FridayStudy] Service active — polling every 30s for study slots.");
    this.checkScheduleTicker().catch(() => {});
  }

  public stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
      console.log("[FridayStudy] Service stopped.");
    }
  }

  // ── IST Helper ───────────────────────────────────────────────────────────
  public getISTNow(): { dateStr: string; hour: number; minute: number; timeStr: string } {
    const now = new Date();
    const dateStr = now.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const timeStr = now.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    }).formatToParts(now);

    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value || "0", 10);

    return { dateStr, hour, minute, timeStr };
  }

  // ── Study Group Discovery & Approval ─────────────────────────────────────
  public isStudyGroupName(name: string): boolean {
    if (!name) return false;
    return /\bstudy\b/i.test(name) || /neet/i.test(name) || /padhai/i.test(name);
  }

  public isApprovedStudyGroup(groupJid: string): boolean {
    if (!groupJid) return false;
    return this.approvedStudyGroups.has(groupJid);
  }

  public isStudyGroup(groupJid: string, groupName?: string): boolean {
    return (groupName ? this.isStudyGroupName(groupName) : false) || this.isApprovedStudyGroup(groupJid);
  }

  public hasPendingApproval(): boolean {
    return this.pendingApprovals.size > 0;
  }

  public getPendingApprovals() {
    return Array.from(this.pendingApprovals.values());
  }

  public isStudyGroupActivationRequest(text: string): boolean {
    if (!text) return false;
    const clean = text.trim().toLowerCase();
    return (
      /(?:this\s+is\s+(?:a\s+)?study\s+group|ye\s+study\s+group\s+(?:hai|h)|ye\s+padhai\s+ka\s+group\s+(?:hai|h)|(?:is\s+group\s+ko\s+)?study\s+group\s+bana\s+do|make\s+this\s+(?:a\s+)?study\s+group|study\s+group\s+declare\s+karo|declare\s+(?:this\s+)?study\s+group|^@study\s+(?:activate|enable|start|on)$)/i.test(
        clean
      )
    );
  }

  public async loadApprovedGroups(): Promise<void> {
    try {
      if (!approvedGroupsCol()) return;
      const snap = await approvedGroupsCol()!.get();
      if (!snap || snap.empty) return;
      for (const doc of snap.docs) {
        const data = doc.data();
        if (data?.groupJid) {
          this.approvedStudyGroups.add(data.groupJid);
          this.cachedStudyGroups.add(data.groupJid);
        }
      }
      console.log(`[FridayStudy] Loaded ${this.approvedStudyGroups.size} approved study groups from Firestore.`);
    } catch (e: any) {
      console.warn("[FridayStudy] Could not load approved study groups:", e?.message || e);
    }
  }

  public requestStudyGroupApproval(
    groupJid: string,
    groupName: string,
    requesterName: string,
    requesterPhone: string
  ): { waitMessage: string; alertForBoss: string; pendingId: string } {
    const pendingId = groupJid;
    const req = {
      groupJid,
      groupName: groupName || "Study Group",
      requesterName: requesterName || "Student",
      requesterPhone: requesterPhone || "",
      requestedAt: Date.now(),
    };

    this.pendingApprovals.set(groupJid, req);
    this.latestPendingApprovalGroupJid = groupJid;

    const waitMessage =
      `⏳ *Ok, wait for confirmation from Boss...* 📋\n\n` +
      `Maine Boss ko approval request bhej di hai. Boss ke approve karte hi main yahan aap sabhi ki dedicated NEET Study Mentor ban jaungi! 📚🎯\n\n` +
      `_Tab tak sabhi apna study material taiyar rakhein!_ ✨`;

    const alertForBoss =
      `🔔 *NEET STUDY GROUP APPROVAL REQUEST* 📚\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 *Group Name:* ${req.groupName}\n` +
      `🆔 *Group ID:* ${req.groupJid}\n` +
      `👤 *Requested By:* ${req.requesterName}${req.requesterPhone ? ` (+${req.requesterPhone})` : ""}\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Boss, kya aap is group ko *NEET Study Group* approve karna chahte hain?\n\n` +
      `Approve karne par:\n` +
      `• Friday is group me sabhi students ke har doubt/sawal ka bina "Friday" bole direct mentor ban kar reply karegi.\n` +
      `• Is group me koi Boss nahi hoga — sabhi students barabar honge (khud aap bhi DK student banenge).\n` +
      `• Fixed NEET study schedule, daily attendance aur backlog reporting active ho jayegi.\n\n` +
      `👉 Reply karein:\n` +
      `• *approve* ya *haa* ➔ Approve karne ke liye\n` +
      `• *reject* ya *nahi* ➔ Reject karne ke liye`;

    return { waitMessage, alertForBoss, pendingId };
  }

  public async approveStudyGroup(groupJid?: string): Promise<{
    success: boolean;
    groupJid: string;
    groupName: string;
    announcement: string;
    bossConfirmation: string;
  } | null> {
    const targetJid = groupJid || this.latestPendingApprovalGroupJid;
    if (!targetJid) return null;

    const pending = this.pendingApprovals.get(targetJid);
    const groupName = pending?.groupName || "NEET Study Group";

    // Mark as approved
    this.approvedStudyGroups.add(targetJid);
    this.cachedStudyGroups.add(targetJid);
    this.pendingApprovals.delete(targetJid);
    if (this.latestPendingApprovalGroupJid === targetJid) {
      this.latestPendingApprovalGroupJid = null;
    }

    // Persist in Firestore
    try {
      if (approvedGroupsCol()) {
        const cleanDocId = targetJid.replace(/[^a-zA-Z0-9_-]/g, "_");
        await approvedGroupsCol()!.doc(cleanDocId).set(
          {
            groupJid: targetJid,
            groupName,
            approvedAt: Date.now(),
            approvedBy: "Boss",
          },
          { merge: true }
        );
      }
    } catch (e: any) {
      console.warn("[FridayStudy] Could not persist approved group in Firestore:", e?.message || e);
    }

    const announcement =
      `🎉 *Approved, now I am your mentor.* 📚\n` +
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n` +
      `Boss ne is group ko *NEET Study Group* approve kar diya hai!\n\n` +
      `✨ *Important Group Guidelines:*\n` +
      `1️⃣ *No Boss Policy:* Is study group me koi 'Boss' nahi hai — khud owner DK bhi yahan sabhi ke saath ek student/aspirant hain.\n` +
      `2️⃣ *Dedicated Mentor:* Main yahan aap sabhi ki dedicated NEET Study Mentor hu.\n` +
      `3️⃣ *No Wake-Word Needed:* Aapko "Friday" bolne ki koi zaroorat nahi hai. Aap jo bhi padhai, chapters, doubts ya questions puchenge, main sidhe reply aur guide karungi!\n` +
      `4️⃣ *Daily Routine:* Subah 4:00 AM se Shaam 8:10 PM tak humara fixed study schedule, attendance aur backlog tracking chalegi.\n\n` +
      `All the best Future Doctors! Chaliye milkar NEET crack karte hain! 🩺🎯`;

    const bossConfirmation =
      `✅ *Boss, group "${groupName}" ko NEET Study Group approve kar diya gaya hai!* 📚\n\n` +
      `Group me mentor announcement bhej di gayi hai aur Friday ab wahan sabhi students ko direct mentor kar rahi hai! 🎯`;

    return {
      success: true,
      groupJid: targetJid,
      groupName,
      announcement,
      bossConfirmation,
    };
  }

  public async rejectStudyGroup(groupJid?: string): Promise<{
    success: boolean;
    groupJid: string;
    groupName: string;
    announcement: string;
    bossConfirmation: string;
  } | null> {
    const targetJid = groupJid || this.latestPendingApprovalGroupJid;
    if (!targetJid) return null;

    const pending = this.pendingApprovals.get(targetJid);
    const groupName = pending?.groupName || "Group";

    this.pendingApprovals.delete(targetJid);
    if (this.latestPendingApprovalGroupJid === targetJid) {
      this.latestPendingApprovalGroupJid = null;
    }

    const announcement =
      `❌ *Study Group Request Not Approved*\n\n` +
      `Boss ne abhi is group ko study group ke roop me approve nahi kiya hai. Yeh group normal general chat group ke roop me rahega.`;

    const bossConfirmation = `❌ *Boss, group "${groupName}" ki study group request reject kar di gayi hai.*`;

    return {
      success: true,
      groupJid: targetJid,
      groupName,
      announcement,
      bossConfirmation,
    };
  }

  public async dispatchApprovalAlertToBoss(sock: any, alertText: string): Promise<boolean> {
    try {
      const ownerPhone = (
        process.env.WHATSAPP_OWNER_PHONE ||
        process.env.BOSS_WHATSAPP_PHONE ||
        process.env.WHATSAPP_OWNER_NUMBER ||
        process.env.WHATSAPP_BOSS_PHONE ||
        process.env.OWNER_WHATSAPP_NUMBER ||
        process.env.BOSS_WHATSAPP_NUMBER ||
        process.env.OWNER_PHONE ||
        process.env.BOSS_PHONE ||
        "919315570187"
      ).replace(/\D/g, "");

      if (!sock || !ownerPhone) return false;

      // Try Alert Desk Group first
      try {
        const { whatsappAlertDeskService } = await import("./whatsappAlertDeskService");
        const deskGroupJid = whatsappAlertDeskService.getDeskGroupJid();
        if (deskGroupJid) {
          await sock.sendMessage(deskGroupJid, { text: alertText });
          return true;
        }
      } catch {}

      // Fallback to Boss private chat
      const ownerJid = `${ownerPhone}@s.whatsapp.net`;
      await sock.sendMessage(ownerJid, { text: alertText });
      return true;
    } catch (e: any) {
      console.warn("[FridayStudy] dispatchApprovalAlertToBoss error:", e?.message || e);
      return false;
    }
  }

  public async generateStudyMentorReply(
    text: string,
    senderName: string = "Student",
    groupName: string = "Study Group"
  ): Promise<string> {
    const cleanQuery = text.trim();
    if (!cleanQuery) return "";

    try {
      const { geminiKeyPoolService } = await import("./geminiKeyPoolService");
      const alloc = geminiKeyPoolService.getOptimalClient({ priority: "public" });
      const client = alloc.client;

      const systemPrompt = `You are Friday, an elite, deeply caring, sharp, and encouraging NEET Mentor for medical aspirants preparing for the National Eligibility cum Entrance Test (NEET UG) in India.
You are chatting inside a dedicated WhatsApp NEET study group named "${groupName}".

CRITICAL BEHAVIORAL RULES:
1. STRICT ZERO "BOSS" POLICY: NEVER use the word "Boss" or address anyone as Boss. Even the group creator or DK is an equal student/aspirant here. Address DK simply as "DK". Address students warmly by their name (${senderName}), or as "Future Doctors", "Aspirants", "Champions", "Saathiyo".
2. ROLE: You are their NEET Mentor / Academic Coach. Your tone is supportive, academically rigorous, motivating, and disciplined.
3. ACADEMIC EXPERTISE:
   - Biology: Strict NCERT line-by-line focus, mnemonics, diagrams, high-weightage NEET topics (Genetics & Evolution, Human Physiology, Plant Physiology, Biotech, Cell Biology, Ecology).
   - Physics: Concept clarity, formula derivations, problem-solving intuition, unit-dimensions, PYQ shortcuts (Mechanics, Electrodynamics, Modern Physics, Optics, Thermodynamics).
   - Chemistry: NCERT organic reaction mechanisms/named reactions, inorganic trends/exceptions & memory tricks, physical chemistry formulas & calculation shortcuts.
   - Strategy & Routine: Encourage daily consistency, clearing backlogs, solving 50+ MCQs daily, maintaining attendance, and avoiding phone distractions.
4. FORMATTING:
   - Use clean, readable WhatsApp formatting with bold (*text*), bullet points, and clean emojis.
   - Keep answers concise, high-impact, and easy to read on a mobile screen (2-4 crisp paragraphs or structured bullets).
   - Language: Natural Hinglish/Hindi or English matching the user's input.
5. If the user asks something off-topic or fun, briefly answer warmly as a friendly mentor, then smoothly guide their focus back to NEET preparation and their daily study targets!`;

      const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: [
          {
            role: "user",
            parts: [
              {
                text: `${systemPrompt}\n\nStudent (${senderName}) asked:\n"${cleanQuery}"\n\nMentor Response:`,
              },
            ],
          },
        ],
      });

      const reply = response.text?.trim();
      if (reply) {
        return reply.replace(/\bBoss\b/gi, senderName || "Champion");
      }
    } catch (e: any) {
      console.warn("[FridayStudy] generateStudyMentorReply fallback:", e?.message || e);
    }

    return `📚 *NEET Mentor Guidance for ${senderName}:*\nMaine aapka message note kar liya hai! Abhi apna pura dhyan apne subject target aur NCERT concept revision par rakhein. 50+ MCQs daily practice karna mat bhoolna! Let's crack NEET! 🎯🩺`;
  }

  public registerStudyGroup(jid: string, name?: string) {
    if (!jid || !jid.endsWith("@g.us")) return;
    this.cachedStudyGroups.add(jid);
  }

  public async refreshStudyGroupsCache(): Promise<string[]> {
    const found: string[] = [];
    for (const jid of this.approvedStudyGroups) {
      this.cachedStudyGroups.add(jid);
      found.push(jid);
    }
    if (!this.sock) return Array.from(this.cachedStudyGroups);

    try {
      if (typeof this.sock.groupFetchAllParticipating === "function") {
        const groups = await this.sock.groupFetchAllParticipating();
        for (const [jid, meta] of Object.entries(groups as Record<string, any>)) {
          const subject = meta?.subject || "";
          if (this.isStudyGroupName(subject)) {
            this.cachedStudyGroups.add(jid);
            found.push(jid);
          }
        }
      }
    } catch (e: any) {
      console.warn("[FridayStudy] groupFetchAllParticipating notice:", e?.message || e);
    }

    return Array.from(this.cachedStudyGroups);
  }

  public async getActiveStudyGroups(): Promise<string[]> {
    if (this.cachedStudyGroups.size === 0) {
      await this.refreshStudyGroupsCache();
    }
    return Array.from(this.cachedStudyGroups);
  }

  // ── Daily Plan Management ────────────────────────────────────────────────
  private defaultSubjectTopics(): SubjectTopics {
    return {
      currentTopic: "NCERT Chapter / Daily Class Target",
      backlogTopic: "Revision & 50 MCQs / Backlog Cleansing",
      currentStatus: "pending",
      backlogStatus: "pending",
      status: "pending",
      updatedAt: Date.now(),
    };
  }

  public async getDailyPlan(groupId: string, dateStr?: string): Promise<DayStudyPlan> {
    const today = dateStr || this.getISTNow().dateStr;
    const cacheKey = `${today}_${groupId}`;

    const cached = this.inMemoryPlans.get(cacheKey);
    if (cached) return cached;

    let plan: DayStudyPlan | null = null;
    try {
      if (sessionsCol()) {
        const doc = await sessionsCol()!.doc(cacheKey).get();
        if (doc.exists) {
          plan = doc.data() as DayStudyPlan;
        }
      }
    } catch (e) {
      console.warn("[FridayStudy] Firestore fetch error:", e);
    }

    if (!plan) {
      plan = {
        dateStr: today,
        groupId,
        biologyMorning: this.defaultSubjectTopics(),
        biologyAfternoon: this.defaultSubjectTopics(),
        physics: this.defaultSubjectTopics(),
        chemistry: this.defaultSubjectTopics(),
        dispatchedSlots: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    }

    this.inMemoryPlans.set(cacheKey, plan);
    return plan;
  }

  public async saveDailyPlan(plan: DayStudyPlan): Promise<void> {
    const cacheKey = `${plan.dateStr}_${plan.groupId}`;
    plan.updatedAt = Date.now();
    this.inMemoryPlans.set(cacheKey, plan);

    try {
      if (sessionsCol()) {
        await sessionsCol()!.doc(cacheKey).set(plan, { merge: true });
      }
    } catch (e) {
      console.warn("[FridayStudy] Firestore save error:", e);
    }
  }

  // ── Backlog Storage ──────────────────────────────────────────────────────
  private async preloadBacklogs() {
    try {
      if (backlogsCol()) {
        const snap = await backlogsCol()!.where("status", "==", "pending").get();
        this.inMemoryBacklogs = snap.docs.map((doc) => ({
          id: doc.id,
          ...(doc.data() as any),
        }));
      }
    } catch (e) {
      console.warn("[FridayStudy] Preload backlogs notice:", e);
    }
  }

  public async addBacklog(subject: "Biology" | "Physics" | "Chemistry", topic: string): Promise<NeetBacklogItem> {
    const cleanTopic = topic.trim();
    const item: NeetBacklogItem = {
      id: `bl_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      subject,
      topic: cleanTopic,
      status: "pending",
      addedAt: Date.now(),
    };

    this.inMemoryBacklogs.push(item);
    try {
      if (backlogsCol()) {
        await backlogsCol()!.doc(item.id).set(item);
      }
    } catch {}
    return item;
  }

  public async getBacklogs(subject?: "Biology" | "Physics" | "Chemistry"): Promise<NeetBacklogItem[]> {
    if (subject) {
      return this.inMemoryBacklogs.filter((b) => b.subject.toLowerCase() === subject.toLowerCase() && b.status === "pending");
    }
    return this.inMemoryBacklogs.filter((b) => b.status === "pending");
  }

  public async markBacklogDone(topicOrId: string): Promise<boolean> {
    const query = topicOrId.toLowerCase().trim();
    const found = this.inMemoryBacklogs.find(
      (b) => b.id === query || b.topic.toLowerCase().includes(query)
    );
    if (!found) return false;

    found.status = "done";
    found.completedAt = Date.now();
    try {
      if (backlogsCol()) {
        await backlogsCol()!.doc(found.id).update({ status: "done", completedAt: Date.now() });
      }
    } catch {}
    return true;
  }

  // ── Topic Setter & Done Markers ──────────────────────────────────────────
  public async setSessionTopics(
    groupId: string,
    subjectKey: "bio" | "bio1" | "bio2" | "physics" | "chem",
    currentTopic?: string,
    backlogTopic?: string
  ): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    let target: SubjectTopics;
    let label = "";

    switch (subjectKey) {
      case "bio1":
        target = plan.biologyMorning;
        label = "Biology Session 1 (Morning 5-6 AM)";
        break;
      case "bio2":
      case "bio":
        target = plan.biologyAfternoon;
        label = "Biology Session 2 (3:10-4:39 PM)";
        break;
      case "physics":
        target = plan.physics;
        label = "Physics Session 3 (5-6:29 PM)";
        break;
      case "chem":
        target = plan.chemistry;
        label = "Chemistry Session 4 (6:45-8:10 PM)";
        break;
    }

    if (currentTopic && currentTopic.trim()) target.currentTopic = currentTopic.trim();
    if (backlogTopic && backlogTopic.trim()) {
      target.backlogTopic = backlogTopic.trim();
      // Auto-save into master NEET backlogs if not already there
      const subj = subjectKey === "physics" ? "Physics" : subjectKey === "chem" ? "Chemistry" : "Biology";
      this.addBacklog(subj, backlogTopic.trim()).catch(() => {});
    }

    target.status = "in_progress";
    target.updatedAt = Date.now();
    await this.saveDailyPlan(plan);

    return {
      success: true,
      message: `✅ *${label} Target Updated!*\n📖 *Current Topic:* ${target.currentTopic}\n⏳ *Backlog Topic:* ${target.backlogTopic}`,
    };
  }

  // ── Member Attendance Register Helpers ────────────────────────────────────
  public getUserKey(memberInfo: { senderName: string; senderPhone?: string; senderJid?: string }): string {
    if (memberInfo.senderPhone && memberInfo.senderPhone.trim()) {
      const cleanPhone = memberInfo.senderPhone.replace(/\D/g, "");
      if (cleanPhone) return cleanPhone;
    }
    if (memberInfo.senderJid && memberInfo.senderJid.trim()) {
      const cleanJid = memberInfo.senderJid.replace(/@.+/, "").replace(/\D/g, "");
      if (cleanJid) return cleanJid;
      return memberInfo.senderJid.replace(/[^a-zA-Z0-9]/g, "_");
    }
    return (memberInfo.senderName || "student").trim().toLowerCase().replace(/[^a-z0-9]/g, "_");
  }

  public defaultMemberSessionProgress(): MemberSessionProgress {
    return {
      attended: false,
      currentStatus: "pending",
      backlogStatus: "pending",
      status: "pending",
      lastReportedAt: 0,
    };
  }

  public getOrCreateMemberAttendance(
    plan: DayStudyPlan,
    memberInfo: MemberInfo
  ): MemberAttendance {
    if (!plan.membersAttendance) {
      plan.membersAttendance = {};
    }
    const userKey = this.getUserKey(memberInfo);
    let record = plan.membersAttendance[userKey];
    if (!record) {
      record = {
        userKey,
        userName: memberInfo.senderName || "Student",
        userPhone: memberInfo.senderPhone,
        isOwner: Boolean(memberInfo.isOwner),
        sessions: {
          bio1: this.defaultMemberSessionProgress(),
          bio2: this.defaultMemberSessionProgress(),
          physics: this.defaultMemberSessionProgress(),
          chem: this.defaultMemberSessionProgress(),
        },
        totalCompletedCount: 0,
        updatedAt: Date.now(),
      };
      plan.membersAttendance[userKey] = record;
    } else {
      if (memberInfo.senderName && memberInfo.senderName !== "Student" && memberInfo.senderName !== "Unknown") {
        record.userName = memberInfo.senderName;
      }
      if (memberInfo.senderPhone) {
        record.userPhone = memberInfo.senderPhone;
      }
      if (memberInfo.isOwner) {
        record.isOwner = true;
      }
    }
    return record;
  }

  public updateMemberSessionProgress(
    record: MemberAttendance,
    sessionKey: "bio" | "bio1" | "bio2" | "physics" | "chem",
    updateFn: (s: MemberSessionProgress) => void
  ) {
    const key: "bio1" | "bio2" | "physics" | "chem" =
      sessionKey === "bio" ? "bio2" : sessionKey;
    if (!record.sessions[key]) {
      record.sessions[key] = this.defaultMemberSessionProgress();
    }
    const session = record.sessions[key];
    session.attended = true;
    updateFn(session);
    session.lastReportedAt = Date.now();

    let count = 0;
    for (const s of Object.values(record.sessions)) {
      if (s.status === "done" || (s.currentStatus === "done" && s.backlogStatus === "done")) {
        count++;
      }
    }
    record.totalCompletedCount = count;
    record.updatedAt = Date.now();
  }

  public async markSessionDone(
    groupId: string,
    subjectKey?: "bio" | "bio1" | "bio2" | "physics" | "chem",
    memberInfo?: MemberInfo
  ): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    const resolvedKey = subjectKey || this.getActiveOrRelevantSession(undefined, plan).key;
    let target: SubjectTopics;
    let label = "";

    switch (resolvedKey) {
      case "bio1":
        target = plan.biologyMorning;
        label = "Biology Session 1 (Morning)";
        break;
      case "bio2":
      case "bio":
        target = plan.biologyAfternoon;
        label = "Biology Session 2 (~1.5 hrs)";
        break;
      case "physics":
        target = plan.physics;
        label = "Physics Session 3 (~1.5 hrs)";
        break;
      case "chem":
        target = plan.chemistry;
        label = "Chemistry Session 4 (~1.5 hrs)";
        break;
    }

    target.currentStatus = "done";
    target.backlogStatus = "done";
    target.status = "done";
    target.updatedAt = Date.now();

    let studentBadge = memberInfo?.isOwner ? "DK" : (memberInfo?.senderName || "Student");
    if (memberInfo) {
      const record = this.getOrCreateMemberAttendance(plan, memberInfo);
      this.updateMemberSessionProgress(record, resolvedKey, (s) => {
        s.currentStatus = "done";
        s.backlogStatus = "done";
        s.status = "done";
        s.lastAction = "Session Done";
      });
      studentBadge = memberInfo.isOwner ? "DK" : memberInfo.senderName;
    }

    await this.saveDailyPlan(plan);

    // If backlog was set and not default, mark as done in master tracker
    if (target.backlogTopic && !target.backlogTopic.includes("Daily Class Target")) {
      this.markBacklogDone(target.backlogTopic).catch(() => {});
    }

    return {
      success: true,
      message: `🎉 *Shabash ${studentBadge}! ${label} COMPLETE!* ✅\n• 📖 Present: ✅ Done (_"${target.currentTopic}"_)\n• ⏳ Backlog: ✅ Done (_"${target.backlogTopic}"_)\n\n🔥 *Attendance Register me Session Mark ho gaya! Keep going!* 🚀`,
    };
  }

  // ── Active Session Resolver & Dual-Phase Reporting ───────────────────────
  public getActiveOrRelevantSession(explicitSubject?: string, plan?: DayStudyPlan): {
    key: "bio1" | "bio2" | "physics" | "chem";
    slot: StudySlot;
    endHour: number;
    endMinute: number;
    sessionName: string;
    durationMinutes: number;
  } {
    const { hour, minute } = this.getISTNow();
    const currentTotalMins = hour * 60 + minute;

    if (explicitSubject) {
      const s = explicitSubject.toLowerCase().trim();
      if (s.startsWith("phys")) {
        return { key: "physics", slot: FIXED_STUDY_SLOTS[9], endHour: 18, endMinute: 29, sessionName: "Physics Session 3", durationMinutes: 89 };
      }
      if (s.startsWith("chem")) {
        return { key: "chem", slot: FIXED_STUDY_SLOTS[12], endHour: 20, endMinute: 10, sessionName: "Chemistry Session 4", durationMinutes: 85 };
      }
      if (s === "bio1" || (s.startsWith("bio") && currentTotalMins < 12 * 60)) {
        return { key: "bio1", slot: FIXED_STUDY_SLOTS[1], endHour: 6, endMinute: 0, sessionName: "Biology Session 1 (Morning)", durationMinutes: 60 };
      }
      return { key: "bio2", slot: FIXED_STUDY_SLOTS[6], endHour: 16, endMinute: 39, sessionName: "Biology Session 2 (Afternoon)", durationMinutes: 89 };
    }

    // Time-based auto-detection
    if (currentTotalMins >= 4 * 60 + 45 && currentTotalMins < 7 * 60) {
      return { key: "bio1", slot: FIXED_STUDY_SLOTS[1], endHour: 6, endMinute: 0, sessionName: "Biology Session 1 (Morning)", durationMinutes: 60 };
    }
    if (currentTotalMins >= 14 * 60 + 30 && currentTotalMins < 16 * 60 + 45) {
      return { key: "bio2", slot: FIXED_STUDY_SLOTS[6], endHour: 16, endMinute: 39, sessionName: "Biology Session 2 (Afternoon)", durationMinutes: 89 };
    }
    if (currentTotalMins >= 16 * 60 + 45 && currentTotalMins < 18 * 60 + 35) {
      return { key: "physics", slot: FIXED_STUDY_SLOTS[9], endHour: 18, endMinute: 29, sessionName: "Physics Session 3", durationMinutes: 89 };
    }
    if (currentTotalMins >= 18 * 60 + 35 && currentTotalMins < 21 * 60) {
      return { key: "chem", slot: FIXED_STUDY_SLOTS[12], endHour: 20, endMinute: 10, sessionName: "Chemistry Session 4", durationMinutes: 85 };
    }

    // Check if any plan session is in_progress
    if (plan) {
      if (plan.physics.currentStatus === "in_progress" || plan.physics.backlogStatus === "in_progress") {
        return { key: "physics", slot: FIXED_STUDY_SLOTS[9], endHour: 18, endMinute: 29, sessionName: "Physics Session 3", durationMinutes: 89 };
      }
      if (plan.chemistry.currentStatus === "in_progress" || plan.chemistry.backlogStatus === "in_progress") {
        return { key: "chem", slot: FIXED_STUDY_SLOTS[12], endHour: 20, endMinute: 10, sessionName: "Chemistry Session 4", durationMinutes: 85 };
      }
      if (plan.biologyMorning.currentStatus === "in_progress" || plan.biologyMorning.backlogStatus === "in_progress") {
        return { key: "bio1", slot: FIXED_STUDY_SLOTS[1], endHour: 6, endMinute: 0, sessionName: "Biology Session 1 (Morning)", durationMinutes: 60 };
      }
      if (plan.biologyAfternoon.currentStatus === "in_progress" || plan.biologyAfternoon.backlogStatus === "in_progress") {
        return { key: "bio2", slot: FIXED_STUDY_SLOTS[6], endHour: 16, endMinute: 39, sessionName: "Biology Session 2 (Afternoon)", durationMinutes: 89 };
      }
    }

    // Default to Biology Afternoon or nearest
    return { key: "bio2", slot: FIXED_STUDY_SLOTS[6], endHour: 16, endMinute: 39, sessionName: "Biology Session 2 (Afternoon)", durationMinutes: 89 };
  }

  public getSubjectTarget(plan: DayStudyPlan, key: "bio" | "bio1" | "bio2" | "physics" | "chem"): SubjectTopics {
    if (key === "bio1") return plan.biologyMorning;
    if (key === "physics") return plan.physics;
    if (key === "chem") return plan.chemistry;
    return plan.biologyAfternoon;
  }

  public async recordDirectAttendance(
    groupId: string,
    explicitSubject?: string,
    memberInfo?: MemberInfo
  ): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    const sessionInfo = this.getActiveOrRelevantSession(explicitSubject, plan);
    const target = this.getSubjectTarget(plan, sessionInfo.key);

    let studentBadge = "Student";
    if (memberInfo) {
      const record = this.getOrCreateMemberAttendance(plan, memberInfo);
      this.updateMemberSessionProgress(record, sessionInfo.key, (s) => {
        if (s.status === "pending") {
          s.status = "in_progress";
          s.currentStatus = "in_progress";
          s.currentStartedAt = Date.now();
        }
        s.lastAction = "Attendance Check-in";
      });
      studentBadge = memberInfo.isOwner ? "⭐ DK" : `👤 ${memberInfo.senderName}`;
    }

    await this.saveDailyPlan(plan);

    return {
      success: true,
      message: `✅ *ATTENDANCE REGISTERED!* 📝
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
👤 *Student:* *${studentBadge}* (Haziri Lag Gayi)
📚 *Session:* *[${sessionInfo.sessionName}]*
🎯 *Common Class Target:* *"${target.currentTopic}"*
⏳ *Class Backlog:* *"${target.backlogTopic}"*

💡 *Next Step:*
Desk par baith kar padhai shuru karein aur likhein:
👉 \`current padh raha hu\`
_Present khatam hote hi Backlog shuru karein!_ 🎯🚀`,
    };
  }

  public async reportPresentStarted(
    groupId: string,
    explicitSubject?: string,
    memberInfo?: MemberInfo
  ): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    const sessionInfo = this.getActiveOrRelevantSession(explicitSubject, plan);
    const target = this.getSubjectTarget(plan, sessionInfo.key);

    target.currentStatus = "in_progress";
    target.currentStartedAt = Date.now();
    target.status = "in_progress";
    target.updatedAt = Date.now();

    let studentLine = "";
    if (memberInfo) {
      const record = this.getOrCreateMemberAttendance(plan, memberInfo);
      this.updateMemberSessionProgress(record, sessionInfo.key, (s) => {
        s.currentStatus = "in_progress";
        s.currentStartedAt = Date.now();
        s.status = "in_progress";
        s.lastAction = "Current Started";
      });
      const badge = memberInfo.isOwner ? "⭐ DK" : `👤 ${memberInfo.senderName}`;
      studentLine = `👤 *Student:* *${badge}* ✅ (Attendance Marked)\n`;
    }

    await this.saveDailyPlan(plan);

    const { hour, minute } = this.getISTNow();
    const currentMins = hour * 60 + minute;
    const endMins = sessionInfo.endHour * 60 + sessionInfo.endMinute;
    let remainingMins = endMins - currentMins;
    if (remainingMins <= 0) {
      remainingMins = sessionInfo.durationMinutes;
    }
    const endFormatted = `${sessionInfo.endHour > 12 ? sessionInfo.endHour - 12 : sessionInfo.endHour}:${sessionInfo.endMinute.toString().padStart(2, "0")} ${sessionInfo.endHour >= 12 ? "PM" : "AM"}`;

    return {
      success: true,
      message: `📖 *[${sessionInfo.sessionName}] PRESENT TOPIC SHURU!* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${studentLine}🎯 *Current Topic:* *"${target.currentTopic}"*
⏳ *Class Backlog:* *"${target.backlogTopic}"*
⏰ *Session Window Ends:* ${endFormatted} (${remainingMins} Mins bache hain)

💡 *Guidance:*
Pehle Present topic par deep focus karo. Jaise hi khatam ho jaye (chahe 40 min me ya 50 min me), yahan report karein:
👉 *"current done, ab backlog padh raha hu"*
taaki Friday bache hue time me Backlog activate kare! ⏳👍`,
    };
  }

  public async reportPresentDoneAndStartBacklog(
    groupId: string,
    explicitSubject?: string,
    memberInfo?: MemberInfo
  ): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    const sessionInfo = this.getActiveOrRelevantSession(explicitSubject, plan);
    const target = this.getSubjectTarget(plan, sessionInfo.key);

    const now = Date.now();
    let spentMins = 45;
    if (target.currentStartedAt) {
      spentMins = Math.max(5, Math.round((now - target.currentStartedAt) / 60000));
    } else {
      // Calculate from slot start time
      const { hour, minute } = this.getISTNow();
      const currentMins = hour * 60 + minute;
      const slotStartMins = sessionInfo.slot.hour * 60 + sessionInfo.slot.minute;
      if (currentMins >= slotStartMins && currentMins < sessionInfo.endHour * 60 + sessionInfo.endMinute) {
        spentMins = Math.max(5, currentMins - slotStartMins);
      }
    }

    target.currentStatus = "done";
    target.currentCompletedAt = now;
    target.currentDurationMinutes = spentMins;

    // Auto-switch to Backlog phase
    target.backlogStatus = "in_progress";
    target.backlogStartedAt = now;
    target.status = "in_progress";
    target.updatedAt = now;

    let studentBadge = memberInfo?.isOwner ? "DK" : (memberInfo?.senderName || "STUDENT").toUpperCase();
    let studentLine = "";
    if (memberInfo) {
      const record = this.getOrCreateMemberAttendance(plan, memberInfo);
      this.updateMemberSessionProgress(record, sessionInfo.key, (s) => {
        s.currentStatus = "done";
        s.currentCompletedAt = now;
        s.currentDurationMinutes = spentMins;
        s.backlogStatus = "in_progress";
        s.backlogStartedAt = now;
        s.status = "in_progress";
        s.lastAction = "Backlog Switched";
      });
      studentBadge = memberInfo.isOwner ? "DK" : (memberInfo.senderName || "STUDENT").toUpperCase();
      studentLine = `👤 *Student:* *${memberInfo.isOwner ? "⭐ DK" : memberInfo.senderName}*\n`;
    }

    await this.saveDailyPlan(plan);

    const { hour, minute } = this.getISTNow();
    const currentMins = hour * 60 + minute;
    const endMins = sessionInfo.endHour * 60 + sessionInfo.endMinute;
    let remainingMins = endMins - currentMins;
    if (remainingMins <= 0) {
      remainingMins = Math.max(15, sessionInfo.durationMinutes - spentMins);
    }
    const endFormatted = `${sessionInfo.endHour > 12 ? sessionInfo.endHour - 12 : sessionInfo.endHour}:${sessionInfo.endMinute.toString().padStart(2, "0")} ${sessionInfo.endHour >= 12 ? "PM" : "AM"}`;

    return {
      success: true,
      message: `🎉 *SHABASH ${studentBadge}! PRESENT TOPIC COMPLETE!* ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${studentLine}📖 *Covered:* "${target.currentTopic}"
⏱️ *Time Spent on Present:* ~${spentMins} Mins

⏳ *SWITCHED TO BACKLOG:*
🎯 *Backlog Target:* *"${target.backlogTopic}"*
⏰ *Remaining Time in Session:* *${remainingMins} Minutes* (Ends at ${endFormatted})

🔥 *Full Focus Mode! Is bache hue ${remainingMins} minute me backlog clear kar lo!* 🚀
_Jab complete ho jaye, likhein:_ \`backlog done\` 👍`,
    };
  }

  public async reportBacklogStarted(
    groupId: string,
    explicitSubject?: string,
    memberInfo?: MemberInfo
  ): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    const sessionInfo = this.getActiveOrRelevantSession(explicitSubject, plan);
    const target = this.getSubjectTarget(plan, sessionInfo.key);

    target.backlogStatus = "in_progress";
    target.backlogStartedAt = Date.now();
    target.status = "in_progress";
    target.updatedAt = Date.now();

    let studentBadge = memberInfo?.isOwner ? "DK" : (memberInfo?.senderName || "Student");
    let studentLine = "";
    if (memberInfo) {
      const record = this.getOrCreateMemberAttendance(plan, memberInfo);
      this.updateMemberSessionProgress(record, sessionInfo.key, (s) => {
        s.backlogStatus = "in_progress";
        s.backlogStartedAt = Date.now();
        s.status = "in_progress";
        s.lastAction = "Backlog Started";
      });
      studentBadge = memberInfo.isOwner ? "DK" : memberInfo.senderName;
      studentLine = `👤 *Student:* *${memberInfo.isOwner ? "⭐ DK" : memberInfo.senderName}* ✅ (Attendance Marked)\n`;
    }

    await this.saveDailyPlan(plan);

    const { hour, minute } = this.getISTNow();
    const currentMins = hour * 60 + minute;
    const endMins = sessionInfo.endHour * 60 + sessionInfo.endMinute;
    let remainingMins = endMins - currentMins;
    if (remainingMins <= 0) {
      remainingMins = Math.max(15, sessionInfo.durationMinutes - 45);
    }

    return {
      success: true,
      message: `⏳ *[${sessionInfo.sessionName}] BACKLOG STUDY SHURU!* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${studentLine}🎯 *Backlog Target:* *"${target.backlogTopic}"*
⏰ *Remaining Time:* *${remainingMins} Mins*

💪 *Speed up karo ${studentBadge}! NCERT line revision & MCQs practice non-stop!* 🎯`,
    };
  }

  public async reportBacklogDone(
    groupId: string,
    explicitSubject?: string,
    memberInfo?: MemberInfo
  ): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    const sessionInfo = this.getActiveOrRelevantSession(explicitSubject, plan);
    const target = this.getSubjectTarget(plan, sessionInfo.key);

    const now = Date.now();
    let backlogSpentMins = 30;
    if (target.backlogStartedAt) {
      backlogSpentMins = Math.max(5, Math.round((now - target.backlogStartedAt) / 60000));
    }
    target.backlogStatus = "done";
    target.backlogCompletedAt = now;
    target.backlogDurationMinutes = backlogSpentMins;

    if (target.currentStatus === "done") {
      target.status = "done";
    }
    target.updatedAt = now;

    let studentBadge = memberInfo?.isOwner ? "DK" : (memberInfo?.senderName || "Student");
    let studentLine = "";
    if (memberInfo) {
      const record = this.getOrCreateMemberAttendance(plan, memberInfo);
      this.updateMemberSessionProgress(record, sessionInfo.key, (s) => {
        s.backlogStatus = "done";
        s.backlogCompletedAt = now;
        s.backlogDurationMinutes = backlogSpentMins;
        if (s.currentStatus === "done") {
          s.status = "done";
        }
        s.lastAction = "Backlog Done";
      });
      studentBadge = memberInfo.isOwner ? "DK" : memberInfo.senderName;
      studentLine = `👤 *Student:* *${memberInfo.isOwner ? "⭐ DK" : memberInfo.senderName}*\n`;
    }

    await this.saveDailyPlan(plan);

    if (target.backlogTopic && !target.backlogTopic.includes("Daily Class Target")) {
      this.markBacklogDone(target.backlogTopic).catch(() => {});
    }

    return {
      success: true,
      message: `🏆 *MISSION ACCOMPLISHED! BACKLOG ALSO COMPLETED!* ✅
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${studentLine}• 📖 Present Topic: ${target.currentStatus === "done" ? "✅ Done" : "⏳ " + target.currentTopic}
• ⏳ Backlog Topic: ✅ Done (_"${target.backlogTopic}"_ ~${backlogSpentMins} mins)

🌟 *[${sessionInfo.sessionName}] 100% SUCCESS!*
Consistency hi NEET topper banayegi, Shabash ${studentBadge}! 🔥🚀`,
    };
  }

  // ── 02:00 PM Daily Running Chapters & Backlog Setup Flow ─────────────────
  public parseThreeTopics(text: string): [string, string, string] | null {
    return parseThreeTopics(text);
  }

  public async promptDailyQuestions(groupId: string): Promise<{ success: boolean; message: string }> {
    const plan = await this.getDailyPlan(groupId);
    plan.setupState = "awaiting_current";
    plan.setupPromptSentAt = Date.now();
    await this.saveDailyPlan(plan);

    return {
      success: true,
      message: `😴 *02:00 PM — SCHOOL OVER & RUNNING CHAPTERS SETUP!* 🛋️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Aspirants, school over ho gaya! 49 minutes ke power nap se pehle shaam ke 3 heavy sessions ka target set kar lete hain!

❓ *Aaj ke teeno subjects ke RUNNING CHAPTERS batayein:*
1️⃣ *Running Biology Chapter:*
2️⃣ *Running Physics Chapter:*
3️⃣ *Running Chemistry Chapter:*

💡 *Aap aise bhej sakte hain (comma ya space se):*
👉 \`Genetics, Electrostatics, Thermodynamics\` ya \`x, y, z\` ya \`x y z\`

_Iske reply ke turant baad hum Backlog chapters puchenge!_ 🎯`,
    };
  }

  public async handleDailySetupResponse(
    groupId: string,
    cleanText: string
  ): Promise<{ handled: boolean; replyText?: string }> {
    const plan = await this.getDailyPlan(groupId);

    // If state expired (more than 4 hours ago), reset to idle
    if (plan.setupPromptSentAt && Date.now() - plan.setupPromptSentAt > 4 * 60 * 60 * 1000) {
      plan.setupState = "idle";
      plan.pendingCurrentTopics = undefined;
      await this.saveDailyPlan(plan);
      return { handled: false };
    }

    if (plan.setupState === "awaiting_current") {
      const parsed = parseThreeTopics(cleanText);
      if (!parsed) {
        // If message is a command or unrelated, don't hijack unless it looks like an attempt
        if (cleanText.startsWith("@") || cleanText.startsWith("/")) return { handled: false };
        if (!cleanText.includes(",") && !cleanText.includes(" ") && !cleanText.includes("\n")) {
          return { handled: false };
        }
        return {
          handled: true,
          replyText: `⚠️ *Teeno subjects ke running chapters batayein:*
1️⃣ Biology, 2️⃣ Physics, 3️⃣ Chemistry
👉 _Jaise:_ \`Genetics, Electrostatics, Thermodynamics\` ya \`x, y, z\` ya \`x y z\``,
        };
      }

      const [bio, phys, chem] = parsed;
      plan.pendingCurrentTopics = { biology: bio, physics: phys, chemistry: chem };
      plan.setupState = "awaiting_backlog";
      plan.setupPromptSentAt = Date.now();
      await this.saveDailyPlan(plan);

      return {
        handled: true,
        replyText: `✅ *Running Chapters Note Ho Gaye!* 📝
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• 🧬 *Biology:* "${bio}"
• ⚡ *Physics:* "${phys}"
• 🧪 *Chemistry:* "${chem}"

❓ *Ab inhi teeno subjects ke RUNNING BACKLOG CHAPTERS batayein:*
1️⃣ *Running Biology Backlog:*
2️⃣ *Running Physics Backlog:*
3️⃣ *Running Chemistry Backlog:*

💡 *Same format me bhej sakte hain (comma ya space se):*
👉 \`Cell Division 30 MCQs, Kinematics Numericals, Solutions PYQs\` ya \`a, b, c\` ya \`a b c\``,
      };
    }

    if (plan.setupState === "awaiting_backlog") {
      const parsed = parseThreeTopics(cleanText);
      if (!parsed) {
        if (cleanText.startsWith("@") || cleanText.startsWith("/")) return { handled: false };
        if (!cleanText.includes(",") && !cleanText.includes(" ") && !cleanText.includes("\n")) {
          return { handled: false };
        }
        return {
          handled: true,
          replyText: `⚠️ *Teeno subjects ke backlog chapters batayein:*
1️⃣ Biology Backlog, 2️⃣ Physics Backlog, 3️⃣ Chemistry Backlog
👉 _Jaise:_ \`Cell Division 30 MCQs, Kinematics Numericals, Solutions PYQs\` ya \`a, b, c\` ya \`a b c\``,
        };
      }

      const [bioBack, physBack, chemBack] = parsed;
      const curr = plan.pendingCurrentTopics || {
        biology: "NCERT Chapter",
        physics: "Theory & Derivations",
        chemistry: "NCERT Line by Line",
      };

      // Update today's plan
      plan.biologyAfternoon.currentTopic = curr.biology;
      plan.biologyAfternoon.backlogTopic = bioBack;
      plan.physics.currentTopic = curr.physics;
      plan.physics.backlogTopic = physBack;
      plan.chemistry.currentTopic = curr.chemistry;
      plan.chemistry.backlogTopic = chemBack;

      plan.setupState = "idle";
      plan.pendingCurrentTopics = undefined;
      await this.saveDailyPlan(plan);

      // Add to master backlog items
      this.addBacklog("Biology", bioBack).catch(() => {});
      this.addBacklog("Physics", physBack).catch(() => {});
      this.addBacklog("Chemistry", chemBack).catch(() => {});

      return {
        handled: true,
        replyText: `🎉 *AWESOME! AAJ KA NEET TARGET 100% SET HO GAYA!* 🎯
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🧬 *1. Biology (~1.5 hrs: 03:10 PM - 04:39 PM):*
• 📖 Current: *"${curr.biology}"*
• ⏳ Backlog: *"${bioBack}"*

⚡ *2. Physics (~1.5 hrs: 05:00 PM - 06:29 PM):*
• 📖 Current: *"${curr.physics}"*
• ⏳ Backlog: *"${physBack}"*

🧪 *3. Chemistry (~1.5 hrs: 06:45 PM - 08:10 PM):*
• 📖 Current: *"${curr.chemistry}"*
• ⏳ Backlog: *"${chemBack}"*

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
😴 *Ab 02:49 PM tak aaram se deep power nap le lo!* 🛋️💤
⏰ *02:50 PM par Wake up & 📞 Call to DK reminder aayega!* 🚀`,
      };
    }

    return { handled: false };
  }

  // ── Formatted Card Generators ────────────────────────────────────────────
  public generateSlotCard(slot: StudySlot, plan: DayStudyPlan): string {
    const { timeStr } = this.getISTNow();

    switch (slot.id) {
      case "slot_04_00":
        return `🌅 *04:00 AM — WAKE UP & GET READY!* ⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Good morning Future Doctors! Subah ke 4:00 AM ho gaye hain.
• Utho, fresh ho jao, bathing & school ke liye ready ho jao.
• Morning tea / water le lo.

🎯 *Next Session:* *05:00 AM* par *Session 1: Biology (1 Hr)* shuru hoga!
_NEET crack karne ke liye morning consistency sabse powerful weapon hai!_ 💪`;

      case "slot_05_00":
        return `🧬 *SESSION 1: BIOLOGY (05:00 AM - 06:00 AM)* 🎯
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ *Time:* 05:00 AM - 06:00 AM (1 Hour Morning Kickstart)

📖 *Present Topic:* ${plan.biologyMorning.currentTopic}
⏳ *Backlog Topic:* ${plan.biologyMorning.backlogTopic}

📋 *Reporting Protocol (1 Hour Focus):*
👉 _Start pe likhein:_ \`current padh raha hu\`
👉 _Khatam hone par likhein:_ \`current done, ab backlog padh raha hu\` (ya \`bio done\`)

🎯 *Target:* Full NCERT memory retention & quick concept review!
_Distractions zero, 1 hour deep focus!_ 📚⚡`;

      case "slot_06_00":
        return `🏫 *06:00 AM — SCHOOL TIME DEPARTURE!* 🎒
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Biology Session 1 completed! Ab school jaane ka time ho gaya hai.

⏰ *School Schedule:* 06:00 AM - 02:00 PM
😴 *Next Routine:* 02:00 PM par school over & 49 min power nap!
_Study bot ab 2:00 PM tak quiet mode me rahegi. Have a productive day at school!_ ✨`;

      case "slot_14_00":
        plan.setupState = "awaiting_current";
        plan.setupPromptSentAt = Date.now();
        return `😴 *02:00 PM — SCHOOL OVER & RUNNING CHAPTERS SETUP!* 🛋️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Aspirants, school se aakar 49 minutes ka deep power nap le lo.
Par pehle shaam ke 3 heavy sessions ka target set kar lete hain!

❓ *Aaj ke teeno subjects ke RUNNING CHAPTERS batayein:*
1️⃣ *Running Biology Chapter:*
2️⃣ *Running Physics Chapter:*
3️⃣ *Running Chemistry Chapter:*

💡 *Aap aise reply de sakte hain (comma ya space se):*
👉 \`Genetics, Electrostatics, Thermodynamics\` ya \`x, y, z\` ya \`x y z\`

_Iske reply ke turant baad hum Backlog chapters puchenge!_ 🎯`;

      case "slot_14_50":
        return `⏰ *02:50 PM — WAKE UP & CALL TO DK!* 📞⚡
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Nap time khatam! Sabhi uth jao!

📞 *MANDATORY REMINDER:*
👉 *DK ko call karne ka time ho gaya hai! Call connect karein!* 👈

💧 *Next:* 03:00 PM - 03:10 PM Fresh up, fir 03:10 PM se Biology Session 2 shuru hoga!
_Utho Champions, Mission NEET evening shift shuru!_ 🚀`;

      case "slot_15_00":
        return `💧 *03:00 PM — 10 MIN QUICK FRESH-UP!* 🚰
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Paani piyo, chehra dho lo aur desk par Biology notes nikal lo!

⏰ *03:10 PM:* *Biology Session 2 (~1.5 Hours Core)* start hoga!
📖 *Present:* ${plan.biologyAfternoon.currentTopic}
⏳ *Backlog:* ${plan.biologyAfternoon.backlogTopic}`;

      case "slot_15_10":
        return `🧬 *SESSION 2: BIOLOGY (~1.5 HOURS CORE)* 🎯
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ *Time:* 03:10 PM - 04:39 PM (89 Mins Core NEET Session)

📖 *Present Topic:* ${plan.biologyAfternoon.currentTopic}
⏳ *Backlog Topic:* ${plan.biologyAfternoon.backlogTopic}

📋 *Dual-Phase Routine (~1.5 Hours Strategy):*
1️⃣ *Phase 1 (Start ➔ ~45 Mins):* Present topic padhein!
   👉 _Shuru karne par likhein:_ \`current padh raha hu\`
2️⃣ *Phase 2 (Remaining Mins):* Backlog topic clear karein!
   👉 _Present khatam hone par report karein:_ \`current done, ab backlog padh raha hu\`
   👉 _Backlog khatam hone par likhein:_ \`backlog done\`

🎯 *Target:* 1.5 Hours me Current chapter + Backlog question solving complete karni hai!
📵 *Phone silent, 100% deep focus mode!* 🔥`;

      case "slot_16_39":
        return `📋 *04:39 PM — BIOLOGY SESSION 2 WRAP-UP!* ⏰
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Aspirants, 1.5 ghante ka Biology session complete ho gaya!

❓ *Status Check:*
Aapka Current & Backlog complete hua?
• Likhein: \`bio done\` ya \`@study done bio\`

☕ *Next:* 04:40 PM se Rest Break & Call to DK time!`;

      case "slot_16_40":
        return `☕ *04:40 PM — REST BREAK & CALL TO DK!* 📞
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
20 minutes ka rest break hai!

📞 *REMINDER:*
👉 *DK ko call kar lo! Rest karo aur fresh mind se baat karo.* 👈

⚡ *Next:* 05:00 PM par *Session 3: Physics (~1.5 Hours)* shuru hoga!`;

      case "slot_17_00":
        return `⚡ *SESSION 3: PHYSICS (~1.5 HOURS CORE)* 📐
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ *Time:* 05:00 PM - 06:29 PM (89 Mins Deep Practice)

📖 *Present Topic:* ${plan.physics.currentTopic}
⏳ *Backlog Topic:* ${plan.physics.backlogTopic}

📋 *Dual-Phase Routine (~1.5 Hours Strategy):*
1️⃣ *Phase 1 (Start ➔ ~45 Mins):* Present topic derivations & theory!
   👉 _Shuru karne par likhein:_ \`current padh raha hu\`
2️⃣ *Phase 2 (Remaining Mins):* Backlog numericals solving!
   👉 _Present khatam hone par report karein:_ \`current done, ab backlog padh raha hu\`
   👉 _Backlog khatam hone par likhein:_ \`backlog done\`

🎯 *Target:* Formulas derivation, concept clarity aur numerical solving!
_Physics me confidence tabhi aayega jab pen chalega! Let's go!_ ✍️⚡`;

      case "slot_18_29":
        return `📋 *06:29 PM — PHYSICS SESSION 3 WRAP-UP!* ⏰
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Physics Session 3 complete! Numericals solve ho gaye?

• Likhein: \`physics done\` ya \`@study done physics\`
🍎 *Next:* 06:30 PM - 06:44 PM 15-min snack/water break!`;

      case "slot_18_30":
        return `🍎 *06:30 PM — 15 MIN QUICK BREAK!* 🥤
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Thoda walk kar lo, snacks ya juice le lo. Eye strain relief break!

🧪 *Next:* 06:45 PM par *Session 4: Chemistry (~1.5 Hours)* shuru hoga!`;

      case "slot_18_45":
        return `🧪 *SESSION 4: CHEMISTRY (~1.5 HOURS CORE)* 🔬
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⏰ *Time:* 06:45 PM - 08:10 PM (85 Mins Final Core Session)

📖 *Present Topic:* ${plan.chemistry.currentTopic}
⏳ *Backlog Topic:* ${plan.chemistry.backlogTopic}

📋 *Dual-Phase Routine (~1.5 Hours Strategy):*
1️⃣ *Phase 1 (Start ➔ ~45 Mins):* Present chapters & reactions!
   👉 _Shuru karne par likhein:_ \`current padh raha hu\`
2️⃣ *Phase 2 (Remaining Mins):* Backlog questions & NCERT reading!
   👉 _Present khatam hone par report karein:_ \`current done, ab backlog padh raha hu\`
   👉 _Backlog khatam hone par likhein:_ \`backlog done\`

🎯 *Target:* Organic/Inorganic/Physical reactions & NCERT line-by-line questions!
_Aaj ka aakhiri study session hai — finish strong!_ 🔥`;

      case "slot_20_10":
        return this.formatDailyScorecard(plan);

      default:
        return `🔔 *Study Schedule Alert: ${slot.title}* (${slot.timeRangeStr})`;
    }
  }

  public formatTodayStatusCard(plan: DayStudyPlan): string {
    const { timeStr } = this.getISTNow();
    const statusIcon = (s?: string) =>
      s === "done" ? "✅ Done" : s === "in_progress" ? "⏳ In-Progress" : "⚪ Pending";

    const memberCount = Object.keys(plan.membersAttendance || {}).length;

    return `📚 *FRIDAY STUDY — DAILY NEET DASHBOARD* 🎯
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 *Date:* ${plan.dateStr} | ⏰ *Current Time:* ${timeStr} IST
👥 *Registered Students Today:* ${memberCount} (_Register:_ \`@study attendance\`)

🧬 *1. Biology (Morning: 05:00 - 06:00 AM):*
• 📖 Present: [${statusIcon(plan.biologyMorning.currentStatus)}] ${plan.biologyMorning.currentTopic}
• ⏳ Backlog: [${statusIcon(plan.biologyMorning.backlogStatus)}] ${plan.biologyMorning.backlogTopic}

🧬 *2. Biology (Core: 03:10 - 04:39 PM):*
• 📖 Present: [${statusIcon(plan.biologyAfternoon.currentStatus)}] ${plan.biologyAfternoon.currentTopic}
• ⏳ Backlog: [${statusIcon(plan.biologyAfternoon.backlogStatus)}] ${plan.biologyAfternoon.backlogTopic}

⚡ *3. Physics (Core: 05:00 - 06:29 PM):*
• 📖 Present: [${statusIcon(plan.physics.currentStatus)}] ${plan.physics.currentTopic}
• ⏳ Backlog: [${statusIcon(plan.physics.backlogStatus)}] ${plan.physics.backlogTopic}

🧪 *4. Chemistry (Core: 06:45 - 08:10 PM):*
• 📖 Present: [${statusIcon(plan.chemistry.currentStatus)}] ${plan.chemistry.currentTopic}
• ⏳ Backlog: [${statusIcon(plan.chemistry.backlogStatus)}] ${plan.chemistry.backlogTopic}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Live Reporting & Attendance Commands:*
• \`present\` ya \`p\` ➔ Haziri mark karein
• \`current padh raha hu\` ➔ Start present topic
• \`current done, ab backlog padh raha hu\` ➔ Switch to backlog (~45 mins)
• \`backlog done\` ➔ Backlog complete
• \`bio done\` / \`physics done\` / \`chem done\` ➔ Full session done
• \`@study attendance\` ➔ Full batch attendance register
• \`@study set <bio/physics/chem> current: ... backlog: ...\`
• \`@study backlog\` ➔ Master backlog list`;
  }

  public formatAttendanceCard(plan: DayStudyPlan): string {
    const { timeStr } = this.getISTNow();
    const members = Object.values(plan.membersAttendance || {});

    const statusEmoji = (s: MemberSessionProgress) => {
      if (s.status === "done" || (s.currentStatus === "done" && s.backlogStatus === "done")) return "✅ Done";
      if (s.currentStatus === "done") return "⚠️ Current Done";
      if (s.currentStatus === "in_progress" || s.backlogStatus === "in_progress" || s.attended) return "⏳ Present";
      return "⚪ Absent";
    };

    let memberListStr = "";
    if (members.length === 0) {
      memberListStr = `_Abhi tak kisi bhi student ne attendance nahi lagayi hai._\n👉 _Attendance ke liye likhein:_ \`present\` ya \`current padh raha hu\``;
    } else {
      const sorted = [...members].sort((a, b) => {
        if (a.isOwner) return -1;
        if (b.isOwner) return 1;
        return b.totalCompletedCount - a.totalCompletedCount || a.userName.localeCompare(b.userName);
      });

      memberListStr = sorted
        .map((m, idx) => {
          const badge = m.isOwner ? "⭐ DK" : `👤 ${m.userName}`;
          const phone = m.userPhone ? ` (+${m.userPhone})` : "";
          const bio1 = statusEmoji(m.sessions.bio1);
          const bio2 = statusEmoji(m.sessions.bio2);
          const phys = statusEmoji(m.sessions.physics);
          const chem = statusEmoji(m.sessions.chem);
          const score = `${m.totalCompletedCount}/4 Sessions`;

          return `${idx + 1}. *${badge}*${phone}
   • 🧬 Bio (05-06 AM): [${bio1}]
   • 🧬 Bio (03:10-04:39 PM): [${bio2}]
   • ⚡ Physics (05-06:29 PM): [${phys}]
   • 🧪 Chemistry (06:45-08:10 PM): [${chem}]
   📊 *Score:* ${score}`;
        })
        .join("\n\n");
    }

    return `📋 *FRIDAY STUDY — BATCH ATTENDANCE REGISTER* 🎓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 *Date:* ${plan.dateStr} | ⏰ *Time:* ${timeStr} IST
👥 *Registered Students Today:* ${members.length}

📚 *Common Class Syllabus (Same for Batch):*
• 🧬 Bio (M): ${plan.biologyMorning.currentTopic}
• 🧬 Bio (A): ${plan.biologyAfternoon.currentTopic} | Backlog: ${plan.biologyAfternoon.backlogTopic}
• ⚡ Physics: ${plan.physics.currentTopic} | Backlog: ${plan.physics.backlogTopic}
• 🧪 Chemistry: ${plan.chemistry.currentTopic} | Backlog: ${plan.chemistry.backlogTopic}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${memberListStr}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Live Attendance Commands:*
• \`present\` ya \`p\` ➔ Haziri mark karein
• \`current padh raha hu\` ➔ Session start reporting
• \`current done, ab backlog padh raha hu\` ➔ Backlog switch
• \`backlog done\` ➔ Backlog complete
• \`bio done\` / \`physics done\` / \`chem done\` ➔ Full session done`;
  }

  public formatDailyScorecard(plan: DayStudyPlan): string {
    let completedCount = 0;
    if (plan.biologyMorning.status === "done" || (plan.biologyMorning.currentStatus === "done" && plan.biologyMorning.backlogStatus === "done")) completedCount++;
    if (plan.biologyAfternoon.status === "done" || (plan.biologyAfternoon.currentStatus === "done" && plan.biologyAfternoon.backlogStatus === "done")) completedCount++;
    if (plan.physics.status === "done" || (plan.physics.currentStatus === "done" && plan.physics.backlogStatus === "done")) completedCount++;
    if (plan.chemistry.status === "done" || (plan.chemistry.currentStatus === "done" && plan.chemistry.backlogStatus === "done")) completedCount++;

    const totalHours = 5.5; // 1 + 1.5 + 1.5 + 1.5
    const completionPercent = Math.round((completedCount / 4) * 100);

    const formatSessionLine = (s: SubjectTopics, name: string) => {
      if (s.status === "done" || (s.currentStatus === "done" && s.backlogStatus === "done")) {
        return `${name}: ✅ Completed (Present + Backlog)`;
      }
      if (s.currentStatus === "done") {
        return `${name}: ⚠️ Present Done, Backlog Incomplete (${s.backlogTopic})`;
      }
      return `${name}: ⏳ Pending (${s.currentTopic})`;
    };

    const members = Object.values(plan.membersAttendance || {});
    let membersSection = "";
    if (members.length > 0) {
      const sorted = [...members].sort((a, b) => {
        if (a.isOwner) return -1;
        if (b.isOwner) return 1;
        return b.totalCompletedCount - a.totalCompletedCount || a.userName.localeCompare(b.userName);
      });
      const memberLines = sorted.map((m, i) => {
        const medal = i === 0 && m.totalCompletedCount > 0 ? "🥇" : i === 1 && m.totalCompletedCount > 0 ? "🥈" : "👤";
        const badge = m.isOwner ? "⭐ DK" : m.userName;
        return `${medal} *${badge}:* ${m.totalCompletedCount}/4 Sessions Completed`;
      });
      membersSection = `\n\n👥 *Batch Leaderboard & Attendance:*\n${memberLines.join("\n")}`;
    }

    return `📊 *NEET STUDY DAILY WRAP-UP & SCORECARD* 🏆
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📅 *Date:* ${plan.dateStr} (08:10 PM IST)

🎯 *Completion Rate:* *${completionPercent}%* (${completedCount} of 4 Sessions Done)
⏱️ *Total Core Study Hours:* ~${totalHours} Hours

🧬 ${formatSessionLine(plan.biologyMorning, "Biology (Morning)")}
🧬 ${formatSessionLine(plan.biologyAfternoon, "Biology (Afternoon)")}
⚡ ${formatSessionLine(plan.physics, "Physics")}
🧪 ${formatSessionLine(plan.chemistry, "Chemistry")}${membersSection}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌟 *Aspirants, har roz ka ye routine aapko NEET ranker banayega!*
_Aaj ka kaam complete ho gaya, ab dinner karein aur rest karein._ 🛌✨`;
  }

  public formatScheduleGuide(): string {
    return `⏰ *FRIDAY STUDY — DEFAULT NEET TIMETABLE* 📋
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🌅 *04:00 AM* ➔ Wake up, Bathing, School Preparation
🧬 *05:00 - 06:00 AM* ➔ *Session 1: Biology* (1 Hr)
🏫 *06:00 AM - 02:00 PM* ➔ *School Time* (Quiet Mode)
😴 *02:00 - 02:49 PM* ➔ *Power Nap / Rest* (49 Mins)
⏰ *02:50 PM* ➔ *Wake up + 📞 Call to DK Alert*
💧 *03:00 - 03:10 PM* ➔ *Fresh Up* (10 Mins)
🧬 *03:10 - 04:39 PM* ➔ *Session 2: Biology* (~1.5 Hrs: Current + Backlog)
☕ *04:40 - 05:00 PM* ➔ *Rest Break + 📞 Call to DK Alert*
⚡ *05:00 - 06:29 PM* ➔ *Session 3: Physics* (~1.5 Hrs: Current + Backlog)
🍎 *06:30 - 06:44 PM* ➔ *Quick Refreshment Break* (15 Mins)
🧪 *06:45 - 08:10 PM* ➔ *Session 4: Chemistry* (~1.5 Hrs: Current + Backlog)
📊 *08:10 PM* ➔ *Daily NEET Wrap-up Scorecard*
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 *Note:* Har 1.5 ghante ke session me sabhi students Current aur Backlog topics cover karte hain!`;
  }

  // ── Background Scheduler Ticker ──────────────────────────────────────────
  public async checkScheduleTicker(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    try {
      const { dateStr, hour, minute } = this.getISTNow();
      const currentMinuteKey = `${dateStr}_${hour.toString().padStart(2, "0")}:${minute.toString().padStart(2, "0")}`;

      // Prevent re-triggering within the same minute
      if (this.lastTriggeredMinuteKey === currentMinuteKey) {
        return;
      }

      // Find any slot matching current hour and minute
      const matchingSlot = FIXED_STUDY_SLOTS.find(
        (s) => s.hour === hour && s.minute === minute
      );

      if (!matchingSlot) {
        return;
      }

      this.lastTriggeredMinuteKey = currentMinuteKey;
      console.log(`[FridayStudy] Matching study slot triggered: ${matchingSlot.id} (${matchingSlot.title}) at ${hour}:${minute} IST.`);

      // Discover active study groups
      const studyGroups = await this.getActiveStudyGroups();
      if (studyGroups.length === 0) {
        console.log("[FridayStudy] No study groups cached yet. Attempting refresh...");
        await this.refreshStudyGroupsCache();
      }

      const activeGroups = await this.getActiveStudyGroups();
      if (activeGroups.length === 0) {
        console.log("[FridayStudy] No groups with 'study' in subject found. Skipping broadcast.");
        return;
      }

      for (const groupId of activeGroups) {
        try {
          const plan = await this.getDailyPlan(groupId, dateStr);

          // Avoid duplicate dispatch for this slot today
          if (plan.dispatchedSlots && plan.dispatchedSlots.includes(matchingSlot.id)) {
            continue;
          }

          const card = this.generateSlotCard(matchingSlot, plan);
          await this.dispatchToGroup(groupId, card);

          if (!plan.dispatchedSlots) plan.dispatchedSlots = [];
          plan.dispatchedSlots.push(matchingSlot.id);
          await this.saveDailyPlan(plan);

          console.log(`[FridayStudy] Dispatched slot ${matchingSlot.id} to study group ${groupId}`);
        } catch (groupErr) {
          console.warn(`[FridayStudy] Failed to dispatch slot to group ${groupId}:`, groupErr);
        }
      }
    } finally {
      this.isChecking = false;
    }
  }

  public async dispatchToGroup(groupId: string, messageText: string): Promise<boolean> {
    if (!this.sock) {
      console.warn("[FridayStudy] Cannot dispatch — WhatsApp socket not attached.");
      return false;
    }

    try {
      // Use clean WhatsApp markdown
      const { whatsappBotService } = await import("./whatsappBotService");
      if (whatsappBotService && typeof whatsappBotService.sendHumanLikeMessage === "function") {
        await whatsappBotService.sendHumanLikeMessage(groupId, messageText);
        return true;
      }

      await this.sock.sendMessage(groupId, { text: messageText });
      return true;
    } catch (e: any) {
      console.warn(`[FridayStudy] Error dispatching to group ${groupId}:`, e?.message || e);
      return false;
    }
  }

  // ── Message Handler for Study Groups ─────────────────────────────────────
  public async handleStudyGroupMessage(ctx: {
    sock: any;
    groupJid: string;
    groupName: string;
    text: string;
    senderName: string;
    senderPhone: string;
    senderJid?: string;
    isOwner: boolean;
  }): Promise<{ handled: boolean; replyText?: string }> {
    const { groupJid, groupName, text, senderName, senderPhone, senderJid, isOwner } = ctx;
    const clean = (text || "").trim();
    const lower = clean.toLowerCase();

    const memberInfo: MemberInfo = {
      senderName: senderName || "Student",
      senderPhone,
      senderJid,
      isOwner,
    };

    // Register this study group
    this.registerStudyGroup(groupJid, groupName);

    const isStudy = this.isStudyGroup(groupJid, groupName);

    // 0A. Check for Study Group Activation Request ("this is study group", "ye study group hai")
    if (this.isStudyGroupActivationRequest(clean)) {
      if (this.isApprovedStudyGroup(groupJid)) {
        return {
          handled: true,
          replyText: `📚 *Yeh group pehle se hi NEET Study Group ke roop me active hai!* 🎯\n\nMain yahan aap sabhi ki dedicated NEET Study Mentor hu. Yahan koi Boss nahi hai — sabhi students barabar hain. Aap bina "Friday" bole direct koi bhi padhai ka sawal ya doubt puchein! 🩺✨`,
        };
      }

      const req = this.requestStudyGroupApproval(
        groupJid,
        groupName || "Study Group",
        memberInfo.senderName,
        memberInfo.senderPhone || ""
      );

      // Alert Boss via private DM / Alert Desk if sock is connected
      if (ctx.sock) {
        this.dispatchApprovalAlertToBoss(ctx.sock, req.alertForBoss).catch((err) => {
          console.warn("[FridayStudy] Error dispatching alert to Boss:", err);
        });
      }

      return {
        handled: true,
        replyText: req.waitMessage,
      };
    }

    // 0B. Check if Boss is approving/rejecting from within the group chat
    if (isOwner) {
      const isApprove = /^(?:approve\s+study|approve|haa|haan|yes|approved)$/i.test(clean);
      const isReject = /^(?:reject\s+study|reject|nahi|no|mat\s+karo)$/i.test(clean);

      if (isApprove && (this.hasPendingApproval() || !isStudy)) {
        const res = await this.approveStudyGroup(groupJid);
        if (res && res.success) {
          return { handled: true, replyText: res.announcement };
        }
      } else if (isReject && (this.hasPendingApproval() || !isStudy)) {
        const res = await this.rejectStudyGroup(groupJid);
        if (res) {
          return { handled: true, replyText: res.announcement };
        }
      }
    }

    // If this is NOT an active study group and not an explicit @study command, do not handle
    const isExplicitStudyCmd = lower.startsWith("@study") || lower.startsWith("/study");
    if (!isStudy && !isExplicitStudyCmd) {
      return { handled: false };
    }

    // 1. Help or info command
    if (lower === "@study help" || lower === "/study help") {
      return {
        handled: true,
        replyText: `📚 *FRIDAY STUDY — HELP & COMMANDS GUIDE* 🎯
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
• \`@study\` ya \`@study status\` ➔ Aaj ka live schedule & topics dashboard
• \`@study attendance\` ya \`@study register\` ➔ Sabhi students ka attendance register
• \`present\` ya \`p\` ➔ Apni session attendance lagayein
• \`@study schedule\` ➔ Full NEET timetable (04:00 AM - 08:10 PM)
• \`@study set bio current: <topic> backlog: <topic>\` ➔ Biology target set karein
• \`@study set physics current: <topic> backlog: <topic>\` ➔ Physics target set karein
• \`@study set chem current: <topic> backlog: <topic>\` ➔ Chemistry target set karein
• \`bio done\` / \`physics done\` / \`chem done\` ➔ Session complete mark karein
• \`@study backlog\` ➔ Master NEET pending backlogs list
• \`@study add backlog <bio/physics/chem>: <chapter>\` ➔ Naya backlog add karein
• \`@study test\` ➔ Current slot ka sample alert card test karein
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
💡 _Natural bhasha me bhi bol sakte hain (e.g. "aaj bio me current genetics aur backlog biomolecules")_ 👍`,
      };
    }

    // 2. Schedule Guide
    if (
      lower === "@study schedule" ||
      lower === "/study schedule" ||
      lower === "@timetable" ||
      lower === "study schedule" ||
      lower === "study timetable"
    ) {
      return { handled: true, replyText: this.formatScheduleGuide() };
    }

    // 3. Status or Dashboard
    if (
      lower === "@study" ||
      lower === "/study" ||
      lower === "@study status" ||
      lower === "/study status" ||
      lower === "study status" ||
      lower === "aaj ka study status"
    ) {
      const plan = await this.getDailyPlan(groupJid);
      return { handled: true, replyText: this.formatTodayStatusCard(plan) };
    }

    // 3B. Batch Attendance Register: @study attendance, @study register, @study haziri
    if (
      lower === "@study attendance" ||
      lower === "/study attendance" ||
      lower === "@study register" ||
      lower === "/study register" ||
      lower === "@study haziri" ||
      lower === "/study haziri" ||
      lower === "study attendance" ||
      lower === "attendance register" ||
      lower === "attendance list" ||
      lower === "aaj ki attendance" ||
      lower === "aaj ki attendance list"
    ) {
      const plan = await this.getDailyPlan(groupJid);
      return { handled: true, replyText: this.formatAttendanceCard(plan) };
    }

    // 3C. Direct Student Attendance Check-in: "present", "p", "hazir", "mai aa gaya", etc.
    const isDirectAttendance =
      /^(?:@study\s+present|\/study\s+present|@study\s+mark\s+attendance|\/study\s+mark\s+attendance|present|p|hazir|present\s+sir|mai\s+aa\s+gaya|main\s+aa\s+gaya|mai\s+aa\s+gayi|main\s+aa\s+gayi|attendance\s+laga\s+do|aaj\s+ki\s+attendance\s+laga\s+do)$/i.test(clean);
    if (isDirectAttendance) {
      const res = await this.recordDirectAttendance(groupJid, undefined, memberInfo);
      return { handled: true, replyText: res.message };
    }

    // 3D. Daily 2:00 PM Question Flow Manual Trigger: @study ask or @study setup
    if (
      lower === "@study ask" ||
      lower === "/study ask" ||
      lower === "@study setup" ||
      lower === "/study setup" ||
      lower === "running chapters pucho" ||
      lower === "aaj ke chapters set karo"
    ) {
      const res = await this.promptDailyQuestions(groupJid);
      return { handled: true, replyText: res.message };
    }

    // 3E. Cancel/Reset setup flow: @study reset or @study cancel
    if (lower === "@study reset" || lower === "/study reset" || lower === "@study cancel") {
      const plan = await this.getDailyPlan(groupJid);
      plan.setupState = "idle";
      plan.pendingCurrentTopics = undefined;
      await this.saveDailyPlan(plan);
      return { handled: true, replyText: "🔄 *Daily chapter setup reset ho gaya hai.*" };
    }

    // 4. Test Trigger (Sends sample card of next slot or current slot)
    if (lower === "@study test" || lower === "/study test") {
      const plan = await this.getDailyPlan(groupJid);
      const sampleSlot = FIXED_STUDY_SLOTS[6]; // Session 2 Bio
      const card = this.generateSlotCard(sampleSlot, plan);
      return {
        handled: true,
        replyText: `🧪 *[TEST DISPATCH PREVIEW]*\n\n${card}`,
      };
    }

    // 5. Backlog Tracker View
    if (lower === "@study backlog" || lower === "/study backlog" || lower === "study backlog" || lower === "backlog list") {
      const backlogs = await this.getBacklogs();
      if (backlogs.length === 0) {
        return {
          handled: true,
          replyText: `✨ *Wah Champions! Abhi koi pending backlog nahi hai!* 🎯\nNaya backlog add karne ke liye likhein:\n\`@study add backlog bio: Cell Division 50 MCQs\``,
        };
      }

      const lines = backlogs.map(
        (b, i) => `${i + 1}. *[${b.subject}]* ${b.topic}`
      );
      return {
        handled: true,
        replyText: `⏳ *NEET PENDING BACKLOGS LIST* 📋\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n${lines.join("\n")}\n\n💡 _Complete karne par likhein:_ \`@study clear backlog <topic>\``,
      };
    }

    // 6. Add Backlog Command
    const addBacklogMatch = clean.match(/^@study\s+add\s+backlog\s+(bio|physics|chem|chemistry|biology):\s*(.+)$/i);
    if (addBacklogMatch) {
      const rawSubj = addBacklogMatch[1].toLowerCase();
      const topic = addBacklogMatch[2].trim();
      const subj = rawSubj.startsWith("phys") ? "Physics" : rawSubj.startsWith("chem") ? "Chemistry" : "Biology";
      await this.addBacklog(subj, topic);
      return {
        handled: true,
        replyText: `✅ *[${subj}] Backlog Added!* 📝\n• Topic: *"${topic}"*\n_Master backlog list me save ho gaya hai!_ 👍`,
      };
    }

    // 7. Clear Backlog Command
    const clearBacklogMatch = clean.match(/^@study\s+clear\s+backlog\s+(.+)$/i);
    if (clearBacklogMatch) {
      const topicQuery = clearBacklogMatch[1].trim();
      const cleared = await this.markBacklogDone(topicQuery);
      if (cleared) {
        return { handled: true, replyText: `🎉 *Backlog Cleared!* "${topicQuery}" mark ho gaya! ✅` };
      }
      return { handled: true, replyText: `❌ "${topicQuery}" backlog list me nahi mila.` };
    }

    // 8. Dual-Phase Reporting Protocol (NEET 1.5-Hour Session Splitting)

    // 8A. Backlog Done Reporter
    // Matches: "backlog done", "backlog khatam", "backlog khatm", "backlog complete", "backlog ho gaya", "@study done backlog", "bio backlog done", "physics backlog done", etc.
    const isBacklogDone =
      /^@study\s+done\s+backlog(?:\s+(bio1|bio2|bio|physics|chem))?$/i.test(clean) ||
      /(?:^|\s)backlog\s+(?:done|khatam|khatm|complete|ho\s*gaya)(?:\s|$)/i.test(clean);
    if (isBacklogDone) {
      const subjMatch = clean.match(/\b(bio1|bio2|bio|biology|physics|phys|chem|chemistry)\b/i);
      const explicitSubj = subjMatch ? subjMatch[1].toLowerCase() : undefined;
      const res = await this.reportBacklogDone(groupJid, explicitSubj, memberInfo);
      return { handled: true, replyText: res.message };
    }

    // 8B. Present Done -> Switch to Backlog Reporter
    // Matches:
    // - "current done, ab backlog padh raha hu"
    // - "current done ab backlog padh raha hu"
    // - "present done, ab backlog padh raha hu"
    // - "present done ab backlog shuru"
    // - "current done ab backlog"
    // - "current ho gaya ab backlog"
    // - "current khatam ab backlog"
    // - "current khatm ab backlog"
    // - "current done"
    // - "present done"
    // - "current ho gaya"
    // - "present ho gaya"
    // - "mai backlog padh raha hu"
    // - "main backlog padh raha hu"
    // - "ab backlog padh raha hu"
    // - "backlog padh raha hu"
    // - "backlog shuru"
    // - "backlog start"
    // - "@study done current"
    // - "@study done present"
    // - "@study start backlog"
    const isPresentDoneOrSwitchingBacklog =
      /(?:current|present)\s*(?:done|khatam|khatm|complete|ho\s*gaya).*backlog/i.test(clean) ||
      /(?:current|present)\s*(?:done|khatam|khatm|complete|ho\s*gaya)/i.test(clean) ||
      /(?:ab\s+|mai\s+|main\s+)?backlog\s+(?:padh\s+raha\s+hu|padh\s+rahi\s+hu|shuru|start)/i.test(clean) ||
      /^@study\s+done\s+(?:current|present)(?:\s+(bio1|bio2|bio|physics|chem))?$/i.test(clean) ||
      /^@study\s+start\s+backlog(?:\s+(bio1|bio2|bio|physics|chem))?$/i.test(clean);
    if (isPresentDoneOrSwitchingBacklog) {
      const subjMatch = clean.match(/\b(bio1|bio2|bio|biology|physics|phys|chem|chemistry)\b/i);
      const explicitSubj = subjMatch ? subjMatch[1].toLowerCase() : undefined;
      const res = await this.reportPresentDoneAndStartBacklog(groupJid, explicitSubj, memberInfo);
      return { handled: true, replyText: res.message };
    }

    // 8C. Present Start Reporter
    // Matches:
    // - "current padh raha hu"
    // - "mai current padh raha hu"
    // - "main current padh raha hu"
    // - "present padh raha hu"
    // - "mai present padh raha hu"
    // - "current start"
    // - "present start"
    // - "current shuru"
    // - "present shuru"
    // - "bio current padh raha hu"
    // - "physics current padh raha hu"
    // - "@study start current"
    // - "@study start present"
    const isPresentStart =
      /^@study\s+start\s+(?:current|present)(?:\s+(bio1|bio2|bio|physics|chem))?$/i.test(clean) ||
      /(?:(?:mai|main)\s+)?(?:current|present)\s+(?:padh\s+raha\s+hu|padh\s+rahi\s+hu|shuru|start)/i.test(clean) ||
      /^(?:start|shuru)\s+(?:current|present)/i.test(clean);
    if (isPresentStart) {
      const subjMatch = clean.match(/\b(bio1|bio2|bio|biology|physics|phys|chem|chemistry)\b/i);
      const explicitSubj = subjMatch ? subjMatch[1].toLowerCase() : undefined;
      const res = await this.reportPresentStarted(groupJid, explicitSubj, memberInfo);
      return { handled: true, replyText: res.message };
    }

    // 8D. Whole Session Done Markers (e.g. "bio done", "physics done", "chem done", "@study done bio")
    const doneMatch = clean.match(/^(?:@study\s+done(?:\s+(bio|biology|physics|chem|chemistry))?|(bio|biology|physics|chem|chemistry)\s+done)$/i);
    if (doneMatch) {
      const raw = (doneMatch[1] || doneMatch[2] || "").toLowerCase();
      const key = raw.startsWith("phys") ? "physics" : raw.startsWith("chem") ? "chem" : raw.startsWith("bio") ? "bio" : undefined;
      const res = await this.markSessionDone(groupJid, key, memberInfo);
      return { handled: true, replyText: res.message };
    }

    // 9. Interactive 2:00 PM Daily Running Chapters & Backlog Setup Flow Listener
    const currentPlan = await this.getDailyPlan(groupJid);
    if (currentPlan.setupState === "awaiting_current" || currentPlan.setupState === "awaiting_backlog") {
      const setupRes = await this.handleDailySetupResponse(groupJid, clean);
      if (setupRes.handled) {
        return setupRes;
      }
    }

    // 10. Structured Target Setter: @study set <subject> current: ... backlog: ...
    const structSetMatch = clean.match(/^@study\s+set\s+(bio|bio1|bio2|physics|chem)\s+current:\s*([^,]+?)(?:\s+backlog:\s*(.+))?$/i);
    if (structSetMatch) {
      const rawSubj = structSetMatch[1].toLowerCase() as "bio" | "bio1" | "bio2" | "physics" | "chem";
      const curr = structSetMatch[2]?.trim();
      const back = structSetMatch[3]?.trim();
      const res = await this.setSessionTopics(groupJid, rawSubj, curr, back);
      return { handled: true, replyText: res.message };
    }

    // 10. Natural Language Target Setting (Boss friendly)
    // Examples:
    // "aaj bio me current genetics aur backlog cell cycle"
    // "bio current: genetics, backlog: cell division"
    // "physics current: electrostatics backlog: kinematics"
    const naturalMatch = clean.match(/(?:aaj\s+)?(bio|biology|physics|chem|chemistry)(?:\s+me)?\s+current[:\s]+([^,]+?)(?:\s*(?:aur|and|,)\s*backlog[:\s]+(.+))?$/i);
    if (naturalMatch) {
      const rawSubj = naturalMatch[1].toLowerCase();
      const curr = naturalMatch[2]?.trim();
      const back = naturalMatch[3]?.trim();
      const key = rawSubj.startsWith("phys") ? "physics" : rawSubj.startsWith("chem") ? "chem" : "bio";
      const res = await this.setSessionTopics(groupJid, key, curr, back);
      return { handled: true, replyText: res.message };
    }

    // 11. Study Group General Interaction: Friday replies as NEET Mentor WITHOUT requiring "Friday"
    // (Because this is a study group, not a general group, and Friday is their dedicated mentor)
    if (isStudy && clean.length > 0) {
      const isSingleReactionEmoji = /^(👍|👎|❤️|🔥|👏|🙏|😂|😍|🎉|👌|💯|⚡|😎|✨|💪|🙌|🤝|💖|😊|🥺|😢|😭|🕊️|💀|🗿|👀)$/u.test(clean);
      if (!isSingleReactionEmoji) {
        const mentorReply = await this.generateStudyMentorReply(
          clean,
          memberInfo.senderName,
          groupName || "Study Group"
        );
        if (mentorReply) {
          return { handled: true, replyText: mentorReply };
        }
      }
    }

    return { handled: false };
  }
}

export const fridayStudyService = new FridayStudyService();
