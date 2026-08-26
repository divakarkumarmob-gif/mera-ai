/**
 * Screen Wake Lock & Background Audio Task Manager
 * Keeps device display and background audio threads permanently ON.
 * Powered by @capacitor-community/keep-awake, @capawesome/capacitor-background-task,
 * Native Screen Wake Lock API, and hidden micro-video loop fallback.
 */

import { KeepAwake } from '@capacitor-community/keep-awake';
import { BackgroundTask } from '@capawesome/capacitor-background-task';

class ScreenWakeLockManager {
  private wakeLock: any = null;
  private isRequested: boolean = false;
  private fallbackVideo: HTMLVideoElement | null = null;
  private backgroundTaskId: string | null = null;
  private keepAliveInterval: any = null;

  constructor() {
    if (typeof window !== "undefined") {
      // Re-acquire lock when tab becomes visible again
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && this.isRequested) {
          this.requestLock();
        }
      });

      // User interaction listener to acquire lock immediately on first touch/click
      const triggerLock = () => {
        if (this.isRequested && !this.wakeLock) {
          this.requestLock();
        }
      };
      window.addEventListener("click", triggerLock, { passive: true });
      window.addEventListener("touchstart", triggerLock, { passive: true });
    }
  }

  /**
   * Request and acquire continuous screen wake lock and background CPU task.
   */
  public async requestLock(): Promise<boolean> {
    this.isRequested = true;
    if (typeof window === "undefined") return false;

    // 1. Try Capacitor Native KeepAwake & BackgroundTask (For Mobile APK)
    try {
      if (KeepAwake?.keepAwake) {
        await KeepAwake.keepAwake();
        console.log("[ScreenWakeLock] 💡 Capacitor Native KeepAwake activated! Screen will NOT sleep.");
      }
      if (BackgroundTask?.beforeExit) {
        BackgroundTask.beforeExit(async () => {
          try {
            this.backgroundTaskId = typeof (BackgroundTask as any).start === "function" ? await (BackgroundTask as any).start() : null;
            if (!this.keepAliveInterval) {
              this.keepAliveInterval = setInterval(() => {
                // Keep-alive ping for background audio engine
              }, 5000);
            }
            console.log("[ScreenWakeLock] 🚀 Capacitor BackgroundTask started! ID:", this.backgroundTaskId);
          } catch (e) {
            console.warn("[ScreenWakeLock] BackgroundTask start error:", e);
          }
        });
      }
    } catch {
      // Running in standard web browser
    }

    // 2. Try Web Standard Screen Wake Lock API
    if ("wakeLock" in navigator && (navigator as any).wakeLock?.request) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => {
          this.wakeLock = null;
          if (this.isRequested && document.visibilityState === "visible") {
            setTimeout(() => this.requestLock(), 1000);
          }
        });
        console.log("[ScreenWakeLock] 💡 Web Native Screen Wake Lock active.");
        return true;
      } catch (err) {
        console.warn("[ScreenWakeLock] Native wakeLock request failed, trying fallback:", err);
      }
    }

    // 3. Fallback: Hidden silent micro-video loop for browsers / WebViews
    return this.startFallbackVideoWakeLock();
  }

  /**
   * Release wake lock and finish background task when music stops.
   */
  public async releaseLock(): Promise<void> {
    this.isRequested = false;

    // 1. Release Capacitor Native KeepAwake & BackgroundTask
    try {
      if (KeepAwake?.allowSleep) {
        await KeepAwake.allowSleep();
      }
      if (this.backgroundTaskId && BackgroundTask?.finish) {
        await BackgroundTask.finish({ taskId: this.backgroundTaskId });
        this.backgroundTaskId = null;
      }
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = null;
      }
    } catch {}

    // 2. Release Web Wake Lock
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch {}
      this.wakeLock = null;
    }

    // 3. Pause fallback video
    if (this.fallbackVideo) {
      try {
        this.fallbackVideo.pause();
        this.fallbackVideo.src = "";
        this.fallbackVideo.remove();
      } catch {}
      this.fallbackVideo = null;
    }

    console.log("[ScreenWakeLock] 💤 Screen Wake Lock released.");
  }

  public isLocked(): boolean {
    return !!this.wakeLock || !!this.fallbackVideo || !!this.backgroundTaskId;
  }

  private startFallbackVideoWakeLock(): boolean {
    try {
      if (!this.fallbackVideo) {
        const video = document.createElement("video");
        video.setAttribute("playsinline", "");
        video.setAttribute("muted", "");
        video.muted = true;
        video.loop = true;
        video.style.position = "fixed";
        video.style.left = "-9999px";
        video.style.top = "-9999px";
        video.style.width = "1px";
        video.style.height = "1px";
        video.style.opacity = "0.01";
        video.style.pointerEvents = "none";
        // Tiny base64 MP4 loop
        video.src = "data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAADpmcmVlAAAABW1kYXQAAAAAMW1vb3YAAABsbXZoZAAAAAB3bXpld216ZXAAAA+gAAAAAAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==";
        document.body.appendChild(video);
        this.fallbackVideo = video;
      }
      this.fallbackVideo.play().catch(() => {});
      console.log("[ScreenWakeLock] 💡 Fallback Video Wake Lock active.");
      return true;
    } catch {
      return false;
    }
  }
}

export const screenWakeLock = new ScreenWakeLockManager();
