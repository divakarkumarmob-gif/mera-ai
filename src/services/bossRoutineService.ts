import { db } from "./firebaseAdmin";

export interface BossRoutineSlot {
  id: string;
  title: string;
  startHour: number; // 0 - 23 (IST)
  startMinute: number; // 0 - 59
  endHour: number; // 0 - 23 (IST)
  endMinute: number; // 0 - 59
  timeRangeStr: string;
  activity: string;
  hintForFriday?: string;
  isCustom?: boolean;
  updatedAt?: number;
}

const routineCol = () => db.collection("memory").doc("bossRoutine").collection("slots");

class BossRoutineService {
  private inMemorySlots: Map<string, BossRoutineSlot> = new Map();
  private isInitialized = false;
  private initPromise: Promise<void>;

  constructor() {
    this.initPromise = this.init();
  }

  private async init(): Promise<void> {
    try {
      // Load user-defined custom slots from Firestore
      const snap = await routineCol().get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const data = doc.data() as BossRoutineSlot;
          const legacyDefaultIds = [
            "early_morning_gym",
            "morning_fresh_breakfast",
            "day_deep_coding",
            "lunch_break",
            "afternoon_work",
            "evening_walk_chill",
            "dinner_time",
            "night_wind_down",
            "night_sleep",
          ];
          if (legacyDefaultIds.includes(data.id) && !data.isCustom) {
            // Delete legacy uncustomized slot
            doc.ref.delete().catch(() => {});
            continue;
          }
          if (data && data.id) {
            this.inMemorySlots.set(data.id, data);
          }
        }
      }
      this.isInitialized = true;
    } catch (e: any) {
      console.warn("[BossRoutineService] Firestore sync warning (using memory cache):", e?.message || e);
      this.isInitialized = true;
    }
  }

  /**
   * Returns current IST time (hours & minutes) safely.
   */
  public getISTTime(date: Date = new Date()): { hours: number; minutes: number; timeStr: string; dateStr: string } {
    const istString = date.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: false });
    const istDate = new Date(istString);
    const hours = istDate.getHours();
    const minutes = istDate.getMinutes();

    const timeStr = date.toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    const dateStr = date.toLocaleDateString("en-IN", {
      timeZone: "Asia/Kolkata",
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    return { hours, minutes, timeStr, dateStr };
  }

  /**
   * Parses time string like "07:30 AM", "7:30 pm", "14:00", "7 am" to hours & minutes.
   */
  public parseTimeString(timeStr?: string): { hour: number; minute: number } | null {
    if (!timeStr) return null;
    const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (!match) return null;
    let h = parseInt(match[1], 10);
    const m = match[2] ? parseInt(match[2], 10) : 0;
    const mer = match[3]?.toLowerCase();
    if (mer === "pm" && h < 12) h += 12;
    if (mer === "am" && h === 12) h = 0;
    return { hour: h, minute: m };
  }

  /**
   * Matches current IST time against user-defined routine slots.
   */
  public getCurrentHabit(date: Date = new Date()): {
    currentSlot: BossRoutineSlot | null;
    nextSlot?: BossRoutineSlot | null;
    istTimeStr: string;
    istDateStr: string;
  } {
    const { hours, minutes, timeStr, dateStr } = this.getISTTime(date);
    const currentMins = hours * 60 + minutes;

    const slots = Array.from(this.inMemorySlots.values());
    if (slots.length === 0) {
      return {
        currentSlot: null,
        nextSlot: null,
        istTimeStr: timeStr,
        istDateStr: dateStr,
      };
    }

    let matchedSlot: BossRoutineSlot | null = null;
    let matchedIndex = -1;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const startMins = slot.startHour * 60 + slot.startMinute;
      const endMins = slot.endHour * 60 + slot.endMinute;

      if (startMins <= endMins) {
        if (currentMins >= startMins && currentMins < endMins) {
          matchedSlot = slot;
          matchedIndex = i;
          break;
        }
      } else {
        // Overnight slot crossing midnight
        if (currentMins >= startMins || currentMins < endMins) {
          matchedSlot = slot;
          matchedIndex = i;
          break;
        }
      }
    }

    const nextSlot =
      matchedIndex >= 0 && matchedIndex + 1 < slots.length
        ? slots[matchedIndex + 1]
        : slots.length > 0
        ? slots[0]
        : null;

    return {
      currentSlot: matchedSlot,
      nextSlot,
      istTimeStr: timeStr,
      istDateStr: dateStr,
    };
  }

  /**
   * Returns all active user-defined routine slots.
   */
  public async getAllRoutineSlots(): Promise<BossRoutineSlot[]> {
    await this.initPromise;
    return Array.from(this.inMemorySlots.values());
  }

  /**
   * Sets or replaces the entire daily routine given by Boss in conversation.
   */
  public async setFullRoutine(
    slotsInput: Array<{
      title: string;
      startTimeStr: string;
      endTimeStr: string;
      activity?: string;
      hintForFriday?: string;
    }>
  ): Promise<{ success: boolean; message: string; slots: BossRoutineSlot[] }> {
    await this.initPromise;

    if (!slotsInput || slotsInput.length === 0) {
      return { success: false, message: "Koi routine slots provide nahi kiye gaye.", slots: [] };
    }

    // Clear old memory slots
    this.inMemorySlots.clear();

    const createdSlots: BossRoutineSlot[] = [];
    const batch = db.batch();

    // First delete all existing slots in Firestore
    try {
      const snap = await routineCol().get();
      snap.docs.forEach((d) => batch.delete(d.ref));
    } catch {}

    for (let i = 0; i < slotsInput.length; i++) {
      const item = slotsInput[i];
      const id = `slot_${item.title.toLowerCase().replace(/[^a-z0-9_]/gi, "_") || i + 1}`;
      const startParsed = this.parseTimeString(item.startTimeStr);
      const endParsed = this.parseTimeString(item.endTimeStr);

      const startHour = startParsed ? startParsed.hour : 9;
      const startMinute = startParsed ? startParsed.minute : 0;
      const endHour = endParsed ? endParsed.hour : 10;
      const endMinute = endParsed ? endParsed.minute : 0;

      const timeRangeStr = `${item.startTimeStr} – ${item.endTimeStr}`;
      const activity = item.activity?.trim() || item.title;
      const hintForFriday = item.hintForFriday || `Boss ka ${item.title} time hai.`;

      const slot: BossRoutineSlot = {
        id,
        title: item.title,
        startHour,
        startMinute,
        endHour,
        endMinute,
        timeRangeStr,
        activity,
        hintForFriday,
        isCustom: true,
        updatedAt: Date.now(),
      };

      this.inMemorySlots.set(id, slot);
      createdSlots.push(slot);
      batch.set(routineCol().doc(id), slot);
    }

    try {
      await batch.commit();
    } catch (e: any) {
      console.warn("[BossRoutineService] Firestore batch write warning:", e?.message || e);
    }

    const summary = createdSlots.map((s, idx) => `${idx + 1}. [${s.timeRangeStr}] ${s.title}`).join("\n");
    return {
      success: true,
      message: `Boss, aapka naya daily routine permanently save ho gaya hai aur follow kiya jayega:\n${summary}`,
      slots: createdSlots,
    };
  }

  /**
   * Adds or updates a user-defined routine slot.
   */
  public async updateRoutineSlot(
    slotQuery: string,
    updates: {
      startTimeStr?: string;
      endTimeStr?: string;
      activity?: string;
      title?: string;
      hintForFriday?: string;
    }
  ): Promise<{ success: boolean; message: string; updatedSlot?: BossRoutineSlot }> {
    await this.initPromise;
    const query = slotQuery.toLowerCase().trim();

    // Find existing slot by ID or title keyword
    let target = Array.from(this.inMemorySlots.values()).find(
      (s) =>
        s.id.toLowerCase() === query ||
        s.title.toLowerCase().includes(query) ||
        s.activity.toLowerCase().includes(query) ||
        query.includes(s.id.toLowerCase())
    );

    const startParsed = this.parseTimeString(updates.startTimeStr);
    const endParsed = this.parseTimeString(updates.endTimeStr);

    if (!target) {
      // Create a brand new custom routine slot
      const id = query.replace(/[^a-z0-9_]/gi, "_").toLowerCase() || `slot_${Date.now()}`;
      const title = updates.title?.trim() || slotQuery;
      const activity = updates.activity?.trim() || title;
      const startHour = startParsed ? startParsed.hour : 9;
      const startMinute = startParsed ? startParsed.minute : 0;
      const endHour = endParsed ? endParsed.hour : 10;
      const endMinute = endParsed ? endParsed.minute : 0;
      const timeRangeStr =
        updates.startTimeStr && updates.endTimeStr
          ? `${updates.startTimeStr} – ${updates.endTimeStr}`
          : `${String(startHour).padStart(2, "0")}:${String(startMinute).padStart(2, "0")} – ${String(endHour).padStart(2, "0")}:${String(endMinute).padStart(2, "0")}`;

      const newSlot: BossRoutineSlot = {
        id,
        title,
        startHour,
        startMinute,
        endHour,
        endMinute,
        timeRangeStr,
        activity,
        hintForFriday: updates.hintForFriday || `Boss ka ${title} time hai.`,
        isCustom: true,
        updatedAt: Date.now(),
      };

      this.inMemorySlots.set(id, newSlot);
      try {
        await routineCol().doc(id).set(newSlot);
      } catch (e: any) {
        console.warn("[BossRoutineService] Firestore write warning:", e?.message || e);
      }

      return {
        success: true,
        message: `Boss, aapka naya routine slot [${newSlot.title}] (${newSlot.timeRangeStr}) add ho gaya ✅`,
        updatedSlot: newSlot,
      };
    }

    const updated: BossRoutineSlot = {
      ...target,
      activity: updates.activity?.trim() || target.activity,
      title: updates.title?.trim() || target.title,
      timeRangeStr:
        updates.startTimeStr && updates.endTimeStr
          ? `${updates.startTimeStr} – ${updates.endTimeStr}`
          : target.timeRangeStr,
      hintForFriday: updates.hintForFriday || target.hintForFriday,
      isCustom: true,
      updatedAt: Date.now(),
    };

    if (startParsed) {
      updated.startHour = startParsed.hour;
      updated.startMinute = startParsed.minute;
    }
    if (endParsed) {
      updated.endHour = endParsed.hour;
      updated.endMinute = endParsed.minute;
    }

    this.inMemorySlots.set(target.id, updated);
    try {
      await routineCol().doc(target.id).set(updated);
    } catch (e: any) {
      console.warn("[BossRoutineService] Firestore write warning:", e?.message || e);
    }

    return {
      success: true,
      message: `Boss, aapka [${updated.title}] routine update ho gaya: ${updated.timeRangeStr} (${updated.activity}) ✅`,
      updatedSlot: updated,
    };
  }

  /**
   * Deletes a routine slot.
   */
  public async deleteRoutineSlot(slotQuery: string): Promise<{ success: boolean; message: string }> {
    await this.initPromise;
    const query = slotQuery.toLowerCase().trim();
    const target = Array.from(this.inMemorySlots.values()).find(
      (s) =>
        s.id.toLowerCase() === query ||
        s.title.toLowerCase().includes(query) ||
        s.activity.toLowerCase().includes(query)
    );

    if (!target) {
      return { success: false, message: `Routine slot '${slotQuery}' nahi mila.` };
    }

    this.inMemorySlots.delete(target.id);
    try {
      await routineCol().doc(target.id).delete();
    } catch (e: any) {
      console.warn("[BossRoutineService] Firestore delete warning:", e?.message || e);
    }

    return { success: true, message: `Boss, aapka routine slot [${target.title}] delete kar diya gaya hai ✅` };
  }

  /**
   * Clears all routine slots completely.
   */
  public async clearAllRoutineSlots(): Promise<{ success: boolean; message: string }> {
    await this.initPromise;
    this.inMemorySlots.clear();

    try {
      const snap = await routineCol().get();
      const batch = db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit().catch(() => {});
    } catch (e: any) {
      console.warn("[BossRoutineService] Firestore clear warning:", e?.message || e);
    }

    return { success: true, message: `Boss, saare routine slots clear kar diye gaye hain. Ab koi rigid schedule nahi hai ✅` };
  }

  /**
   * Compiles the dynamic prompt context for Friday's System Instruction.
   */
  public async compileRoutinePromptContext(nowDate: Date = new Date()): Promise<string> {
    await this.initPromise;
    const { currentSlot, nextSlot, istTimeStr, istDateStr } = this.getCurrentHabit(nowDate);
    const allSlots = Array.from(this.inMemorySlots.values());

    if (allSlots.length === 0) {
      return `============================================================
📅 BOSS DIVAKAR'S (DK'S) LIVE CLOCK & SCHEDULE STATUS:
• Real-time Indian Clock (IST): ${istTimeStr} (${istDateStr})
• 📌 Hardcoded Routine: NONE (No rigid daily timetable is currently saved. Boss follows a dynamic and flexible schedule).
• 🧠 DYNAMIC SCHEDULE & AWARENESS MANDATE:
  - DO NOT make up fake routines (e.g. do NOT assume Boss is in the gym at 5:30 AM or eating lunch at 1:30 PM unless Boss explicitly told you).
  - IF BOSS TELLS YOU HIS ROUTINE IN CONVERSATION (e.g. "Mera routine note karo...", "Mera daily schedule yeh hai...", "Subah 7 baje uthna, 8 baje gym, 10 baje kaam..."):
    -> IMMEDIATELY call tool 'set_boss_full_routine' or 'update_boss_daily_routine' to save it permanently in Firestore!
    -> Strictly follow and remember Boss's routine until he updates or changes it again!
  - Whenever Boss asks situational questions ("Abhi mai kya kar raha hounga?", "Mera schedule kya hai?"):
    State the current IST time (${istTimeStr}), check any live calendar/reminders, and answer naturally and warmly.
============================================================`;
    }

    return `============================================================
📅 BOSS DIVAKAR'S (DK'S) SAVED DAILY ROUTINE & HABIT GRAPH:
• Real-time Indian Clock (IST): ${istTimeStr} (${istDateStr})
${
  currentSlot
    ? `• 🎯 CURRENT ACTIVE HABIT SLOT: [${currentSlot.timeRangeStr}] ${currentSlot.title}
• 📌 EXPECTED ACTIVITY RIGHT NOW: ${currentSlot.activity}
• 💡 Hint For Friday: ${currentSlot.hintForFriday || ""}`
    : `• 🎯 CURRENT ACTIVE HABIT SLOT: Open / Flexible (No specific slot currently active)`
}
${nextSlot ? `• ⏭️ Next Upcoming Habit: [${nextSlot.timeRangeStr}] ${nextSlot.title}` : ""}

SAVED HABIT TIMETABLE (BOSS'S ACTUAL ROUTINE):
${allSlots.map((s, i) => `${i + 1}. [${s.timeRangeStr}] ${s.title}: ${s.activity}`).join("\n")}

🧠 STRICT HABIT EXECUTION MANDATE:
• Strictly follow this routine that Boss has taught you! Always treat this as Boss's active schedule until Boss updates or changes it.
• If Boss updates any slot or provides a new routine during chat, call 'update_boss_daily_routine' or 'set_boss_full_routine'.
• When Boss asks situational questions ("Abhi mai kya kar raha hounga?", "Mera schedule kya hai?", "Is time mai kya karta hu?"):
  - Use the CURRENT ACTIVE HABIT SLOT above based on IST time (${istTimeStr}) and answer smartly and loyally!
============================================================`;
  }
}

export const bossRoutineService = new BossRoutineService();
