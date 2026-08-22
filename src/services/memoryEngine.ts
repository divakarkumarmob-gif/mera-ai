import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";

export interface SessionMessage {
  sender: "user" | "ai";
  text: string;
  timestamp: number;
}

export interface ConversationSession {
  id: string;
  startTime: number;
  endTime?: number;
  dateStr: string;
  messages: SessionMessage[];
  summary?: string;
  pinnedFacts?: string[];
  mistakesOrInsights?: string[];
}

export interface LongTermMemoryData {
  pinnedMemories: { id: string; fact: string; date: string; timestamp: number }[];
  profileFacts: string[];
  knownMistakes: string[];
  sessions: ConversationSession[];
}

const dbDir = path.resolve("data");
try {
  fs.mkdirSync(dbDir, { recursive: true });
} catch {}

const memoryFilePath = path.join(dbDir, "memory.json");

class MemoryEngine {
  private data: LongTermMemoryData = {
    pinnedMemories: [],
    profileFacts: [],
    knownMistakes: [],
    sessions: [],
  };

  private activeSessions: Map<string, ConversationSession> = new Map();

  constructor() {
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(memoryFilePath)) {
        const raw = fs.readFileSync(memoryFilePath, "utf-8");
        const parsed = JSON.parse(raw);
        this.data = {
          pinnedMemories: parsed.pinnedMemories || [],
          profileFacts: parsed.profileFacts || [],
          knownMistakes: parsed.knownMistakes || [],
          sessions: parsed.sessions || [],
        };
      }
    } catch (e) {
      console.error("[MemoryEngine] Failed to load memory.json, starting fresh:", e);
    }
  }

  public persist() {
    try {
      fs.writeFileSync(memoryFilePath, JSON.stringify(this.data, null, 2), "utf-8");
    } catch (e) {
      console.error("[MemoryEngine] Failed to persist memory.json:", e);
    }
  }

  public startSession(sessionId: string): ConversationSession {
    const now = Date.now();
    const session: ConversationSession = {
      id: sessionId,
      startTime: now,
      dateStr: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      messages: [],
    };
    this.activeSessions.set(sessionId, session);
    return session;
  }

  public recordMessage(sessionId: string, sender: "user" | "ai", text: string) {
    if (!text || !text.trim()) return;
    let session = this.activeSessions.get(sessionId);
    if (!session) {
      session = this.startSession(sessionId);
    }
    session.messages.push({
      sender,
      text: text.trim(),
      timestamp: Date.now(),
    });
  }

  public async finalizeSession(sessionId: string, ai?: GoogleGenAI) {
    const session = this.activeSessions.get(sessionId);
    if (!session || session.messages.length === 0) {
      this.activeSessions.delete(sessionId);
      return;
    }

    session.endTime = Date.now();
    this.activeSessions.delete(sessionId);

    // Save session to history list
    this.data.sessions.push(session);
    // Keep max 50 recent sessions stored
    if (this.data.sessions.length > 50) {
      this.data.sessions = this.data.sessions.slice(-50);
    }
    this.persist();

    // Auto Summarize & Extract Memories in Background if AI client provided
    if (ai && session.messages.length >= 2) {
      this.autoSummarizeSession(session, ai).catch((err) => {
        console.error(`[MemoryEngine] Summarization failed for session ${sessionId}:`, err);
      });
    }
  }

  private async autoSummarizeSession(session: ConversationSession, ai: GoogleGenAI) {
    try {
      const transcript = session.messages
        .map((m) => `${m.sender === "user" ? "DK" : "Friday"}: ${m.text}`)
        .join("\n");

      const prompt = `You are Friday AI's memory summarizer. Analyze this conversation between user DK and Friday.
Extract key long-term insights and return ONLY a valid JSON object matching this schema:
{
  "summary": "Brief 2-3 sentence summary of what was discussed, what DK asked, and what answers were given.",
  "pinnedMemories": ["Array of explicit facts DK asked to remember, e.g., if DK said 'yeh yaad rakhna', 'don't forget this', 'yaad rakho', or shared personal facts"],
  "mistakes": ["Array of any mistakes, confusion, or errors DK made or struggled with during the discussion"],
  "profileFacts": ["New facts learned about DK, his preferences, projects, or goals"]
}

Conversation:
${transcript}`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        },
      });

      const text = response.text || "{}";
      const parsed = JSON.parse(text);

      session.summary = parsed.summary || "";
      session.pinnedFacts = Array.isArray(parsed.pinnedMemories) ? parsed.pinnedMemories : [];
      session.mistakesOrInsights = Array.isArray(parsed.mistakes) ? parsed.mistakes : [];

      // Add to global pinned memories
      if (session.pinnedFacts && session.pinnedFacts.length > 0) {
        for (const fact of session.pinnedFacts) {
          if (fact && !this.data.pinnedMemories.some((p) => p.fact.toLowerCase() === fact.toLowerCase())) {
            this.data.pinnedMemories.push({
              id: Math.random().toString(36).substring(2, 9),
              fact,
              date: session.dateStr,
              timestamp: session.startTime,
            });
          }
        }
      }

      // Add to DK profile facts
      if (Array.isArray(parsed.profileFacts)) {
        for (const f of parsed.profileFacts) {
          if (f && !this.data.profileFacts.includes(f)) {
            this.data.profileFacts.push(f);
          }
        }
      }

      // Add to known mistakes
      if (Array.isArray(parsed.mistakes)) {
        for (const m of parsed.mistakes) {
          if (m && !this.data.knownMistakes.includes(m)) {
            this.data.knownMistakes.push(m);
          }
        }
      }

      this.persist();
      console.log(`[MemoryEngine] Successfully summarized session ${session.id}: "${session.summary}"`);
    } catch (e) {
      console.error("[MemoryEngine] Auto-summarization error:", e);
    }
  }

  public addPinnedMemory(fact: string) {
    if (!fact || !fact.trim()) return;
    const now = Date.now();
    this.data.pinnedMemories.push({
      id: Math.random().toString(36).substring(2, 9),
      fact: fact.trim(),
      date: new Date(now).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
      timestamp: now,
    });
    this.persist();
  }

  public getMemories() {
    return {
      pinnedMemories: this.data.pinnedMemories,
      profileFacts: this.data.profileFacts,
      knownMistakes: this.data.knownMistakes,
      pastSessionsCount: this.data.sessions.length,
      recentSessions: this.data.sessions.slice(-10),
    };
  }

  public clearAll() {
    this.data = {
      pinnedMemories: [],
      profileFacts: [],
      knownMistakes: [],
      sessions: [],
    };
    this.persist();
  }

  /**
   * Compiles the full persistent memory context to inject into Friday's system prompt.
   * Includes:
   * 1. Explicit Pinned Memories (facts DK told Friday to remember)
   * 2. DK's Profile & Known Mistakes
   * 3. Summary timeline of past conversations (5 days ago, yesterday, etc.)
   * 4. Exact transcripts of the LAST 5 CONVERSATIONS
   */
  public compileMemoryPrompt(): string {
    const sections: string[] = [];

    // 1. Explicit Pinned Memories
    if (this.data.pinnedMemories.length > 0) {
      const pinnedList = this.data.pinnedMemories
        .slice(-20)
        .map((p, i) => `${i + 1}. [Saved on ${p.date}]: "${p.fact}"`)
        .join("\n");
      sections.push(`### IMPORTANT FACTS DK SPECIFICALLY ASKED YOU TO REMEMBER ("YEH YAAD RAKHNA"):\n${pinnedList}`);
    }

    // 2. DK Profile Facts & Known Mistakes
    if (this.data.profileFacts.length > 0 || this.data.knownMistakes.length > 0) {
      let profileText = "";
      if (this.data.profileFacts.length > 0) {
        profileText += `Known Facts about DK:\n- ${this.data.profileFacts.slice(-15).join("\n- ")}\n`;
      }
      if (this.data.knownMistakes.length > 0) {
        profileText += `Past Mistakes/Weaknesses DK made previously (for you to help correct):\n- ${this.data.knownMistakes.slice(-15).join("\n- ")}`;
      }
      sections.push(`### DK'S PROFILE & LEARNING CONTEXT:\n${profileText.trim()}`);
    }

    // 3. Past Sessions Timeline (Earlier than last 5)
    const olderSessions = this.data.sessions.slice(0, -5).filter((s) => s.summary);
    if (olderSessions.length > 0) {
      const timeline = olderSessions
        .slice(-10)
        .map((s) => `- [${s.dateStr}]: ${s.summary}`)
        .join("\n");
      sections.push(`### HISTORICAL SESSIONS TIMELINE (PAST DAYS):\n${timeline}`);
    }

    // 4. EXACT TRANSCRIPTS OF LAST 5 CONVERSATIONS
    const last5Sessions = this.data.sessions.slice(-5);
    if (last5Sessions.length > 0) {
      const transcriptBlocks = last5Sessions.map((s, idx) => {
        const dialog = s.messages
          .slice(-12)
          .map((m) => `${m.sender === "user" ? "DK" : "Friday"}: ${m.text}`)
          .join("\n");
        return `--- Conversation #${idx + 1} (${s.dateStr}) ---${s.summary ? `\nSummary: ${s.summary}` : ""}\nExact Dialogue:\n${dialog}`;
      });
      sections.push(`### EXACT TRANSCRIPTS OF THE LAST ${last5Sessions.length} CONVERSATION(S):\n${transcriptBlocks.join("\n\n")}`);
    }

    if (sections.length === 0) {
      return "[Memory is currently empty. This is your first interaction with DK. Learn about him and remember everything he shares!]";
    }

    return sections.join("\n\n");
  }
}

export const memoryEngine = new MemoryEngine();
