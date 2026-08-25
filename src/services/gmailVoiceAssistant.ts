import nodemailer from "nodemailer";
import { google } from "googleapis";

export interface EmailSummaryResult {
  success: boolean;
  totalUnread: number;
  priorityEmails: Array<{ from: string; subject: string; timeStr: string; snippet: string }>;
  message: string;
}

export interface SendEmailResult {
  success: boolean;
  toEmail: string;
  subject: string;
  deliveryMethod: "smtp" | "gmail_api" | "not_sent";
  mailtoUrl?: string;
  message: string;
}

/**
 * Real Gmail integration via the Gmail API (OAuth2).
 *
 * Setup required for inbox reading (SMTP alone cannot read a Gmail inbox —
 * only the Gmail API can):
 * 1. Create a Google Cloud project, enable the "Gmail API".
 * 2. Create OAuth2 credentials (Desktop app type is easiest), get a Client ID
 *    and Client Secret.
 * 3. Run the OAuth consent flow once to get a Refresh Token
 *    (scope: https://www.googleapis.com/auth/gmail.readonly and
 *    https://www.googleapis.com/auth/gmail.send if you also want sending
 *    via Gmail instead of SMTP).
 * 4. Set in .env:
 *      GOOGLE_CLIENT_ID=...
 *      GOOGLE_CLIENT_SECRET=...
 *      GOOGLE_REFRESH_TOKEN=...
 *
 * Until these are set, summarizeInbox() honestly reports that it cannot
 * read the inbox, instead of returning fixed sample emails.
 */
class GmailVoiceAssistant {
  private getOAuthClient() {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) return null;

    const client = new google.auth.OAuth2(clientId, clientSecret);
    client.setCredentials({ refresh_token: refreshToken });
    return client;
  }

  private getTransporter() {
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const port = Number(process.env.SMTP_PORT) || 587;

    if (host && user && pass) {
      return nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    }
    return null;
  }

  public async summarizeInbox(): Promise<EmailSummaryResult> {
    const auth = this.getOAuthClient();
    if (!auth) {
      console.error("[GmailAssistant] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN not configured.");
      return {
        success: false,
        totalUnread: 0,
        priorityEmails: [],
        message:
          "Boss, Gmail inbox padhne ke liye Gmail API OAuth setup abhi complete nahi hai. Kripya GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, aur GOOGLE_REFRESH_TOKEN .env me set karein.",
      };
    }

    try {
      const gmail = google.gmail({ version: "v1", auth });
      const listRes = await gmail.users.messages.list({
        userId: "me",
        q: "is:unread in:inbox",
        maxResults: 5,
      });

      const messageRefs = listRes.data.messages || [];
      const totalUnread = listRes.data.resultSizeEstimate || messageRefs.length;

      const priorityEmails: EmailSummaryResult["priorityEmails"] = [];
      for (const ref of messageRefs.slice(0, 5)) {
        if (!ref.id) continue;
        const msgRes = await gmail.users.messages.get({
          userId: "me",
          id: ref.id,
          format: "metadata",
          metadataHeaders: ["From", "Subject", "Date"],
        });
        const headers = msgRes.data.payload?.headers || [];
        const from = headers.find((h) => h.name === "From")?.value || "Unknown Sender";
        const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
        const dateHeader = headers.find((h) => h.name === "Date")?.value;
        const timeStr = dateHeader
          ? new Date(dateHeader).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
          : "Unknown time";
        const snippet = msgRes.data.snippet || "";

        priorityEmails.push({ from, subject, timeStr, snippet });
      }

      const message =
        priorityEmails.length === 0
          ? "Boss, aapke inbox me koi unread email nahi hai. Sab clear hai!"
          : `Boss, aapke inbox me ${totalUnread} unread emails hain. Top ${priorityEmails.length}: ${priorityEmails
              .map((e) => `"${e.subject}" (${e.from})`)
              .join(", ")}.`;

      return { success: true, totalUnread, priorityEmails, message };
    } catch (e: any) {
      console.error("[GmailAssistant] summarizeInbox failed:", e);
      return {
        success: false,
        totalUnread: 0,
        priorityEmails: [],
        message: `Boss, inbox summarize karte waqt error aaya: ${e?.message || "unknown error"}.`,
      };
    }
  }

  /**
   * Sends a real email via SMTP (preferred if configured) or the Gmail API.
   * Never reports success unless the message was actually handed off to a
   * real mail provider — previously this silently fell back to generating a
   * "mailto:" link (which does nothing from a backend server) and still
   * claimed success.
   */
  public async sendQuickEmail(
    toEmail: string,
    subject: string,
    bodyText: string
  ): Promise<SendEmailResult> {
    const to = (toEmail || "").trim();
    const sub = (subject || "Message from Friday AI").trim();
    const body = (bodyText || "").trim();

    if (!to) {
      throw new Error("Recipient email address zaroori hai.");
    }

    // 1. Try SMTP first
    const transporter = this.getTransporter();
    if (transporter) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_USER,
          to,
          subject: sub,
          text: body,
        });
        return {
          success: true,
          toEmail: to,
          subject: sub,
          deliveryMethod: "smtp",
          message: `Boss, "${to}" ko email successfully deliver ho gaya hai! (Subject: "${sub}")`,
        };
      } catch (err: any) {
        console.warn("[GmailAssistant] SMTP send failed, trying Gmail API next:", err);
      }
    }

    // 2. Try Gmail API
    const auth = this.getOAuthClient();
    if (auth) {
      try {
        const gmail = google.gmail({ version: "v1", auth });
        const rawMessage = [
          `To: ${to}`,
          `Subject: ${sub}`,
          "Content-Type: text/plain; charset=utf-8",
          "",
          body,
        ].join("\n");
        const encoded = Buffer.from(rawMessage)
          .toString("base64")
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");

        await gmail.users.messages.send({
          userId: "me",
          requestBody: { raw: encoded },
        });

        return {
          success: true,
          toEmail: to,
          subject: sub,
          deliveryMethod: "gmail_api",
          message: `Boss, "${to}" ko Gmail API ke through email successfully bhej diya gaya hai! (Subject: "${sub}")`,
        };
      } catch (err: any) {
        console.error("[GmailAssistant] Gmail API send failed:", err);
      }
    }

    // 3. Neither is configured/working — be honest, do NOT claim success
    return {
      success: false,
      toEmail: to,
      subject: sub,
      deliveryMethod: "not_sent",
      mailtoUrl: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(sub)}&body=${encodeURIComponent(body)}`,
      message: `Boss, email actually send nahi ho paya kyunki na SMTP configure hai na Gmail API. Kripya .env me SMTP_HOST/SMTP_USER/SMTP_PASS ya GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REFRESH_TOKEN set karein. Ek mailto link diya gaya hai jo aap manually apne mail client me khol sakte hain.`,
    };
  }
}

export const gmailVoiceAssistant = new GmailVoiceAssistant();
