/**
 * Screen Wake Lock Manager — Keeps device display permanently ON (no sleep / no auto-dimming).
 * Works across desktop, mobile Chrome, Safari, Edge, Firefox, and PWA WebViews.
 */

class ScreenWakeLockManager {
  private wakeLock: any = null;
  private isRequested: boolean = false;
  private fallbackVideo: HTMLVideoElement | null = null;

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
   * Request and acquire continuous screen wake lock.
   */
  public async requestLock(): Promise<boolean> {
    this.isRequested = true;
    if (typeof window === "undefined") return false;

    // 1. Try Native Screen Wake Lock API
    if ("wakeLock" in navigator && (navigator as any).wakeLock?.request) {
      try {
        this.wakeLock = await (navigator as any).wakeLock.request("screen");
        this.wakeLock.addEventListener("release", () => {
          this.wakeLock = null;
          // Re-acquire if still requested and page is visible
          if (this.isRequested && document.visibilityState === "visible") {
            setTimeout(() => this.requestLock(), 1000);
          }
        });
        console.log("[ScreenWakeLock] 💡 Native Screen Wake Lock active. Screen will NOT sleep.");
        return true;
      } catch (err) {
        console.warn("[ScreenWakeLock] Native wakeLock request failed, trying fallback:", err);
      }
    }

    // 2. Fallback: Hidden silent micro-video loop for browsers without native wakeLock (iOS Safari / WebViews)
    return this.startFallbackVideoWakeLock();
  }

  /**
   * Release wake lock if needed.
   */
  public releaseLock(): void {
    this.isRequested = false;
    if (this.wakeLock) {
      try {
        this.wakeLock.release();
      } catch {}
      this.wakeLock = null;
    }
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
    return !!this.wakeLock || !!this.fallbackVideo;
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
