import { describe, it, expect, vi } from "vitest";
import { whatsappAlertDeskService } from "../src/services/whatsapp/whatsappAlertDeskService";

describe("WhatsApp Alert Desk Service Suite", () => {
  it("should format and forward media with metadata stamp to desk group", async () => {
    let sentPayload: any = null;
    let targetJid: string = "";

    const mockSock = {
      groupFetchAllParticipating: vi.fn().mockResolvedValue({
        "120363012345678901@g.us": { subject: "Friday Desk 🛡️" }
      }),
      sendMessage: vi.fn().mockImplementation((jid, content) => {
        targetJid = jid;
        sentPayload = content;
        return Promise.resolve({ key: { id: "mock_sent_msg_123" } });
      })
    };

    const dummyBuffer = Buffer.from("fake_image_content");
    const res = await whatsappAlertDeskService.forwardMediaToDesk(mockSock, {
      senderName: "Amit Sharma",
      senderPhone: "919876543210",
      sourceName: "Coding Group",
      userNote: "ye photo dk ko bhej dena, homework hai",
      mediaBuffer: dummyBuffer,
      mediaType: "photo",
      mimeType: "image/jpeg"
    });

    expect(res.success).toBe(true);
    expect(targetJid).toContain("@g.us");
    expect(sentPayload).toBeDefined();
    expect(sentPayload.image).toEqual(dummyBuffer);
    expect(sentPayload.caption).toContain("Forwarded Media for Boss DK");
    expect(sentPayload.caption).toContain("Amit Sharma");
    expect(sentPayload.caption).toContain("919876543210");
    expect(sentPayload.caption).toContain("Coding Group");
    expect(sentPayload.caption).toContain("ye photo dk ko bhej dena, homework hai");
    expect(sentPayload.caption).toContain("Forwarded by Friday Assistant");
  });

  it("should relay outsider 1-on-1 message to desk group", async () => {
    let sentText: string = "";

    const mockSock = {
      groupFetchAllParticipating: vi.fn().mockResolvedValue({
        "120363012345678901@g.us": { subject: "Friday Desk 🛡️" }
      }),
      sendMessage: vi.fn().mockImplementation((jid, content) => {
        sentText = content.text;
        return Promise.resolve({ key: { id: "mock_sent_text_456" } });
      })
    };

    const relayed = await whatsappAlertDeskService.relayOutsiderMessageToDesk(mockSock, {
      senderName: "Rohit Verma",
      senderPhone: "919123456789",
      text: "Hello DK sir, are you free today?"
    });

    expect(relayed).toBe(true);
    expect(sentText).toContain("New Message Alert");
    expect(sentText).toContain("Rohit Verma");
    expect(sentText).toContain("919123456789");
    expect(sentText).toContain("Direct 1-on-1 Chat");
    expect(sentText).toContain("Hello DK sir, are you free today?");
  });

  it("should natively forward media (zero-download) directly using Baileys forward with stamp", async () => {
    let forwardPayload: any = null;
    let targetJid: string = "";

    const mockSock = {
      groupFetchAllParticipating: vi.fn().mockResolvedValue({
        "120363012345678901@g.us": { subject: "Friday Desk 🛡️" }
      }),
      sendMessage: vi.fn().mockImplementation((jid, content) => {
        targetJid = jid;
        forwardPayload = content;
        return Promise.resolve({ key: { id: "mock_sent_fwd_789" } });
      })
    };

    const mockRawMessage = {
      key: { id: "msg_abc_123", remoteJid: "group123@g.us" },
      message: {
        imageMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7118-24/...",
          caption: "original caption",
          mimetype: "image/jpeg",
          fileSha256: Buffer.from("sha256")
        }
      }
    };

    const res = await whatsappAlertDeskService.forwardMediaToDesk(mockSock, {
      senderName: "Pooja Singh",
      senderPhone: "919988776655",
      sourceName: "College Friends",
      userNote: "ye photo boss ko bhej do urgently",
      rawMessage: mockRawMessage,
      mediaType: "photo"
    });

    expect(res.success).toBe(true);
    expect(targetJid).toContain("@g.us");
    expect(forwardPayload).toBeDefined();
    expect(forwardPayload.forward).toBeDefined();
    expect(forwardPayload.force).toBe(true);
    // Stamp must be injected into the forwarded message caption directly
    expect(forwardPayload.forward.message.imageMessage.caption).toContain("Forwarded Media for Boss DK");
    expect(forwardPayload.forward.message.imageMessage.caption).toContain("Pooja Singh");
    expect(forwardPayload.forward.message.imageMessage.caption).toContain("College Friends");
    expect(forwardPayload.forward.message.imageMessage.caption).toContain("ye photo boss ko bhej do urgently");
  });
});
