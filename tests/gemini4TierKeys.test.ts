import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getLiveGeminiKey,
  getMessengerGeminiKey,
  getIntentGeminiKey,
  getFallbackGeminiKey,
  getKeyForService
} from "../src/services/geminiKeyPoolService";

describe("4-Tier Dedicated Gemini API Key Architecture", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GEMINI_API_KEY_1;
    delete process.env.GEMINI_API_KEY_2;
    delete process.env.GEMINI_API_KEY_3;
    delete process.env.GEMINI_API_KEY_4;
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("should correctly route Key 1 for Live Voice/Video & Tool calls", () => {
    process.env.GEMINI_API_KEY_1 = "test_tier1_live_key_1234567890";
    expect(getLiveGeminiKey()).toBe("test_tier1_live_key_1234567890");
    const serviceKey = getKeyForService("live");
    expect(serviceKey.apiKey).toBe("test_tier1_live_key_1234567890");
  });

  it("should correctly route Key 2 for WhatsApp & Telegram bots", () => {
    process.env.GEMINI_API_KEY_2 = "test_tier2_bots_key_1234567890";
    expect(getMessengerGeminiKey()).toBe("test_tier2_bots_key_1234567890");
    const waKey = getKeyForService("whatsapp");
    const tgKey = getKeyForService("telegram");
    expect(waKey.apiKey).toBe("test_tier2_bots_key_1234567890");
    expect(tgKey.apiKey).toBe("test_tier2_bots_key_1234567890");
  });

  it("should correctly route Key 3 for Intent Classifier & Memory Engine", () => {
    process.env.GEMINI_API_KEY_3 = "test_tier3_intent_key_1234567890";
    expect(getIntentGeminiKey()).toBe("test_tier3_intent_key_1234567890");
    const intentKey = getKeyForService("intent");
    const memoryKey = getKeyForService("memory");
    expect(intentKey.apiKey).toBe("test_tier3_intent_key_1234567890");
    expect(memoryKey.apiKey).toBe("test_tier3_intent_key_1234567890");
  });

  it("should fallback to Tier 4 Key if Tier 1/2/3 keys are missing", () => {
    process.env.GEMINI_API_KEY_4 = "test_tier4_fallback_key_1234567890";
    expect(getLiveGeminiKey()).toBe("test_tier4_fallback_key_1234567890");
    expect(getMessengerGeminiKey()).toBe("test_tier4_fallback_key_1234567890");
    expect(getIntentGeminiKey()).toBe("test_tier4_fallback_key_1234567890");
    expect(getFallbackGeminiKey()).toBe("test_tier4_fallback_key_1234567890");
  });
});
