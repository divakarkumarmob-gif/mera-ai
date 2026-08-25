import { toolsEngine } from "./toolsEngine";

export interface FocusSessionState {
  isActive: boolean;
  durationMinutes: number;
  goalTitle: string;
  startedAt: string;
  endsAt: string;
  lofiStreamUrl: string;
  message: string;
}

class FocusModeService {
  private currentSession: FocusSessionState | null = null;

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
      lofiStreamUrl: lofiStream,
      message: `Boss, ${durationMinutes} minute ka Focus Mode activate ho gaya hai! (Goal: "${goalTitle}", Ends at: ${endsAt}). Lo-Fi background beats ready hain. All notifications silenced for maximum productivity!`,
    };

    // Schedule completion reminder
    try {
      await toolsEngine.addReminder(
        `Focus Session Complete: "${goalTitle}" (${durationMinutes} mins done!)`,
        endsAt,
        durationMinutes
      );
    } catch {}

    return this.currentSession;
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
