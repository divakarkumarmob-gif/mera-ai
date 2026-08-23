import * as BaileysModule from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { useFirestoreAuthState } from "./whatsappAuthState";

// Resolve Baileys exports safely across CJS/ESM bundling
const baileys: any = BaileysModule;
const makeWASocket = baileys.default?.default || baileys.default || baileys.makeWASocket || baileys;
const DisconnectReason = baileys.DisconnectReason || baileys.default?.DisconnectReason;
const fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion || baileys.default?.fetchLatestBaileysVersion;

type WASocket = any;

class WhatsAppBotService {
  private sock: WASocket | null = null;
  private isConnected = false;
  private pairingCode: string | null = null;
  private qrCodeDataUrl: string | null = null;
  private dedicatedPhone: string | null = null;
  private clearAuthFn: (() => Promise<void>) | null = null;

  constructor() {
    this.initSocket().catch((err) => {
      console.log("[WhatsAppBot] Init standby:", err?.message || err);
    });
  }

  public async initSocket() {
    try {
      if (!makeWASocket || typeof makeWASocket !== "function") {
        console.warn("[WhatsAppBot] makeWASocket is not a function:", typeof makeWASocket);
        return;
      }
      // Auth session (creds + signal keys) now lives in Firestore instead of
      // local disk, so pairing survives restarts/redeploys on Render's free
      // plan (which has no persistent disk).
      const { state, saveCreds, clearAuth } = await useFirestoreAuthState();
      this.clearAuthFn = clearAuth;
      const versionResult = await fetchLatestBaileysVersion?.();
      const version = versionResult?.version;

      const logger = pino({ level: "silent" }) as any;

      this.sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        // Standard Linux/Chrome tuple officially supported by WhatsApp for pairing codes & QR
        browser: ["Ubuntu", "Chrome", "20.0.04"],
        syncFullHistory: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr, { margin: 2, scale: 7 });
          } catch (e) {
            console.error("[WhatsAppBot] QR code generation error:", e);
          }
        }

        if (connection === "close") {
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason?.loggedOut;
          this.isConnected = false;
          this.qrCodeDataUrl = null;
          console.log(`[WhatsAppBot] Connection closed (${statusCode}). Reconnecting: ${shouldReconnect}`);
          if (shouldReconnect) {
            setTimeout(() => this.initSocket(), 5000);
          }
        } else if (connection === "open") {
          this.isConnected = true;
          this.pairingCode = null;
          this.qrCodeDataUrl = null;
          console.log("[WhatsAppBot] Connected successfully to dedicated WhatsApp number!");
        }
      });
    } catch (err) {
      console.error("[WhatsAppBot] Error initializing socket:", err);
    }
  }

  /**
   * Generates an 8-digit Pairing Code for linking the spare phone number.
   */
  public async requestPairingCode(phoneNumber: string): Promise<string> {
    let cleanPhone = phoneNumber.replace(/[\s\-\(\)\+]/g, "").trim();
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
    this.dedicatedPhone = cleanPhone;

    if (this.isConnected) {
      return "ALREADY_CONNECTED";
    }

    if (!this.sock) {
      await this.initSocket();
    }

    // Wait a brief moment for socket connection to initialize
    await new Promise((resolve) => setTimeout(resolve, 800));

    if (this.sock && !this.isConnected) {
      try {
        const code = await this.sock.requestPairingCode(cleanPhone);
        this.pairingCode = code;
        console.log(`[WhatsAppBot] Generated Pairing Code for ${cleanPhone}: ${code}`);
        return code;
      } catch (err: any) {
        console.error("[WhatsAppBot] Failed to request pairing code:", err);
        // If failed due to stale creds, reset auth and retry once
        try {
          await this.resetSession();
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const code = await this.sock.requestPairingCode(cleanPhone);
          this.pairingCode = code;
          return code;
        } catch (retryErr: any) {
          throw new Error(retryErr?.message || err?.message || "Failed to generate pairing code");
        }
      }
    }

    throw new Error("WhatsApp socket not ready. Please try again.");
  }

  public async resetSession() {
    this.isConnected = false;
    this.pairingCode = null;
    this.qrCodeDataUrl = null;
    try {
      if (this.sock) {
        this.sock.end(undefined);
        this.sock = null;
      }
      if (this.clearAuthFn) {
        await this.clearAuthFn();
      }
    } catch (e) {
      console.error("[WhatsAppBot] Error during resetSession:", e);
    }
    await this.initSocket();
  }

  public async sendMessage(toPhone: string, text: string): Promise<{ success: boolean; message: string }> {
    let cleanPhone = toPhone.replace(/[\s\-\(\)\+]/g, "").trim();
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

    if (!this.isConnected || !this.sock) {
      return {
        success: false,
        message: "Dedicated WhatsApp bot is not connected. Please pair your dedicated number in settings or terminal.",
      };
    }

    try {
      const jid = `${cleanPhone}@s.whatsapp.net`;
      await this.sock.sendMessage(jid, { text: text.trim() });
      console.log(`[WhatsAppBot] Message successfully sent to ${cleanPhone}: "${text}"`);
      return {
        success: true,
        message: `Message delivered to +${cleanPhone} from Friday Assistant!`,
      };
    } catch (err: any) {
      console.error("[WhatsAppBot] Error sending message:", err);
      return {
        success: false,
        message: `Failed to send WhatsApp message: ${err?.message || err}`,
      };
    }
  }

  public getStatus() {
    return {
      isConnected: this.isConnected,
      dedicatedPhone: this.dedicatedPhone,
      pairingCode: this.pairingCode,
      qrCodeDataUrl: this.qrCodeDataUrl,
    };
  }
}

export const whatsappBotService = new WhatsAppBotService();
