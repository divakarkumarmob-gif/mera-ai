import { contactsService } from "./contactsService";

export interface SmsSendResult {
  success: boolean;
  recipient: string;
  recipientName?: string;
  messageId?: string;
  deliveryStatus: "sent" | "failed" | "demo_preview";
  message: string;
}

class Fast2SmsService {
  /**
   * Sends a real SMS to any Indian mobile number or saved contact by name using Fast2SMS Gateway
   */
  public async sendSms(
    phoneNumberOrContactName: string,
    messageText: string,
    customApiKey?: string
  ): Promise<SmsSendResult> {
    const rawInput = (phoneNumberOrContactName || "").trim();
    let recipientName: string | undefined;
    let targetNumber = "";

    // 1. Check if input is a name in Friday's saved contacts book
    try {
      const found = await contactsService.findContact(rawInput);
      if (found && found.phone) {
        recipientName = found.name;
        targetNumber = found.phone.replace(/\D/g, "").slice(-10);
      }
    } catch {}

    // 2. If not found in contacts, extract digits from input
    if (!targetNumber) {
      const rawDigits = rawInput.replace(/\D/g, "");
      targetNumber = rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
    }

    const text = (messageText || "").trim();
    if (!targetNumber || targetNumber.length !== 10) {
      throw new Error(`Boss, "${rawInput}" ka koi valid 10-digit mobile number nahi mila.`);
    }
    if (!text) {
      throw new Error("SMS message body text zaroori hai.");
    }

    const apiKey = customApiKey || process.env.FAST2SMS_API_KEY || process.env.FAST_2_SMS_KEY;

    if (!apiKey) {
      return {
        success: false,
        recipient: targetNumber,
        deliveryStatus: "failed",
        message: `Boss, Fast2SMS API Key configure nahi hai. Kripya .env file me FAST2SMS_API_KEY daalein.`,
      };
    }

    try {
      const payload = {
        route: "q",
        message: text,
        language: "english",
        flash: 0,
        numbers: targetNumber,
      };

      const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data && (data.return === true || data.status_code === 200 || data.message?.[0]?.includes("success"))) {
        const requestId = data.request_id || "F2S_" + Math.random().toString(36).substring(2, 8);
        return {
          success: true,
          recipient: targetNumber,
          recipientName,
          messageId: requestId,
          deliveryStatus: "sent",
          message: recipientName
            ? `Boss, Fast2SMS ke through ${recipientName} (${targetNumber}) par SMS successfully send ho gaya hai! (ID: ${requestId})`
            : `Boss, Fast2SMS ke through mobile number ${targetNumber} par SMS successfully send ho gaya hai! (ID: ${requestId})`,
        };
      } else {
        const errDesc = Array.isArray(data?.message) ? data.message.join(", ") : data?.message || "Fast2SMS error";
        return {
          success: false,
          recipient: targetNumber,
          deliveryStatus: "failed",
          message: `Fast2SMS se message bhejte waqt error aaya: ${errDesc}`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        recipient: targetNumber,
        deliveryStatus: "failed",
        message: `Fast2SMS network error: ${err?.message || err}`,
      };
    }
  }
}

export const fast2SmsService = new Fast2SmsService();
