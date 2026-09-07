/**
 * imageGenerationService.ts
 *
 * High-performance AI Image Generation Engine for WhatsApp, Telegram, and Live Assistant.
 * Dual-Engine Architecture:
 * 1. Primary: Google Imagen 3 (imagen-3.0-generate-002 / imagen-3.0-fast-generate-001) via @google/genai.
 * 2. Fallback: Ultra-fast Pollinations Flux / Turbo AI (100% reliable zero-downtime fallback).
 */

import { GoogleGenAI } from "@google/genai";

export interface GeneratedImageResult {
  success: boolean;
  buffer?: Buffer;
  imageUrl?: string;
  model: string;
  prompt: string;
  error?: string;
}

class ImageGenerationService {
  /**
   * Generates a photorealistic AI image from a text prompt.
   * Returns a Buffer ready for direct WhatsApp / Telegram media upload.
   */
  public async generateImage(
    prompt: string,
    options: {
      aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
      enhancePrompt?: boolean;
    } = {}
  ): Promise<GeneratedImageResult> {
    const rawPrompt = (prompt || "").trim();
    if (!rawPrompt) {
      return {
        success: false,
        model: "none",
        prompt: "",
        error: "Prompt cannot be empty",
      };
    }

    const apiKey = process.env.GEMINI_API_KEY;

    // ── Tier 1: Google Imagen 3 via @google/genai ───────────────────────────
    if (apiKey) {
      for (const modelName of ["imagen-3.0-generate-002", "imagen-3.0-fast-generate-001"]) {
        try {
          const ai = new GoogleGenAI({ apiKey });
          console.log(`[ImageGen] Trying Google Imagen 3 (${modelName}) for prompt: "${rawPrompt.slice(0, 60)}..."`);

          const response: any = await Promise.race([
            ai.models.generateImages({
              model: modelName,
              prompt: rawPrompt,
              config: {
                numberOfImages: 1,
                outputMimeType: "image/jpeg",
                aspectRatio: options.aspectRatio || "1:1",
              },
            }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("Imagen 3 timeout")), 15000)),
          ]);

          const imageBase64 = response?.generatedImages?.[0]?.image?.imageBytes;
          if (imageBase64) {
            const buffer = Buffer.from(imageBase64, "base64");
            console.log(`[ImageGen] Successfully generated image using Google ${modelName} (${buffer.length} bytes)`);
            return {
              success: true,
              buffer,
              model: modelName,
              prompt: rawPrompt,
            };
          }
        } catch (err: any) {
          console.warn(`[ImageGen] Google ${modelName} failed (${err?.message || err}), trying fallback...`);
        }
      }
    }

    // ── Tier 2: Ultra-Fast Pollinations Flux AI Fallback ───────────────────
    try {
      console.log(`[ImageGen] Falling back to Pollinations Flux AI for prompt: "${rawPrompt.slice(0, 60)}..."`);
      const width = options.aspectRatio === "16:9" ? 1280 : options.aspectRatio === "9:16" ? 720 : 1024;
      const height = options.aspectRatio === "16:9" ? 720 : options.aspectRatio === "9:16" ? 1280 : 1024;
      const seed = Math.floor(Math.random() * 1000000);
      const encodedPrompt = encodeURIComponent(rawPrompt);
      const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&seed=${seed}&model=flux&nologo=true`;

      const resp = await Promise.race([
        fetch(pollinationsUrl, {
          headers: {
            "User-Agent": "MeraAI-Friday-Agent/1.0",
          },
        }),
        new Promise<Response>((_, reject) => setTimeout(() => reject(new Error("Pollinations timeout")), 20000)),
      ]);

      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > 1000) {
          console.log(`[ImageGen] Successfully generated image using Pollinations Flux AI (${buffer.length} bytes)`);
          return {
            success: true,
            buffer,
            imageUrl: pollinationsUrl,
            model: "Pollinations Flux AI",
            prompt: rawPrompt,
          };
        }
      }
    } catch (pollErr: any) {
      console.error("[ImageGen] Pollinations Flux fallback failed:", pollErr?.message || pollErr);
    }

    // ── Tier 3: Pollinations Turbo Model Final Fallback ───────────────────
    try {
      const seed = Math.floor(Math.random() * 1000000);
      const encodedPrompt = encodeURIComponent(rawPrompt);
      const turboUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&model=turbo&nologo=true`;

      const resp = await fetch(turboUrl);
      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        const buffer = Buffer.from(arrayBuf);
        if (buffer.length > 1000) {
          console.log(`[ImageGen] Generated image using Pollinations Turbo (${buffer.length} bytes)`);
          return {
            success: true,
            buffer,
            imageUrl: turboUrl,
            model: "Pollinations Turbo AI",
            prompt: rawPrompt,
          };
        }
      }
    } catch (turboErr: any) {
      console.error("[ImageGen] Pollinations Turbo fallback failed:", turboErr?.message || turboErr);
    }

    return {
      success: false,
      model: "none",
      prompt: rawPrompt,
      error: "All image generation models failed. Please try again with a different description.",
    };
  }
}

export const imageGenerationService = new ImageGenerationService();
