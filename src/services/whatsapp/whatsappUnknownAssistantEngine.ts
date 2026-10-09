import { getMessengerGeminiClient } from "../geminiKeyPoolService";
import { SenderIdentity } from "./whatsappIdentityAgent";
import { IntentRouteResult } from "./whatsappIntentRouterAgent";

export interface UnknownChatSession {
  jid: string;
  senderName: string;
  history: Array<{ role: "user" | "model"; text: string }>;
  lastActive: number;
}

export class WhatsAppUnknownAssistantEngine {
  // In-memory working sessions per unknown chat (Reset daily at 3:00 AM IST)
  private sessions: Map<string, UnknownChatSession> = new Map();

  // Fast/Low tier model chain for high throughput and swift assistant answers
  public static readonly LOW_MODEL_CHAIN = [
    "gemini-3.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
  ];

  /**
   * Resets all unknown sessions at 3:00 AM IST circadian reset
   */
  public resetSessions(): void {
    this.sessions.clear();
    console.log("[UnknownAssistantEngine] 🔄 All unknown working chat sessions reset at 03:00 AM IST.");
  }

  /**
   * Generates a polite, helpful assistant reply for unknown/unsaved contacts.
   * Persona: "DK ka Assistant". Solves their questions/problems, assists them politely.
   */
  public async generateAssistantReply(
    text: string,
    identity: SenderIdentity,
    route: IntentRouteResult,
    replyJid: string
  ): Promise<string> {
    const sessionKey = replyJid;
    let session = this.sessions.get(sessionKey);
    if (!session) {
      session = {
        jid: replyJid,
        senderName: identity.displayName,
        history: [],
        lastActive: Date.now(),
      };
      this.sessions.set(sessionKey, session);
    }

    session.lastActive = Date.now();

    const recentContext = session.history
      .slice(-4)
      .map((h) => `${h.role === "user" ? identity.displayName : "Assistant"}: "${h.text}"`)
      .join("\n");

    const systemPrompt = `You are the smart personal assistant of Divakar (DK) answering an incoming inquiry from an unknown or unsaved number on WhatsApp.

ROLE & PERSONA:
- Your identity: "DK ka Assistant" (Divakar's smart, courteous executive assistant).
- You are answering on DK's WhatsApp because DK is occupied right now.
- Your goal: Be very polite, respectful, and genuinely helpful. Answer their questions and resolve their problems efficiently.

STRICT PRIVACY & SECURITY BOUNDARIES:
- NEVER reveal DK's personal passwords, bank details, home address, or personal contact numbers of other people.
- NEVER discuss DK's girlfriend, relationships, or private secrets.
- If they ask general knowledge, studies, tech, or business questions: Give clear, smart, helpful answers.
- If they need to reach DK directly: Tell them you will note down their name and query and pass it to DK as soon as he is available.

STYLE & TONE:
- Fluent, polite Hindi / Hinglish.
- Professional, welcoming, and concise (max 2-3 short sentences).
- Use *bold* for key terms.
- Output ONLY the reply message text.`;

    const ai = getMessengerGeminiClient();

    for (const model of WhatsAppUnknownAssistantEngine.LOW_MODEL_CHAIN) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `${systemPrompt}\n\n${recentContext ? `Recent chat context:\n${recentContext}\n\n` : ""}Incoming message from user:\n"${text}"`,
                },
              ],
            },
          ],
        });

        const reply = response.text?.trim();
        if (reply) {
          session.history.push({ role: "user", text });
          session.history.push({ role: "model", text: reply });
          if (session.history.length > 15) session.history = session.history.slice(-15);
          return reply;
        }
      } catch (err) {
        console.warn(`[UnknownAssistantEngine] Model ${model} turn error:`, err);
      }
    }

    return "Namaste! Main DK ka assistant hoon. DK abhi available nahi hain, par aap apna naam aur kaam bata dijiye, main unko note kara dunga 👍";
  }
}

export const whatsappUnknownAssistantEngine = new WhatsAppUnknownAssistantEngine();
