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
});
