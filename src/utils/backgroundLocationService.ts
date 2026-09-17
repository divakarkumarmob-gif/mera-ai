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
const STORAGE_KEY_LAST_KNOWN_LOCATION = 'friday_last_known_location';

// ── Interfaces ───────────────────────────────────────────────────────────────

interface CachedPositionData {
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  timestamp: number;
}

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
  isCachedLastKnown?: boolean;
}

// ── Service Class ────────────────────────────────────────────────────────────

class BackgroundLocationService {
  private isRunning = false;
  private watchId: number | null = null;
  private pingInterval: any = null;
  private lastPosition: GeolocationPosition | null = null;
  private cachedLastKnown: CachedPositionData | null = null;
  private deviceId: string = '';
  private deviceLabel: string = '';
  private isNativeApp = false;
  private consecutiveErrors = 0;
  private readonly MAX_CONSECUTIVE_ERRORS = 10;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isNativeApp = typeof (window as any).Capacitor !== 'undefined' &&
        (window as any).Capacitor.isNativePlatform?.();
      this.loadLastKnownPosition();
    }
  }

  /**
   * Persist last known GPS location so it is never lost even if GPS goes offline
   */
  private saveLastKnownPosition(coords: GeolocationCoordinates): void {
    const data: CachedPositionData = {
      lat: coords.latitude,
      lon: coords.longitude,
      accuracy: coords.accuracy || 0,
      altitude: coords.altitude ?? null,
      speed: coords.speed ?? null,
      heading: coords.heading ?? null,
      timestamp: Date.now(),
    };
    this.cachedLastKnown = data;
    try {
      localStorage.setItem(STORAGE_KEY_LAST_KNOWN_LOCATION, JSON.stringify(data));
    } catch {}
  }

  /**
   * Load last known GPS location from persistent storage
   */
  private loadLastKnownPosition(): CachedPositionData | null {
    if (this.cachedLastKnown) return this.cachedLastKnown;
    try {
      const stored = localStorage.getItem(STORAGE_KEY_LAST_KNOWN_LOCATION);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.cachedLastKnown = parsed;
        return parsed;
      }
    } catch {}
    return null;
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
  public async registerAndStart(
    label: string,
    ownerName?: string,
    coords?: { lat: number; lon: number; accuracy?: number }
  ): Promise<{ success: boolean; message: string }> {
    const deviceId = this.getOrCreateDeviceId();
    this.setDeviceLabel(label);
    const user = getStoredUser();

    const cached = this.loadLastKnownPosition();
    const lat = coords?.lat ?? this.lastPosition?.coords?.latitude ?? cached?.lat;
    const lon = coords?.lon ?? this.lastPosition?.coords?.longitude ?? cached?.lon;
    const accuracy = coords?.accuracy ?? this.lastPosition?.coords?.accuracy ?? cached?.accuracy ?? 0;

    const payload: any = {
      deviceId,
      label: this.deviceLabel || 'Boss Phone',
      ownerName: ownerName || this.deviceLabel || 'DK (Boss)',
      username: user?.username || 'boss',
      batteryLevel: this.getBatteryLevel(),
      isCharging: this.getChargingStatus(),
      networkType: this.getNetworkType(),
    };

    if (lat !== undefined && lon !== undefined) {
      payload.lat = lat;
      payload.lon = lon;
      payload.accuracy = accuracy;
    }

    try {
      // Register device with the server
      const registerUrl = getApiUrl('/api/location/register');
      const response = await fetch(registerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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

      // Immediately send fresh ping
      this.sendPing();

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
   * Proactively request location permission from the browser/APK and start tracking
   */
  public async requestPermissionAndStart(customLabel?: string): Promise<{ success: boolean; message: string }> {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      console.warn('[BackgroundLocation] Geolocation not supported on this environment.');
      return { success: false, message: 'Geolocation is not supported on this browser/device.' };
    }

    const user = getStoredUser();
    const label = customLabel || this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Phone';
    this.setDeviceLabel(label);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          this.lastPosition = position;
          this.saveLastKnownPosition(position.coords);
          console.log('[BackgroundLocation] 📍 Location permission granted:', position.coords.latitude, position.coords.longitude);
          try {
            localStorage.setItem(STORAGE_KEY_TRACKING_ENABLED, 'true');
          } catch {}
          const res = await this.registerAndStart(label, label, {
            lat: position.coords.latitude,
            lon: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
          resolve(res);
        },
        async (error) => {
          console.warn('[BackgroundLocation] ⚠️ Location permission prompt response/error:', error.message);
          // If cached last known location exists, still try to register
          const cached = this.loadLastKnownPosition();
          if (cached) {
            const res = await this.registerAndStart(label, label, {
              lat: cached.lat,
              lon: cached.lon,
              accuracy: cached.accuracy,
            });
            resolve(res);
          } else {
            resolve({
              success: false,
              message: `Location permission not granted: ${error.message}`,
            });
          }
        },
        {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        }
      );
    });
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
          this.saveLastKnownPosition(position.coords);
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
        this.saveLastKnownPosition(position.coords);
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
   * Send GPS ping to server with latest coordinates (or fallback to persistent last known location)
   */
  private async sendPing(): Promise<void> {
    if (!this.lastPosition) {
      // Try to get a fresh position if we don't have one yet
      try {
        if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: true,
              timeout: 15000,
            });
          });
          this.lastPosition = pos;
          this.saveLastKnownPosition(pos.coords);
        }
      } catch (err: any) {
        console.warn('[BackgroundLocation] Could not get fresh position for ping, checking last known cache:', err?.message);
      }
    }

    const cached = this.loadLastKnownPosition();
    const effectiveLat = this.lastPosition?.coords?.latitude ?? cached?.lat;
    const effectiveLon = this.lastPosition?.coords?.longitude ?? cached?.lon;

    if (effectiveLat === undefined || effectiveLon === undefined) return;

    const user = getStoredUser();
    const effectiveLabel = this.getDeviceLabel() || user?.displayName || user?.username || 'FRIDAY Device';

    const payload: GpsPingPayload = {
      deviceId: this.getOrCreateDeviceId(),
      username: user?.username,
      label: effectiveLabel,
      lat: effectiveLat,
      lon: effectiveLon,
      accuracy: this.lastPosition?.coords?.accuracy ?? cached?.accuracy ?? 0,
      altitude: this.lastPosition?.coords?.altitude ?? cached?.altitude ?? null,
      speed: this.lastPosition?.coords?.speed ?? cached?.speed ?? null,
      heading: this.lastPosition?.coords?.heading ?? cached?.heading ?? null,
      batteryLevel: this.getBatteryLevel(),
      isCharging: this.getChargingStatus(),
      networkType: this.getNetworkType(),
      isCachedLastKnown: !this.lastPosition && !!cached,
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
   * Auto-resume tracking or proactively prompt for location permission on app load
   */
  public async autoResumeIfEnabled(): Promise<void> {
    if (typeof window === 'undefined') return;

    if (this.isRunning) return;

    const user = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Device';

    if (this.isTrackingEnabled()) {
      console.log(`[BackgroundLocation] Auto-resuming tracking for "${label}"...`);
      this.startTracking();
    } else {
      // If not yet started, trigger permission prompt so user can allow location
      try {
        await this.requestPermissionAndStart(label);
      } catch (e) {
        console.warn('[BackgroundLocation] Auto-prompt location error:', e);
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
