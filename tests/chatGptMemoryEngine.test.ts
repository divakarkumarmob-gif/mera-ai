import { describe, it, expect, vi } from "vitest";
import { chatGptMemoryEngine } from "../src/services/chatGptMemoryEngine";

describe("ChatGPT-Style Lifelong Memory Engine", () => {
  it("should ignore trivial greetings and return empty recall string to save tokens", async () => {
    const res1 = await chatGptMemoryEngine.recallRelevantMemories("hi");
    expect(res1).toBe("");

    const res2 = await chatGptMemoryEngine.recallRelevantMemories("ok");
    expect(res2).toBe("");

    const res3 = await chatGptMemoryEngine.recallRelevantMemories("@song kesariya");
    expect(res3).toBe("");
  });

  it("should safely handle learnFromMessageTurn for trivial text without throwing", async () => {
    await expect(
      chatGptMemoryEngine.learnFromMessageTurn("Boss DK", "ok", "Theek hai Boss!", "whatsapp")
    ).resolves.not.toThrow();
  });

  it("should safely execute recall query for meaningful input without errors", async () => {
    const recall = await chatGptMemoryEngine.recallRelevantMemories("Main Patna ja raha hoon ghumne");
    expect(typeof recall).toBe("string");
  });
});
