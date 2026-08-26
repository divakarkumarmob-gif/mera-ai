import { db } from "./firebaseAdmin";
import { GoogleGenAI } from "@google/genai";

export type MessengerRole = "boss" | "girlfriend" | "friend" | "unknown";
export type MediaType = "text" | "image" | "video" | "pdf" | "audio" | "link";

export interface MessengerContact {
  id: string;
  name: string;
  role: MessengerRole;
  avatar: string;
  phone?: string;
  bio?: string;
  unreadCount: number;
  lastMessage?: string;
  lastTimestamp: number;
}

export interface MessengerMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  senderRole: MessengerRole | "friday_ai";
  text: string;
  mediaType: MediaType;
  mediaUrl?: string;
  mediaTitle?: string;
  timestamp: number;
  aiGenerated: boolean;
}

const messengerContactsCol = () => db.collection("messenger_contacts");
const messengerMessagesCol = (chatId: string) => db.collection("messenger_chats").doc(chatId).collection("messages");

class FridayMessengerService {
  private defaultContacts: MessengerContact[] = [
    {
      id: "boss_dk",
      name: "DK (Boss 👑)",
      role: "boss",
      avatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80",
      bio: "Creator & Master of FRIDAY",
      unreadCount: 0,
      lastMessage: "Friday, system ready hai?",
      lastTimestamp: Date.now() - 60000,
    },
    {
      id: "special_gf",
      name: "Special Someone 💖",
      role: "girlfriend",
      avatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80",
      bio: "VIP Priority Contact",
      unreadCount: 0,
      lastMessage: "DK kahan hai Friday?",
      lastTimestamp: Date.now() - 300000,
    },
    {
      id: "best_friend_aman",
      name: "Aman (Bhai 🤝)",
      role: "friend",
      avatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80",
      bio: "College Bro & Gamer",
      unreadCount: 0,
      lastMessage: "Bhai weekend par gaming session?",
      lastTimestamp: Date.now() - 900000,
    },
    {
      id: "unknown_client",
      name: "Alex (New Inquirer 🤖)",
      role: "unknown",
      avatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80",
      bio: "External Contact",
      unreadCount: 0,
      lastMessage: "Hi, I have a project inquiry for DK.",
      lastTimestamp: Date.now() - 1800000,
    },
  ];

  private inMemoryMessages = new Map<string, MessengerMessage[]>();

  public async getContacts(): Promise<MessengerContact[]> {
    try {
      const snap = await messengerContactsCol().get();
      if (snap.empty) {
        // Seed default contacts
        const batch = db.batch();
        for (const c of this.defaultContacts) {
          batch.set(messengerContactsCol().doc(c.id), c);
        }
        await batch.commit();
        return this.defaultContacts;
      }
      return snap.docs.map((d) => d.data() as MessengerContact);
    } catch {
      return this.defaultContacts;
    }
  }

  public async getMessages(chatId: string): Promise<MessengerMessage[]> {
    try {
      const snap = await messengerMessagesCol(chatId).orderBy("timestamp", "asc").limit(100).get();
      const messages = snap.docs.map((d) => d.data() as MessengerMessage);
      if (messages.length > 0) {
        this.inMemoryMessages.set(chatId, messages);
        return messages;
      }
    } catch {}

    return this.inMemoryMessages.get(chatId) || [];
  }

  public async setContactRole(contactId: string, role: MessengerRole): Promise<{ success: boolean; message: string }> {
    await messengerContactsCol().doc(contactId).set({ role }, { merge: true });
    return {
      success: true,
      message: `Contact "${contactId}" ka role update ho gaya: ${role.toUpperCase()}`,
    };
  }

  /**
   * Generates persona-tuned AI response based on recipient role
   */
  private generateSystemPromptForRole(contact: MessengerContact): string {
    const role = contact.role;
    if (role === "boss") {
      return `You are FRIDAY, the ultra-advanced, loyal AI assistant for DK (your creator and Boss).
Address him as 'Boss'. Speak in natural, fast Hinglish with high intelligence, respect, and dry wit.
You have full access to all 23 superpowers, admin permissions, and coding systems. Be proactive, obedient, and concise.`;
    }

    if (role === "girlfriend") {
      return `You are FRIDAY, the AI assistant of DK. You are speaking with DK's girlfriend / special someone (${contact.name}).
TONE & PERSONALITY:
- Address her respectfully and charmingly as 'Bhabhi ji' or by her name warmly.
- Be extremely sweet, polite, caring, and cheerful.
- Keep her happy! If she asks where DK is, explain that he is working hard/coding and thinking of her.
- Protect DK's private technical passwords/stress, but give sweet, reassuring updates.
- If she needs anything (reminders, sweet messages for DK, food suggestions), help her immediately with maximum care!`;
    }

    if (role === "friend") {
      return `You are FRIDAY, DK's AI assistant speaking with DK's close friend (${contact.name}).
TONE & PERSONALITY:
- Speak in fun, casual Hinglish with college bro slang ('Bhai', 'Yaar', 'Mast').
- Be humorous, witty, give funny roasts, help with gaming, tech discussions, or movie plans.
- NEVER reveal DK's confidential passwords, secure vault, bank details, or private work secrets.`;
    }

    // Default: unknown / stranger
    return `You are FRIDAY, the professional AI Gatekeeper & Receptionist for DK.
TONE & PERSONALITY:
- Speak in professional, polite English or Hinglish.
- Act as DK's AI secretary. Answer general questions politely.
- Collect their name, organization, and message purpose so you can forward it to DK.
- Strictly filter out spam, marketing, or malicious inquiries. Do not provide DK's personal phone number or private details.`;
  }

  /**
   * Post a message into Friday Messenger and generate AI response if appropriate
   */
  public async handleIncomingMessage(
    chatId: string,
    senderId: string,
    senderName: string,
    text: string,
    mediaType: MediaType = "text",
    mediaUrl?: string,
    mediaTitle?: string
  ): Promise<{ userMessage: MessengerMessage; aiReply?: MessengerMessage }> {
    const now = Date.now();
    const contacts = await this.getContacts();
    const contact = contacts.find((c) => c.id === chatId) || {
      id: chatId,
      name: senderName,
      role: "unknown" as MessengerRole,
      avatar: "",
      unreadCount: 0,
      lastTimestamp: now,
    };

    const userMsgId = Math.random().toString(36).substring(2, 9);
    const userMessage: MessengerMessage = {
      id: userMsgId,
      chatId,
      senderId,
      senderName,
      senderRole: contact.role,
      text,
      mediaType,
      mediaUrl,
      mediaTitle,
      timestamp: now,
      aiGenerated: false,
    };

    // Cache user message locally
    const existingList = this.inMemoryMessages.get(chatId) || [];
    existingList.push(userMessage);
    this.inMemoryMessages.set(chatId, existingList);

    // Save user message in Firestore
    try {
      await messengerMessagesCol(chatId).doc(userMsgId).set(userMessage);
      await messengerContactsCol().doc(chatId).set(
        {
          lastMessage: text || `[${mediaType.toUpperCase()}]`,
          lastTimestamp: now,
        },
        { merge: true }
      );
    } catch {}

    // Generate FRIDAY Autonomous Role-Based Response
    let aiReply: MessengerMessage | undefined;
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        const ai = new GoogleGenAI({ apiKey });
        const systemPrompt = this.generateSystemPromptForRole(contact);

        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: [
            {
              role: "user",
              parts: [{ text: `System Instructions:\n${systemPrompt}\n\nIncoming Message from ${contact.name} (${contact.role.toUpperCase()}):\n"${text}"` }],
            },
          ],
        });

        const replyText = response.text || "Message received by Friday AI.";
        const aiMsgId = Math.random().toString(36).substring(2, 9);

        aiReply = {
          id: aiMsgId,
          chatId,
          senderId: "friday_ai",
          senderName: "FRIDAY AI",
          senderRole: "friday_ai",
          text: replyText,
          mediaType: "text",
          timestamp: Date.now(),
          aiGenerated: true,
        };

        existingList.push(aiReply);
        this.inMemoryMessages.set(chatId, existingList);

        await messengerMessagesCol(chatId).doc(aiMsgId).set(aiReply);
        await messengerContactsCol().doc(chatId).set(
          {
            lastMessage: replyText,
            lastTimestamp: Date.now(),
          },
          { merge: true }
        );
      }
    } catch (err) {
      console.warn("[FridayMessenger] AI reply generation error:", err);
    }

    return { userMessage, aiReply };
  }

  /**
   * Allows Friday tools / Boss to autonomously push media/documents to any chat
   */
  public async sendMediaOrDocument(
    chatId: string,
    text: string,
    mediaType: MediaType,
    mediaUrl: string,
    mediaTitle?: string
  ): Promise<MessengerMessage> {
    const now = Date.now();
    const msgId = Math.random().toString(36).substring(2, 9);

    const message: MessengerMessage = {
      id: msgId,
      chatId,
      senderId: "friday_ai",
      senderName: "FRIDAY AI",
      senderRole: "friday_ai",
      text,
      mediaType,
      mediaUrl,
      mediaTitle,
      timestamp: now,
      aiGenerated: true,
    };

    try {
      await messengerMessagesCol(chatId).doc(msgId).set(message);
      await messengerContactsCol().doc(chatId).set(
        {
          lastMessage: text || `[Sent ${mediaType.toUpperCase()}]`,
          lastTimestamp: now,
        },
        { merge: true }
      );
    } catch {}

    return message;
  }
}

export const fridayMessengerService = new FridayMessengerService();
