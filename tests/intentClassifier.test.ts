import { describe, it, expect } from "vitest";
import { intentClassifierService, IntentContext } from "../src/services/intentClassifierService";

const mockContext: IntentContext = {
  platform: "whatsapp",
  isGroup: false,
  isOwner: true,
  senderName: "DK (Boss)",
  senderPhone: "919315570187",
  timeOfDay: "10:15 AM",
  userTimezone: "Asia/Kolkata"
};

describe("IntentClassifierService - Fallback & Core Classification Suite", () => {
  describe("1. Cellular Calls & Contacts", () => {
    it("should classify generic phone call intent for Boss", async () => {
      const res = await intentClassifierService.classifyIntent("mujhe call karo abhi", mockContext);
      expect(res.action).toBe("make_phone_call");
      expect(res.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should extract named contact in call intent", async () => {
      const res = await intentClassifierService.classifyIntent("Rahul ko phone lagao", mockContext);
      expect(res.action).toBe("make_phone_call");
      expect(res.parameters.targetPhone).toBe("Rahul");
    });

    it("should extract raw 10-digit number in call intent", async () => {
      const res = await intentClassifierService.classifyIntent("call 9876543210 urgently", mockContext);
      expect(res.action).toBe("make_phone_call");
      expect(res.parameters.targetPhone).toBe("9876543210");
    });

    it("should classify WhatsApp message dispatch intent", async () => {
      const res = await intentClassifierService.classifyIntent("Rahul ko msg karo: kal subah 10 baje milte hain", mockContext);
      expect(res.action).toBe("send_whatsapp_message");
      expect(res.parameters.contactNameOrPhone.toLowerCase()).toContain("rahul");
      expect(res.parameters.messageText).toContain("kal subah");
    });
  });

  describe("2. Media, Music & Vision", () => {
    it("should classify music intent with artist/song query", async () => {
      const res = await intentClassifierService.classifyIntent("gaana bajao Arijit Singh ka", mockContext);
      expect(res.action).toBe("play_music");
      expect(res.parameters.songQuery).toContain("Arijit");
    });

    it("should classify AI image generation intent", async () => {
      const res = await intentClassifierService.classifyIntent("photo banao ek robotic sher ki jungle me", mockContext);
      expect(res.action).toBe("generate_ai_image");
      expect(res.parameters.prompt).toBeTruthy();
    });
  });

  describe("3. Weather, News & Sports", () => {
    it("should classify weather inquiry with location", async () => {
      const res = await intentClassifierService.classifyIntent("Patna ka mausam kaisa hai", mockContext);
      expect(res.action).toBe("get_weather");
      expect(res.parameters.place.toLowerCase()).toBe("patna");
    });

    it("should classify weather inquiry for Delhi", async () => {
      const res = await intentClassifierService.classifyIntent("aaj barish hogi kya Delhi me", mockContext);
      expect(res.action).toBe("get_weather");
      expect(res.parameters.place.toLowerCase()).toBe("delhi");
    });

    it("should classify news intent with category", async () => {
      const res = await intentClassifierService.classifyIntent("aaj ki sports news batao", mockContext);
      expect(res.action).toBe("get_news");
      expect(res.parameters.topic).toBe("sports");
    });

    it("should classify cricket live score inquiry", async () => {
      const res = await intentClassifierService.classifyIntent("cricket score batao", mockContext);
      expect(res.action).toBe("get_cricket_scores");
    });
  });

  describe("4. Productivity, Daily Updates & Routine", () => {
    it("should classify reminder with time string", async () => {
      const res = await intentClassifierService.classifyIntent("remind me at 5pm to call doctor", mockContext);
      expect(res.action).toBe("set_reminder");
      expect(res.parameters.timeString).toBeTruthy();
    });

    it("should classify daily update logging", async () => {
      const res = await intentClassifierService.classifyIntent("aaj ka update note karo: gym gaya aur workout kiya", mockContext);
      expect(res.action).toBe("save_daily_update");
      expect(res.parameters.updateText).toContain("gym gaya");
    });

    it("should classify daily update recall for past days", async () => {
      const res = await intentClassifierService.classifyIntent("kal kya update tha", mockContext);
      expect(res.action).toBe("get_daily_update");
      expect(res.parameters.dateWord).toBe("kal");
    });

    it("should classify routine timetable lookup", async () => {
      const res = await intentClassifierService.classifyIntent("mera routine kya hai", mockContext);
      expect(res.action).toBe("get_routine");
    });

    it("should classify routine confirmation from photo suggestion ('haan set kar do')", async () => {
      const res = await intentClassifierService.classifyIntent("haan set kar do", mockContext);
      expect(res.action).toBe("set_routine");
      expect(res.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should classify photo routine save intent ('photo wala routine save karo')", async () => {
      const res = await intentClassifierService.classifyIntent("photo wala routine save karo", mockContext);
      expect(res.action).toBe("set_routine");
      expect(res.confidence).toBeGreaterThanOrEqual(0.8);
    });

    it("should correctly extract routine slots and strip machine tag in visionMemoryService", async () => {
      const { visionMemoryService } = await import("../src/services/visionMemoryService");
      const sampleAIOutput = `📌 *Main Subject:* Daily Routine Schedule
⏰ *Timetable / Routine Detected:*
• 04:00 AM - 05:00 AM: Jagna / Wake Up
• 08:00 AM - 09:00 AM: Breakfast / Khana

👉 *Boss, kya main is schedule ke daily reminders ya Friday routine me set kar doon?*
[ROUTINE_DATA: [{"title": "Jagna", "startTimeStr": "04:00 AM", "endTimeStr": "05:00 AM", "activity": "Wake up"}, {"title": "Khana", "startTimeStr": "08:00 AM", "endTimeStr": "09:00 AM", "activity": "Breakfast"}]]`;

      const extracted = visionMemoryService.extractRoutineSlots(sampleAIOutput);
      expect(extracted.slots).toHaveLength(2);
      expect(extracted.slots[0].title).toBe("Jagna");
      expect(extracted.slots[0].startTimeStr).toBe("04:00 AM");
      expect(extracted.slots[1].title).toBe("Khana");
      expect(extracted.slots[1].startTimeStr).toBe("08:00 AM");
      expect(extracted.cleanedText).not.toContain("[ROUTINE_DATA:");
      expect(extracted.cleanedText).toContain("Timetable / Routine Detected");
    });

    it("should classify memory recall/search", async () => {
      const res = await intentClassifierService.classifyIntent("purani baat dhundho pichle hafte ki", mockContext);
      expect(res.action).toBe("search_memory");
      expect(res.parameters.searchQuery).toBeTruthy();
    });
  });

  describe("5. Language Translation & Web Tools", () => {
    it("should classify language translation intent", async () => {
      const res = await intentClassifierService.classifyIntent("translate to English: mujhe bhookh lagi hai", mockContext);
      expect(res.action).toBe("translate_text");
      expect(res.parameters.targetLanguage.toLowerCase()).toContain("english");
    });

    it("should classify web search intent", async () => {
      const res = await intentClassifierService.classifyIntent("google par search karo latest AI news", mockContext);
      expect(res.action).toBe("search_web");
      expect(res.parameters.query).toContain("latest AI news");
    });
  });

  describe("6. Session Health & Security", () => {
    it("should classify WhatsApp session health check", async () => {
      const res = await intentClassifierService.classifyIntent("session health kaisa hai", mockContext);
      expect(res.action).toBe("check_session_health");
    });

    it("should classify bot unpause command", async () => {
      const res = await intentClassifierService.classifyIntent("bot chalu karo abhi", mockContext);
      expect(res.action).toBe("unpause_bot");
    });

    it("should classify WhatsApp ban status check", async () => {
      const res = await intentClassifierService.classifyIntent("whatsapp ban status check karo", mockContext);
      expect(res.action).toBe("check_session_health");
    });

    it("should not misclassify personal WhatsApp story status as session health", async () => {
      const res = await intentClassifierService.classifyIntent("mera whatsapp status laga do: good morning", mockContext);
      expect(res.action).not.toBe("check_session_health");
    });

    it("should classify deep website vulnerability scan intent", async () => {
      const res = await intentClassifierService.classifyIntent("scan website https://example.com for vulnerabilities", mockContext);
      expect(res.action).toBe("scan_website_security");
      expect(res.parameters.urlOrDomain).toContain("example.com");
      expect(res.parameters.scanMode).toBe("deep");
    });

    it("should classify website security audit intent", async () => {
      const res = await intentClassifierService.classifyIntent("audit website https://mybank.com", mockContext);
      expect(res.action).toBe("scan_website_security");
      expect(res.parameters.urlOrDomain).toContain("mybank.com");
      expect(res.parameters.scanMode).toBe("audit");
    });
  });

  describe("7. Conversation Fallback & Feature Engine", () => {
    it("should fallback to general_chat for casual conversation", async () => {
      const res = await intentClassifierService.classifyIntent("aur batao kya chal raha hai", mockContext);
      expect(res.action).toBe("general_chat");
      expect(res.confidence).toBeLessThanOrEqual(0.7);
    });

    it("should verify whatsappFeatureEngine generates poll and quiz cards", async () => {
      const { whatsappFeatureEngine } = await import("../src/services/whatsappFeatureEngine");
      const pollCard = await whatsappFeatureEngine.generatePoll("Best programming language?");
      expect(pollCard).toContain("Poll");

      const quizCard = await whatsappFeatureEngine.generateQuiz("JavaScript");
      expect(quizCard).toContain("Question");
    });
  });
});
