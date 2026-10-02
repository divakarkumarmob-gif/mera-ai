/**
 * FRIDAY AI — Background Location Service (Client-Side)
 *
 * Layers (priority order):
 *  1. @capacitor-community/background-geolocation  → NATIVE APK, works when screen is OFF ✅
 *  2. navigator.geolocation.watchPosition          → Web / browser fallback
 *
 * Native plugin creates a FOREGROUND SERVICE on Android (shows notification).
 * This is the ONLY reliable way to get GPS when screen is off on Android 8+.
 *
 * Ping interval: 60 seconds to server even when phone is locked.
 */

import { getApiUrl } from './api';
import { getAppToken, getStoredUser } from './appSecurityClient';

// ── Configuration ─────────────────────────────────────────────────────────────

const PING_INTERVAL_MS         = 60 * 1000;   // 60 seconds
const STORAGE_KEY_DEVICE_ID    = 'friday_location_device_id';
const STORAGE_KEY_DEVICE_LABEL = 'friday_location_device_label';
const STORAGE_KEY_TRACKING_ON  = 'friday_location_tracking_enabled';
const STORAGE_KEY_LAST_KNOWN   = 'friday_last_known_location';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CachedPosition {
  lat: number; lon: number; accuracy: number;
  altitude: number | null; speed: number | null; heading: number | null;
  timestamp: number;
}

interface GpsPingPayload {
  deviceId: string; username?: string; label?: string;
  lat: number; lon: number; accuracy: number;
  altitude: number | null; speed: number | null; heading: number | null;
  batteryLevel: number | null; isCharging: boolean | null; networkType: string | null;
  isCachedLastKnown?: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

class BackgroundLocationService {
  private isRunning        = false;
  private watchId: number | null = null;
  private pingTimer: any   = null;
  private lastPosition: GeolocationPosition | null = null;
  private cachedLast: CachedPosition | null = null;
  private deviceId         = '';
  private deviceLabel      = '';
  private isNative         = false;
  private consecutiveErrors = 0;
  private readonly MAX_ERRORS = 10;

  // Whether native bg-geolocation plugin is loaded and running
  private nativeBgRunning  = false;

  constructor() {
    if (typeof window !== 'undefined') {
      this.isNative = typeof (window as any).Capacitor !== 'undefined' &&
        (window as any).Capacitor?.isNativePlatform?.();
      this.loadLastKnown();
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  public getDeviceId():    string  { return this.getOrCreateDeviceId(); }
  public getDeviceLabel(): string  { return this.deviceLabel || this.readStorage(STORAGE_KEY_DEVICE_LABEL) || ''; }
  public isActive():       boolean { return this.isRunning; }
  public isTrackingEnabled(): boolean {
    return this.readStorage(STORAGE_KEY_TRACKING_ON) === 'true';
  }

  public setDeviceLabel(label: string): void {
    this.deviceLabel = label.trim();
    this.writeStorage(STORAGE_KEY_DEVICE_LABEL, this.deviceLabel);
  }

  /**
   * Auto-resume tracking on app load if previously enabled.
   * Called from App.tsx / main entry once.
   */
  public async autoResumeIfEnabled(): Promise<void> {
    if (typeof window === 'undefined' || this.isRunning) return;
    const user  = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Device';

    if (this.isTrackingEnabled()) {
      console.log(`[BGLocation] 🔄 Auto-resuming tracking for "${label}"...`);
      await this.requestPermissionAndStart(label).catch(() => this.startTracking());
    } else {
      await this.requestPermissionAndStart(label).catch(() => {});
    }
  }

  /**
   * Request GPS permission and start tracking with the given label.
   */
  public async requestPermissionAndStart(customLabel?: string): Promise<{ success: boolean; message: string }> {
    if (typeof window === 'undefined' || !('geolocation' in navigator)) {
      return { success: false, message: 'Geolocation not supported.' };
    }

    const user  = getStoredUser();
    const label = customLabel || this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Phone';
    this.setDeviceLabel(label);

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          this.lastPosition = pos;
          this.saveLastKnown(pos.coords);
          this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
          const res = await this.registerAndStart(label, label, {
            lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy,
          });
          resolve(res);
        },
        async (err) => {
          console.warn('[BGLocation] ⚠️ Location permission error:', err.message);
          const cached = this.loadLastKnown();
          if (cached) {
            const res = await this.registerAndStart(label, label, { lat: cached.lat, lon: cached.lon, accuracy: cached.accuracy });
            resolve(res);
          } else {
            resolve({ success: false, message: `Location permission denied: ${err.message}` });
          }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
  }

  /**
   * Register device on server and start GPS tracking.
   */
  public async registerAndStart(
    label: string,
    ownerName?: string,
    coords?: { lat: number; lon: number; accuracy?: number }
  ): Promise<{ success: boolean; message: string }> {
    const deviceId = this.getOrCreateDeviceId();
    this.setDeviceLabel(label);
    const user = getStoredUser();
    const cached = this.loadLastKnown();

    const payload: any = {
      deviceId,
      label: this.deviceLabel || 'Boss Phone',
      ownerName: ownerName || this.deviceLabel || 'DK (Boss)',
      username: user?.username || 'boss',
      batteryLevel: this.getBatteryLevel(),
      isCharging: this.getChargingStatus(),
      networkType: this.getNetworkType(),
    };

    const lat = coords?.lat ?? this.lastPosition?.coords?.latitude ?? cached?.lat;
    const lon = coords?.lon ?? this.lastPosition?.coords?.longitude ?? cached?.lon;
    if (lat !== undefined && lon !== undefined) {
      payload.lat = lat;
      payload.lon = lon;
      payload.accuracy = coords?.accuracy ?? cached?.accuracy ?? 0;
    }

    try {
      const url = getApiUrl('/api/location/register');
      console.log('[BGLocation] 📡 Registering device:', url, JSON.stringify(payload));
      const res  = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { success: false, message: text }; }

      if (!data.success) {
        console.error('[BGLocation] ❌ Register failed:', data.message);
        return { success: false, message: data.message || 'Registration failed' };
      }

      console.log('[BGLocation] ✅ Device registered!');
      this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
      this.startTracking();
      await this.sendPing();

      return { success: true, message: `Device "${label}" registered! GPS tracking active 📍` };
    } catch (err: any) {
      console.error('[BGLocation] ❌ Registration error:', err?.message);
      return { success: false, message: `Registration failed: ${err?.message}` };
    }
  }

  /**
   * Start GPS tracking.
   * APK: Uses native BackgroundGeolocation (screen OFF safe).
   * Web: Falls back to navigator.geolocation.watchPosition.
   */
  public startTracking(): void {
    if (this.isRunning) return;
    if (typeof window === 'undefined') return;

    this.isRunning = true;
    this.consecutiveErrors = 0;
    console.log('[BGLocation] 🛰️ Starting GPS tracking (native:', this.isNative, ')...');

    if (this.isNative) {
      // Try native plugin first — true background GPS
      this.startNativeBackgroundGps().then((started) => {
        if (!started) this.startWebTracking(); // fallback if plugin fails
      });
    } else {
      this.startWebTracking();
    }

    // Fallback ping timer (also runs alongside native plugin for reliability)
    this.pingTimer = setInterval(() => { this.sendPing(); }, PING_INTERVAL_MS);
    this.sendPing(); // immediate first ping
  }

  /**
   * Stop GPS tracking (both native and web).
   */
  public stopTracking(): void {
    console.log('[BGLocation] ⏹️ Stopping GPS tracking...');
    this.isRunning = false;

    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }

    if (this.nativeBgRunning) {
      this.stopNativeBackgroundGps();
    }

    this.writeStorage(STORAGE_KEY_TRACKING_ON, 'false');
  }

  // ── Native Background GPS (Screen-OFF safe) ──────────────────────────────────

  /**
   * Uses @capacitor-community/background-geolocation.
   * This creates a FOREGROUND SERVICE on Android (notification required by OS).
   * Returns true if started successfully.
   */
  private async startNativeBackgroundGps(): Promise<boolean> {
    try {
      const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation');

      // Register the location callback
      const watchRef = BackgroundGeolocation.addWatcher(
        {
          // ── Android Foreground Service Notification ────────────────────────
          backgroundMessage: 'FRIDAY AI is tracking your location in the background.',
          backgroundTitle: 'FRIDAY Location Active',
          requestPermissions: true,
          stale: false,          // never return stale GPS
          distanceFilter: 10,    // update every 10 meters of movement
        },
        (location, error) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') {
              console.warn('[BGLocation] ❌ Native GPS permission denied. Opening settings...');
              BackgroundGeolocation.openSettings();
            }
            console.warn('[BGLocation] Native GPS error:', error.code, error.message);
            return;
          }

          if (!location) return;

          // Update lastPosition-equivalent from native
          this.cachedLast = {
            lat: location.latitude, lon: location.longitude,
            accuracy: location.accuracy ?? 0,
            altitude: location.altitude ?? null,
            speed: location.speed ?? null,
            heading: (location as any).bearing ?? null,
            timestamp: location.time ?? Date.now(),
          };
          this.saveLastKnown(null, this.cachedLast);
          this.consecutiveErrors = 0;

          console.log('[BGLocation] 📍 Native GPS update:', location.latitude, location.longitude,
            'speed:', location.speed, 'acc:', location.accuracy);
        }
      );

      // Store watcher ID to stop later
      watchRef.then((watchId: string) => {
        (this as any)._nativeWatchId = watchId;
        this.nativeBgRunning = true;
        console.log('[BGLocation] ✅ Native BackgroundGeolocation running (screen-OFF safe). WatchId:', watchId);
      }).catch((err: any) => {
        console.warn('[BGLocation] Native GPS watcher error:', err?.message);
        this.nativeBgRunning = false;
      });

      return true;
    } catch (err: any) {
      console.warn('[BGLocation] ⚠️ BackgroundGeolocation plugin not available, using web fallback:', err?.message);
      this.nativeBgRunning = false;
      return false;
    }
  }

  private async stopNativeBackgroundGps(): Promise<void> {
    try {
      const { BackgroundGeolocation } = await import('@capacitor-community/background-geolocation');
      const id = (this as any)._nativeWatchId;
      if (id) {
        await BackgroundGeolocation.removeWatcher({ id });
        (this as any)._nativeWatchId = null;
        this.nativeBgRunning = false;
        console.log('[BGLocation] ⏹️ Native GPS watcher removed.');
      }
    } catch { /* ignore */ }
  }

  // ── Web Browser Fallback ──────────────────────────────────────────────────────

  private startWebTracking(): void {
    if (!('geolocation' in navigator)) {
      console.warn('[BGLocation] Geolocation API not available');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.lastPosition = pos;
        this.saveLastKnown(pos.coords);
        this.consecutiveErrors = 0;
      },
      (err) => {
        console.warn('[BGLocation] Web GPS error:', err.message);
        this.consecutiveErrors++;
        if (this.consecutiveErrors >= this.MAX_ERRORS) {
          console.error('[BGLocation] Too many GPS errors, stopping.');
          this.stopTracking();
        }
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 }
    );

    console.log('[BGLocation] ✅ Web GPS tracking active (browser/WebView)');
  }

  // ── Ping to Server ────────────────────────────────────────────────────────────

  private async sendPing(): Promise<void> {
    const cached  = this.loadLastKnown();
    const nativeLat = this.cachedLast?.lat;
    const nativeLon = this.cachedLast?.lon;

    // Prefer native coords → then browser lastPosition → then localStorage cache
    const lat = nativeLat ?? this.lastPosition?.coords?.latitude ?? cached?.lat;
    const lon = nativeLon ?? this.lastPosition?.coords?.longitude ?? cached?.lon;

    if (lat === undefined || lon === undefined || lat === 0 && lon === 0) {
      console.warn('[BGLocation] No GPS coords available, trying fresh fetch...');
      // Try one-shot getCurrentPosition
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000 })
        );
        this.lastPosition = pos;
        this.saveLastKnown(pos.coords);
      } catch { return; }
    }

    const effectiveLat = nativeLat ?? this.lastPosition?.coords?.latitude ?? cached?.lat;
    const effectiveLon = nativeLon ?? this.lastPosition?.coords?.longitude ?? cached?.lon;
    if (!effectiveLat || !effectiveLon) return;

    const user  = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'FRIDAY Device';

    const payload: GpsPingPayload = {
      deviceId: this.getOrCreateDeviceId(),
      username: user?.username,
      label,
      lat: effectiveLat, lon: effectiveLon,
      accuracy:  this.cachedLast?.accuracy  ?? this.lastPosition?.coords?.accuracy  ?? cached?.accuracy  ?? 0,
      altitude:  this.cachedLast?.altitude  ?? this.lastPosition?.coords?.altitude  ?? cached?.altitude  ?? null,
      speed:     this.cachedLast?.speed     ?? this.lastPosition?.coords?.speed     ?? cached?.speed     ?? null,
      heading:   this.cachedLast?.heading   ?? this.lastPosition?.coords?.heading   ?? cached?.heading   ?? null,
      batteryLevel: this.getBatteryLevel(),
      isCharging: this.getChargingStatus(),
      networkType: this.getNetworkType(),
      isCachedLastKnown: !nativeLat && !this.lastPosition && !!cached,
    };

    try {
      const url = getApiUrl('/api/location/ping');
      console.log('[BGLocation] 📡 Ping → lat:', effectiveLat, 'lon:', effectiveLon, '| native:', this.nativeBgRunning);
      const res = await fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      if (res.ok) {
        console.log('[BGLocation] ✅ Ping saved!');
        this.consecutiveErrors = 0;
      } else {
        console.error('[BGLocation] ❌ Ping failed:', res.status, await res.text());
        this.consecutiveErrors++;
      }
    } catch (err: any) {
      console.error('[BGLocation] ❌ Ping network error:', err?.message);
      this.consecutiveErrors++;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getOrCreateDeviceId(): string {
    if (this.deviceId) return this.deviceId;
    const stored = this.readStorage(STORAGE_KEY_DEVICE_ID);
    if (stored) { this.deviceId = stored; return stored; }
    const id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    this.deviceId = id;
    this.writeStorage(STORAGE_KEY_DEVICE_ID, id);
    return id;
  }

  private saveLastKnown(coords: GeolocationCoordinates | null, cached?: CachedPosition): void {
    const data: CachedPosition = cached ?? {
      lat: coords!.latitude, lon: coords!.longitude,
      accuracy: coords!.accuracy ?? 0,
      altitude: coords!.altitude ?? null,
      speed: coords!.speed ?? null,
      heading: coords!.heading ?? null,
      timestamp: Date.now(),
    };
    this.cachedLast = data;
    this.writeStorage(STORAGE_KEY_LAST_KNOWN, JSON.stringify(data));
  }

  private loadLastKnown(): CachedPosition | null {
    if (this.cachedLast) return this.cachedLast;
    try {
      const s = this.readStorage(STORAGE_KEY_LAST_KNOWN);
      if (s) { this.cachedLast = JSON.parse(s); return this.cachedLast; }
    } catch {}
    return null;
  }

  private readStorage(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
  }

  private writeStorage(key: string, value: string): void {
    try { localStorage.setItem(key, value); } catch {}
  }

  private getBatteryLevel(): number | null {
    try {
      const nav = navigator as any;
      if (nav.getBattery) {
        nav.getBattery().then((b: any) => {
          (this as any)._battLevel = Math.round(b.level * 100);
          (this as any)._charging  = b.charging;
        }).catch(() => {});
        return (this as any)._battLevel ?? null;
      }
    } catch {}
    return null;
  }

  private getChargingStatus(): boolean | null { return (this as any)._charging ?? null; }

  private getNetworkType(): string | null {
    try {
      const c = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
      return c ? (c.effectiveType || c.type || null) : null;
    } catch { return null; }
  }
}

export const backgroundLocationService = new BackgroundLocationService();
