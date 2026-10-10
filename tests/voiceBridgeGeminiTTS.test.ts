import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  VoiceBridgeService,
  GEMINI_TTS_PRIORITY_MODELS,
} from "../src/services/voiceBridgeService";

describe("VoiceBridgeService — Google Gemini Flash TTS Priority Implementation", () => {
  let service: VoiceBridgeService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new VoiceBridgeService();
    process.env.GEMINI_API_KEY = "mock-test-gemini-key";
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should have correct Google Gemini TTS priority list in order: 3.1 Flash, 2.5 Flash, 3.8 Flash Lite, 3.8 Flash", () => {
    expect(GEMINI_TTS_PRIORITY_MODELS).toEqual([
      "gemini-3.1-flash-tts-preview",
      "gemini-2.5-flash-preview-tts",
      "gemini-3.8-flash-lite-tts",
      "gemini-3.8-flash-tts",
    ]);
  });

  it("should correctly resolve voice tone mapping to Gemini prebuilt voices", () => {
    // Default / Female
    expect(service.resolveGeminiVoice("hi-IN-SwaraNeural")).toBe("Aoede");
    expect(service.resolveGeminiVoice("female")).toBe("Aoede");
    expect(service.resolveGeminiVoice("ladki")).toBe("Aoede");

    // Male
    expect(service.resolveGeminiVoice("hi-IN-MadhurNeural")).toBe("Puck");
    expect(service.resolveGeminiVoice("male")).toBe("Puck");
    expect(service.resolveGeminiVoice("ladka")).toBe("Puck");
    expect(service.resolveGeminiVoice("en-IN-PrabhatNeural")).toBe("Puck");

    // Specific Gemini Voices
    expect(service.resolveGeminiVoice("kore")).toBe("Kore");
    expect(service.resolveGeminiVoice("charon")).toBe("Charon");
    expect(service.resolveGeminiVoice("fenrir")).toBe("Fenrir");
    expect(service.resolveGeminiVoice("leda")).toBe("Leda");
    expect(service.resolveGeminiVoice("zephyr")).toBe("Zephyr");
  });

  it("should correctly package raw PCM into a standard 44-byte RIFF/WAVE header", () => {
    const rawPcm = Buffer.alloc(1000, 0x12);
    const wavBuffer = service.pcmToWav(rawPcm, 24000, 1, 16);

    expect(wavBuffer.length).toBe(1044);
    expect(wavBuffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(wavBuffer.subarray(8, 12).toString("ascii")).toBe("WAVE");
    expect(wavBuffer.subarray(12, 16).toString("ascii")).toBe("fmt ");
    expect(wavBuffer.readUInt16LE(20)).toBe(1); // PCM
    expect(wavBuffer.readUInt16LE(22)).toBe(1); // 1 channel
    expect(wavBuffer.readUInt32LE(24)).toBe(24000); // 24kHz
    expect(wavBuffer.subarray(36, 40).toString("ascii")).toBe("data");
    expect(wavBuffer.readUInt32LE(40)).toBe(1000); // data length

    // If buffer already has RIFF, it should not double-wrap
    const doubleWrapped = service.pcmToWav(wavBuffer, 24000);
    expect(doubleWrapped.length).toBe(1044);
  });

  it("should update Boss Global Voice preference to Gemini presets", async () => {
    const resPuck = await service.setBossGlobalVoice("puck");
    expect(resPuck.voice).toBe("Puck");
    expect(resPuck.voiceName).toContain("Puck");

    const resAoede = await service.setBossGlobalVoice("aoede");
    expect(resAoede.voice).toBe("Aoede");
    expect(resAoede.voiceName).toContain("Aoede");

    const resKore = await service.setBossGlobalVoice("kore");
    expect(resKore.voice).toBe("Kore");
    expect(resKore.voiceName).toContain("Kore");
  });

  it("should call Gemini 3.1 Flash TTS as priority 1 and return audio", async () => {
    const requestedUrls: string[] = [];
    const dummyAudioBase64 = Buffer.from("RIFFdummywavdata").toString("base64");

    global.fetch = vi.fn().mockImplementation(async (url: string, init?: any) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: "audio/wav",
                      data: dummyAudioBase64,
                    },
                  },
                ],
              },
            },
          ],
        }),
      } as any;
    });

    const res = await service.geminiTTS("Namaste Friday", "female");

    expect(res).not.toBeNull();
    expect(res?.modelUsed).toBe("gemini-3.1-flash-tts-preview");
    expect(res?.mimeType).toBe("audio/wav");
    expect(requestedUrls.length).toBe(1);
    expect(requestedUrls[0]).toContain("gemini-3.1-flash-tts-preview");
  });

  it("should fallback through priority chain (3.1 -> 2.5 -> 3.8 lite -> 3.8 flash) when earlier models fail", async () => {
    const requestedModels: string[] = [];
    const dummyAudioBase64 = Buffer.alloc(100).toString("base64");

    global.fetch = vi.fn().mockImplementation(async (url: string) => {
      const modelMatch = url.match(/models\/([^:]+):generateContent/);
      const modelName = modelMatch ? modelMatch[1] : "";
      requestedModels.push(modelName);

      // Fail 3.1 Flash TTS and 2.5 Flash TTS
      if (modelName.includes("3.1-flash") || modelName.includes("2.5-flash")) {
        return {
          ok: false,
          status: 404,
          text: async () => "Model not found",
        } as any;
      }

      // 3.8 Flash Lite succeeds!
      if (modelName === "gemini-3.8-flash-lite-tts") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      inlineData: {
                        mimeType: "audio/pcm;rate=24000",
                        data: dummyAudioBase64,
                      },
                    },
                  ],
                },
              },
            ],
          }),
        } as any;
      }

      return { ok: false, status: 500, text: async () => "Error" } as any;
    });

    const res = await service.geminiTTS("Testing fallback", "male");

    expect(res).not.toBeNull();
    expect(res?.modelUsed).toBe("gemini-3.8-flash-lite-tts");
    expect(res?.mimeType).toBe("audio/wav");
    // Verify requested models tried in correct order
    expect(requestedModels[0]).toBe("gemini-3.1-flash-tts-preview");
    expect(requestedModels).toContain("gemini-2.5-flash-preview-tts");
    expect(requestedModels).toContain("gemini-3.8-flash-lite-tts");
  });

  it("should prioritize Gemini TTS inside generateSpeech over ElevenLabs, Sarvam, and Edge TTS", async () => {
    const dummyWav = Buffer.from("RIFFgeminiaudiobytes");
    const geminiSpy = vi.spyOn(service, "geminiTTS").mockResolvedValue({
      buffer: dummyWav,
      mimeType: "audio/wav",
      modelUsed: "gemini-3.1-flash-tts-preview",
    });

    const elevenSpy = vi.spyOn(service, "elevenLabsTTS");
    const sarvamSpy = vi.spyOn(service, "sarvamTTS");
    const edgeSpy = vi.spyOn(service, "textToSpeechBuffer");

    const result = await service.generateSpeech("Hello Boss, how can I help you?");

    expect(geminiSpy).toHaveBeenCalled();
    expect(result.buffer).toEqual(dummyWav);
    expect(result.mimeType).toBe("audio/wav");

    // ElevenLabs, Sarvam, and Edge should NOT be called because Gemini TTS succeeded
    expect(elevenSpy).not.toHaveBeenCalled();
    expect(sarvamSpy).not.toHaveBeenCalled();
    expect(edgeSpy).not.toHaveBeenCalled();
  });

  it("should smoothly fallback to Edge Neural TTS when Gemini TTS, ElevenLabs, and Sarvam all return null", async () => {
    vi.spyOn(service, "geminiTTS").mockResolvedValue(null);
    vi.spyOn(service, "elevenLabsTTS").mockResolvedValue(null);
    vi.spyOn(service, "sarvamTTS").mockResolvedValue(null);
    const dummyEdgeBuf = Buffer.from("dummy-edge-mp3");
    vi.spyOn(service, "textToSpeechBuffer").mockResolvedValue(dummyEdgeBuf);

    const result = await service.generateSpeech("Fallback test");
    expect(result.buffer).toEqual(dummyEdgeBuf);
    expect(result.mimeType).toBe("audio/mpeg");
  });
});
