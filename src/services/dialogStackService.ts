/**
 * Dialog Interruption & Topic Resumption Stack Service for Friday AI
 * 
 * Manages an active conversation stack per user/chat.
 * When the user abruptly pivots ("arre ruko ek second...", "chodo ye batao..."),
 * the previous topic is pushed onto the stack. When the user later says
 * "hum kya baat kar rahe the?" or "wapas us baat par aate hain", Friday recovers
 * the interrupted thread seamlessly like a human companion with zero amnesia.
 */

export interface DialogThread {
  topic: string;
  summary: string;
  lastMessageSnippet: string;
  timestamp: number;
}

export class DialogStackService {
  private static instance: DialogStackService;
  private stacks: Map<string, DialogThread[]> = new Map();

  private constructor() {}

  public static getInstance(): DialogStackService {
    if (!DialogStackService.instance) {
      DialogStackService.instance = new DialogStackService();
    }
    return DialogStackService.instance;
  }

  /**
   * Pushes an interrupted or paused conversation topic onto the stack.
   */
  public pushTopic(
    userId: string,
    topic: string,
    summary: string,
    lastMessageSnippet: string
  ): void {
    const key = userId || "default_user";
    if (!this.stacks.has(key)) {
      this.stacks.set(key, []);
    }
    const stack = this.stacks.get(key)!;
    stack.push({
      topic,
      summary,
      lastMessageSnippet,
      timestamp: Date.now(),
    });

    // Keep stack size reasonable (max 5 nested topics)
    if (stack.length > 5) {
      stack.shift();
    }
  }

  /**
   * Pops the most recent interrupted topic when returning to it.
   */
  public popTopic(userId: string): DialogThread | null {
    const key = userId || "default_user";
    const stack = this.stacks.get(key);
    if (!stack || stack.length === 0) return null;
    return stack.pop() || null;
  }

  /**
   * Peeks at the active suspended topic without popping.
   */
  public peekTopic(userId: string): DialogThread | null {
    const key = userId || "default_user";
    const stack = this.stacks.get(key);
    if (!stack || stack.length === 0) return null;
    return stack[stack.length - 1] || null;
  }

  /**
   * Detects if the user is asking to resume a previous interrupted topic.
   */
  public isResumptionQuery(query: string): boolean {
    const q = (query || "").toLowerCase();
    return (
      q.includes("kya baat kar rahe the") ||
      q.includes("kya bol rahe the") ||
      q.includes("hum kahan the") ||
      q.includes("wo pehle wali baat") ||
      q.includes("wapas us baat pe") ||
      q.includes("coming back to") ||
      q.includes("what were we talking about") ||
      q.includes("where were we") ||
      q.includes("wo purani baat")
    );
  }

  /**
   * Generates a context injection prompt for interrupted dialogs.
   */
  public compileDialogStackPrompt(userId: string): string {
    const thread = this.peekTopic(userId);
    if (!thread) return "";

    return `🔄 INTERRUPTED DIALOG STACK (Topic Recovery Context):
- Suspended Topic: "${thread.topic}"
- Context: ${thread.summary}
- Last discussion before interruption: "${thread.lastMessageSnippet}"
*Note: If Boss asks "hum kya baat kar rahe the?" or pivots back, effortlessly resume from this exact point.*`;
  }
}

export const dialogStackService = DialogStackService.getInstance();
