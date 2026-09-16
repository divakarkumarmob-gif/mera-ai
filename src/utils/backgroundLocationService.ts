/**
 * FRIDAY AI — Background Location Service (Client-Side)
 * Runs on family member's device (FRIDAY APK / Browser) and sends GPS pings
 * to the server every 60 seconds, even when the app is in the background.
 *
 * Uses:
 * 1. Capacitor @capacitor/geolocation for native APK GPS (background-capable)
 * 2. navigator.geolocation.watchPosition for web browser fallback
 * 3. @capawesome/capacitor-background-task to keep running when app is backgrounded
 */

import { getApiUrl } from './api';
import { getAppToken, getStoredUser } from './appSecurityClient';

// ── Configuration ────────────────────────────────────────────────────────────

const PING_INTERVAL_MS = 60 * 1000; // 60 seconds between GPS pings
const STORAGE_KEY_DEVICE_ID = 'friday_location_device_id';
const STORAGE_KEY_DEVICE_LABEL = 'friday_location_device_label';
const STORAGE_KEY_TRACKING_ENABLED = 'friday_location_tracking_enabled';

// ── Interfaces ───────────────────────────────────────────────────────────────

interface GpsPingPayload {
  deviceId: string;
  username?: string;
  label?: string;
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  batteryLevel: number | null;
  isCharging: boolean | null;
  networkType: string | null;
}

// ── Service Class ────────────────────────────────────────────────────────────

class BackgroundLocationService {
  private isRunning = false;
  private watchId: number | null = null;
  private pingInterval: any = null;
  private lastPosition: GeolocationPosition | null = null;
  private deviceId: string = '';
  private deviceLabel: string = '';
  private isNativeApp = false;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 10;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isNativeApp = typeof (window as any).Capacitor !== 'undefined' &&
        (window as any).Capacitor.isNativePlatform?.();
    }
  }

  /**
   * Generate or retrieve a persistent unique device ID
   */
  private getOrCreateDeviceId(): string {
    if (this.deviceId) return this.deviceId;

    try {
      const stored = localStorage.getItem(STORAGE_KEY_DEVICE_ID);
      if (stored) {
        this.deviceId = stored;
        return stored;
      }
    } catch {}

    // Generate new UUID-like ID
    const id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    this.deviceId = id;
    try {
      localStorage.setItem(STORAGE_KEY_DEVICE_ID, id);
    } catch {}
    return id;
  }

  /**
   * Get the device label (e.g., "Bhai", "Papa")
   */
  public getDeviceLabel(): string {
    if (this.deviceLabel) return this.deviceLabel;
    try {
      const stored = localStorage.getItem(STORAGE_KEY_DEVICE_LABEL);
      if (stored) {
        this.deviceLabel = stored;
        return stored;
      }
    } catch {}
    return '';
  }

  /**
   * Set the device label (called when registering or from settings)
   */
  public setDeviceLabel(label: string): void {
    this.deviceLabel = label.trim();
    try {
      localStorage.setItem(STORAGE_KEY_DEVICE_LABEL, this.deviceLabel);
    } catch {}
  }

  /**
   * Check if tracking is enabled
   */
  public isTrackingEnabled(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY_TRACKING_ENABLED) === 'true';
    } catch {
      return false;
    }
  }

  /**
   * Get the device ID (for display purposes)
   */
  public getDeviceId(): string {
    return this.getOrCreateDeviceId();
  }

  /**
   * Check if tracking is currently active
   */
  public isActive(): boolean {
    return this.isRunning;
  }

  /**
   * Register this device with the server and start background location tracking.
   * Call this once when user grants location permission and sets a label.
   */
  public async registerAndStart(label: string, ownerName?: string): Promise<{ success: boolean; message: string }> {
    const deviceId = this.getOrCreateDeviceId();
    this.setDeviceLabel(label);
    const user = getStoredUser();

    try {
      // Register device with the server
      const registerUrl = getApiUrl('/api/location/register');
      const response = await fetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId,
          label: this.deviceLabel,
          ownerName: ownerName || this.deviceLabel,
          username: user?.username,
        }),
      });

      const data = await response.json();
      if (!data.success) {
        return { success: false, message: data.message || 'Registration failed' };
      }

      // Mark tracking as enabled
      try {
        localStorage.setItem(STORAGE_KEY_TRACKING_ENABLED, 'true');
      } catch {}

      // Start background tracking
      this.startTracking();

      return {
        success: true,
        message: `Device "${label}" registered! Live location tracking active. 📍`,
      };
    } catch (err: any) {
      console.error('[BackgroundLocation] Registration error:', err);
      return {
        success: false,
        message: `Registration failed: ${err?.message || 'Network error'}`,
      };
    }
  }

  /**
   * Start background GPS tracking (called on app load if previously enabled)
   */
  public startTracking(): void {
    if (this.isRunning) return;
    if (typeof window === 'undefined') return;

    const deviceId = this.getOrCreateDeviceId();
    if (!deviceId) return;

    console.log('[BackgroundLocation] 🛰️ Starting background GPS tracking...');
    this.isRunning = true;
    this.consecutiveErrors = 0;

    // ── Strategy 1: Capacitor Native Geolocation (APK) ──────────────────
    if (this.isNativeApp) {
      this.startNativeTracking();
    } else {
      // ── Strategy 2: Web Browser Geolocation API ───────────────────────
      this.startWebTracking();
    }

    // ── Periodic Ping Timer ─────────────────────────────────────────────
    this.pingInterval = setInterval(() => {
      this.sendPing();
    }, PING_INTERVAL_MS);

    // Send first ping immediately
    this.sendPing();
  }

  /**
   * Native Capacitor GPS tracking (works in APK background)
   */
  private async startNativeTracking(): Promise<void> {
    try {
      // Use navigator.geolocation which works in both web and Capacitor WebView
      if (!('geolocation' in navigator)) {
        console.warn('[BackgroundLocation] Geolocation not available, falling back to web tracking');
        this.startWebTracking();
        return;
      }

      // Watch position continuously
      this.watchId = navigator.geolocation.watchPosition(
        (position) => {
          this.lastPosition = position;
          this.consecutiveErrors = 0;
        },
        (error) => {
          console.warn('[BackgroundLocation] Native watch error:', error.message);
        },
        { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 }
      );

      // Also register background task to keep GPS alive
      try {
        const { BackgroundTask } = await import('@capawesome/capacitor-background-task');
        BackgroundTask.beforeExit(async () => {
          // Keep sending pings in the background
          this.sendPing();
        });
      } catch {
        // Background task plugin may not be available
      }

      console.log('[BackgroundLocation] ✅ Native Capacitor GPS tracking active');
    } catch (err: any) {
      console.warn('[BackgroundLocation] Native tracking fallback to web:', err?.message);
      this.startWebTracking();
    }
  }

  /**
   * Web browser geolocation tracking (fallback)
   */
  private startWebTracking(): void {
    if (!('geolocation' in navigator)) {
      console.warn('[BackgroundLocation] Geolocation API not available in this browser');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (position) => {
        this.lastPosition = position;
        this.consecutiveErrors = 0;
      },
      (error) => {
        console.warn('[BackgroundLocation] Web GPS error:', error.message);
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= this.MAX_CONSECUTIVE_ERRORS) {
          console.error('[BackgroundLocation] Too many GPS errors, stopping tracking');
          this.stopTracking();
        }
      },
      {
        enableHighAccuracy: true,
        timeout: 30000,
        maximumAge: 30000,
      }
    );

    console.log('[BackgroundLocation] ✅ Web browser GPS tracking active');
  }

  /**
   * Send GPS ping to server with latest coordinates
   */
  private async sendPing(): Promise<void> {
    if (!this.lastPosition) {
      // Try to get a fresh position if we don't have one yet
      try {
        if (this.isNativeApp && 'geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
            });
          });
          this.lastPosition = pos;
        } else if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
            });
          });
          this.lastPosition = pos;
        }
      } catch (err: any) {
        console.warn('[BackgroundLocation] Could not get fresh position for ping:', err?.message);
        return;
      }
    }

    if (!this.lastPosition) return;

    const user = getStoredUser();
    const effectiveLabel = this.getDeviceLabel() || user?.displayName || user?.username || 'FRIDAY Device';

    const payload: GpsPingPayload = {
      deviceId: this.getOrCreateDeviceId(),
      username: user?.username,
      label: effectiveLabel,
      lat: this.lastPosition.coords.latitude,
      lon: this.lastPosition.coords.longitude,
      accuracy: this.lastPosition.coords.accuracy || 0,
      altitude: this.lastPosition.coords.altitude,
      speed: this.lastPosition.coords.speed,
      heading: this.lastPosition.coords.heading,
      batteryLevel: this.getBatteryLevel(),
      isCharging: this.getChargingStatus(),
      networkType: this.getNetworkType(),
    };

    try {
      const pingUrl = getApiUrl('/api/location/ping');
      const response = await fetch(pingUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        this.consecutiveErrors = 0;
      } else {
        console.warn('[BackgroundLocation] Ping failed with status:', response.status);
        this.consecutiveErrors++;
      }
    } catch (err: any) {
      console.warn('[BackgroundLocation] Ping network error:', err?.message);
      this.consecutiveErrors++;
    }
  }

  /**
   * Stop background location tracking
   */
  public stopTracking(): void {
    console.log('[BackgroundLocation] ⏹️ Stopping GPS tracking...');
    this.isRunning = false;

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.watchId !== null) {
      if (this.isNativeApp) {
        // In Capacitor WebView, clearWatch works the same way
        navigator.geolocation.clearWatch(this.watchId);
      } else {
        navigator.geolocation.clearWatch(this.watchId);
      }
      this.watchId = null;
    }

    try {
      localStorage.setItem(STORAGE_KEY_TRACKING_ENABLED, 'false');
    } catch {}
  }

  /**
   * Auto-resume tracking on app load if it was previously enabled
   */
  public autoResumeIfEnabled(): void {
    if (this.isTrackingEnabled() && !this.isRunning) {
      const label = this.getDeviceLabel();
      if (label) {
        console.log(`[BackgroundLocation] Auto-resuming tracking for "${label}"...`);
        this.startTracking();
      }
    }
  }

  // ── Battery & Network Helpers ────────────────────────────────────────────

  private getBatteryLevel(): number | null {
    try {
      const nav = navigator as any;
      if (nav.getBattery) {
        // This is async, we'll use cached value from last check
        nav.getBattery().then((battery: any) => {
          (this as any)._cachedBatteryLevel = Math.round(battery.level * 100);
          (this as any)._cachedCharging = battery.charging;
        }).catch(() => {});
        return (this as any)._cachedBatteryLevel ?? null;
      }
    } catch {}
    return null;
  }

  private getChargingStatus(): boolean | null {
    return (this as any)._cachedCharging ?? null;
  }

  private getNetworkType(): string | null {
    try {
      const conn = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      if (conn) {
        return conn.effectiveType || conn.type || null;
      }
    } catch {}
    return null;
  }
}

export const backgroundLocationService = new BackgroundLocationService();
