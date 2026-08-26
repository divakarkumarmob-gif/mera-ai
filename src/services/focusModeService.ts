export interface FocusSessionState {
  isActive: boolean;
  durationMinutes: number;
  remainingMinutes: number;
  goalTitle: string;
  startedAt: string;
  endsAt: string;
  endTimestamp: number;
  lofiStreamUrl: string;
  message: string;
}

class FocusModeService {
  private currentSession: (Omit<FocusSessionState, "remainingMinutes"> & { endTimestamp: number }) | null = null;

  public async startFocusMode(
    durationMinutes = 25,
    goalTitle = "Deep Work & Coding"
  ): Promise<FocusSessionState> {
    const now = Date.now();
    const end = now + durationMinutes * 60 * 1000;

    const startedAt = new Date(now).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const endsAt = new Date(end).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

    // Lo-Fi high quality chill stream URL
    const lofiStream = "https://streams.ilovemusic.de/iloveradio17.mp3";

    this.currentSession = {
      isActive: true,
      durationMinutes,
      goalTitle,
      startedAt,
      endsAt,
      endTimestamp: end,
      lofiStreamUrl: lofiStream,
      message: `Boss, ${durationMinutes} minute ka Focus Mode activate ho gaya hai! (Goal: "${goalTitle}", Ends at: ${endsAt}). Lo-Fi background beats ready hain. All notifications silenced for maximum productivity!`,
    };

    // Schedule completion reminder (dynamic import to prevent circular dependency)
    try {
      const { toolsEngine } = await import("./toolsEngine");
      await toolsEngine.addReminder(
        `Focus Session Complete: "${goalTitle}" (${durationMinutes} mins done!)`,
        endsAt,
        durationMinutes
      );
    } catch {}

    return {
      ...this.currentSession,
      remainingMinutes: durationMinutes,
    };
  }

  public getFocusModeStatus(): { isActive: boolean; session: FocusSessionState | null; message: string } {
    if (!this.currentSession || !this.currentSession.isActive) {
      return {
        isActive: false,
        session: null,
        message: "Boss, filhal koi Focus Mode active nahi hai. Aap normal mode me hain.",
      };
    }

    const now = Date.now();
    const remainingMs = this.currentSession.endTimestamp - now;

    if (remainingMs <= 0) {
      this.currentSession = null;
      return {
        isActive: false,
        session: null,
        message: "Boss, pichhla Focus Mode session complete ho chuka hai.",
      };
    }

    const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    const sessionState: FocusSessionState = {
      ...this.currentSession,
      remainingMinutes,
    };

    return {
      isActive: true,
      session: sessionState,
      message: `Boss, Focus Mode ACTIVE hai! Goal: "${this.currentSession.goalTitle}". Lagbhag ${remainingMinutes} minutes bache hain (Ends at: ${this.currentSession.endsAt}).`,
    };
  }

  public stopFocusMode(): { success: boolean; message: string } {
    this.currentSession = null;
    return {
      success: true,
      message: "Boss, Focus Mode deactivate kar diya gaya hai. Welcome back to normal mode!",
    };
  }
}

export const focusModeService = new FocusModeService();
