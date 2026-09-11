/**
 * FRIDAY AI — Exotel Indian Cloud Telephony Service (+91 Virtual Number Calling)
 * Handles Inbound Call Webhooks, Multi-Turn Voice AI Dialogues,
 * Real-Time Groq STT + Gemini LLM + Edge/Sarvam TTS, Outbound Calling,
 * Call Logs, and Instant WhatsApp/Telegram Post-Call Summary Alerts.
 */

import fs from "fs";
import path from "path";
import { GoogleGenAI } from "@google/genai";
import { voiceBridgeService } from "./voiceBridgeService";
import { sendWhatsAppUnified } from "./whatsappService";
import { telegramBotService } from "./telegramBotService";
import { memoryEngine } from "./memoryEngine";

export interface ExotelConfig {
  accountSid: string;
  apiKey: string;
  apiToken: string;
  subdomain: string; // e.g. "api.exotel.com" or "api.in.exotel.com"
  virtualNumber: string; // Exotel ExoPhone (e.g. "08047123456" or "+918047123456")
  appId?: string; // Optional Exotel Flow App ID
  isLive: boolean;
  bossNotificationNumber?: string; // WhatsApp number for alerts
}

export interface ExotelCallSession {
  callSid: string;
  from: string;
  to: string;
  callerName?: string;
  startTime: number;
  endTime?: number;
  durationSecs: number;
  status: "ringing" | "in-progress" | "completed" | "failed" | "busy" | "no-answer";
  direction: "inbound" | "outbound";
  turns: Array<{
    speaker: "caller" | "friday";
    text: string;
    timestamp: number;
    audioUrl?: string;
  }>;
  summary?: string;
  actionItems?: string[];
  recordingUrl?: string;
}

class ExotelService {
  private configPath = path.resolve(process.cwd(), "data", "exotel_config.json");
  private logsPath = path.resolve(process.cwd(), "data", "exotel_call_logs.json");
  private config: ExotelConfig = {
    accountSid: process.env.EXOTEL_ACCOUNT_SID || "",
    apiKey: process.env.EXOTEL_API_KEY || "",
    apiToken: process.env.EXOTEL_API_TOKEN || "",
    subdomain: process.env.EXOTEL_SUBDOMAIN || "api.exotel.com",
    virtualNumber: process.env.EXOTEL_VIRTUAL_NUMBER || "",
    appId: process.env.EXOTEL_APP_ID || "",
    isLive: false,
    bossNotificationNumber: process.env.BOSS_WHATSAPP_NUMBER || "",
  };

  private activeSessions = new Map<string, ExotelCallSession>();
  private audioBufferStore = new Map<string, { buffer: Buffer; mimeType: string; createdAt: number }>();

  constructor() {
    this.ensureDataDir();
    this.loadConfig();
    this.cleanupOldAudioBuffersPeriodically();
  }

  private ensureDataDir(): void {
    const dataDir = path.resolve(process.cwd(), "data");
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch {}
    }
  }

  public getConfig(): ExotelConfig {
    return { ...this.config };
  }

  public saveConfig(newConfig: Partial<ExotelConfig>): { success: boolean; config: ExotelConfig } {
    this.config = {
      ...this.config,
      ...newConfig,
      isLive: Boolean(newConfig.accountSid && newConfig.apiKey && newConfig.apiToken),
    };
    try {
      this.ensureDataDir();
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf-8");
      console.log("[ExotelService] 💾 Exotel Telephony config updated successfully.");
    } catch (e) {
      console.warn("[ExotelService] Failed to save config to disk:", e);
    }
    return { success: true, config: this.config };
  }

  private loadConfig(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, "utf-8");
        const parsed = JSON.parse(raw);
        this.config = { ...this.config, ...parsed };
      }
    } catch (e) {
      console.warn("[ExotelService] Error reading config file:", e);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // DYNAMIC AUDIO BUFFER STORE (For Exotel to stream Friday's generated voice)
  // ──────────────────────────────────────────────────────────────────────────
  public storeAudio(buffer: Buffer, mimeType: string = "audio/mpeg"): string {
    const audioId = `friday_voice_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.mp3`;
    this.audioBufferStore.set(audioId, { buffer, mimeType, createdAt: Date.now() });
    return audioId;
  }

  public getAudio(audioId: string): { buffer: Buffer; mimeType: string } | null {
    const item = this.audioBufferStore.get(audioId);
    return item ? { buffer: item.buffer, mimeType: item.mimeType } : null;
  }

  private cleanupOldAudioBuffersPeriodically(): void {
    setInterval(() => {
      const now = Date.now();
      for (const [id, data] of this.audioBufferStore.entries()) {
        if (now - data.createdAt > 30 * 60 * 1000) {
          // 30 mins TTL
          this.audioBufferStore.delete(id);
        }
      }
    }, 10 * 60 * 1000);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // INBOUND CALL HANDLING & MULTI-TURN AI VOICE DIALOGUE
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * 1. Initial Inbound Call Webhook (Exotel Passthru / Voicebot Entrypoint)
   */
  public async handleIncomingCall(params: {
    callSid: string;
    from: string;
    to: string;
    baseUrl: string;
  }): Promise<{ exml: string; session: ExotelCallSession }> {
    const { callSid, from, to, baseUrl } = params;
    console.log(`[ExotelService] 📞 Incoming call on ${to} from: ${from} (CallSid: ${callSid})`);

    const cleanFrom = from.replace(/\D/g, "");
    const session: ExotelCallSession = {
      callSid,
      from: cleanFrom,
      to,
      startTime: Date.now(),
      durationSecs: 0,
      status: "in-progress",
      direction: "inbound",
      turns: [],
    };
    this.activeSessions.set(callSid, session);

    // Initial greeting in Hindi
    const greetingText = "नमस्ते! मैं Boss की AI असिस्टेंट Friday बोल रही हूँ। बताइए मैं आपकी क्या मदद कर सकती हूँ?";
    session.turns.push({
      speaker: "friday",
      text: greetingText,
      timestamp: Date.now(),
    });

    // Synthesize audio
    let audioUrl = "";
    try {
      const speech = await voiceBridgeService.generateSpeech(greetingText);
      const audioId = this.storeAudio(speech.buffer, speech.mimeType);
      audioUrl = `${baseUrl.replace(/\/$/, "")}/api/exotel/audio/${audioId}`;
    } catch (err) {
      console.warn("[ExotelService] TTS fallback error:", err);
    }

    // ExML Response: Play greeting and record caller's response (or gather audio)
    const callbackUrl = `${baseUrl.replace(/\/$/, "")}/api/exotel/process-speech?callSid=${encodeURIComponent(callSid)}`;
    
    let exml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n`;
    if (audioUrl) {
      exml += `  <Play>${audioUrl}</Play>\n`;
    } else {
      exml += `  <Say voice="female">${greetingText}</Say>\n`;
    }
    // Record up to 15 seconds of caller speech
    exml += `  <Record action="${callbackUrl}" method="POST" maxLength="15" timeout="4" />\n`;
    exml += `</Response>`;

    return { exml, session };
  }

  /**
   * 2. Process Caller's Speech & Generate Next Friday AI Response Turn
   */
  public async handleSpeechInput(params: {
    callSid: string;
    recordingUrl?: string;
    digits?: string;
    baseUrl: string;
  }): Promise<{ exml: string; fridayReply: string; session: ExotelCallSession }> {
    const { callSid, recordingUrl, digits, baseUrl } = params;
    let session = this.activeSessions.get(callSid);

    if (!session) {
      session = {
        callSid,
        from: "Unknown",
        to: this.config.virtualNumber || "Friday",
        startTime: Date.now(),
        durationSecs: 0,
        status: "in-progress",
        direction: "inbound",
        turns: [],
      };
      this.activeSessions.set(callSid, session);
    }

    let callerText = "";

    // 1. Transcribe caller's voice recording using Groq Whisper / Gemini
    if (recordingUrl && recordingUrl.startsWith("http")) {
      try {
        console.log(`[ExotelService] 🎙️ Fetching & transcribing caller recording from: ${recordingUrl}`);
        const audioRes = await fetch(recordingUrl);
        if (audioRes.ok) {
          const arrayBuf = await audioRes.arrayBuffer();
          const buffer = Buffer.from(arrayBuf);
          callerText = await voiceBridgeService.transcribeAudio(buffer, "audio/wav", "caller.wav");
        }
      } catch (err: any) {
        console.warn("[ExotelService] STT transcription notice:", err?.message || err);
      }
    } else if (digits) {
      callerText = `User pressed keys: ${digits}`;
    }

    if (!callerText || !callerText.trim()) {
      callerText = "(Silence or inaudible speech)";
    }

    session.turns.push({
      speaker: "caller",
      text: callerText,
      timestamp: Date.now(),
      audioUrl: recordingUrl,
    });

    // 2. Generate Friday AI response using Gemini with Persona & Memory
    const fridayReply = await this.generateFridayVoiceResponse(callerText, session);

    session.turns.push({
      speaker: "friday",
      text: fridayReply,
      timestamp: Date.now(),
    });

    // 3. Synthesize Friday's speech
    let audioUrl = "";
    try {
      const speech = await voiceBridgeService.generateSpeech(fridayReply);
      const audioId = this.storeAudio(speech.buffer, speech.mimeType);
      audioUrl = `${baseUrl.replace(/\/$/, "")}/api/exotel/audio/${audioId}`;
    } catch (err) {
      console.warn("[ExotelService] Speech synthesis notice:", err);
    }

    // 4. Check if conversation should end or continue
    const isGoodbye = /bye|alvida|shukriya|dhanyawad|take care|thank you|baad me baat karte|rakhta hu/i.test(
      callerText + " " + fridayReply
    );

    const callbackUrl = `${baseUrl.replace(/\/$/, "")}/api/exotel/process-speech?callSid=${encodeURIComponent(callSid)}`;
    let exml = `<?xml version="1.0" encoding="UTF-8"?>\n<Response>\n`;
    if (audioUrl) {
      exml += `  <Play>${audioUrl}</Play>\n`;
    } else {
      exml += `  <Say voice="female">${fridayReply}</Say>\n`;
    }

    if (!isGoodbye && session.turns.length < 20) {
      // Continue recording next turn
      exml += `  <Record action="${callbackUrl}" method="POST" maxLength="15" timeout="4" />\n`;
    } else {
      // Hang up call gracefully
      exml += `  <Hangup />\n`;
    }
    exml += `</Response>`;

    return { exml, fridayReply, session };
  }

  /**
   * Model Fallback Chain:
   * 1. gemini-3.5-flash-lite (Primary)
   * 2. gemini-2.5-flash-lite (Fallback 1)
   * 3. gemini-3.1-flash-lite (Fallback 2)
   * 4. gemini-3.6-flash      (Fallback 3)
   * 5. gemini-3.5-flash      (Fallback 4)
   * 6. gemini-2.5-flash      (Safety Backup)
   */
  public static readonly MODEL_CHAIN = [
    "gemini-3.5-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemini-3.6-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash",
  ];

  /**
   * 3. Friday Brain Voice Dialogue Generator with Model Fallback Chain
   */
  private async generateFridayVoiceResponse(userInput: string, session: ExotelCallSession): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return "जी, मैंने आपकी बात नोट कर ली है। मैं Boss Divakar को आपका संदेश पहुँचा दूँगी। धन्यवाद!";
    }

    try {
      const memories: any = await memoryEngine.getMemories().catch(() => ({}));
      const memorySnippet = [
        ...(memories.pinnedMemories || []),
        ...(memories.personalVault || []).slice(0, 8),
      ]
        .map((f: any) => `- ${typeof f === "string" ? f : f?.fact || f?.exactFact || JSON.stringify(f)}`)
        .join("\n");

      const conversationHistory = session.turns
        .map((t) => `${t.speaker === "caller" ? "Caller" : "Friday"}: ${t.text}`)
        .join("\n");

      const systemPrompt = `You are FRIDAY (Female Voice Assistant & Smart Executive Secretary) answering a real phone call on Boss Divakar's official phone line.
The caller is speaking to you over a live cellular phone call.

Key Rules:
1. Speak in natural, warm, respectful Hindi/Hinglish (crisp, short, conversational).
2. Keep your answers brief (1 to 2 sentences max) because this is a voice call.
3. If caller asks for Boss Divakar, explain that Boss is busy in development/meetings, ask for their name and purpose, and assure them you will deliver the message.
4. Boss Context & Memory:
${memorySnippet}

Current Call Transcript So Far:
${conversationHistory}

Caller just said: "${userInput}"

Generate Friday's direct spoken response (without emojis, markdown asterisks, or extra formatting so it sounds clean over voice):`;

      const ai = new GoogleGenAI({ apiKey });

      for (const model of ExotelService.MODEL_CHAIN) {
        try {
          const res = await ai.models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text: systemPrompt }] }],
          });

          const reply = res.text?.trim();
          if (reply) {
            return reply.replace(/[*_#`~]/g, "").trim();
          }
        } catch (mErr: any) {
          console.warn(`[ExotelService] Model ${model} failed, attempting next fallback in chain:`, mErr?.message || mErr);
        }
      }

      return "जी, मैंने आपकी बात समझ ली है। मैं Boss को सूचित कर दूँगी।";
    } catch (e: any) {
      console.warn("[ExotelService] Friday LLM voice generation notice:", e?.message);
      return "जी, मैंने आपकी बात समझ ली है। मैं Boss Divakar को आपका संदेश पहुँचा दूँगी।";
    }
  }

  /**
   * 4. Call Ended Status Callback & Instant WhatsApp/Telegram Alert
   */
  public async handleCallStatus(params: {
    callSid: string;
    status: string;
    duration?: number | string;
    recordingUrl?: string;
  }): Promise<ExotelCallSession | null> {
    const { callSid, status, duration, recordingUrl } = params;
    let session = this.activeSessions.get(callSid);

    if (!session) {
      session = {
        callSid,
        from: "Unknown",
        to: this.config.virtualNumber || "Friday",
        startTime: Date.now() - (Number(duration) || 0) * 1000,
        durationSecs: Number(duration) || 0,
        status: (status as any) || "completed",
        direction: "inbound",
        turns: [],
      };
    }

    session.status = (status as any) || "completed";
    session.durationSecs = Number(duration) || session.durationSecs || 0;
    session.endTime = Date.now();
    if (recordingUrl) session.recordingUrl = recordingUrl;

    // Summarize call & send alert to Boss
    await this.summarizeAndNotifyBoss(session);

    // Save to persistent logs
    this.saveCallLog(session);
    this.activeSessions.delete(callSid);

    return session;
  }

  /**
   * 5. Generate AI Summary & Alert Boss on WhatsApp and Telegram
   */
  private async summarizeAndNotifyBoss(session: ExotelCallSession): Promise<void> {
    if (session.turns.length === 0) return;

    const transcript = session.turns
      .map((t) => `• *${t.speaker === "caller" ? "Caller" : "Friday"}*: ${t.text}`)
      .join("\n");

    const callerId = session.from || "Unknown Number";
    const duration = session.durationSecs > 0 ? `${session.durationSecs}s` : "Few seconds";

    const alertMessage = `📞 *[FRIDAY TELEPHONY ALERT] New Phone Call Received!*\n\n` +
      `👤 *Caller:* +${callerId}\n` +
      `⏱️ *Duration:* ${duration}\n` +
      `📅 *Time:* ${new Date().toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}\n\n` +
      `📝 *Call Conversation Transcript:*\n${transcript}\n\n` +
      (session.recordingUrl ? `🎙️ *Recording:* ${session.recordingUrl}\n\n` : "") +
      `_Status: Friday successfully handled the call and recorded details for Boss._`;

    // 1. Send via WhatsApp to Boss
    try {
      const bossNum = this.config.bossNotificationNumber || process.env.BOSS_WHATSAPP_NUMBER || "919315570187";
      if (bossNum) {
        await sendWhatsAppUnified(bossNum, alertMessage);
        console.log(`[ExotelService] 📲 Sent post-call summary alert to Boss on WhatsApp (${bossNum})`);
      }
    } catch (e) {
      console.warn("[ExotelService] WhatsApp post-call notification notice:", e);
    }

    // 2. Send via Telegram to Boss
    try {
      const bossTelegramId = Number(process.env.BOSS_TELEGRAM_CHAT_ID) || 0;
      if (bossTelegramId) {
        await telegramBotService.sendMessage(bossTelegramId, alertMessage);
        console.log(`[ExotelService] ✈️ Sent post-call summary alert to Boss on Telegram`);
      }
    } catch (e) {
      console.warn("[ExotelService] Telegram post-call notification notice:", e);
    }
  }

  /**
   * Resolves the public base URL for Exotel webhooks (Render / Custom domain)
   */
  public resolvePublicBaseUrl(providedUrl?: string): string {
    if (providedUrl && providedUrl.startsWith("http") && !providedUrl.includes("localhost")) {
      return providedUrl.replace(/\/$/, "");
    }
    const renderUrl = process.env.RENDER_EXTERNAL_URL?.trim();
    if (renderUrl && renderUrl.startsWith("http")) {
      return renderUrl.replace(/\/$/, "");
    }
    if (process.env.RENDER_EXTERNAL_HOSTNAME?.trim()) {
      return `https://${process.env.RENDER_EXTERNAL_HOSTNAME.trim().replace(/\/$/, "")}`;
    }
    const appUrl = process.env.APP_BASE_URL?.trim() || process.env.PUBLIC_URL?.trim() || process.env.HOST_URL?.trim();
    if (appUrl && appUrl.startsWith("http")) {
      return appUrl.replace(/\/$/, "");
    }
    return "https://mera-ai-3496.onrender.com";
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OUTBOUND CALL INITIATION (Friday Dials a Real Phone Number)
  // ──────────────────────────────────────────────────────────────────────────
  public async makeOutboundCall(params: {
    to: string;
    customMessage?: string;
    baseUrl?: string;
  }): Promise<{ success: boolean; callSid?: string; message: string }> {
    const { to, customMessage, baseUrl } = params;
    const { accountSid, apiKey, apiToken, subdomain, virtualNumber, appId } = this.config;

    if (!accountSid || !apiKey || !apiToken) {
      return {
        success: false,
        message: "Exotel credentials (AccountSid, ApiKey, ApiToken) missing in settings.",
      };
    }

    const cleanTo = to.replace(/\D/g, "");
    const cleanVirtual = (virtualNumber || "").replace(/\D/g, "");
    const cleanSubdomain = (subdomain || "api.exotel.com").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    const exotelUrl = `https://${cleanSubdomain}/v1/Accounts/${accountSid}/Calls/connect.json`;
    const basicAuth = `Basic ${Buffer.from(`${apiKey}:${apiToken}`).toString("base64")}`;

    const effectiveBaseUrl = this.resolvePublicBaseUrl(baseUrl);
    const flowUrl = `${effectiveBaseUrl}/api/exotel/incoming-call`;
    const statusCallbackUrl = `${effectiveBaseUrl}/api/exotel/call-status`;

    try {
      const formData = new URLSearchParams();

      // Ensure Indian 10-digit number is prefixed with '0' for Exotel compatibility
      let formattedFrom = cleanTo;
      if (formattedFrom.length === 10) {
        formattedFrom = `0${formattedFrom}`;
      }
      formData.append("From", formattedFrom); // Recipient phone number

      // Set CallerId if valid virtual ExoPhone is configured
      if (cleanVirtual && cleanVirtual.length >= 8 && !/^0+$/.test(cleanVirtual) && !cleanVirtual.includes("x")) {
        let formattedCallerId = cleanVirtual;
        if (formattedCallerId.length === 10) formattedCallerId = `0${formattedCallerId}`;
        formData.append("CallerId", formattedCallerId);
      }

      const activeAppId = (appId || this.config.appId || process.env.EXOTEL_APP_ID || "").trim();

      if (activeAppId) {
        // Official Exotel Applet Flow endpoint: http://my.exotel.com/{account_sid}/exoml/start_voice/{app_id}
        const exotelFlowUrl = `http://my.exotel.com/${accountSid}/exoml/start_voice/${activeAppId}`;
        formData.append("Url", exotelFlowUrl);
        console.log(`[ExotelService] 🔗 Using Exotel App Bazaar Voice Flow: ${exotelFlowUrl}`);
      } else if (effectiveBaseUrl && effectiveBaseUrl.startsWith("http") && !effectiveBaseUrl.includes("localhost")) {
        // Direct webhook URL
        formData.append("Url", flowUrl);
      }

      if (effectiveBaseUrl && effectiveBaseUrl.startsWith("http") && !effectiveBaseUrl.includes("localhost")) {
        formData.append("StatusCallback", statusCallbackUrl);
      }

      formData.append("CallType", "trans");
      formData.append("TimeLimit", "300"); // 5 mins max
      formData.append("Record", "true");

      console.log(`[ExotelService] 📞 Dialing outbound call to ${formattedFrom} (ExML Flow: ${flowUrl})`);

      const response = await fetch(exotelUrl, {
        method: "POST",
        headers: {
          Authorization: basicAuth,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: formData.toString(),
      });

      const resData = await response.json();
      if (response.ok && resData?.Call?.Sid) {
        console.log(`[ExotelService] 🚀 Outbound call triggered successfully! CallSid: ${resData.Call.Sid}`);
        return {
          success: true,
          callSid: resData.Call.Sid,
          message: `Call dialed successfully to +${cleanTo}. CallSid: ${resData.Call.Sid}`,
        };
      } else {
        const errMsg = resData?.RestException?.Message || JSON.stringify(resData);
        console.warn("[ExotelService] Exotel API outbound call response:", errMsg);
        return { success: false, message: `Exotel Notice: ${errMsg}` };
      }
    } catch (e: any) {
      console.error("[ExotelService] Outbound call network error:", e);
      return { success: false, message: e?.message || "Outbound call request failed" };
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CALL LOGS & PERSISTENCE
  // ──────────────────────────────────────────────────────────────────────────
  private saveCallLog(session: ExotelCallSession): void {
    try {
      this.ensureDataDir();
      let logs: ExotelCallSession[] = [];
      if (fs.existsSync(this.logsPath)) {
        logs = JSON.parse(fs.readFileSync(this.logsPath, "utf-8"));
      }
      logs.unshift(session);
      // Keep most recent 200 logs
      if (logs.length > 200) logs = logs.slice(0, 200);
      fs.writeFileSync(this.logsPath, JSON.stringify(logs, null, 2), "utf-8");
    } catch (e) {
      console.warn("[ExotelService] Failed to save call log to disk:", e);
    }
  }

  public getCallLogs(limit: number = 50): ExotelCallSession[] {
    try {
      if (fs.existsSync(this.logsPath)) {
        const logs: ExotelCallSession[] = JSON.parse(fs.readFileSync(this.logsPath, "utf-8"));
        return logs.slice(0, limit);
      }
    } catch (e) {
      console.warn("[ExotelService] Error reading call logs:", e);
    }
    return [];
  }

  public clearCallLogs(): boolean {
    try {
      this.ensureDataDir();
      fs.writeFileSync(this.logsPath, JSON.stringify([], null, 2), "utf-8");
      return true;
    } catch {
      return false;
    }
  }
}

export const exotelService = new ExotelService();
