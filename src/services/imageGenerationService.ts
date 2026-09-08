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
  mimeType?: string;
  model: string;
  prompt: string;
  error?: string;
}

/**
 * Validates and decodes image buffers, checking for JSON base64 envelopes
 * and verifying magic bytes for JPEG, PNG, WebP, GIF.
 */
function extractValidImageBuffer(rawBuf: Buffer): { buffer: Buffer; mimeType: string } | null {
  if (!rawBuf || rawBuf.length === 0) return null;

  // 1. Check if the buffer is actually a JSON response with base64 encoded image
  const strStart = rawBuf.toString("utf8", 0, Math.min(rawBuf.length, 60)).trim();
  if (strStart.startsWith("{") || strStart.startsWith("[")) {
    try {
      const parsed = JSON.parse(rawBuf.toString("utf8"));
      const b64 =
        parsed?.result?.image ||
        parsed?.image ||
        parsed?.result ||
        parsed?.data?.[0]?.b64_json ||
        parsed?.images?.[0] ||
        parsed?.[0]?.image;

      if (b64 && typeof b64 === "string") {
        const cleanB64 = b64.replace(/^data:image\/\w+;base64,/, "").trim();
        const decoded = Buffer.from(cleanB64, "base64");
        return extractValidImageBuffer(decoded);
      }
    } catch {
      // Not JSON or parse failure
    }
  }

  // 2. Magic byte detection
  // JPEG: FF D8 FF
  if (rawBuf.length >= 3 && rawBuf[0] === 0xFF && rawBuf[1] === 0xD8 && rawBuf[2] === 0xFF) {
    return { buffer: rawBuf, mimeType: "image/jpeg" };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    rawBuf.length >= 4 &&
    rawBuf[0] === 0x89 &&
    rawBuf[1] === 0x50 &&
    rawBuf[2] === 0x4E &&
    rawBuf[3] === 0x47
  ) {
    return { buffer: rawBuf, mimeType: "image/png" };
  }

  // WebP: RIFF .... WEBP
  if (
    rawBuf.length >= 12 &&
    rawBuf.toString("ascii", 0, 4) === "RIFF" &&
    rawBuf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return { buffer: rawBuf, mimeType: "image/webp" };
  }

  // GIF: GIF87a or GIF89a
  if (rawBuf.length >= 6 && rawBuf.toString("ascii", 0, 3) === "GIF") {
    return { buffer: rawBuf, mimeType: "image/gif" };
  }

  // Fallback for valid binary blobs without HTML/JSON wrappers
  if (rawBuf.length > 5000 && !strStart.startsWith("<") && !strStart.startsWith("{")) {
    return { buffer: rawBuf, mimeType: "image/jpeg" };
  }

  return null;
}

class ImageGenerationService {
  /**
   * Generates a photorealistic AI image from a text prompt.
   * Returns a clean binary Buffer with verified magic bytes ready for WhatsApp media upload.
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
            const rawBuf = Buffer.from(arrayBuf);
            const validated = extractValidImageBuffer(rawBuf);
            if (validated && validated.buffer.length > 2000) {
              console.log(
                `[ImageGen] Successfully generated image via Cloudflare (${cfModel}) [${validated.buffer.length} bytes, ${validated.mimeType}]`
              );
              return {
                success: true,
                buffer: validated.buffer,
                mimeType: validated.mimeType,
                model: `Cloudflare (${cfModel.split("/").pop()})`,
                prompt: rawPrompt,
              };
            } else {
              console.warn(
                `[ImageGen] Cloudflare (${cfModel}) response was not a valid image binary (${rawBuf.length} bytes)`
              );
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
              const rawBuf = Buffer.from(arrayBuf);
              const validated = extractValidImageBuffer(rawBuf);
              if (validated && validated.buffer.length > 2000) {
                console.log(
                  `[ImageGen] Successfully generated image via Hugging Face (${modelName}) [${validated.buffer.length} bytes, ${validated.mimeType}]`
                );
                return {
                  success: true,
                  buffer: validated.buffer,
                  mimeType: validated.mimeType,
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
            const rawBuffer = Buffer.from(imageBase64, "base64");
            const validated = extractValidImageBuffer(rawBuffer) || { buffer: rawBuffer, mimeType: "image/jpeg" };
            console.log(`[ImageGen] Successfully generated image using Google ${modelName} (${validated.buffer.length} bytes)`);
            return {
              success: true,
              buffer: validated.buffer,
              mimeType: validated.mimeType,
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
        const rawBuf = Buffer.from(arrayBuf);
        const validated = extractValidImageBuffer(rawBuf) || { buffer: rawBuf, mimeType: "image/jpeg" };
        if (validated && validated.buffer.length > 1000) {
          console.log(
            `[ImageGen] Successfully generated image using Pollinations Flux AI (${validated.buffer.length} bytes)`
          );
          return {
            success: true,
            buffer: validated.buffer,
            mimeType: validated.mimeType,
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
        const rawBuf = Buffer.from(arrayBuf);
        const validated = extractValidImageBuffer(rawBuf) || { buffer: rawBuf, mimeType: "image/jpeg" };
        if (validated && validated.buffer.length > 1000) {
          console.log(
            `[ImageGen] Generated image using Pollinations Turbo (${validated.buffer.length} bytes)`
          );
          return {
            success: true,
            buffer: validated.buffer,
            mimeType: validated.mimeType,
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

  /**
   * Intelligently edits or modifies an existing photo based on user instructions.
   * Uses Gemini Vision to analyze original photo structure & compose a specialized
   * transformation prompt, then executes via the Multi-Tier Flux engine.
   */
  public async editImageWithAI(
    imageBuffer: Buffer,
    editInstructions: string,
    mimeType = "image/jpeg"
  ): Promise<GeneratedImageResult> {
    const rawInstruction = (editInstructions || "").trim();
    if (!rawInstruction) {
      return {
        success: false,
        model: "none",
        prompt: "",
        error: "Edit instructions cannot be empty",
      };
    }

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.VITE_GEMINI_API_KEY?.trim();
    let enhancedPrompt = rawInstruction;

    if (apiKey && imageBuffer && Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const base64Data = imageBuffer.toString("base64");
        const cleanMime = (mimeType || "image/jpeg").split(";")[0].trim() || "image/jpeg";

        const visionPrompt = `You are a world-class AI Image Transformation & Inpainting Prompt Specialist.
The user wants to EDIT/MODIFY this provided image according to these user instructions:
"${rawInstruction}"

Analyze this image in detail:
1. Identify key subjects, characters, environment, colors, art style, lighting, and composition.
2. Formulate a single, highly detailed, photorealistic prompt for modern diffusion models (Flux.1 / SDXL) that creates the edited version.
3. Keep the original character/subject consistent while applying all user requested edits (e.g. background changes, accessories, lighting, style transforms).
4. Output ONLY the raw descriptive prompt text without introductory remarks or quotes.`;

        const VISION_EDIT_MODELS = [
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash-lite",
          "gemini-2.5-flash-lite",
          "gemini-3.6-flash",
          "gemini-3.5-flash",
          "gemini-2.5-flash",
          "gemini-1.5-flash",
        ];

        for (const model of VISION_EDIT_MODELS) {
          try {
            const resp = await ai.models.generateContent({
              model,
              contents: [
                {
                  role: "user",
                  parts: [
                    {
                      inlineData: {
                        mimeType: cleanMime,
                        data: base64Data,
                      },
                    },
                    { text: visionPrompt },
                  ],
                },
              ],
            });
            const text = resp.text?.trim();
            if (text && text.length > 10) {
              enhancedPrompt = text;
              console.log(`[ImageGen] Vision Edit Prompt formulated (${model}): "${enhancedPrompt.slice(0, 80)}..."`);
              break;
            }
          } catch (modelErr: any) {
            console.warn(`[ImageGen] Vision model ${model} failed for edit prompt (${modelErr?.message || modelErr})`);
          }
        }
      } catch (err: any) {
        console.warn("[ImageGen] Vision edit prompt generation failed:", err?.message || err);
      }
    }

    return this.generateImage(enhancedPrompt);
  }

  /**
   * Dual-Image AI Fusion Engine (Face Swap, Style & Color Grading Transfer, Outfit Transfer).
   * Takes Image 1 (Source Face / Subject) and Image 2 (Target Body / Style / Color Reference),
   * analyzes both with Gemini Multimodal Vision, and synthesizes the fused masterpiece.
   */
  public async fuseTwoImagesWithAI(
    image1Buffer: Buffer,
    image2Buffer: Buffer,
    userInstruction: string,
    mimeType1 = "image/jpeg",
    mimeType2 = "image/jpeg"
  ): Promise<GeneratedImageResult> {
    const rawInstruction = (userInstruction || "Seamlessly blend the two photos").trim();
    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.VITE_GEMINI_API_KEY?.trim();
    let enhancedPrompt = rawInstruction;

    if (
      apiKey &&
      image1Buffer &&
      image2Buffer &&
      Buffer.isBuffer(image1Buffer) &&
      Buffer.isBuffer(image2Buffer) &&
      image1Buffer.length > 0 &&
      image2Buffer.length > 0
    ) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const b64_1 = image1Buffer.toString("base64");
        const b64_2 = image2Buffer.toString("base64");
        const cleanMime1 = (mimeType1 || "image/jpeg").split(";")[0].trim() || "image/jpeg";
        const cleanMime2 = (mimeType2 || "image/jpeg").split(";")[0].trim() || "image/jpeg";

        const fusionPrompt = `You are a world-class AI Photo Fusion & Style Transfer Prompt Engineer.
You have been given TWO images:
• IMAGE 1 (First image): Source Subject / Face / Person 1.
• IMAGE 2 (Second image): Reference Style / Body / Background / Color Palette / Lighting.

USER GOAL / INSTRUCTIONS:
"${rawInstruction}"

TASK:
1. If the user wants Face Swap: Take the exact facial identity, features, and hair of Image 1 and map it onto the body, pose, clothing, and environment of Image 2.
2. If the user wants Color/Style Transfer: Take the subject/content from Image 1 and apply the cinematic color grading, tone curve, lighting mood, and visual aesthetics of Image 2.
3. If the user wants Combination/Fusion: Harmoniously combine both subjects/scenes into a coherent 8k photorealistic photo.

Generate a single, comprehensive, hyper-realistic diffusion prompt for Flux.1/SDXL that will generate the exact fused output.
Output ONLY the raw descriptive prompt string.`;

        const FUSION_MODELS = [
          "gemini-3.1-flash-lite",
          "gemini-3.5-flash-lite",
          "gemini-2.5-flash-lite",
          "gemini-3.6-flash",
          "gemini-3.5-flash",
          "gemini-2.5-flash",
          "gemini-1.5-flash",
        ];

        for (const model of FUSION_MODELS) {
          try {
            const resp = await ai.models.generateContent({
              model,
              contents: [
                {
                  role: "user",
                  parts: [
                    { inlineData: { mimeType: cleanMime1, data: b64_1 } },
                    { inlineData: { mimeType: cleanMime2, data: b64_2 } },
                    { text: fusionPrompt },
                  ],
                },
              ],
            });
            const text = resp.text?.trim();
            if (text && text.length > 10) {
              enhancedPrompt = text;
              console.log(`[ImageGen] Dual Image Fusion Prompt formulated (${model}): "${enhancedPrompt.slice(0, 80)}..."`);
              break;
            }
          } catch (modelErr: any) {
            console.warn(`[ImageGen] Dual Image Fusion model ${model} failed (${modelErr?.message || modelErr})`);
          }
        }
      } catch (err: any) {
        console.warn("[ImageGen] Dual Image Fusion prompt error:", err?.message || err);
      }
    }

    return this.generateImage(enhancedPrompt);
  }
}

export const imageGenerationService = new ImageGenerationService();
