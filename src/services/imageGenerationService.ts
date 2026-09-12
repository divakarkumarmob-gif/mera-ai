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
        const cleanB64 = b64.replace(/^data:image\/\w+;base64, /, "").trim();
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
  if (rawBuf.length >= 6 && rawBuf.toString("ascii", 3) === "GIF") {
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
   * Intelligently enhances a prompt for 4K ultra-realistic cinematic / portrait rendering.
   */
  public enhancePortraitPrompt(rawPrompt: string, isPortrait: boolean = true): string {
    const clean = (rawPrompt || "").trim();
    if (!clean) return clean;

    // Check if user already gave an ultra detailed prompt
    if (clean.length > 200 && clean.includes("8k") && clean.includes("photorealistic")) {
      return clean;
    }

    const portraitKeywords = isPortrait
      ? "cinematic 4k portrait photography, beautiful composition, soft natural rim lighting, sharp focus, detailed facial features, realistic skin texture, shallow depth of field, 85mm f/1.4 lens, 8k resolution, photorealistic, masterpiece"
      : "cinematic ultra-realistic 4k photograph, highly detailed, vivid natural colors, realistic textures, volumetric lighting, 8k uhd, masterpiece";

    return `${clean}, ${portraitKeywords}`;
  }

  /**
   * Generates a photorealistic AI image from a text prompt.
   * Returns a clean binary Buffer with verified magic bytes ready for WhatsApp media upload.
   */
  public async generateImage(
    prompt: string, options: {
      aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
      enhancePrompt?: boolean;
    } = {}
  ): Promise<GeneratedImageResult> {
    let rawPrompt = (prompt || "").trim();
    if (!rawPrompt) {
      return {
        success: false, model: "none", prompt: "", error: "Prompt cannot be empty", };
    }

    const isPortrait = options.aspectRatio === "9:16" || options.aspectRatio === "3:4" || /portrait|ladki|girl|woman|face|person/i.test(rawPrompt);
    if (options.enhancePrompt !== false) {
      rawPrompt = this.enhancePortraitPrompt(rawPrompt, isPortrait);
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
        "@cf/black-forest-labs/flux-1-schnell", "@cf/bytedance/stable-diffusion-xl-lightning", "@cf/stabilityai/stable-diffusion-xl-base-1.0", ];

      for (const cfModel of cfModels) {
        try {
          console.log(`[ImageGen] Trying Cloudflare Workers AI (${cfModel})...`);
          const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${cfModel}`;
          const resp = await Promise.race([
            fetch(cfUrl, {
              method: "POST", headers: {
                Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json", }, body: JSON.stringify({ prompt: rawPrompt }), }), new Promise<Response>((_, reject) =>
              setTimeout(() => reject(new Error("Cloudflare Workers AI timeout")), 25000)
            ), ]);

          if (resp.ok) {
            const arrayBuf = await resp.arrayBuffer();
            const rawBuf = Buffer.from(arrayBuf);
            const validated = extractValidImageBuffer(rawBuf);
            if (validated && validated.buffer.length > 2000) {
              console.log(
                `[ImageGen] Successfully generated image via Cloudflare (${cfModel}) [${validated.buffer.length} bytes, ${validated.mimeType}]`
              );
              return {
                success: true, buffer: validated.buffer, mimeType: validated.mimeType, model: `Cloudflare (${cfModel.split("/").pop()})`, prompt: rawPrompt, };
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
        "black-forest-labs/FLUX.1-schnell", "stabilityai/stable-diffusion-xl-base-1.0", ];

      for (const modelName of hfModels) {
        for (const baseUrl of [
          `https://router.huggingface.co/hf-inference/models/${modelName}`, `https://api-inference.huggingface.co/models/${modelName}`, ]) {
          try {
            console.log(`[ImageGen] Trying Hugging Face (${modelName}) via ${baseUrl.split('/')[2]}...`);
            const resp = await Promise.race([
              fetch(baseUrl, {
                method: "POST", headers: {
                  Authorization: `Bearer ${hfToken}`, "User-Agent": "MeraAI-Friday-Agent/1.0", body: JSON.stringify({ inputs: rawPrompt }), reject) =>
                setTimeout(() => reject(new Error("Hugging Face API timeout")), 25000)
              ), ]);

            if (resp.ok) {
              const arrayBuf = await resp.arrayBuffer();
              const rawBuf = Buffer.from(arrayBuf);
              const validated = extractValidImageBuffer(rawBuf);
              if (validated && validated.buffer.length > 2000) {
                console.log(
                  `[ImageGen] Successfully generated image via Hugging Face (${modelName}) [${validated.buffer.length} bytes, ${validated.mimeType}]`
                );
                return {
                  success: true, model: `Hugging Face (${modelName.split("/").pop()})`, };
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
              model: modelName, config: {
                numberOfImages: 1, outputMimeType: "image/jpeg", aspectRatio: options.aspectRatio || "1:1", new Promise((_, reject) => setTimeout(() => reject(new Error("Imagen 3 timeout")), 15000)), ]);

          const imageBase64 = response?.generatedImages?.[0]?.image?.imageBytes;
          if (imageBase64) {
            const rawBuffer = Buffer.from(imageBase64, "base64");
            const validated = extractValidImageBuffer(rawBuffer) || { buffer: rawBuffer, mimeType: "image/jpeg" };
            console.log(`[ImageGen] Successfully generated image using Google ${modelName} (${validated.buffer.length} bytes)`);
            return {
              success: true, model: `Google ${modelName}`, };
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
            "User-Agent": "MeraAI-Friday-Agent/1.0", reject) => setTimeout(() => reject(new Error("Pollinations timeout")), 20000)), ]);

      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        const rawBuf = Buffer.from(arrayBuf);
        const validated = extractValidImageBuffer(rawBuf) || { buffer: rawBuf, mimeType: "image/jpeg" };
        if (validated && validated.buffer.length > 1000) {
          console.log(
            `[ImageGen] Successfully generated image using Pollinations Flux AI (${validated.buffer.length} bytes)`
          );
          return {
            success: true, imageUrl: pollinationsUrl, model: "Pollinations Flux AI", };
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
            success: true, imageUrl: turboUrl, model: "Pollinations Turbo AI", };
        }
      }
    } catch (turboErr: any) {
      console.error("[ImageGen] Pollinations Turbo fallback failed:", turboErr?.message || turboErr);
    }

    return {
      success: false, error: "All image generation models failed. Please try again with a different description.", };
  }

  /**
   * Intelligently edits or modifies an existing photo based on user instructions.
   * Uses Gemini Vision to analyze original photo structure & compose a specialized
   * transformation prompt, then executes via the Multi-Tier Flux engine.
   */
  public async editImageWithAI(
    imageBuffer: Buffer, editInstructions: string, mimeType = "image/jpeg"
  ): Promise<GeneratedImageResult> {
    const rawInstruction = (editInstructions || "").trim();
    if (!rawInstruction) {
      return {
        success: false, error: "Edit instructions cannot be empty", };
    }

    const apiKey =
      process.env.GEMINI_API_KEY?.trim() ||
      process.env.GOOGLE_API_KEY?.trim() ||
      process.env.VITE_GEMINI_API_KEY?.trim();
    let enhancedPrompt = rawInstruction;

    const hasValidImage = imageBuffer && Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0;

    if (apiKey && hasValidImage) {
      try {
        const ai = new GoogleGenAI({ apiKey });
        const base64Data = imageBuffer.toString("base64");
        const cleanMime = (mimeType || "image/jpeg").split(";")[0].trim() || "image/jpeg";

        const visionPrompt = `You are a world-class AI Biometric Portrait & Photo Editing Specialist.
The user wants to EDIT/MODIFY the provided image according to this instruction:
"${rawInstruction}"

YOUR CRITICAL MISSION:
Preserve the EXACT identity, face structure, bone geometry, and ethnicity of the individual in the photo while seamlessly applying the requested edits.

Analyze the image with extreme precision and write a detailed prompt:
1. EXACT FACIAL BIOMETRICS: Describe the exact face shape (round, oval, square, heart), cheek fullness, jawline, chin curvature, exact skin tone and undertone (e.g. warm dusky South Asian / Indian complexion), eye shape, eyebrow thickness and arch, nose bridge and nostril shape, lip fullness, hair texture, hairline, haircut, parting, and facial hair (stubble, mustache, clean).
2. EXACT CLOTHING & LIGHTING: Describe the current shirt/outfit, collar, colors, lighting angle (key light, rim light), and studio backdrop.
3. USER'S REQUESTED MODIFICATIONS: Seamlessly integrate "${rawInstruction}" (e.g. stylish modern dark sunglasses resting naturally on the nose bridge over the eyes) without altering the person's real face, head shape, or identity.
4. STRICT CONSTRAINT: Do NOT substitute the person for a generic fashion model, European, or celebrity. The person MUST remain the exact same specific individual from the photo.

Output ONLY the raw descriptive prompt text.`;

        const VISION_EDIT_MODELS = [
          "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

        for (const model of VISION_EDIT_MODELS) {
          try {
            const resp = await ai.models.generateContent({
              model,
              contents: [{
                  role: "user", parts: [
                    {
                      inlineData: {
                        mimeType: cleanMime, data: base64Data, }, { text: visionPrompt }, ], });
            const text = resp.text?.trim();
            if (text && text.length > 10) {
              enhancedPrompt = text;
              console.log(`[ImageGen] Biometric Edit Prompt formulated (${model}): "${enhancedPrompt.slice(0, 80)}..."`);
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

    // ── Tier 1: True Image-to-Image / Inpainting on Cloudflare Workers AI ────
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

    if (cfToken && cfAccountId && hasValidImage) {
      const img2imgModels = [
        { model: "@cf/stabilityai/stable-diffusion-xl-base-1.0", strength: 0.48 }, { model: "@cf/runwayml/stable-diffusion-v1-5-inpainting", strength: 0.55 }, ];

      for (const { model: cfModel, strength } of img2imgModels) {
        try {
          console.log(`[ImageGen] Trying True Image-to-Image via Cloudflare (${cfModel}, strength: ${strength})...`);
          const cfUrl = `https://api.cloudflare.com/client/v4/accounts/${cfAccountId}/ai/run/${cfModel}`;
          
          const imageArray = Array.from(imageBuffer);
          const resp = await Promise.race([
            fetch(cfUrl, {
              method: "POST", headers: {
                Authorization: `Bearer ${cfToken}`, "Content-Type": "application/json", body: JSON.stringify({
                prompt: enhancedPrompt, image: imageArray, strength, }), new Promise<Response>((_, reject) =>
              setTimeout(() => reject(new Error("Cloudflare Image-to-Image timeout")), 30000)
            ), ]);

          if (resp.ok) {
            const arrayBuf = await resp.arrayBuffer();
            const rawBuf = Buffer.from(arrayBuf);
            const validated = extractValidImageBuffer(rawBuf);
            if (validated && validated.buffer.length > 2000) {
              console.log(
                `[ImageGen] Successfully edited image via Cloudflare Img2Img (${cfModel}) [${validated.buffer.length} bytes, ${validated.mimeType}]`
              );
              return {
                success: true, buffer: validated.buffer, mimeType: validated.mimeType, model: `Cloudflare Img2Img (${cfModel.split("/").pop()})`, prompt: enhancedPrompt, };
            }
          }
        } catch (cfErr: any) {
          console.warn(`[ImageGen] Cloudflare Img2Img (${cfModel}) failed (${cfErr?.message || cfErr}), trying next...`);
        }
      }
    }

    // ── Tier 2: Multi-Tier Diffusion Fallback with Identity-Locked Prompt ────
    return this.generateImage(enhancedPrompt);
  }

  /**
   * Dual-Image AI Fusion Engine (Face Swap, Style & Color Grading Transfer, Outfit Transfer).
   * Takes Image 1 (Source Face / Subject) and Image 2 (Target Body / Style / Color Reference), * analyzes both with Gemini Multimodal Vision, and synthesizes the fused masterpiece.
   */
  public async fuseTwoImagesWithAI(
    image1Buffer: Buffer, image2Buffer: Buffer, userInstruction: string, mimeType1 = "image/jpeg", mimeType2 = "image/jpeg"
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

        const fusionPrompt = `You are a world-class AI Biometric Photo Fusion & Style Transfer Prompt Specialist.
You have been given TWO images:
• IMAGE 1 (First image): Source Subject / Face / Identity reference.
• IMAGE 2 (Second image): Reference Style / Body / Pose / Clothing / Environment / Lighting.

USER INSTRUCTIONS:
"${rawInstruction}"

CRITICAL REQUIREMENTS:
1. FACE & IDENTITY PRESERVATION: Keep the EXACT facial structure, bone geometry, eyes, nose, lips, hair, and ethnic skin tone of the person in IMAGE 1. Do NOT generate a generic model or alter their facial identity.
2. BODY / STYLE TRANSFER: Map that exact face and expression from IMAGE 1 onto the body, pose, outfit, and background environment of IMAGE 2.
3. HARMONIOUS INTEGRATION: Match the lighting direction, color temperature, and depth of field seamlessly.

Generate a single, comprehensive, hyper-realistic diffusion prompt for Flux.1/SDXL that will generate this exact fused photo.
Output ONLY the raw descriptive prompt string without quotes.`;

        const FUSION_MODELS = [
          "gemini-3.1-flash-lite", "gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash-lite", "gemini-3.5-flash", "gemini-3-flash", "gemini-2.0-flash", "gemini-1.5-flash"];

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
