export interface QuotedMessageContext {
  isReply: boolean;
  sender: string;
  senderPhone?: string;
  text: string;
  mediaType: "text" | "photo" | "video" | "document" | "audio" | "location" | "contact" | "sticker";
  stanzaId?: string;
  rawQuotedMessage?: any;
  fileName?: string;
}

export interface IncomingMessage {
  id: string;
  senderPhone: string;
  senderName: string;           // From contacts book (preferred) or WhatsApp displayName
  senderDisplayName: string;    // Raw WhatsApp profile name
  replyJid: string;             // Correct JID to use when replying (handles @lid senders)
  groupId: string | null;       // @g.us JID if group, else null
  groupName: string | null;     // Human-readable group subject
  isGroup: boolean;
  isUnknownContact: boolean;    // true = not saved in DK's contacts book
  text: string;
  timestamp: number;            // ms epoch
  dateStr: string;              // Formatted IST date string
  isRead: boolean;
  quotedMessage?: QuotedMessageContext | null;
  botReply?: string;
  consumedByDailyUpdate?: boolean;
}

export interface GirlfriendSession {
  expiresAt: number;
  durationMinutes: number;
  timer: NodeJS.Timeout;
  tempHistory: Array<{ role: "user" | "model"; text: string }>;
  lastUserMsgTime?: number;
  idleNudgeTimer?: NodeJS.Timeout | null;
  idleNudgeCount?: number;
  mood?: "romantic" | "sassy" | "caring" | "naughty" | "cute" | "mix";
  coupleMemory?: Record<string, string>;
  isAngry?: boolean;
  healthTracker?: { issue: string; timestamp: number } | null;
  sessionCount?: number;
  isClingy?: boolean;
}

export interface ChatPhotoRecord {
  buffer: Buffer;
  mimeType: string;
  timestamp: number;
}

export interface PendingLinkChoice {
  url: string;
  platform: string;
  ytVideoId?: string | null;
  timestamp: number;
}

export interface WhatsAppStatus {
  isConnected: boolean;
  dedicatedPhone: string | null;
  pairingCode: string | null;
  qrCodeDataUrl: string | null;
  autoReplyEnabled: boolean;
  baileysEnabled: boolean;
}
