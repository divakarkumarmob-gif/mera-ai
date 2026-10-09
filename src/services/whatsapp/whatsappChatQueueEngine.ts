import { QuotedMessageContext } from "./whatsappTypes";

export interface QueuedMessageItem {
  text: string;
  messageKey: any;
  quotedMessage?: QuotedMessageContext | null;
  senderName: string;
  senderPhone: string;
  isFromOwner: boolean;
  isGroup: boolean;
  timestamp: number;
}

export interface QueuedBatch {
  combinedText: string;
  latestMessageKey: any;
  quotedMessage?: QuotedMessageContext | null;
  senderName: string;
  senderPhone: string;
  isFromOwner: boolean;
  isGroup: boolean;
  messageCount: number;
  originalMessages: QueuedMessageItem[];
}

export type QueueProcessCallback = (batch: QueuedBatch) => Promise<void>;

interface ChatQueueState {
  chatJid: string;
  buffered: QueuedMessageItem[];
  debounceTimer: NodeJS.Timeout | null;
  isProcessing: boolean;
  pendingWhileProcessing: QueuedMessageItem[];
  lastActive: number;
  processCallback: QueueProcessCallback | null;
}

export class WhatsAppChatQueueEngine {
  private chatQueues: Map<string, ChatQueueState> = new Map();
  private gcInterval: NodeJS.Timeout | null = null;

  public static readonly DEFAULT_DEBOUNCE_MS = 3000; // 3 seconds window to collect rapid messages
  public static readonly FAST_DEBOUNCE_MS = 400;     // For urgent single-word commands
  public static readonly POST_PROCESSING_DRAIN_MS = 1200; // Delay before draining pending follow-ups

  constructor() {
    // Periodic garbage collector: cleanup idle queues every 5 minutes
    this.gcInterval = setInterval(() => {
      this.cleanupStaleQueues();
    }, 5 * 60 * 1000);
  }

  /**
   * Identifies urgent commands that shouldn't wait full 3 seconds
   */
  private isUrgentCommand(text: string): boolean {
    const clean = text.trim().toLowerCase();
    return (
      /^(?:@call|\/call|call|call\s*me|approve|reject|@stop|stop|stop\s*gf|exit\s*gf|@normal|\/normal|unpause|\/unpause)$/i.test(clean) ||
      clean === "call" ||
      clean === "approve" ||
      clean === "reject"
    );
  }

  /**
   * Enqueue an incoming message into the per-chat isolated queue.
   */
  public enqueue(
    chatJid: string,
    item: QueuedMessageItem,
    onProcess: QueueProcessCallback,
    customDebounceMs?: number
  ): void {
    if (!chatJid || !item.text) return;

    let state = this.chatQueues.get(chatJid);
    if (!state) {
      state = {
        chatJid,
        buffered: [],
        debounceTimer: null,
        isProcessing: false,
        pendingWhileProcessing: [],
        lastActive: Date.now(),
        processCallback: onProcess,
      };
      this.chatQueues.set(chatJid, state);
    }

    state.lastActive = Date.now();
    state.processCallback = onProcess;

    // Case 1: AI is currently generating a response for this specific chat
    if (state.isProcessing) {
      state.pendingWhileProcessing.push(item);
      console.log(
        `[WhatsAppChatQueue] ⏳ Chat ${chatJid} is currently busy with AI turn. Message queued in in-flight pending buffer (pending count: ${state.pendingWhileProcessing.length}): "${item.text.slice(0, 40)}..."`
      );
      return;
    }

    // Case 2: Chat is idle, accumulate in debounce buffer
    state.buffered.push(item);

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    const isUrgent = this.isUrgentCommand(item.text);
    const debounceTime = customDebounceMs !== undefined
      ? customDebounceMs
      : isUrgent
      ? WhatsAppChatQueueEngine.FAST_DEBOUNCE_MS
      : WhatsAppChatQueueEngine.DEFAULT_DEBOUNCE_MS;

    console.log(
      `[WhatsAppChatQueue] 📥 Buffered message from ${item.senderName} (${chatJid}) [Batch size: ${state.buffered.length}]. Waiting ${debounceTime}ms debounce...`
    );

    state.debounceTimer = setTimeout(() => {
      this.dispatchBatch(chatJid).catch((err) => {
        console.error(`[WhatsAppChatQueue] Error dispatching batch for ${chatJid}:`, err);
      });
    }, debounceTime);
  }

  /**
   * Dispatches the accumulated messages as a single merged batch
   */
  private async dispatchBatch(chatJid: string): Promise<void> {
    const state = this.chatQueues.get(chatJid);
    if (!state) return;

    if (state.debounceTimer) {
      clearTimeout(state.debounceTimer);
      state.debounceTimer = null;
    }

    const items = [...state.buffered];
    state.buffered = [];

    if (items.length === 0) return;

    state.isProcessing = true;
    state.lastActive = Date.now();

    // 1. Combine texts with clear newlines
    const textPieces = items.map((i) => i.text.trim()).filter(Boolean);
    const combinedText = textPieces.join("\n");

    // 2. Select latest message key and best quoted context
    const latestItem = items[items.length - 1];
    const latestKey = latestItem.messageKey;
    const bestQuoted = items.slice().reverse().find((i) => i.quotedMessage)?.quotedMessage || latestItem.quotedMessage;

    const batch: QueuedBatch = {
      combinedText,
      latestMessageKey: latestKey,
      quotedMessage: bestQuoted,
      senderName: latestItem.senderName,
      senderPhone: latestItem.senderPhone,
      isFromOwner: latestItem.isFromOwner,
      isGroup: latestItem.isGroup,
      messageCount: items.length,
      originalMessages: items,
    };

    console.log(
      `[WhatsAppChatQueue] 🚀 Firing aggregated batch for ${chatJid} (${items.length} messages merged):\n"${combinedText.replace(/\n/g, " ↵ ")}"`
    );

    try {
      if (state.processCallback) {
        await state.processCallback(batch);
      }
    } catch (procErr) {
      console.error(`[WhatsAppChatQueue] Batch execution failed for ${chatJid}:`, procErr);
    } finally {
      state.isProcessing = false;
      state.lastActive = Date.now();

      // Drain any messages received WHILE the AI was executing
      if (state.pendingWhileProcessing.length > 0) {
        state.buffered = [...state.pendingWhileProcessing];
        state.pendingWhileProcessing = [];

        console.log(
          `[WhatsAppChatQueue] 🔄 Draining ${state.buffered.length} in-flight follow-up messages for ${chatJid}...`
        );

        // Small pause to allow user to finish typing immediate follow-up
        state.debounceTimer = setTimeout(() => {
          this.dispatchBatch(chatJid).catch((err) => {
            console.error(`[WhatsAppChatQueue] Error draining post-processing batch for ${chatJid}:`, err);
          });
        }, WhatsAppChatQueueEngine.POST_PROCESSING_DRAIN_MS);
      }
    }
  }

  /**
   * Checks if a chat currently has active or pending items
   */
  public hasActiveQueue(chatJid: string): boolean {
    const s = this.chatQueues.get(chatJid);
    if (!s) return false;
    return s.isProcessing || s.buffered.length > 0 || s.pendingWhileProcessing.length > 0;
  }

  /**
   * Cleans up idle queues older than 15 minutes
   */
  private cleanupStaleQueues(): void {
    const now = Date.now();
    const staleThreshold = 15 * 60 * 1000;

    for (const [jid, state] of this.chatQueues.entries()) {
      if (
        !state.isProcessing &&
        state.buffered.length === 0 &&
        state.pendingWhileProcessing.length === 0 &&
        now - state.lastActive > staleThreshold
      ) {
        if (state.debounceTimer) clearTimeout(state.debounceTimer);
        this.chatQueues.delete(jid);
      }
    }
  }

  public destroy(): void {
    if (this.gcInterval) {
      clearInterval(this.gcInterval);
      this.gcInterval = null;
    }
    for (const state of this.chatQueues.values()) {
      if (state.debounceTimer) clearTimeout(state.debounceTimer);
    }
    this.chatQueues.clear();
  }
}

export const whatsappChatQueueEngine = new WhatsAppChatQueueEngine();
