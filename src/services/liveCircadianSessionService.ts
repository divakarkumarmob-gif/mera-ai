import { GoogleGenAI } from "@google/genai";
import { memoryEngine, SessionMessage } from "./memoryEngine";
import { liveScratchService } from "./liveScratchService";

/**
 * Live Circadian Session Service for Friday AI (Gemini Live Audio / WebSocket).
 *
 * Implements a continuous 24-hour conversational session anchored at 03:00 AM IST.
 * - Current circadian cycle: 03:00 AM to 02:59:59 AM next morning.
 * - Preserves conversational turn continuity across WebSocket reconnects, page refreshes,
 *   and multi-turn follow-ups ("haa", "nahi", "kal ka kya", "aur batao").
 * - At 03:00 AM IST, safely finalizes and archives the previous day's live session into
 *   Firestore and Vector Store, starting a fresh clean day session.
 * - Permanent memories (Personal Vault, Pinned Memories, Profile Facts) are NEVER flushed.
 */
class LiveCircadianSessionService {
  private activeCycleId: string;
  private geminiAi?: GoogleGenAI;
  private rotationCheckInterval?: NodeJS.Timeout;

  constructor() {
    this.activeCycleId = this.getCircadianCycleId();
    // Ensure memoryEngine has the active circadian session initialized
    memoryEngine.startSession(this.getCurrentLiveSessionId());

    // Run a periodic rotation check every 60 seconds to detect 03:00 AM IST rollover
    this.rotationCheckInterval = setInterval(() => {
      this.checkAndRotateCircadianCycle(this.geminiAi).catch((err) => {
        console.warn("[LiveCircadianSession] Periodic rotation check error:", err?.message || err);
      });
    }, 60000);
  }

  /**
   * Sets or updates the GoogleGenAI instance for background summarization and extraction.
   */
  public setAiClient(ai: GoogleGenAI): void {
    this.geminiAi = ai;
  }

  /**
   * Calculates the circadian cycle ID anchored at 03:00 AM IST (Asia/Kolkata).
   * E.g. 03:00 AM on 2026-10-04 to 02:59:59 AM on 2026-10-05 belongs to "2026-10-04".
   */
  public getCircadianCycleId(now: Date = new Date()): string {
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const hours = istNow.getHours();
    const d = new Date(istNow);
    if (hours < 3) {
      d.setDate(d.getDate() - 1);
    }
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  /**
   * Returns the stable circadian session ID for Live Gemini.
   */
  public getCurrentLiveSessionId(now: Date = new Date()): string {
    return `live_boss_${this.getCircadianCycleId(now)}`;
  }

  /**
   * Returns time until the next 03:00 AM IST reset.
   */
  public getNextResetInfo(): { nextResetDateIST: string; msRemaining: number; humanHoursRemaining: string } {
    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const nextReset = new Date(istNow);
    
    // If before 3 AM, next reset is 3 AM today. Otherwise, 3 AM tomorrow.
    if (istNow.getHours() < 3) {
      nextReset.setHours(3, 0, 0, 0);
    } else {
      nextReset.setDate(nextReset.getDate() + 1);
      nextReset.setHours(3, 0, 0, 0);
    }

    const msRemaining = Math.max(0, nextReset.getTime() - istNow.getTime());
    const hours = Math.floor(msRemaining / (1000 * 60 * 60));
    const mins = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));

    return {
      nextResetDateIST: nextReset.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      msRemaining,
      humanHoursRemaining: `${hours}h ${mins}m`,
    };
  }

  /**
   * Checks if 03:00 AM IST has passed and rotates the circadian live session if needed.
   * If rotated:
   * 1. Safely archives the previous day's session via memoryEngine.finalizeSession.
   * 2. Starts a fresh new day session.
   * 3. Leaves all permanent memories (Vault, Profile, Vector Store) completely intact.
   */
  public async checkAndRotateCircadianCycle(ai?: GoogleGenAI): Promise<boolean> {
    const currentCycle = this.getCircadianCycleId();
    if (currentCycle === this.activeCycleId) {
      return false; // Still within the same circadian day cycle
    }

    const previousCycle = this.activeCycleId;
    const previousSessionId = `live_boss_${previousCycle}`;
    const newSessionId = `live_boss_${currentCycle}`;

    console.log(`[LiveCircadianSession] 🌅 03:00 AM IST Circadian Day Rollover detected!`);
    console.log(`[LiveCircadianSession] Archiving yesterday's live session (${previousSessionId}) and initializing today's session (${newSessionId})...`);

    const effectiveAi = ai || this.geminiAi;

    try {
      // Finalize and archive yesterday's live session (generates summary, stores in Firestore, vectors)
      await memoryEngine.finalizeSession(previousSessionId, effectiveAi);
      console.log(`[LiveCircadianSession] ✅ Yesterday's live session ${previousSessionId} safely archived.`);
    } catch (e: any) {
      console.warn(`[LiveCircadianSession] Notice while archiving previous session ${previousSessionId}:`, e?.message || e);
    }

    // Switch active cycle
    this.activeCycleId = currentCycle;

    // Start fresh circadian session in memoryEngine
    memoryEngine.startSession(newSessionId);
    console.log(`[LiveCircadianSession] ✨ Fresh Live Circadian Day Session initialized: ${newSessionId}`);

    return true;
  }

  /**
   * Records a user or AI message into today's active circadian live session.
   */
  public recordLiveMessage(sender: "user" | "ai", text: string): void {
    if (!text || !text.trim()) return;
    const sessionId = this.getCurrentLiveSessionId();
    memoryEngine.recordMessage(sessionId, sender, text.trim());
  }

  /**
   * Retrieves recent messages from today's active circadian live session.
   * If memory is empty (e.g. server was restarted mid-day), falls back to hydrating from liveScratchService.
   */
  public async getRecentDialogueTurns(limit: number = 16): Promise<SessionMessage[]> {
    const sessionId = this.getCurrentLiveSessionId();
    let messages = memoryEngine.getRecentSessionMessages(sessionId, limit);

    if (messages.length === 0) {
      // Server may have just booted mid-day. Hydrate recent scratch turns from last 18 hours
      try {
        const scratchTurns = await liveScratchService.getRecentScratchTurns(18);
        const dayPrefix = this.activeCycleId;
        const matching = scratchTurns.filter((t) => {
          return t.sessionId === sessionId || (t.spokenTimeIST && t.spokenTimeIST.includes(dayPrefix));
        });

        if (matching.length > 0) {
          messages = matching.slice(-limit).map((t) => ({
            sender: t.sender,
            text: t.text,
            timestamp: t.timestamp,
            timeStr: t.spokenTimeIST,
          }));
        }
      } catch (err) {
        console.warn("[LiveCircadianSession] Fallback hydration warning:", err);
      }
    }

    return messages;
  }

  /**
   * Compiles the formatted dialogue context to inject into Gemini Live system prompt.
   * Gives Gemini Live 100% awareness of today's conversation turns across reconnects & follow-ups.
   */
  public async compileCircadianPromptContext(limit: number = 16): Promise<string> {
    const turns = await this.getRecentDialogueTurns(limit);
    const resetInfo = this.getNextResetInfo();

    let turnsText = "";
    if (turns.length > 0) {
      turnsText = turns
        .map((t) => {
          const time = t.timeStr || new Date(t.timestamp).toLocaleTimeString("en-IN", {
            timeZone: "Asia/Kolkata",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
          const speaker = t.sender === "user" ? "Boss DK" : "Friday (You)";
          return `[${time}] ${speaker}: "${t.text}"`;
        })
        .join("\n");
    }

    return `
============================================================
TODAY'S ACTIVE LIVE VOICE SESSION (03:00 AM IST CIRCADIAN CYCLE):
• Active Day Cycle ID: ${this.activeCycleId} (Runs 03:00 AM to 02:59:59 AM next morning)
• Next Scheduled 3:00 AM Reset: in ${resetInfo.humanHoursRemaining} (${resetInfo.nextResetDateIST})
• Total Spoken Turns Today: ${turns.length}

🗣️ RECENT TURNS SPOKEN TODAY IN THIS ACTIVE LIVE SESSION:
${turnsText ? turnsText : "(No prior spoken turns yet today in this circadian cycle — this is the first interaction of the day)"}

⚡ CONVERSATIONAL CONTINUITY MANDATE (ZERO AMNESIA LAW):
1. The dialogue above represents what Boss DK and Friday discussed earlier today in this live session!
2. Boss often gives short follow-ups like:
   • "haan", "nahi", "haa kal ka batao"
   • "aur batao", "phir kya hua"
   • "jo maine abhi bola", "kal ka weather kya hai"
   • "meri baat suno", "wahi jo pucha tha"
3. NEVER say generic filler like "Haan boss kuch kaam hai kya?" when Boss responds with "haan" or "nahi"!
4. IMMEDIATELY connect Boss's follow-up to the latest question or pending topic from the turns above and answer smoothly and helpfully.
============================================================`.trim();
  }

  /**
   * Returns metadata and diagnostic status of the active circadian session.
   */
  public getStatus() {
    const sessionId = this.getCurrentLiveSessionId();
    const session = memoryEngine.getSession(sessionId);
    const resetInfo = this.getNextResetInfo();

    return {
      activeCycleId: this.activeCycleId,
      sessionId,
      turnCount: session?.messages.length || 0,
      startTime: session?.startTime || Date.now(),
      nextReset: resetInfo,
    };
  }

  /**
   * Manual trigger for testing or admin override.
   */
  public async forceResetSession(ai?: GoogleGenAI): Promise<void> {
    const sessionId = this.getCurrentLiveSessionId();
    console.log(`[LiveCircadianSession] Manual force reset triggered for ${sessionId}`);
    await memoryEngine.finalizeSession(sessionId, ai || this.geminiAi);
    this.activeCycleId = this.getCircadianCycleId();
    memoryEngine.startSession(this.getCurrentLiveSessionId());
  }
}

export const liveCircadianSessionService = new LiveCircadianSessionService();
