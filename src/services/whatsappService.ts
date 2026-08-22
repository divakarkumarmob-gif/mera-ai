import https from "https";
import http from "http";
import { memoryEngine } from "./memoryEngine";

export interface WhatsAppSendResult {
  success: boolean;
  message: string;
  phone?: string;
}

class WhatsAppService {
  /**
   * Dispatches a WhatsApp message 100% in the background silently.
   * Checks for phone and apiKey in environment variables first, then in Friday's PersonalVault.
   */
  public async sendBackgroundMessage(text: string, customPhone?: string): Promise<WhatsAppSendResult> {
    const memory = memoryEngine.getMemories();
    
    // Find phone from env or personal vault
    let phone = customPhone || process.env.WHATSAPP_PHONE || "";
    let apiKey = process.env.CALLMEBOT_API_KEY || "";

    // If not in env, look in personal vault for stored WhatsApp credentials
    if (!phone || !apiKey) {
      for (const item of memory.personalVault) {
        if (item.category === "whatsapp_phone" || item.exactFact.includes("whatsapp number:")) {
          const match = item.exactFact.match(/(\+?\d{10,15})/);
          if (match && !phone) phone = match[1];
        }
        if (item.category === "whatsapp_apikey" || item.exactFact.includes("whatsapp apikey:")) {
          const match = item.exactFact.split(":")[1]?.trim();
          if (match && !apiKey) apiKey = match;
        }
      }
    }

    // Standardize phone format (remove spaces, dashes)
    phone = phone.replace(/[\s\-\(\)]/g, "");
    if (phone.startsWith("+")) phone = phone.substring(1);

    if (!phone || !apiKey) {
      return {
        success: false,
        message: `WhatsApp credentials missing. Please set WHATSAPP_PHONE & CALLMEBOT_API_KEY in .env, or tell Friday: "Mera WhatsApp number 91XXXXXXXXXX hai aur API key 123456 hai".`,
        phone,
      };
    }

    return new Promise((resolve) => {
      const encodedText = encodeURIComponent(text);
      const url = `https://api.callmebot.com/whatsapp.php?phone=${phone}&text=${encodedText}&apikey=${apiKey}`;

      https.get(url, (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });

        res.on("end", () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[WhatsAppService] Background WhatsApp sent successfully to ${phone}`);
            resolve({
              success: true,
              message: `Message sent successfully in the background to +${phone}`,
              phone,
            });
          } else {
            console.warn(`[WhatsAppService] CallMeBot returned status ${res.statusCode}: ${data}`);
            // CallMeBot sometimes returns text responses like "Message queued" or "OK"
            if (data.toLowerCase().includes("ok") || data.toLowerCase().includes("queued") || data.toLowerCase().includes("success")) {
              resolve({
                success: true,
                message: `Message dispatched successfully to +${phone}`,
                phone,
              });
            } else {
              resolve({
                success: false,
                message: `Failed to send WhatsApp message: ${data || "Unknown gateway error"}`,
                phone,
              });
            }
          }
        });
      }).on("error", (err) => {
        console.error("[WhatsAppService] HTTP Error:", err);
        resolve({
          success: false,
          message: `Network error sending WhatsApp message: ${err.message}`,
          phone,
        });
      });
    });
  }
}

export const whatsappService = new WhatsAppService();
