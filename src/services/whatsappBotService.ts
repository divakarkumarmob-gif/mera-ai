import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WASocket,
} from "@whiskeysockets/baileys";
import pino from "pino";
import path from "path";
import fs from "fs";

const authFolder = path.resolve("data", "whatsapp_auth");
try {
  fs.mkdirSync(authFolder, { recursive: true });
} catch {}

class WhatsAppBotService {
  private sock: WASocket | null = null;
  private isConnected = false;
  private pairingCode: string | null = null;
  private dedicatedPhone: string | null = null;

  constructor() {
    this.initSocket().catch((err) => {
      console.log("[WhatsAppBot] Init standby:", err?.message || err);
    });
  }

  public async initSocket() {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(authFolder);
      const { version } = await fetchLatestBaileysVersion();

      const logger = pino({ level: "silent" }) as any;

      this.sock = makeWASocket({
        version,
        auth: state,
        logger,
        printQRInTerminal: false,
        browser: ["Friday AI Assistant", "Chrome", "1.0.0"],
      });

      this.sock.ev.on("creds.update", saveCreds);

      this.sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (connection === "close") {
          const shouldReconnect =
            (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut;
          this.isConnected = false;
          console.log(
            `[WhatsAppBot] Connection closed. Reconnecting: ${shouldReconnect}`
          );
          if (shouldReconnect) {
            setTimeout(() => this.initSocket(), 5000);
          }
        } else if (connection === "open") {
          this.isConnected = true;
          this.pairingCode = null;
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

    if (!this.sock) {
      await this.initSocket();
    }

    if (this.sock && !this.isConnected) {
      try {
        const code = await this.sock.requestPairingCode(cleanPhone);
        this.pairingCode = code;
        console.log(`[WhatsAppBot] Generated Pairing Code for ${cleanPhone}: ${code}`);
        return code;
      } catch (err: any) {
        console.error("[WhatsAppBot] Failed to request pairing code:", err);
        throw new Error(err?.message || "Failed to generate pairing code");
      }
    }

    if (this.isConnected) {
      return "ALREADY_CONNECTED";
    }

    throw new Error("Socket not ready");
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
    };
  }
}

export const whatsappBotService = new WhatsAppBotService();
