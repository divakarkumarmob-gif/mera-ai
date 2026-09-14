/**
 * whatsappMetaAiBridgeEngine.ts
 *
 * WhatsApp Native Inbuilt Meta AI Bridge Engine (Zero Web Scraping, 100% Baileys Protocol):
 * 1. Directly communicates with WhatsApp's official Meta AI bot (13135550002@s.whatsapp.net).
 * 2. Generates images (/imagine <prompt>), animates photos, and modifies photos natively inside WhatsApp.
 * 3. Human-like anti-ban stealth:
 *    - Gaussian random presence updates (composing/typing simulation).
 *    - Rate-limiting queue (prevents spamming Meta AI).
 *    - Ghost read receipts (human delay before blue ticking Meta AI replies).
 * 4. Automatic fallback to Cloudflare FLUX.1 & Pollinations if Meta AI experiences latency or policy refusals.
 */

import { humanBotFirewallService } from "../humanBotFirewallService";
import { imageGenerationService } from "../imageGenerationService";
import { aiMediaAnimationEngine } from "../aiMediaAnimationEngine";

export interface PendingMetaAiRequest {
  id: string;
  requesterJid: string;
  requestType: "imagine" | "animate" | "edit";
  prompt: string;
  imageBuffer?: Buffer;
  timestamp: number;
  messageKey?: any;
  resolve: (result: { success: boolean; buffer?: Buffer; mediaType: "image" | "video" | "text"; caption?: string; error?: string }) => void;
  timeoutTimer: NodeJS.Timeout;
}

export class WhatsAppMetaAiBridgeEngine {
  public static readonly META_AI_JID = "13135550002@s.whatsapp.net";
  private pendingRequests: Map<string, PendingMetaAiRequest> = new Map();
  private requestQueue: Array<() => Promise<void>> = [];
  private isProcessingQueue = false;
  private lastMetaAiInteractionTime = 0;

  /**
   * Check if an incoming message is from WhatsApp's official Meta AI bot
   */
  public isMetaAiMessage(jid: string): boolean {
    if (!jid) return false;
    return jid.includes("13135550002") || jid === WhatsAppMetaAiBridgeEngine.META_AI_JID;
  }

  /**
   * Request an AI image from WhatsApp's native Meta AI via /imagine
   */
  public async requestImagineImage(
    sock: any,
    requesterJid: string,
    prompt: string,
    messageKey?: any
  ): Promise<{ success: boolean; buffer?: Buffer; mediaType: "image" | "video" | "text"; caption?: string; error?: string }> {
    const cleanPrompt = (prompt || "").trim();
    if (!cleanPrompt) {
      return { success: false, mediaType: "text", error: "Prompt cannot be empty" };
    }

    if (!sock?.sendMessage) {
      // Fallback directly to Cloudflare / Pollinations FLUX
      const imgRes = await imageGenerationService.generateImage(cleanPrompt);
      if (imgRes.success && imgRes.buffer) {
        return { success: true, buffer: imgRes.buffer, mediaType: "image", caption: `✨ *AI Photo Generated!* 🎨\n\n📌 *Prompt:* _"${cleanPrompt}"_\n🤖 *Engine:* ${imgRes.model}` };
      }
      return { success: false, mediaType: "text", error: imgRes.error || "Image generation failed" };
    }

    return new Promise((resolve) => {
      const reqId = `meta_imagine_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      // 35s Timeout with automatic fallback to Cloudflare/Pollinations
      const timeoutTimer = setTimeout(async () => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          console.log(`[MetaAiBridge] ⏱️ Meta AI timeout for prompt "${cleanPrompt.slice(0, 40)}...", falling back to Cloudflare/Pollinations FLUX...`);
          try {
            const fallbackRes = await imageGenerationService.generateImage(cleanPrompt);
            if (fallbackRes.success && fallbackRes.buffer) {
              resolve({
                success: true,
                buffer: fallbackRes.buffer,
                mediaType: "image",
                caption: `✨ *AI Photo Generated!* 🎨\n\n📌 *Prompt:* _"${cleanPrompt}"_\n🤖 *Engine:* ${fallbackRes.model} (Auto-Failover)`,
              });
              return;
            }
          } catch {}
          resolve({ success: false, mediaType: "text", error: "Meta AI did not reply in time." });
        }
      }, 35000);

      this.pendingRequests.set(reqId, {
        id: reqId,
        requesterJid,
        requestType: "imagine",
        prompt: cleanPrompt,
        timestamp: Date.now(),
        messageKey,
        resolve,
        timeoutTimer,
      });

      this.enqueueTask(async () => {
        await this.dispatchImagineToMetaAi(sock, cleanPrompt);
      });
    });
  }

  /**
   * Request photo animation from WhatsApp's native Meta AI
   */
  public async requestAnimatePhoto(
    sock: any,
    requesterJid: string,
    imageBuffer: Buffer,
    motionPrompt = "Animate this photo with natural living motion",
    messageKey?: any
  ): Promise<{ success: boolean; buffer?: Buffer; mediaType: "image" | "video" | "text"; caption?: string; error?: string }> {
    if (!imageBuffer || imageBuffer.length === 0) {
      return { success: false, mediaType: "text", error: "Image buffer is empty" };
    }

    if (!sock?.sendMessage) {
      const animRes = await aiMediaAnimationEngine.animateImage(imageBuffer, motionPrompt);
      if (animRes.success && animRes.videoBuffer) {
        return { success: true, buffer: animRes.videoBuffer, mediaType: "video", caption: `🪄 *Photo Animated!* 🎬\n\n🤖 *Engine:* ${animRes.model}` };
      }
      return { success: false, mediaType: "text", error: animRes.error || "Animation failed" };
    }

    return new Promise((resolve) => {
      const reqId = `meta_anim_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

      const timeoutTimer = setTimeout(async () => {
        if (this.pendingRequests.has(reqId)) {
          this.pendingRequests.delete(reqId);
          console.log(`[MetaAiBridge] ⏱️ Meta AI animation timeout, falling back to Pollinations Motion Engine...`);
          try {
            const fallbackAnim = await aiMediaAnimationEngine.animateImage(imageBuffer, motionPrompt);
            if (fallbackAnim.success && fallbackAnim.videoBuffer) {
              resolve({
                success: true,
                buffer: fallbackAnim.videoBuffer,
                mediaType: "video",
                caption: `🪄 *Photo Animated!* 🎬\n\n🤖 *Engine:* ${fallbackAnim.model} (Auto-Failover)`,
              });
              return;
            }
          } catch {}
          resolve({ success: false, mediaType: "text", error: "Meta AI animation timed out." });
        }
      }, 40000);

      this.pendingRequests.set(reqId, {
        id: reqId,
        requesterJid,
        requestType: "animate",
        prompt: motionPrompt,
        imageBuffer,
        timestamp: Date.now(),
        messageKey,
        resolve,
        timeoutTimer,
      });

      this.enqueueTask(async () => {
        await this.dispatchAnimateToMetaAi(sock, imageBuffer, motionPrompt);
      });
    });
  }

  /**
   * Internal queue to prevent flooding Meta AI and enforce human-like interaction rate
   */
  private enqueueTask(task: () => Promise<void>) {
    this.requestQueue.push(task);
    if (!this.isProcessingQueue) {
      this.processQueue();
    }
  }

  private async processQueue() {
    if (this.isProcessingQueue || this.requestQueue.length === 0) return;
    this.isProcessingQueue = true;

    while (this.requestQueue.length > 0) {
      const nextTask = this.requestQueue.shift();
      if (nextTask) {
        // Enforce 3-6s human gap between consecutive requests to Meta AI
        const elapsed = Date.now() - this.lastMetaAiInteractionTime;
        if (elapsed < 4000) {
          const waitMs = 4000 - elapsed + Math.floor(Math.random() * 2000);
          await new Promise((r) => setTimeout(r, waitMs));
        }

        try {
          await nextTask();
          this.lastMetaAiInteractionTime = Date.now();
        } catch (taskErr) {
          console.warn("[MetaAiBridge] Error executing queued Meta AI task:", taskErr);
        }
      }
    }

    this.isProcessingQueue = false;
  }

  /**
   * Dispatches `/imagine <prompt>` to Meta AI with human-like typing and entropy injection
   */
  private async dispatchImagineToMetaAi(sock: any, prompt: string) {
    const metaJid = WhatsAppMetaAiBridgeEngine.META_AI_JID;

    // 1. Simulate Human Composing Presence (1.8s - 3.2s)
    const typingDelay = Math.floor(humanBotFirewallService.gaussianRandom(2200, 400));
    try {
      sock.sendPresenceUpdate?.("composing", metaJid).catch(() => {});
      await new Promise((r) => setTimeout(r, Math.max(1200, Math.min(4500, typingDelay))));
      sock.sendPresenceUpdate?.("paused", metaJid).catch(() => {});
    } catch {}

    // 2. Format command with anti-hash entropy
    const commandText = prompt.startsWith("/imagine") ? prompt : `/imagine ${prompt}`;
    const humanFormatted = humanBotFirewallService.injectAntiHashZeroWidthEntropy(commandText);

    console.log(`[MetaAiBridge] 🤖 Sending native WhatsApp prompt to Meta AI: "${prompt.slice(0, 50)}..."`);
    await sock.sendMessage(metaJid, { text: humanFormatted });
  }

  /**
   * Dispatches photo animation request to Meta AI with human media upload
   */
  private async dispatchAnimateToMetaAi(sock: any, imageBuffer: Buffer, motionPrompt: string) {
    const metaJid = WhatsAppMetaAiBridgeEngine.META_AI_JID;

    // 1. Simulate Human Presence
    try {
      sock.sendPresenceUpdate?.("composing", metaJid).catch(() => {});
      await new Promise((r) => setTimeout(r, 1800 + Math.random() * 800));
      sock.sendPresenceUpdate?.("paused", metaJid).catch(() => {});
    } catch {}

    const caption = `animate this: ${motionPrompt || "smooth living animation"}`;
    const humanCaption = humanBotFirewallService.injectAntiHashZeroWidthEntropy(caption);

    console.log(`[MetaAiBridge] 🎬 Sending photo to Meta AI for native animation...`);
    await sock.sendMessage(metaJid, {
      image: imageBuffer,
      caption: humanCaption,
    });
  }

  /**
   * Intercept incoming message from Meta AI in Baileys `messages.upsert`
   */
  public async handleIncomingMetaAiMessage(
    sock: any,
    msg: any,
    downloadMediaFn: (msg: any, mediaType: string) => Promise<Buffer>
  ): Promise<boolean> {
    const senderJid = msg?.key?.remoteJid || "";
    if (!this.isMetaAiMessage(senderJid)) {
      return false;
    }

    const messageContent = msg?.message;
    if (!messageContent) return false;

    // 1. Human Ghost Read Delay (1.2s - 2.2s) before sending blue ticks to Meta AI
    const readDelay = Math.floor(1200 + Math.random() * 1000);
    await new Promise((r) => setTimeout(r, readDelay));
    sock.readMessages?.([msg.key]).catch(() => {});

    // Find the oldest matching pending request
    let matchedReq: PendingMetaAiRequest | null = null;
    let matchedReqId = "";

    this.pendingRequests.forEach((req, id) => {
      if (!matchedReq) {
        matchedReq = req;
        matchedReqId = id;
      }
    });

    if (!matchedReq) {
      console.log("[MetaAiBridge] Received unprompted message from Meta AI:", Object.keys(messageContent));
      return true;
    }

    this.pendingRequests.delete(matchedReqId);
    if (matchedReq.timeoutTimer) clearTimeout(matchedReq.timeoutTimer);

    // 2. Check if Meta AI sent an Image
    if (messageContent.imageMessage) {
      try {
        console.log(`[MetaAiBridge] 📸 Meta AI replied with generated image! Downloading buffer...`);
        const buffer = await downloadMediaFn(msg, "buffer");
        if (buffer && buffer.length > 2000) {
          matchedReq.resolve({
            success: true,
            buffer,
            mediaType: "image",
            caption: `✨ *Generated by Meta AI on WhatsApp!* 🎨\n\n📌 *Prompt:* _"${matchedReq.prompt}"_\n🌐 *Source:* WhatsApp Official Meta AI`,
          });
          return true;
        }
      } catch (dlErr) {
        console.warn("[MetaAiBridge] Failed to download Meta AI image:", dlErr);
      }
    }

    // 3. Check if Meta AI sent a Video (e.g. animation)
    if (messageContent.videoMessage) {
      try {
        console.log(`[MetaAiBridge] 🎬 Meta AI replied with animated video! Downloading buffer...`);
        const buffer = await downloadMediaFn(msg, "buffer");
        if (buffer && buffer.length > 2000) {
          matchedReq.resolve({
            success: true,
            buffer,
            mediaType: "video",
            caption: `🪄 *Animated by Meta AI on WhatsApp!* 🎬\n\n🌐 *Source:* WhatsApp Official Meta AI Animation`,
          });
          return true;
        }
      } catch (dlErr) {
        console.warn("[MetaAiBridge] Failed to download Meta AI video:", dlErr);
      }
    }

    // 4. Check if Meta AI sent a text response (e.g. refusal or chat)
    const textReply =
      messageContent.conversation ||
      messageContent.extendedTextMessage?.text ||
      "";

    if (textReply) {
      console.log(`[MetaAiBridge] 💬 Meta AI replied with text: "${textReply.slice(0, 80)}..."`);
      
      // If Meta AI refused with safety/policy, fallback to our uncensored engine
      if (/cannot|can't|unable to|policy|guidelines|sorry/i.test(textReply)) {
        console.log(`[MetaAiBridge] Meta AI refused prompt, triggering Uncensored FLUX Fallback...`);
        try {
          const fallbackRes = await imageGenerationService.generateImage(matchedReq.prompt);
          if (fallbackRes.success && fallbackRes.buffer) {
            matchedReq.resolve({
              success: true,
              buffer: fallbackRes.buffer,
              mediaType: "image",
              caption: `✨ *AI Photo Generated!* 🎨\n\n📌 *Prompt:* _"${matchedReq.prompt}"_\n🤖 *Engine:* ${fallbackRes.model} (Uncensored Fallback)`,
            });
            return true;
          }
        } catch {}
      }

      matchedReq.resolve({
        success: true,
        mediaType: "text",
        caption: `🤖 *Meta AI Response:*\n\n${textReply}`,
      });
      return true;
    }

    return true;
  }
}

export const whatsappMetaAiBridgeEngine = new WhatsAppMetaAiBridgeEngine();
