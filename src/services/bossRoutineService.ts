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
  hintForFriday: string;
  isCustom?: boolean;
  updatedAt?: number;
}

const DEFAULT_ROUTINE_SLOTS: BossRoutineSlot[] = [
  {
    id: "early_morning_gym",
    title: "Gym / Exercise & Morning Workout",
    startHour: 5,
    startMinute: 30,
    endHour: 7,
    endMinute: 30,
    timeRangeStr: "05:30 AM – 07:30 AM",
    activity: "Gym, exercise, physical workout, weight lifting aur fitness",
    hintForFriday: "Boss is waqt gym me exercise/workout karte hain. Confidently bolo ki boss to gym me paseena baha rahe honge.",
  },
  {
    id: "morning_fresh_breakfast",
    title: "Fresh hona, Healthy Breakfast & Day Planning",
    startHour: 7,
    startMinute: 30,
    endHour: 9,
    endMinute: 0,
    timeRangeStr: "07:30 AM – 09:00 AM",
    activity: "Workout ke baad fresh hona, healthy breakfast karna aur din plan karna",
    hintForFriday: "Boss gym se aakar fresh ho rahe hote hain, breakfast kar rahe hote hain ya din shuru kar rahe hote hain.",
  },
  {
    id: "day_deep_coding",
    title: "Deep Focus Coding & Software Development",
    startHour: 9,
    startMinute: 0,
    endHour: 13,
    endMinute: 30,
    timeRangeStr: "09:00 AM – 01:30 PM",
    activity: "Deep focus coding, system architecture, programming aur AI projects work",
    hintForFriday: "Boss is waqt screen ke saamne coding ya development me fully engrossed hote hain.",
  },
  {
    id: "lunch_break",
    title: "Lunch Break & Afternoon Rest",
    startHour: 13,
    startMinute: 30,
    endHour: 14,
    endMinute: 30,
    timeRangeStr: "01:30 PM – 02:30 PM",
    activity: "Dopahar ka lunch khana aur thoda aaram / unwind karna",
    hintForFriday: "Boss ka dopahar ke lunch ka time hai.",
  },
  {
    id: "afternoon_work",
    title: "Afternoon Work, Problem Solving & Project Execution",
    startHour: 14,
    startMinute: 30,
    endHour: 18,
    endMinute: 30,
    timeRangeStr: "02:30 PM – 06:30 PM",
    activity: "Coding, technical problem solving, testing aur daily tasks execute karna",
    hintForFriday: "Boss second half ke work, debugging aur tasks complete kar rahe hote hain.",
  },
  {
    id: "evening_walk_chill",
    title: "Evening Walk, Fresh Air, Chai & Relaxing",
    startHour: 18,
    startMinute: 30,
    endHour: 20,
    endMinute: 0,
    timeRangeStr: "06:30 PM – 08:00 PM",
    activity: "Shaam ki walk, taaza hawa, chai peena, dosto se baat ya relax karna",
    hintForFriday: "Boss evening walk par hote hain, chai pee rahe hote hain ya fresh air me relax karte hain.",
  },
  {
    id: "dinner_time",
    title: "Dinner & Relaxed Downtime",
    startHour: 20,
    startMinute: 0,
    endHour: 21,
    endMinute: 30,
    timeRangeStr: "08:00 PM – 09:30 PM",
    activity: "Raat ka dinner khana aur relaxed time bitana",
    hintForFriday: "Boss dinner kar rahe hote hain aur chill karte hain.",
  },
  {
    id: "night_wind_down",
    title: "Light Coding, Learning, Music & Winding Down",
    startHour: 21,
    startMinute: 30,
    endHour: 23,
    endMinute: 30,
    timeRangeStr: "09:30 PM – 11:30 PM",
    activity: "Light coding, research, music sunna, social catchup aur din wrap-up",
    hintForFriday: "Boss din ka review, light tech exploration ya music ke sath wind-down karte hain.",
  },
  {
    id: "night_sleep",
    title: "Sleep / Deep Rest (or Late Night Coding)",
    startHour: 23,
    startMinute: 30,
    endHour: 5,
    endMinute: 30,
    timeRangeStr: "11:30 PM – 05:30 AM",
    activity: "Sona, deep rest (ya kabhi-kabhi late night intense coding session)",
    hintForFriday: "Boss is waqt so rahe hote hain, ya agar awake hain toh late-night deep focus coding me hote hain.",
  },
];

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
      // Seed default slots in memory first for instantaneous synchronous access
      for (const slot of DEFAULT_ROUTINE_SLOTS) {
        this.inMemorySlots.set(slot.id, slot);
      }

      // Try loading custom/persisted overrides from Firestore
      const snap = await routineCol().get();
      if (!snap.empty) {
        for (const doc of snap.docs) {
          const data = doc.data() as BossRoutineSlot;
          this.inMemorySlots.set(data.id, data);
        }
      } else {
        // Seed default slots into Firestore if empty
        const batch = db.batch();
        for (const slot of DEFAULT_ROUTINE_SLOTS) {
          batch.set(routineCol().doc(slot.id), slot);
        }
        await batch.commit().catch(() => {});
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
   * Matches current IST time against routine slots.
   */
  public getCurrentHabit(date: Date = new Date()): {
    currentSlot: BossRoutineSlot;
    nextSlot?: BossRoutineSlot;
    istTimeStr: string;
    istDateStr: string;
  } {
    const { hours, minutes, timeStr, dateStr } = this.getISTTime(date);
    const currentMins = hours * 60 + minutes;

    const slots = Array.from(this.inMemorySlots.values());
    let matchedSlot: BossRoutineSlot | null = null;
    let matchedIndex = -1;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const startMins = slot.startHour * 60 + slot.startMinute;
      const endMins = slot.endHour * 60 + slot.endMinute;

      if (startMins <= endMins) {
        // Normal slot within the same calendar day
        if (currentMins >= startMins && currentMins < endMins) {
          matchedSlot = slot;
          matchedIndex = i;
          break;
        }
      } else {
        // Overnight slot crossing midnight (e.g. 23:30 to 05:30)
        if (currentMins >= startMins || currentMins < endMins) {
          matchedSlot = slot;
          matchedIndex = i;
          break;
        }
      }
    }

    // Default to gym or night sleep if boundary edge
    const fallbackSlot = matchedSlot || slots.find((s) => s.id === "early_morning_gym") || DEFAULT_ROUTINE_SLOTS[0];
    const nextSlot = matchedIndex >= 0 && matchedIndex + 1 < slots.length ? slots[matchedIndex + 1] : slots[0];

    return {
      currentSlot: fallbackSlot,
      nextSlot,
      istTimeStr: timeStr,
      istDateStr: dateStr,
    };
  }

  /**
   * Returns all routine slots.
   */
  public async getAllRoutineSlots(): Promise<BossRoutineSlot[]> {
    await this.initPromise;
    return Array.from(this.inMemorySlots.values());
  }

  /**
   * Updates an existing routine slot or adds a custom habit.
   */
  public async updateRoutineSlot(
    slotQuery: string,
    updates: {
      startTimeStr?: string;
      endTimeStr?: string;
      activity?: string;
      title?: string;
    }
  ): Promise<{ success: boolean; message: string; updatedSlot?: BossRoutineSlot }> {
    await this.initPromise;
    const query = slotQuery.toLowerCase().trim();

    // Find slot by ID, title, or activity keyword (e.g. "gym", "lunch", "coding")
    let target = Array.from(this.inMemorySlots.values()).find(
      (s) =>
        s.id.toLowerCase() === query ||
        s.title.toLowerCase().includes(query) ||
        s.activity.toLowerCase().includes(query) ||
        query.includes(s.id.toLowerCase())
    );

    if (!target) {
      if (query.includes("gym") || query.includes("exercise") || query.includes("workout")) {
        target = this.inMemorySlots.get("early_morning_gym");
      } else if (query.includes("lunch") || query.includes("khana")) {
        target = this.inMemorySlots.get("lunch_break");
      } else if (query.includes("sleep") || query.includes("sona")) {
        target = this.inMemorySlots.get("night_sleep");
      } else if (query.includes("walk") || query.includes("chai")) {
        target = this.inMemorySlots.get("evening_walk_chill");
      }
    }

    if (!target) {
      return {
        success: false,
        message: `Boss ka routine slot '${slotQuery}' match nahi ho paya. Valid slots: gym, breakfast, coding, lunch, walk, dinner, sleep.`,
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
      isCustom: true,
      updatedAt: Date.now(),
    };

    // If time was provided, parse hours/minutes
    if (updates.startTimeStr) {
      const match = updates.startTimeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = match[2] ? parseInt(match[2], 10) : 0;
        const mer = match[3]?.toLowerCase();
        if (mer === "pm" && h < 12) h += 12;
        if (mer === "am" && h === 12) h = 0;
        updated.startHour = h;
        updated.startMinute = m;
      }
    }

    if (updates.endTimeStr) {
      const match = updates.endTimeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
      if (match) {
        let h = parseInt(match[1], 10);
        const m = match[2] ? parseInt(match[2], 10) : 0;
        const mer = match[3]?.toLowerCase();
        if (mer === "pm" && h < 12) h += 12;
        if (mer === "am" && h === 12) h = 0;
        updated.endHour = h;
        updated.endMinute = m;
      }
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
   * Compiles the full prompt context for Friday's System Instruction.
   * This is dynamically injected every session so Friday ALWAYS knows what Boss does right now!
   */
  public async compileRoutinePromptContext(nowDate: Date = new Date()): Promise<string> {
    await this.initPromise;
    const { currentSlot, nextSlot, istTimeStr, istDateStr } = this.getCurrentHabit(nowDate);
    const allSlots = Array.from(this.inMemorySlots.values());

    return `============================================================
🏋️ BOSS DIVAKAR'S (DK'S) DAILY LIFE ROUTINE & HABIT GRAPH:
• Real-time Indian Clock (IST): ${istTimeStr} (${istDateStr})
• 🎯 CURRENT ACTIVE HABIT SLOT: [${currentSlot.timeRangeStr}] ${currentSlot.title}
• 📌 EXPECTED ACTIVITY RIGHT NOW: ${currentSlot.activity}
• 💡 Hint For Friday: ${currentSlot.hintForFriday}
• ⏭️ Next Upcoming Habit: [${nextSlot ? nextSlot.timeRangeStr : "Next Day"}] ${nextSlot ? nextSlot.title : "Morning Routine"}

FULL 24-HOUR HABIT TIMETABLE:
${allSlots.map((s, i) => `${i + 1}. [${s.timeRangeStr}] ${s.title}: ${s.activity}`).join("\n")}

🧠 THEORY OF MIND & PROACTIVE INTUITION MANDATE:
• Whenever Boss (DK) asks situational questions about himself:
  - "Abhi mai kya kar raha hounga?"
  - "Mai abhi kahan hounga?"
  - "Is time mai kya karta hu?"
  - "Mera schedule kya hai?"
  - "Batao to abhi mai kya kar raha hu?"
• CRITICAL: NEVER BE A DUMB LITERAL ROBOT! NEVER say "Mujhe nahi pata aap kya kar rahe hain", "Main aapko dekh nahi sakti", or "Mujhe koi idea nahi hai".
• Check the CURRENT ACTIVE HABIT SLOT above and speak like a loyal, witty human companion:
  👉 Example (Morning/Gym slot): "Boss, abhi ghadi me ${istTimeStr} baj rahe hain — is time toh aap gym / exercise karte hain! Wahan ho ya iske alawa kuch aur kar rahe ho?"
  👉 Example (Lunch slot): "Boss, abhi ${istTimeStr} ho rahe hain, is waqt toh aap lunch kar rahe hote hain! Lunch kar liya ya kisi coding bug me uljhe ho?"
  👉 Example (Walk/Evening slot): "Boss, shaam ke ${istTimeStr} hain — is waqt toh aap evening walk aur chai ke liye nikalte hain! Aaj walk par ho ya system pe baithe ho?"
  👉 Example (Night/Sleep slot): "Boss, raat ke ${istTimeStr} baj rahe hain! Is waqt toh aapko so jana chahiye, so rahe ho ya abhi bhi late-night coding chal rahi hai?"
============================================================`;
  }
}

export const bossRoutineService = new BossRoutineService();
