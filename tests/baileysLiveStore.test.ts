import { describe, it, expect } from "vitest";
import { baileysLiveStore } from "../src/services/whatsapp/baileysLiveStore";
import { whatsappHistoryEngine } from "../src/services/whatsapp/whatsappHistoryEngine";
import { IncomingMessage } from "../src/services/whatsapp/whatsappTypes";

describe("BaileysLiveStore & Baileys-First Chat History", () => {
  it("should format timestamps into friendly Indian Standard Time (IST) badges", () => {
    const now = Date.now();
    const info = baileysLiveStore.formatFriendlyIST(now);

    expect(info.timeStr).toMatch(/\d{1,2}:\d{2}\s+(AM|PM)/i);
    expect(info.dayStr).toBe("Aaj");
    expect(info.formattedBadge).toContain("Aaj");
  });

  it("should record incoming and outgoing messages with correct sender attribution", () => {
    const targetPhone = "919876543210";
    const jid = `${targetPhone}@s.whatsapp.net`;

    const incoming: IncomingMessage = {
      id: "test_msg_inc_1",
      senderPhone: targetPhone,
      senderName: "Amit Sharma",
      senderDisplayName: "Amit",
      replyJid: jid,
      groupId: null,
      groupName: null,
      isGroup: false,
      isUnknownContact: false,
      text: "Boss, project update ready hai?",
      timestamp: Date.now() - 60000,
      dateStr: "Aaj 10:00 AM",
      isRead: false,
    };

    baileysLiveStore.recordIncoming(incoming);
    baileysLiveStore.recordOutgoing(jid, "Haan Amit, review karke bhejta hoon.", "Aap (DK)", false, "test_msg_out_1");

    const history = baileysLiveStore.getLiveMessages(targetPhone, 5);
    expect(history).not.toBeNull();
    expect(history!.length).toBe(2);

    expect(history![0].text).toBe("Boss, project update ready hai?");
    expect(history![0].senderName).toBe("Amit Sharma");

    expect(history![1].text).toBe("Haan Amit, review karke bhejta hoon.");
    expect(history![1].senderPhone).toBe("me");
  });

  it("should return live history with [⚡ Source: Real-time Baileys] badge in getConversationSummaryAndHistory", async () => {
    const targetPhone = "919876543210";
    const result = await whatsappHistoryEngine.getConversationSummaryAndHistory(targetPhone, 5);

    expect(result.success).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(2);
    expect(result.summary).toContain("WhatsApp Live Chat");
    expect(result.summary).toContain("Aap (DK)");
    expect(result.summary).toContain("Amit Sharma");
    expect(result.summary).toContain("Baileys");
  });

  it("should support live group messages", () => {
    const groupJid = "120363029999999999@g.us";
    const groupMsg: IncomingMessage = {
      id: "grp_msg_1",
      senderPhone: "919999999999",
      senderName: "Rohan",
      senderDisplayName: "Rohan",
      replyJid: groupJid,
      groupId: groupJid,
      groupName: "Dev Team Core",
      isGroup: true,
      isUnknownContact: false,
      text: "Server restart successful.",
      timestamp: Date.now(),
      dateStr: "Abhi",
      isRead: true,
    };

    baileysLiveStore.recordIncoming(groupMsg);

    const liveGrp = baileysLiveStore.getLiveGroupMessages("Dev Team Core", 5);
    expect(liveGrp).not.toBeNull();
    expect(liveGrp!.groupName).toBe("Dev Team Core");
    expect(liveGrp!.messages.length).toBe(1);
    expect(liveGrp!.messages[0].text).toBe("Server restart successful.");
  });

  it("should correctly handle 'ram ke ajj ke msg kya kya h' when Ram has messages today", async () => {
    const ramPhone = "919811223344";
    const ramJid = `${ramPhone}@s.whatsapp.net`;

    const ramMsgToday: IncomingMessage = {
      id: "ram_msg_today",
      senderPhone: ramPhone,
      senderName: "Ram Kumar",
      senderDisplayName: "Ram",
      replyJid: ramJid,
      groupId: null,
      groupName: null,
      isGroup: false,
      isUnknownContact: false,
      text: "Boss, main aaj meeting ke liye pahunch gaya hoon.",
      timestamp: Date.now() - 3600000, // 1 hour ago (Today)
      dateStr: "Aaj 11:00 AM",
      isRead: false,
    };

    baileysLiveStore.recordIncoming(ramMsgToday);

    const result = await whatsappHistoryEngine.getConversationSummaryAndHistory("ram ke ajj ke msg kya kya h", 5);

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
    expect(result.summary).toContain("Ram");
    expect(result.summary).toContain("main aaj meeting ke liye pahunch gaya hoon");
    expect(result.summary).toContain("Baileys");
  });

  it("should truthfully inform when Ram has NO messages today instead of showing old messages as today's", async () => {
    const shyamPhone = "919822334455";
    const shyamJid = `${shyamPhone}@s.whatsapp.net`;

    // Message from 5 days ago
    const shyamOldMsg: IncomingMessage = {
      id: "shyam_msg_old",
      senderPhone: shyamPhone,
      senderName: "Shyam Verma",
      senderDisplayName: "Shyam",
      replyJid: shyamJid,
      groupId: null,
      groupName: null,
      isGroup: false,
      isUnknownContact: false,
      text: "Purana message from last week.",
      timestamp: Date.now() - (5 * 24 * 60 * 60 * 1000), // 5 days ago
      dateStr: "5 din pehle",
      isRead: true,
    };

    baileysLiveStore.recordIncoming(shyamOldMsg);

    // Ask specifically for Shyam's messages TODAY ("aaj")
    const result = await whatsappHistoryEngine.getConversationSummaryAndHistory("shyam ke aaj ke msg kya kya h", 5);

    expect(result.success).toBe(true);
    expect(result.count).toBe(0);
    // Must NOT say 1 message found today
    expect(result.summary).toContain("aaj koi naya WhatsApp message nahi aaya");
    expect(result.summary).toContain("Unka aakhiri message");
    expect(result.summary).toContain("Purana message from last week");
  });

  it("should strictly isolate WhatsApp status stories from chat media context", async () => {
    const { visionMemoryService } = await import("../src/services/visionMemoryService");
    const { multimodalCoPresenceEngine } = await import("../src/services/multimodalCoPresenceEngine");
    const { whatsappBotService } = await import("../src/services/whatsappBotService");

    const bossChatJid = "919999888877@s.whatsapp.net";

    // 1. Simulate Boss posting a WhatsApp Status story (status@broadcast)
    const dummyStatusBuffer = Buffer.from("fake_status_image_bytes");
    await visionMemoryService.processIncomingMedia(
      dummyStatusBuffer,
      "image/jpeg",
      "Boss DK",
      "Nature quote status",
      "status_photo_919999888877",
      "status@broadcast"
    );

    // 2. Chat media context for Boss must NOT return the WhatsApp status!
    const contextAfterStatus = visionMemoryService.getChatMediaContext(bossChatJid);
    expect(contextAfterStatus).toBeNull();

    // 3. Multimodal Co-Presence prompt must NOT inject the WhatsApp status!
    const promptAfterStatus = await multimodalCoPresenceEngine.compileVisualCoPresencePrompt(bossChatJid);
    expect(promptAfterStatus).toBe("");

    // 4. Test unwrapRealMessage with ephemeral and viewOnce messages
    const viewOnceMessage = {
      viewOnceMessage: {
        message: {
          imageMessage: {
            caption: "New routine photo sent in chat",
            mimetype: "image/jpeg",
          },
        },
      },
    };
    const unwrapped = whatsappBotService.unwrapRealMessage(viewOnceMessage);
    expect(unwrapped.imageMessage?.caption).toBe("New routine photo sent in chat");

    // 5. Simulate sending a real chat image in Boss's chat
    const dummyChatPhoto = Buffer.from("fake_chat_routine_photo_bytes");
    await visionMemoryService.generateMediaSummary(
      dummyChatPhoto,
      "image/jpeg",
      "Mera naya timetable dekho",
      "routine.jpg",
      bossChatJid
    );

    // 6. Now chat media context MUST return the routine photo from chat, NOT the nature status!
    const contextAfterChatPhoto = visionMemoryService.getChatMediaContext(bossChatJid);
    expect(contextAfterChatPhoto).not.toBeNull();
    expect(contextAfterChatPhoto?.isStatusMedia).toBe(false);
    expect(contextAfterChatPhoto?.caption).toBe("Mera naya timetable dekho");
  });
});

