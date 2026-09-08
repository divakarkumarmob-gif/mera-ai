/**
 * imageGenerationService.ts
 *
 * High-performance AI Image Generation Engine for WhatsApp, Telegram, and Live Assistant.
 * Multi-Tier Engine Architecture:
 * 1. Primary (Tier 1): Cloudflare Workers AI (@cf/black-forest-labs/flux-1-schnell & SDXL Lightning) - Dedicated Edge GPUs, 0 Cold Start, 10k Neurons/day.
 * 2. Tier 2: Hugging Face Inference API (FLUX.1-schnell & SDXL) - Ultra-HD Photorealistic.
 * 3. Tier 3: Google Imagen 3 (imagen-3.0-generate-002 / imagen-3.0-fast-generate-001) via @google/genai.
 * 4. Tier 4: Ultra-fast Pollinations Flux AI (Zero-downtime free fallback).
 * 5. Tier 5: Pollinations Turbo AI (Instant backup).
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

    // ── Tier 1: Cloudflare Workers AI (Primary Engine - Ultra-Fast Edge FLUX.1) ─
    const cfToken = (
      process.env.CLOUDFLARE_API_TOKEN ||
      process.env.CLOUDFLARE_API_KEY ||
      process.env.CF_API_TOKEN ||
      process.env.CF_TOKEN ||
      ""
    ).trim();

    const cfAccountId = (
      process.env.CLOUDFLARE_ACCOUNT_ID ||
      process.env.CF_ACCOUNT_ID ||
      process.env.CLOUDFLARE_ACCOUNT ||
      ""
    ).trim();

    if (cfToken && cfAccountId) {
      const cfModels = [
        "@cf/black-forest-labs/flux-1-schnell",
        "@cf/bytedance/stable-diffusion-xl-lightning",
        "@cf/stabilityai/stable-diffusion-xl-base-1.0",
      ];

      for (const cfModel of cfModels) {
        try {
          console.log(`[ImageGen] Trying Cloudflare Workers AI (${cfModel})...`);
          const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${cfModel}`;
          const resp = await Promise.race([
            fetch(cfUrl, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${cfToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ prompt: rawPrompt }),
            }),
            new Promise<Response>((_, reject) =>
              setTimeout(() => reject(new Error("Cloudflare Workers AI timeout")), 25000)
            ),
          ]);

          if (resp.ok) {
            const arrayBuf = await resp.arrayBuffer();
            const buffer = Buffer.from(arrayBuf);
            if (buffer.length > 2000) {
              console.log(
                `[ImageGen] Successfully generated image via Cloudflare (${cfModel}) [${buffer.length} bytes]`
              );
              return {
                success: true,
                buffer,
                model: `Cloudflare (${cfModel.split("/").pop()})`,
                prompt: rawPrompt,
              };
            }
          } else {
            const errBody = await resp.text().catch(() => "");
            console.warn(
              `[ImageGen] Cloudflare (${cfModel}) returned status ${resp.status}: ${errBody.slice(0, 150)}`
            );
          }
        } catch (cfErr: any) {
          console.warn(`[ImageGen] Cloudflare (${cfModel}) failed (${cfErr?.message || cfErr}), trying next...`);
        }
      }
    }

    // ── Tier 2: Hugging Face FLUX.1 / SDXL (Secondary Engine) ────────────────
    const hfToken = (
      process.env.HUGGINGFACE_API_KEY ||
      process.env.HF_TOKEN ||
      process.env.HUGGINGFACE_ACCESS_TOKEN ||
      process.env.HF_API_KEY ||
      process.env.HUGGING_FACE_HUB_TOKEN ||
      ""
    ).trim();

    if (hfToken) {
      const hfModels = [
        "black-forest-labs/FLUX.1-schnell",
        "stabilityai/stable-diffusion-xl-base-1.0",
      ];

      for (const modelName of hfModels) {
        for (const baseUrl of [
          `https://router.huggingface.co/hf-inference/models/${modelName}`,
          `https://api-inference.huggingface.co/models/${modelName}`,
        ]) {
          try {
            console.log(`[ImageGen] Trying Hugging Face (${modelName}) via ${baseUrl.split('/')[2]}...`);
            const resp = await Promise.race([
              fetch(baseUrl, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${hfToken}`,
                  "Content-Type": "application/json",
                  "User-Agent": "MeraAI-Friday-Agent/1.0",
                },
                body: JSON.stringify({ inputs: rawPrompt }),
              }),
              new Promise<Response>((_, reject) =>
                setTimeout(() => reject(new Error("Hugging Face API timeout")), 25000)
              ),
            ]);

            if (resp.ok) {
              const arrayBuf = await resp.arrayBuffer();
              const buffer = Buffer.from(arrayBuf);
              if (buffer.length > 2000) {
                console.log(
                  `[ImageGen] Successfully generated image via Hugging Face (${modelName}) [${buffer.length} bytes]`
                );
                return {
                  success: true,
                  buffer,
                  model: `Hugging Face (${modelName.split("/").pop()})`,
                  prompt: rawPrompt,
                };
              }
            } else {
              const errBody = await resp.text().catch(() => "");
              console.warn(
                `[ImageGen] Hugging Face (${modelName}) returned status ${resp.status}: ${errBody.slice(0, 150)}`
              );
            }
          } catch (hfErr: any) {
            console.warn(`[ImageGen] Hugging Face (${modelName}) failed (${hfErr?.message || hfErr}), trying next...`);
          }
        }
      }
    }

    // ── Tier 3: Google Imagen 3 via @google/genai ───────────────────────────
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      for (const modelName of ["imagen-3.0-generate-002", "imagen-3.0-fast-generate-001"]) {
        try {
          const ai = new GoogleGenAI({ apiKey: geminiKey });
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
              model: `Google ${modelName}`,
              prompt: rawPrompt,
            };
          }
        } catch (err: any) {
          console.warn(`[ImageGen] Google ${modelName} failed (${err?.message || err}), trying fallback...`);
        }
      }
    }

    // ── Tier 4: Ultra-Fast Pollinations Flux AI Fallback ───────────────────
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

    // ── Tier 5: Pollinations Turbo Model Final Fallback ───────────────────
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
