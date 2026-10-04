import { db } from "./firebaseAdmin";
import { GoogleGenAI } from "@google/genai";
import { memoryEngine, SessionMessage } from "./memoryEngine";
import { liveScratchService } from "./liveScratchService";

/**
 * Live Circadian Session Service for Friday AI (Gemini Live Audio / WebSocket).
 *
 * Implements a continuous conversational session for Boss DK:
 * - Session remains active indefinitely across 03:00 AM IST and across multiple days.
 * - OWNER MANDATE: Session NEVER auto-resets at 03:00 AM IST!
 * - Session ONLY resets when Boss explicitly speaks or writes "new session" / "naya session".
 * - When reset, the previous session is safely finalized and archived into Firestore
 *   and Vector Store, and a fresh session is seamlessly started.
 * - Permanent memories (Personal Vault, Pinned Memories, Profile Facts) are NEVER flushed.
 */
class LiveCircadianSessionService {
  private activeCycleId: string;
  private activeSessionId: string = "live_boss_continuous";
  private geminiAi?: GoogleGenAI;
  private rotationCheckInterval?: NodeJS.Timeout;

  constructor() {
    this.activeCycleId = this.getCircadianCycleId();
    // Ensure memoryEngine has the active continuous session initialized
    memoryEngine.startSession(this.getCurrentLiveSessionId());
    this.initSessionFromDb().catch(() => {});
  }

  private async initSessionFromDb(): Promise<void> {
    try {
      const snap = await db.collection("memory").doc("liveSessionState").get();
      if (snap.exists && snap.data()?.activeSessionId) {
        this.activeSessionId = snap.data()!.activeSessionId;
        memoryEngine.startSession(this.activeSessionId);
      }
    } catch {}
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
   * Returns the stable active session ID for Live Gemini (Continuous for Boss).
   */
  public getCurrentLiveSessionId(): string {
    return this.activeSessionId || "live_boss_continuous";
  }

  /**
   * Checks if user prompt or voice transcript is an explicit 'new session' command.
   */
  public isExplicitNewSessionCommand(text: string): boolean {
    if (!text || typeof text !== "string") return false;
    const clean = text.trim().toLowerCase();
    return /^(?:new\s*session|start\s*new\s*session|naya\s*session|reset\s*session|fresh\s*session|session\s*reset)$/i.test(clean) ||
      /\b(new\s*session\s*(?:start|banao|karo)|start\s*fresh\s*session|naya\s*session\s*shuru)\b/i.test(clean) ||
      (/\b(new\s*session|naya\s*session)\b/i.test(clean) && /\b(start|shuru|karo|banao|reset)\b/i.test(clean));
  }

  /**
   * Resets the Live session ONLY when Boss explicitly writes or speaks 'new session'.
   * 1. Safely archives the previous live session into Firestore and Vector Store.
   * 2. Clears the live scratch turn cache.
   * 3. Initializes a fresh continuous session for Boss.
   */
  public async forceNewSession(ai?: GoogleGenAI): Promise<string> {
    const oldSessionId = this.getCurrentLiveSessionId();
    console.log(`[LiveCircadianSession] 🔄 Boss explicit 'new session' command received. Finalizing session ${oldSessionId}...`);

    const effectiveAi = ai || this.geminiAi;
    try {
      await memoryEngine.finalizeSession(oldSessionId, effectiveAi);
      console.log(`[LiveCircadianSession] ✅ Session ${oldSessionId} safely archived.`);
    } catch (e: any) {
      console.warn(`[LiveCircadianSession] Notice while archiving previous session ${oldSessionId}:`, e?.message || e);
    }

    // Generate new active continuous live session ID
    this.activeSessionId = `live_boss_continuous_${Date.now()}`;
    memoryEngine.startSession(this.activeSessionId);

    // Run scratch lifecycle archive
    try {
      await liveScratchService.runScratchLifecycle(effectiveAi);
    } catch {}

    // Persist new session ID to Firestore
    try {
      await db.collection("memory").doc("liveSessionState").set({
        activeSessionId: this.activeSessionId,
        startedAt: Date.now(),
        startedAtIST: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      });
    } catch {}

    console.log(`[LiveCircadianSession] ✨ Fresh Live Voice Session started for Boss: ${this.activeSessionId}`);
    return this.activeSessionId;
  }

  /**
   * Returns time until the next 03:00 AM IST cycle marker.
   */
  public getNextResetInfo(): { nextResetDateIST: string; msRemaining: number; humanHoursRemaining: string } {
    const now = new Date();
    const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const nextReset = new Date(istNow);

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
   * 3:00 AM IST check:
   * Boss live session is EXEMPT from auto-reset per Boss mandate.
   * It only resets when Boss explicitly types or speaks 'new session'.
   */
  public async checkAndRotateCircadianCycle(_ai?: GoogleGenAI): Promise<boolean> {
    const currentCycle = this.getCircadianCycleId();
    if (currentCycle !== this.activeCycleId) {
      this.activeCycleId = currentCycle;
      console.log(`[LiveCircadianSession] 🌅 03:00 AM IST Day Cycle is now: ${currentCycle}. Boss continuous live session remains active.`);
    }
    return false;
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
BOSS'S ACTIVE CONTINUOUS LIVE VOICE SESSION:
• Active Live Session ID: ${this.activeSessionId}
• Continuity Mode: Continuous across days & 3:00 AM (Owner Mandate: Never auto-resets at 3:00 AM)
• Explicit Reset Rule: This live session ONLY resets when Boss explicitly speaks or writes "new session" / "naya session"!
• Total Spoken Turns in Session: ${turns.length}

🗣️ RECENT SPOKEN TURNS IN THIS ACTIVE LIVE SESSION:
${turnsText ? turnsText : "(No prior spoken turns yet recorded in this active session)"}

⚡ CONVERSATIONAL CONTINUITY MANDATE (ZERO AMNESIA LAW):
1. The dialogue above represents what Boss DK and Friday discussed earlier in this session!
2. Boss often gives short follow-ups like:
   • "haan", "nahi", "haa kal ka batao"
   • "aur batao", "phir kya hua"
   • "jo maine abhi bola", "kal ka weather kya hai"
   • "meri baat suno", "wahi jo pucha tha"
3. NEVER say generic filler like "Haan boss kuch kaam hai kya?" when Boss responds with "haan" or "nahi"!
4. IMMEDIATELY connect Boss's follow-up to the latest question or pending topic from the turns above and answer smoothly and helpfully.
5. If Boss explicitly speaks "new session" or "naya session", enthusiastically confirm that a fresh new session has started!
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
      autoResetAt3Am: false,
      mode: "continuous_until_explicit_new_session_command",
      nextReset: resetInfo,
    };
  }

  /**
   * Manual trigger or voice command execution.
   */
  public async forceResetSession(ai?: GoogleGenAI): Promise<string> {
    return await this.forceNewSession(ai);
  }
}

export const liveCircadianSessionService = new LiveCircadianSessionService();
