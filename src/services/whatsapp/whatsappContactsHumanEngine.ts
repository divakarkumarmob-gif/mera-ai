import { getMessengerGeminiClient } from "../geminiKeyPoolService";
import { SenderIdentity } from "./whatsappIdentityAgent";
import { IntentRouteResult } from "./whatsappIntentRouterAgent";

export interface HumanChatSession {
  jid: string;
  senderName: string;
  relation: string;
  history: Array<{ role: "user" | "model"; text: string }>;
  lastActive: number;
}

export class WhatsAppContactsHumanEngine {
  // In-memory working sessions per chat (Reset daily at 3:00 AM IST)
  private sessions: Map<string, HumanChatSession> = new Map();

  // Medium model chain for high empathy and natural human conversational fluency
  public static readonly MEDIUM_MODEL_CHAIN = [
    "gemini-3.5-flash",
    "gemini-2.5-flash",
    "gemini-3.5-flash-lite",
  ];

  /**
   * Resets all in-memory human sessions at 3:00 AM IST circadian reset
   */
  public resetSessions(): void {
    this.sessions.clear();
    console.log("[ContactsHumanEngine] 🔄 All contacts working chat sessions reset at 03:00 AM IST.");
  }

  /**
   * Generates a 100% human-like reply for saved contacts.
   * ABSOLUTE MANDATE: NEVER DISCLOSE BEING AN AI / BOT / ASSISTANT!
   */
  public async generateHumanReply(
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
        relation: identity.relation,
        history: [],
        lastActive: Date.now(),
      };
      this.sessions.set(sessionKey, session);
    }

    session.lastActive = Date.now();

    // Relationship-specific human styling
    let relationPromptGuideline = "";
    if (identity.role === "MOM" || identity.role === "DAD") {
      relationPromptGuideline = `
- SENDER RELATION: ${identity.role === "MOM" ? "Mummy (Mother)" : "Papa (Father)"} (${identity.displayName}).
- MANNERS & TONE: Be extremely respectful, loving, sweet, and caring (sanskari).
- If asking about DK: "Haan Mummy/Papa ji, DK abhi bas kisi zaroori kaam me / study me laga hai, thodi der me free hoke aapko call karega! Aap theek hain na? Khana kha liya aapne?"
- Keep reply short, warm, and comforting like a loving family message.`;
    } else if (identity.role === "GIRLFRIEND") {
      relationPromptGuideline = `
- SENDER RELATION: DK's Girlfriend / Special Person (${identity.displayName}).
- MANNERS & TONE: Exceptionally sweet, caring, warm, romantic, and affectionate.
- If asking about DK: "Arey baby! DK abhi kisi zaroori kaam me thoda busy hai, par maine unhe bata diya hai ki aapka text aaya hai. Wo jaise hi phone dekhenge sabse pehle aapko hi reply/call karenge ❤️ Aap batao, sab theek? Din kaisa gaya?"
- Always make her feel valued, loved, and happy.`;
    } else if (identity.role === "FRIEND") {
      relationPromptGuideline = `
- SENDER RELATION: Close Friend / Bestfriend (${identity.displayName}).
- MANNERS & TONE: Super cool, fun, witty buddy vibe (bhai / yaar banter).
- If asking about DK: "Arey bhai! DK abhi thoda busy hai kisi kaam me. Bata kya scene hai? Kuch khas kaam tha kya?"
- If general question or chatting: Answer smartly with humor and friendship.`;
    } else if (identity.role === "BROTHER" || identity.role === "SISTER") {
      relationPromptGuideline = `
- SENDER RELATION: Sibling (${identity.role === "BROTHER" ? "Bhai" : "Behen"}) (${identity.displayName}).
- MANNERS & TONE: Casual, caring, warm family sibling vibe.
- If asking about DK: "Haan bhai/didi, DK abhi busy hai, thodi der me call karta hai. Batao kya baat hai?"`;
    } else {
      relationPromptGuideline = `
- SENDER RELATION: Saved Contact & Friend (${identity.displayName}).
- MANNERS & TONE: Polite, helpful, intelligent, and warm.
- Answer whatever they ask directly and intelligently. If asking about DK, say DK is busy and will get back shortly.`;
    }

    const recentContext = session.history.slice(-6).map((h) => `${h.role === "user" ? identity.displayName : "Me"}: "${h.text}"`).join("\n");

    const systemPrompt = `You are a real, natural human chatting on WhatsApp with a close contact of Divakar (DK).

🚨 ABSOLUTE SUPREME DIRECTIVE (ZERO AI DISCLOSURE):
- You MUST TALK 100% LIKE A REAL HUMAN INSAAN!
- NEVER EVER reveal or even hint that you are an AI, bot, virtual assistant, language model, machine, or automated system!
- If asked "kya tum AI ho?", reply naturally like a human laughing it off: "Haha kya baat kar rahe ho, insaan hoon bhai/yaar! Kya chal raha hai?"
- Talk naturally in fluent, casual Hindi / Hinglish.

${relationPromptGuideline}

📋 CONVERSATION CONTEXT:
- Sender Name: ${identity.displayName}
- Sender Relation: ${identity.relation || "Contact"}
${route.memoryContext ? `\n🧠 RECALLED RELEVANT CONTEXT:\n${route.memoryContext}` : ""}
${recentContext ? `\n💬 TODAY'S RECENT CHAT:\n${recentContext}` : ""}

FORMATTING RULES:
- Use standard WhatsApp style (crisp, human-length texts).
- Do not write giant robotic essays. Keep it natural (1-3 sentences like real WhatsApp texting).
- Use *bold* for emphasis, normal casual punctuation.
- Output ONLY the reply message text without any prefixes.`;

    const contents = [
      { role: "user", parts: [{ text }] },
    ];

    const ai = getMessengerGeminiClient();

    for (const model of WhatsAppContactsHumanEngine.MEDIUM_MODEL_CHAIN) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [{ text: `${systemPrompt}\n\nIncoming message from ${identity.displayName}:\n"${text}"` }] }],
        });

        const reply = response.text?.trim();
        if (reply) {
          // Record turn in session history
          session.history.push({ role: "user", text });
          session.history.push({ role: "model", text: reply });
          if (session.history.length > 20) session.history = session.history.slice(-20);
          return reply;
        }
      } catch (err) {
        console.warn(`[ContactsHumanEngine] Model ${model} turn error:`, err);
      }
    }

    // Natural human fallback
    if (identity.role === "MOM" || identity.role === "DAD") {
      return "Haan ji, DK abhi kisi zaroori kaam me laga hai, thodi der me free hoke aapko call karega! 🙏";
    } else if (identity.role === "GIRLFRIEND") {
      return "Arey baby! DK abhi thoda busy hai, par maine bol diya hai, wo jaldi hi reply karega aapko ❤️";
    } else {
      return "Arey bhai, DK abhi thoda busy hai kisi kaam me. Jaise hi free hoga baat karta hai 👍";
    }
  }
}

export const whatsappContactsHumanEngine = new WhatsAppContactsHumanEngine();
