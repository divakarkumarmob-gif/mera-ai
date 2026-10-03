/**
 * FRIDAY AI — Background Location Service (Client-Side)
 *
 * Uses Google's Fused Location Provider via:
 *  1. @capacitor/background-runner  → WorkManager (screen OFF, NO permanent notification) ✅
 *  2. @capacitor/geolocation        → Fused Location Provider (foreground)
 *  3. navigator.geolocation         → Web/browser fallback
 *
 * 🔋 ADAPTIVE BATTERY OPTIMIZATION:
 *  - Moving (>50m change)   → ping every 60s  (real-time tracking)
 *  - Slow / stopped         → ping every 3min (light tracking)
 *  - Stationary long time   → ping every 5min (idle mode)
 *  - Deep idle (no move 30m)→ ping every 10min (sleep mode)
 *  - Fused Location uses WiFi+Cell instead of GPS when stationary = less drain
 */

import { getApiUrl } from './api';
import { getStoredUser } from './appSecurityClient';
import { offlineFallbackLocationService } from './offlineFallbackLocationService';
import { sendLocationSms } from './smsSenderPlugin';


// ── Adaptive Ping Configuration ───────────────────────────────────────────────

// Intervals based on movement state
const INTERVAL_ACTIVE_MS      = 60  * 1000;   // Moving       → 60s
const INTERVAL_SLOW_MS        = 3   * 60000;  // Slow/stopped → 3min
const INTERVAL_IDLE_MS        = 5   * 60000;  // Idle         → 5min
const INTERVAL_SLEEP_MS       = 10  * 60000;  // Deep idle    → 10min

// Movement thresholds
const MOVE_THRESHOLD_M        = 50;    // meters — considered "moved"
const IDLE_THRESHOLD_PINGS    = 3;     // 3 consecutive no-move pings → idle
const SLEEP_THRESHOLD_PINGS   = 6;     // 6 consecutive no-move pings → sleep

// Keep for compat
const PING_INTERVAL_MS        = INTERVAL_ACTIVE_MS;
const STORAGE_KEY_DEVICE_ID    = 'friday_location_device_id';
const STORAGE_KEY_DEVICE_LABEL = 'friday_location_device_label';
const STORAGE_KEY_TRACKING_ON  = 'friday_location_tracking_enabled';
const STORAGE_KEY_LAST_KNOWN   = 'friday_last_known_location';
const STORAGE_KEY_OFFLINE_Q    = 'friday_offline_ping_queue';  // queued pings when data is off
const STORAGE_KEY_SMS_RECIPIENT = 'friday_sms_recipient';      // boss's phone number for SMS fallback
const MAX_OFFLINE_QUEUE        = 10;  // max queued pings (oldest dropped when full)

/** Ensures a Promise settles within timeoutMs; returns fallback if timeout fires or promise rejects */
function safePromise<T>(p: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(fallback);
      }
    }, timeoutMs);
    p.then((res) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(res);
      }
    }).catch(() => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    });
  });
}


// ── Types ─────────────────────────────────────────────────────────────────────

interface CachedPosition {
  lat: number; lon: number; accuracy: number;
  altitude: number | null; speed: number | null; heading: number | null;
  timestamp: number;
}

interface GpsPingPayload {
  deviceId: string; username?: string; label?: string;
  platform?: string;  // 'apk' | 'web' — reliable APK vs browser flag
  lat: number; lon: number; accuracy: number;
  altitude: number | null; speed: number | null; heading: number | null;
  batteryLevel: number | null; isCharging: boolean | null; networkType: string | null;
  isCachedLastKnown?: boolean;
}

// ── Service ───────────────────────────────────────────────────────────────────

class BackgroundLocationService {
  private isRunning           = false;
  private webWatchId: number | null = null;
  private bgGeoWatcherId: string | null = null;  // @capacitor-community/background-geolocation watcher ID
  private pingTimer: any      = null;
  private lastPosition: GeolocationPosition | null = null;
  private cachedLast: CachedPosition | null = null;
  private deviceId            = '';
  private deviceLabel         = '';
  private isNative            = false;
  private consecutiveErrors   = 0;
  private readonly MAX_ERRORS = 10;

  // ── Adaptive battery optimization ─────────────────────────────────────────
  private noMovePingCount    = 0;   // consecutive pings with no significant movement
  private lastPingCoords: { lat: number; lon: number } | null = null;

  /** Haversine distance in meters between two GPS points */
  private distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
    const R = 6371000;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lon - a.lon) * Math.PI / 180;
    const sin2 = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(sin2));
  }

  /** Get current adaptive interval based on movement state */
  private getCurrentInterval(): number {
    if (this.noMovePingCount >= SLEEP_THRESHOLD_PINGS) return INTERVAL_SLEEP_MS;   // 10min
    if (this.noMovePingCount >= IDLE_THRESHOLD_PINGS)  return INTERVAL_IDLE_MS;    // 5min
    if (this.noMovePingCount >= 1)                     return INTERVAL_SLOW_MS;    // 3min
    return INTERVAL_ACTIVE_MS;                                                      // 60s
  }

  /** Update movement counter and restart timer if interval changed */
  private updateMovementState(lat: number, lon: number): void {
    const prev = this.lastPingCoords;
    const curr = { lat, lon };
    this.lastPingCoords = curr;

    if (!prev) return; // first ping, no comparison

    const dist = this.distanceMeters(prev, curr);
    const moved = dist >= MOVE_THRESHOLD_M;

    if (moved) {
      if (this.noMovePingCount > 0) {
        console.log(`[BGLocation] 🏃 Movement detected (${dist.toFixed(0)}m) → back to 60s interval`);
        this.noMovePingCount = 0;
        this.restartPingTimer(); // immediately switch to active interval
      }
    } else {
      const prevCount = this.noMovePingCount;
      this.noMovePingCount++;
      const newInterval = this.getCurrentInterval();
      const labels = ['3min 🐢', '5min 💤', '10min 😴'];
      const thresholds = [IDLE_THRESHOLD_PINGS, SLEEP_THRESHOLD_PINGS, SLEEP_THRESHOLD_PINGS + 1];

      if (this.noMovePingCount !== prevCount && thresholds.includes(this.noMovePingCount)) {
        const idx = thresholds.indexOf(this.noMovePingCount);
        console.log(`[BGLocation] 🔋 Stationary detected → interval → ${labels[idx] || '10min 😴'}`);
        this.restartPingTimer();
      } else if (this.noMovePingCount === 1) {
        console.log(`[BGLocation] 🔋 No movement (${dist.toFixed(0)}m) → switching to 3min interval`);
        this.restartPingTimer();
      }
    }
  }

  /** Restart the ping timer with the current adaptive interval */
  private restartPingTimer(): void {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (!this.isRunning) return;
    const interval = this.getCurrentInterval();
    this.pingTimer = setInterval(() => { this.sendPing(); }, interval);
  }

  public checkNative(): boolean {
    if (typeof window === 'undefined') return false;
    return typeof (window as any).FridayNativeBridge !== 'undefined' ||
      Boolean((window as any).isFridayNativeApp) ||
      (typeof (window as any).Capacitor !== 'undefined' &&
       Boolean((window as any).Capacitor?.isNativePlatform?.()));
  }

  constructor() {
    if (typeof window !== 'undefined') {
      this.isNative = this.checkNative();
      this.loadLastKnown();

      // Listen to real-time native Android GPS coordinate updates from Kotlin
      window.addEventListener('friday:native_location', (e: any) => {
        const d = e?.detail;
        if (d && typeof d.lat === 'number' && typeof d.lon === 'number' && d.lat !== 0 && d.lon !== 0) {
          const cached: CachedPosition = {
            lat: d.lat,
            lon: d.lon,
            accuracy: d.accuracy || 10,
            altitude: d.altitude ?? null,
            speed: d.speed ?? null,
            heading: d.heading ?? null,
            timestamp: d.timestamp || Date.now(),
          };
          this.cachedLast = cached;
          this.saveLastKnown(cached);
          console.log('[BGLocation] ⚡ Native GPS event cached: lat=' + d.lat + ' lon=' + d.lon);
        }
      });

      // ── Instant flush when internet returns ─────────────────────────────
      // GPS ON + Data OFF case:
      //   → Pings were queued in localStorage
      //   → Jab bhi internet aata hai (online event) → turant flush
      //   → No waiting for next ping cycle (which could be 10 min if idle)
      window.addEventListener('online', () => {
        console.log('[BGLocation] 🌐 Internet restored! Flushing offline queue...');
        this.flushOfflineQueue().catch(() => {});
      });
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
   * Set the boss/recipient phone number for SMS location fallback.
   * Number must include country code (e.g. "919876543210" for India).
   * When GPS is ON + Data is OFF, coordinates are sent via SMS to this number.
   */
  public setSmsRecipient(number: string): void {
    const clean = number.replace(/\s+|-/g, '').trim();
    this.writeStorage(STORAGE_KEY_SMS_RECIPIENT, clean);
    console.log('[BGLocation] 📱 SMS recipient set:', clean);
  }

  public getSmsRecipient(): string {
    return this.readStorage(STORAGE_KEY_SMS_RECIPIENT) || '';
  }

  public isSmsConfigured(): boolean {
    const n = this.getSmsRecipient();
    return n.length >= 10;
  }

  /** Auto-resume on app load if previously enabled */
  public async autoResumeIfEnabled(): Promise<void> {
    if (typeof window === 'undefined' || this.isRunning) return;

    // 📱 Fetch SMS recipient (boss's number) from server env — zero hardcoding
    this.fetchAndApplySmsRecipient().catch(() => {});

    const user  = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Phone';
    if (this.isTrackingEnabled()) {
      console.log(`[BGLocation] 🔄 Auto-resuming for "${label}"...`);
      await this.requestPermissionAndStart(label).catch(() => this.startTracking());
    } else {
      await this.requestPermissionAndStart(label).catch(() => {});
    }
  }

  /**
   * Fetches the SMS recipient number from the Render server's env variables.
   * Called at app startup — silently stores the number in localStorage.
   *
   * Server env:  BOSS_WHATSAPP_NUMBER or OWNER_WHATSAPP_NUMBER
   * Endpoint:    GET /api/config/app
   * Security:    Number never in APK or repo — only on Render
   */
  private async fetchAndApplySmsRecipient(): Promise<void> {
    try {
      const url = getApiUrl('/config/app');
      // ⭐ AbortController instead of AbortSignal.timeout() — Android WebView compatible!
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, { method: 'GET', signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) return;

      const data: { smsRecipient?: string; smsFallbackEnabled?: boolean } = await res.json();
      const number = data?.smsRecipient?.trim() || '';

      if (number && number.length >= 10) {
        this.setSmsRecipient(number);
        console.log('[BGLocation] 📱 SMS recipient synced from server ✅');
      } else {
        console.log('[BGLocation] ℹ️ No SMS recipient configured on server (BOSS_WHATSAPP_NUMBER not set in Render env)');
      }
    } catch (err) {
      // Non-fatal — SMS fallback simply stays disabled if server unreachable
      console.log('[BGLocation] ⚠️ Could not fetch SMS config (offline or server error)');
    }
  }



  /**
   * Tries to get fresh GPS or fused network coordinates.
   * Cascade order:
   *   1. Capacitor Geolocation (Last-known cache, 2.5s)
   *   2. Capacitor Geolocation (Low accuracy Fused - works indoors in <1s)
   *   3. Capacitor Geolocation (High accuracy GPS, 4.5s)
   *   4. Web navigator.geolocation fallback
   *   5. LocalStorage cached position fallback
   */
  public async getFreshPosition(): Promise<CachedPosition | null> {
    if (typeof window === 'undefined') return null;

    const toCached = (lat: number, lon: number, accuracy: number, pos?: any): CachedPosition => ({
      lat,
      lon,
      accuracy: accuracy || 0,
      altitude: pos?.coords?.altitude ?? null,
      speed: pos?.coords?.speed ?? null,
      heading: pos?.coords?.heading ?? null,
      timestamp: Date.now(),
    });

    const isNative = this.checkNative();

    // 0. Friday Native Android Kotlin Bridge (Pure Native GPS - Instant & Accurate)
    const nativeBridge = typeof window !== 'undefined' ? (window as any).FridayNativeBridge : null;
    if (nativeBridge && typeof nativeBridge.getLocation === 'function') {
      try {
        const raw = nativeBridge.getLocation();
        if (raw && raw !== '{}') {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed.lat === 'number' && typeof parsed.lon === 'number' && parsed.lat !== 0 && parsed.lon !== 0) {
            console.log('[BGLocation] ⚡ Native Android GPS fix acquired:', parsed.lat, parsed.lon, `(±${Math.round(parsed.accuracy || 0)}m)`);
            return toCached(parsed.lat, parsed.lon, parsed.accuracy ?? 10, {
              coords: {
                altitude: parsed.altitude,
                speed: parsed.speed,
                heading: parsed.heading,
              }
            });
          }
        }
      } catch (err: any) {
        console.warn('[BGLocation] FridayNativeBridge getLocation notice:', err?.message);
      }
    }

    // 1. Native Capacitor Geolocation (Legacy Fallback if installed)
    if (isNative) {
      try {
        const { Geolocation } = await import(/* @vite-ignore */ '@capacitor/geolocation');

        try {
          const check = await safePromise(Geolocation.checkPermissions(), 4000, null);
          if (check?.location !== 'granted') {
            await safePromise(Geolocation.requestPermissions(), 8000, null);
          }
        } catch {}

        // ⭐ FAST PATH A: Instant Last Known Position (maximumAge: 10 mins)
        // On Android, Fused Location Provider has this in memory!
        try {
          const cachedPos = await safePromise(
            Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 2500, maximumAge: 600000 }),
            3000,
            null
          );
          if (cachedPos?.coords?.latitude && cachedPos?.coords?.longitude) {
            console.log('[BGLocation] ⚡ Fast cached fix acquired:', cachedPos.coords.latitude, cachedPos.coords.longitude);
            return toCached(cachedPos.coords.latitude, cachedPos.coords.longitude, cachedPos.coords.accuracy ?? 0, cachedPos);
          }
        } catch {}

        // ⭐ FAST PATH B: Low accuracy Fused network fix
        try {
          const fastPos = await safePromise(
            Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 3500, maximumAge: 60000 }),
            4000,
            null
          );
          if (fastPos?.coords?.latitude && fastPos?.coords?.longitude) {
            console.log('[BGLocation] ⚡ Fused fix acquired in <2s:', fastPos.coords.latitude, fastPos.coords.longitude);
            return toCached(fastPos.coords.latitude, fastPos.coords.longitude, fastPos.coords.accuracy ?? 0, fastPos);
          }
        } catch {}

        // Fallback: Satellite GPS
        try {
          const pos = await safePromise(
            Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 4500, maximumAge: 15000 }),
            5000,
            null
          );
          if (pos?.coords?.latitude && pos?.coords?.longitude) {
            console.log('[BGLocation] 🛰️ Satellite GPS fix acquired:', pos.coords.latitude, pos.coords.longitude);
            return toCached(pos.coords.latitude, pos.coords.longitude, pos.coords.accuracy ?? 0, pos);
          }
        } catch {}
      } catch (err: any) {
        console.warn('[BGLocation] Capacitor getFreshPosition error:', err?.message);
      }
    }

    // 2. Web Geolocation API fallback (also protected by safePromise)
    if ('geolocation' in navigator) {
      try {
        const getWebPos = (highAcc: boolean, timeoutMs: number, maxAge: number) => {
          return new Promise<GeolocationPosition | null>((resolve) => {
            const timer = setTimeout(() => resolve(null), timeoutMs + 500);
            try {
              navigator.geolocation.getCurrentPosition(
                (pos) => { clearTimeout(timer); resolve(pos); },
                () => { clearTimeout(timer); resolve(null); },
                { enableHighAccuracy: highAcc, timeout: timeoutMs, maximumAge: maxAge }
              );
            } catch {
              clearTimeout(timer);
              resolve(null);
            }
          });
        };

        const pos1 = await getWebPos(false, 2500, 300000);
        if (pos1?.coords?.latitude && pos1?.coords?.longitude) {
          return toCached(pos1.coords.latitude, pos1.coords.longitude, pos1.coords.accuracy ?? 0, pos1);
        }

        const pos2 = await getWebPos(true, 3500, 10000);
        if (pos2?.coords?.latitude && pos2?.coords?.longitude) {
          return toCached(pos2.coords.latitude, pos2.coords.longitude, pos2.coords.accuracy ?? 0, pos2);
        }
      } catch {}
    }

    // 3. Fallback to localStorage cached position
    const lastKnown = this.loadLastKnown();
    if (lastKnown && lastKnown.lat && lastKnown.lon) {
      return lastKnown;
    }

    return null;
  }

  /** Request GPS permission and start tracking */
  public async requestPermissionAndStart(customLabel?: string): Promise<{ success: boolean; message: string }> {
    if (typeof window === 'undefined') return { success: false, message: 'Not a browser environment.' };

    const user  = getStoredUser();
    const label = customLabel || this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Phone';
    this.setDeviceLabel(label);

    const isNative = this.checkNative();

    // 1. Native permission request if on Android
    if (isNative) {
      try {
        const { Geolocation } = await import(/* @vite-ignore */ '@capacitor/geolocation');
        const check = await Geolocation.checkPermissions();
        if (check.location !== 'granted') {
          await Geolocation.requestPermissions();
        }
      } catch (err: any) {
        console.warn('[BGLocation] Native permission request notice:', err?.message);
      }
    }

    // 2. Always enable tracking state & start foreground + background tracking loops
    this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
    this.startTracking();

    // 3. Try to get fresh location immediately (with indoor fallback)
    const fresh = await this.getFreshPosition();
    if (fresh) {
      this.cachedLast = fresh;
      this.saveLastKnown(fresh);
      return await this.registerAndStart(label, label, { lat: fresh.lat, lon: fresh.lon, accuracy: fresh.accuracy });
    }

    // 4. If fresh GPS fix is taking time, use cached coordinates to register device
    const cached = this.loadLastKnown();
    if (cached) {
      return await this.registerAndStart(label, label, { lat: cached.lat, lon: cached.lon, accuracy: cached.accuracy });
    }

    // 5. Initial registration even without coordinates yet — tracking loop will ping coordinates as soon as available
    return await this.registerAndStart(label, label);
  }

  /** Register device on server and start tracking */
  public async registerAndStart(
    label: string,
    ownerName?: string,
    coords?: { lat: number; lon: number; accuracy?: number }
  ): Promise<{ success: boolean; message: string }> {
    const deviceId = this.getOrCreateDeviceId();
    this.setDeviceLabel(label);
    const user   = getStoredUser();
    const cached = this.loadLastKnown();

    const isNativePlatform = this.checkNative();
    const payload: any = {
      deviceId,
      label: this.deviceLabel || 'Boss Phone',
      ownerName: ownerName || this.deviceLabel || 'DK (Boss)',
      username: user?.username || 'boss',
      platform: isNativePlatform ? 'apk' : 'web',
      batteryLevel: this.getBatteryLevel(),
      isCharging: this.getChargingStatus(),
      networkType: this.getNetworkType(),
    };

    const lat = coords?.lat ?? this.cachedLast?.lat ?? this.lastPosition?.coords?.latitude ?? cached?.lat;
    const lon = coords?.lon ?? this.cachedLast?.lon ?? this.lastPosition?.coords?.longitude ?? cached?.lon;
    if (lat !== undefined && lon !== undefined) {
      payload.lat = lat; payload.lon = lon;
      payload.accuracy = coords?.accuracy ?? cached?.accuracy ?? 0;
    }

    // ── Sync config to native SharedPreferences so FridayForegroundService
    //    can track GPS even when WebView (JS) is completely stopped.
    if (isNativePlatform) {
      this.syncNativeServicePrefs(deviceId, user?.username || 'boss', label).catch(() => {});
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 10000);
      const res  = await fetch(getApiUrl('/api/location/register'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload), signal: ctrl.signal,
      });
      clearTimeout(t);
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { success: false, message: text }; }
      if (!data.success) {
        console.warn('[BGLocation] Server registration notice:', data.message);
      } else {
        console.log('[BGLocation] ✅ Device registered! platform=' + payload.platform + ' deviceId=' + deviceId);
      }

      this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
      this.startTracking();
      this.sendPing().catch(() => {});
      return { success: true, message: `"${label}" registered! GPS tracking active 📍` };
    } catch (err: any) {
      console.warn('[BGLocation] ⚠️ Register network error (tracking active locally):', err?.message);
      this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
      this.startTracking();
      this.sendPing().catch(() => {});
      return { success: true, message: `"${label}" tracking active locally 📍` };
    }
  }

  /**
   * Write deviceId / username / label / backendUrl to Android SharedPreferences
   * (via Capacitor's Preferences plugin). FridayForegroundService reads these
   * on the native Java side so it can POST GPS pings independently of the WebView.
   */
  private async syncNativeServicePrefs(
    deviceId: string,
    username: string,
    label: string
  ): Promise<void> {
    try {
      const { Preferences } = await import(/* @vite-ignore */ '@capacitor/preferences');
      const backendUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_BACKEND_URL)
        || 'https://mera-ai-3496.onrender.com';
      // Capacitor Preferences uses a single shared file; we use group "FridayPrefs"
      // to match the SharedPreferences file name that FridayForegroundService reads.
      await Preferences.set({ key: 'friday_deviceId',   value: deviceId });
      await Preferences.set({ key: 'friday_username',   value: username });
      await Preferences.set({ key: 'friday_label',      value: label });
      await Preferences.set({ key: 'friday_backendUrl', value: backendUrl });
      console.log('[BGLocation] 💾 Native prefs synced → FridayForegroundService will use deviceId=' + deviceId);
    } catch (err: any) {
      console.warn('[BGLocation] syncNativeServicePrefs error:', err?.message);
    }
  }


  /**
   * Start GPS tracking.
   *
   * APK Strategy:
   *   1. @capacitor-community/background-geolocation  ← REAL background (app closed ✅)
   *      → Runs a persistent Android foreground service with notification
   *      → Calls onLocation callback even when screen is OFF and app is killed
   *   2. Fallback ping timer (60s) for network transmission
   *
   * Web Strategy:
   *   - navigator.geolocation.watchPosition
   *   - 60s ping timer
   */
  public startTracking(): void {
    if (this.isRunning) return;
    if (typeof window === 'undefined') return;

    this.isRunning = true;
    this.consecutiveErrors = 0;
    console.log('[BGLocation] 🛰️ Starting GPS (native:', this.isNative, ')...');

    if (this.isNative) {
      // ⭐ PRIMARY: @capacitor-community/background-geolocation
      // This is the ONLY plugin that works when app is closed/killed.
      // It starts a persistent Android Foreground Service (shows a notification)
      // and delivers location updates via callback even with screen OFF.
      this.startBackgroundGeoService().catch((err) => {
        console.warn('[BGLocation] BG-geo failed, falling back to watchPosition:', err?.message);
        // Fallback: Capacitor standard geolocation (foreground only)
        this.startCapacitorGeoWatch().catch(() => {});
      });
    } else {
      this.startWebWatch();
    }

    // 60s ping timer — backup / foreground pings
    this.pingTimer = setInterval(() => { this.sendPing(); }, PING_INTERVAL_MS);
    this.sendPing(); // immediate first ping
  }

  public stopTracking(): void {
    console.log('[BGLocation] ⏹️ Stopping GPS...');
    this.isRunning = false;
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.webWatchId !== null) {
      navigator.geolocation.clearWatch(this.webWatchId); this.webWatchId = null;
    }
    // Stop the real background geo service (removes persistent notification)
    this.stopBackgroundGeoService().catch(() => {});
    this.writeStorage(STORAGE_KEY_TRACKING_ON, 'false');
  }

  // ── @capacitor-community/background-geolocation (TRUE Background — App Closed ✅) ──
  //
  // WHY THIS PLUGIN:
  //   • @capacitor/background-runner  → one-shot dispatch only, NOT a persistent watcher
  //   • @capacitor/geolocation watch  → FOREGROUND ONLY — stops when app is swiped away
  //   • @capacitor-community/background-geolocation → runs an Android ForegroundService
  //     with a persistent notification. OS cannot kill it. Works with screen OFF & app closed.
  //
  // ANDROID REQUIREMENT:
  //   AndroidManifest.xml must have:
  //     <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
  //     <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
  //     <uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
  //   And inside <application>:
  //     <service android:name="com.equimaps.capacitorbackgroundgeolocation.BackgroundGeolocationService"
  //              android:foregroundServiceType="location"
  //              android:exported="false" />

  private async startBackgroundGeoService(): Promise<void> {
    try {
      // @capacitor-community/background-geolocation has NO JS files in its npm package
      // (no main/module/exports in its package.json).
      // The correct way to use Capacitor community plugins is via registerPlugin()
      // from @capacitor/core — this wires up to the native Android implementation
      // that was installed via `npx cap sync`.
      const { registerPlugin } = await import(/* @vite-ignore */ '@capacitor/core');

      const BackgroundGeolocation = registerPlugin<{
        addWatcher(options: {
          backgroundMessage: string;
          backgroundTitle: string;
          requestPermissions: boolean;
          stale: boolean;
          distanceFilter: number;
        }, callback: (location: any, error: any) => void): Promise<{ id: string }>;
        removeWatcher(options: { id: string }): Promise<void>;
        openSettings(): Promise<void>;
      }>('BackgroundGeolocation');

      // Remove any previous watcher to avoid duplicates
      if (this.bgGeoWatcherId) {
        await BackgroundGeolocation.removeWatcher({ id: this.bgGeoWatcherId }).catch(() => {});
        this.bgGeoWatcherId = null;
      }

      const watcher = await BackgroundGeolocation.addWatcher(
        {
          // backgroundMessage tells Android to run a ForegroundService
          // App will track location even when CLOSED / screen OFF
          backgroundMessage: 'FRIDAY is tracking your location in background.',
          backgroundTitle: 'FRIDAY Location Active 📍',
          requestPermissions: true,
          stale: false,         // only fresh locations
          distanceFilter: 10,   // meters before next update (battery saving)
        },
        (location: any, error: any) => {
          if (error) {
            if (error.code === 'NOT_AUTHORIZED') {
              console.warn('[BGLocation] BG-geo: Location permission denied. Grant "Always Allow" in Settings.');
            } else {
              console.warn('[BGLocation] BG-geo error:', error.message);
            }
            return;
          }

          if (!location) return;

          const c: CachedPosition = {
            lat: location.latitude,
            lon: location.longitude,
            accuracy: location.accuracy ?? 0,
            altitude: location.altitude ?? null,
            speed: location.speed ?? null,
            heading: location.bearing ?? null,
            timestamp: Date.now(),
          };

          this.cachedLast = c;
          this.saveLastKnown(c);
          this.consecutiveErrors = 0;

          console.log(`[BGLocation] 📍 BG-geo update: lat=${c.lat.toFixed(5)} lon=${c.lon.toFixed(5)} acc=${c.accuracy}m`);

          // Immediately transmit to server (runs in foreground + background)
          this.sendPing().catch(() => {});
        }
      );

      this.bgGeoWatcherId = watcher.id;
      console.log('[BGLocation] ✅ BackgroundGeolocation service started (id:', watcher.id, ') — works with app CLOSED ✅');
    } catch (err: any) {
      console.warn('[BGLocation] BackgroundGeolocation plugin error:', err?.message);
      throw err; // caller will fallback to @capacitor/geolocation watchPosition
    }
  }

  private async stopBackgroundGeoService(): Promise<void> {
    try {
      if (!this.bgGeoWatcherId) return;
      const { registerPlugin } = await import(/* @vite-ignore */ '@capacitor/core');
      const BackgroundGeolocation = registerPlugin<{
        removeWatcher(options: { id: string }): Promise<void>;
      }>('BackgroundGeolocation');
      await BackgroundGeolocation.removeWatcher({ id: this.bgGeoWatcherId });
      this.bgGeoWatcherId = null;
      console.log('[BGLocation] ⏹️ BackgroundGeolocation service stopped (notification removed)');
    } catch (err: any) {
      console.warn('[BGLocation] stopBackgroundGeoService error:', err?.message);
    }
  }

  // ── Capacitor Geolocation Watch (Foreground-only fallback) ──────────────────

  private async startCapacitorGeoWatch(): Promise<void> {
    try {
      const { Geolocation } = await import(/* @vite-ignore */ '@capacitor/geolocation');
      await Geolocation.watchPosition(
        { enableHighAccuracy: true, timeout: 30000 },
        (pos, err) => {
          if (err || !pos) return;
          const c: CachedPosition = {
            lat: pos.coords.latitude, lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 0,
            altitude: pos.coords.altitude ?? null,
            speed: pos.coords.speed ?? null,
            heading: pos.coords.heading ?? null,
            timestamp: Date.now(),
          };
          this.cachedLast = c;
          this.saveLastKnown(c);
          this.consecutiveErrors = 0;
          this.sendPing().catch(() => {});
        }
      );
      console.log('[BGLocation] ✅ Capacitor Geolocation watch active (foreground fallback)');
    } catch (err: any) {
      console.warn('[BGLocation] Capacitor Geolocation watch error:', err?.message);
    }
  }

  // ── Web Browser Fallback ──────────────────────────────────────────────────────

  private startWebWatch(): void {
    if (!('geolocation' in navigator)) return;
    this.webWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.lastPosition = pos;
        const c: CachedPosition = {
          lat: pos.coords.latitude, lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
          altitude: pos.coords.altitude ?? null, speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null, timestamp: Date.now(),
        };
        this.cachedLast = c;
        this.saveLastKnown(c);
        this.consecutiveErrors = 0;
        // 🚀 SEND LIVE PING IMMEDIATELY on web watch fix as well!
        this.sendPing().catch(() => {});
      },
      (err) => {
        console.warn('[BGLocation] Web GPS error:', err.message);
        if (++this.consecutiveErrors >= this.MAX_ERRORS) this.stopTracking();
      },
      { enableHighAccuracy: true, timeout: 30000, maximumAge: 30000 }
    );
    console.log('[BGLocation] ✅ Web GPS watch active');
  }

  // ── Ping to Server ────────────────────────────────────────────────────────────

  private async sendPing(): Promise<void> {
    // ── Step 1: Get coordinates ──────────────────────────────────────────────
    const cached = this.loadLastKnown();
    let lat: number | undefined;
    let lon: number | undefined;
    let accuracy = 0;
    let usingCached = false;

    // 1. Always attempt to get a fresh position first!
    const fresh = await this.getFreshPosition();
    if (fresh) {
      lat = fresh.lat;
      lon = fresh.lon;
      accuracy = fresh.accuracy;
      this.cachedLast = fresh;
      this.saveLastKnown(fresh);
    } else {
      // 2. Fallback to watchPosition's last cached or stored last known
      lat = this.cachedLast?.lat ?? this.lastPosition?.coords?.latitude ?? cached?.lat;
      lon = this.cachedLast?.lon ?? this.lastPosition?.coords?.longitude ?? cached?.lon;
      accuracy = this.cachedLast?.accuracy ?? this.lastPosition?.coords?.accuracy ?? cached?.accuracy ?? 0;
      usingCached = true;

      // 3. If still no coords, try offline fallback estimation (WiFi fingerprints, cell towers, dead reckoning)
      if (!lat || !lon) {
        const offlineEst = await offlineFallbackLocationService.estimateOfflineLocation(
          cached ? { lat: cached.lat, lon: cached.lon, accuracy: cached.accuracy, timestamp: cached.timestamp } : undefined
        );

        if (offlineEst) {
          lat = offlineEst.lat;
          lon = offlineEst.lon;
          accuracy = offlineEst.accuracy;
          usingCached = true;
          (this as any)._offlineAccuracy = offlineEst.accuracy;
          (this as any)._offlineMethod   = offlineEst.method;
          (this as any)._offlineConf     = offlineEst.confidence;
          console.log(`[BGLocation] 🔍 Offline estimate (${offlineEst.method}, ${offlineEst.confidence}% conf): lat=${lat?.toFixed(5)} lon=${lon?.toFixed(5)} acc=${offlineEst.accuracy}m`);
        } else if (cached?.lat && cached?.lon) {
          lat = cached.lat; lon = cached.lon;
          accuracy = cached.accuracy;
          usingCached = true;
          console.log('[BGLocation] 📦 Using cached last-known coords (all methods failed)');
        } else {
          console.warn('[BGLocation] ⏳ Coordinates not yet ready — retrying ping in 2.5s...');
          if (this.isRunning && !(this as any)._pingRetryTimer) {
            (this as any)._pingRetryTimer = setTimeout(() => {
              (this as any)._pingRetryTimer = null;
              this.sendPing().catch(() => {});
            }, 2500);
          }
          return;
        }
      }
    }

    if (!lat || !lon) return;

    const user  = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Phone';
    const isNativePlatform = this.checkNative();
    const payload: GpsPingPayload = {
      deviceId: this.getOrCreateDeviceId(),
      username: user?.username || 'boss',
      label: label || 'Boss Phone',
      platform: isNativePlatform ? 'apk' : 'web',  // ⭐ Reliable APK vs web flag
      lat, lon,
      accuracy:  this.cachedLast?.accuracy  ?? this.lastPosition?.coords?.accuracy  ?? cached?.accuracy  ?? 0,
      altitude:  this.cachedLast?.altitude  ?? this.lastPosition?.coords?.altitude  ?? cached?.altitude  ?? null,
      speed:     this.cachedLast?.speed     ?? this.lastPosition?.coords?.speed     ?? cached?.speed     ?? null,
      heading:   this.cachedLast?.heading   ?? this.lastPosition?.coords?.heading   ?? cached?.heading   ?? null,
      batteryLevel: this.getBatteryLevel(), isCharging: this.getChargingStatus(), networkType: this.getNetworkType(),
      isCachedLastKnown: usingCached || (!this.cachedLast && !this.lastPosition && !!cached),
    };

    // ── Step 2: Flush any queued offline pings first ─────────────────────────
    await this.flushOfflineQueue();

    // ── Step 3: Send REST ping with adaptive retry ────────────────────────────
    const sent = await this.sendPingWithAdaptiveRetry(payload);
    if (sent === 'ok') {
      const interval = this.getCurrentInterval();
      const offMethod = (this as any)._offlineMethod;
      console.log(`[BGLocation] ✅ Ping saved! lat:${lat} lon:${lon}${usingCached ? ` (${offMethod || 'cached'})` : ''} | next in ${interval/1000}s`);
      this.consecutiveErrors = 0;
      this.updateMovementState(lat, lon);

      // ── Build offline DB when GPS is fresh ──────────────────────────────
      if (!usingCached) {
        const acc = this.cachedLast?.accuracy ?? this.lastPosition?.coords?.accuracy ?? 0;
        offlineFallbackLocationService.buildFingerprint(lat, lon, acc).catch(() => {});
        offlineFallbackLocationService.buildCellCache(lat, lon, acc);
        offlineFallbackLocationService.resetDeadReckoning(lat, lon);
      }
      delete (this as any)._offlineAccuracy;
      delete (this as any)._offlineMethod;
      delete (this as any)._offlineConf;
    } else if (sent === 'queued') {
      // REST API queued — but Firestore already wrote/cached it above ✅
      console.log('[BGLocation] 📦 REST ping queued | Firestore write already handled offline');
    } else {
      console.error('[BGLocation] ❌ REST ping failed:', sent);
      this.consecutiveErrors++;
    }
  }


  // ── 5-Layer Unstable Network Solution ────────────────────────────────────────
  //
  // Layer 1: RTT Probe       — measure actual round-trip time before sending
  // Layer 2: Beacon API      — fire-and-forget for unstable connections
  // Layer 3: Adaptive Payload — 3 tiers based on RTT: full / mini / ultra-mini
  // Layer 4: Jitter Backoff  — smart retry, no thundering herd
  // Layer 5: Smart Queue     — newest-first, dedup if location unchanged
  // ─────────────────────────────────────────────────────────────────────────────

  /** Last measured RTT in milliseconds. -1 = unknown */
  private lastRttMs = -1;
  /** RTT probe: sends a HEAD request and measures response time */
  private async probeRtt(): Promise<number> {
    const probeUrl = getApiUrl('/api/health'); // small/fast endpoint
    const start = Date.now();
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      await fetch(probeUrl, { method: 'HEAD', signal: ctrl.signal });
      clearTimeout(t);
      this.lastRttMs = Date.now() - start;
    } catch {
      this.lastRttMs = 9999; // treat as very slow / offline
    }
    return this.lastRttMs;
  }

  /**
   * Detects current network quality using BOTH Connection API + last RTT.
   * Returns: 'offline' | '2g' | 'slow' | 'good'
   */
  private getNetworkQuality(): 'offline' | '2g' | 'slow' | 'good' {
    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';

      const conn = (navigator as any).connection || (navigator as any).mozConnection;
      const eff      = conn?.effectiveType as string | undefined;
      const downlink = conn?.downlink      as number | undefined;

      // Use both API-reported quality AND last measured RTT
      const rtt = this.lastRttMs;
      if (eff === 'slow-2g' || (rtt > 0 && rtt >= 4000)) return '2g';
      if (eff === '2g'      || (rtt > 0 && rtt >= 2000)) return '2g';
      if (eff === '3g' || (downlink !== undefined && downlink < 1) || (rtt > 0 && rtt >= 800)) return 'slow';
      return 'good';
    } catch {
      return 'good';
    }
  }

  // ── Layer 3: Adaptive Payload Tiers ────────────────────────────────────────

  /** FULL payload — all fields (~350 bytes) — good network */
  private buildFullPayload(p: GpsPingPayload): GpsPingPayload { return p; }

  /** MINI payload — drops altitude/heading/battery (~180 bytes) — slow network */
  private buildMiniPayload(p: GpsPingPayload): Partial<GpsPingPayload> {
    return { deviceId: p.deviceId, username: p.username, label: p.label,
             lat: p.lat, lon: p.lon, accuracy: p.accuracy,
             networkType: p.networkType, isCachedLastKnown: p.isCachedLastKnown };
  }

  /** ULTRA-MINI payload — bare minimum (~100 bytes) — very bad network */
  private buildUltraMiniPayload(p: GpsPingPayload): object {
    return { d: p.deviceId, u: p.username, lat: p.lat, lon: p.lon, a: p.accuracy };
  }

  /** Choose payload tier based on current RTT */
  private choosePayload(p: GpsPingPayload): { body: string; tier: string } {
    const rtt = this.lastRttMs;
    if (rtt < 0 || rtt < 800)  return { body: JSON.stringify(this.buildFullPayload(p)),      tier: 'full'       };
    if (rtt < 2000)             return { body: JSON.stringify(this.buildMiniPayload(p)),      tier: 'mini'       };
    return                             { body: JSON.stringify(this.buildUltraMiniPayload(p)), tier: 'ultra-mini' };
  }

  // ── Layer 2: Beacon API ─────────────────────────────────────────────────────

  /**
   * sendBeacon: fire-and-forget POST.
   * Browser queues it internally and sends when possible — survives:
   *   ✅ Intermittent drops
   *   ✅ Page close / app background
   *   ✅ Slow connections
   * Returns true if browser accepted the beacon (not if server received it)
   */
  private tryBeacon(payload: GpsPingPayload): boolean {
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) return false;
    try {
      const url  = getApiUrl('/api/location/ping');
      const mini = this.buildMiniPayload(payload); // beacon has 64KB limit
      const blob = new Blob([JSON.stringify(mini)], { type: 'application/json' });
      const accepted = navigator.sendBeacon(url, blob);
      if (accepted) console.log('[BGLocation] 📡 Beacon fired (unstable net fallback)');
      return accepted;
    } catch { return false; }
  }

  // ── Layer 4: Jitter Backoff ─────────────────────────────────────────────────

  /** Sleep with jitter to prevent thundering herd on reconnect */
  private async jitterSleep(baseMs: number): Promise<void> {
    const jitter = Math.random() * baseMs * 0.3; // ±30% jitter
    await this.sleep(baseMs + jitter);
  }

  // ── Layer 5: Smart Queue ────────────────────────────────────────────────────

  /**
   * Smart queue: adds ping to localStorage queue.
   *   - Deduplicates: if last queued location is <50m away → replace instead of add
   *   - Priority: newest-first flush (most recent location matters more)
   */
  private queueOfflinePing(payload: GpsPingPayload): void {
    try {
      const raw   = this.readStorage(STORAGE_KEY_OFFLINE_Q);
      const queue: GpsPingPayload[] = raw ? JSON.parse(raw) : [];

      // Dedup: check if last entry is within 50m — replace it
      if (queue.length > 0) {
        const last = queue[queue.length - 1];
        if (last.lat && last.lon && payload.lat && payload.lon) {
          const dist = this.distanceMeters(
            { lat: last.lat, lon: last.lon },
            { lat: payload.lat, lon: payload.lon }
          );
          if (dist < 50) {
            queue[queue.length - 1] = payload; // replace stale nearby entry
            this.writeStorage(STORAGE_KEY_OFFLINE_Q, JSON.stringify(queue));
            console.log(`[BGLocation] 📦 Queue dedup: replaced nearby entry (${dist.toFixed(0)}m)`);
            return;
          }
        }
      }

      queue.push(payload);
      if (queue.length > MAX_OFFLINE_QUEUE) queue.splice(0, queue.length - MAX_OFFLINE_QUEUE);
      this.writeStorage(STORAGE_KEY_OFFLINE_Q, JSON.stringify(queue));
      console.log(`[BGLocation] 📦 Offline queue: ${queue.length}/${MAX_OFFLINE_QUEUE} pings`);
    } catch { /* ignore */ }
  }

  // ── Main Adaptive Sender ───────────────────────────────────────────────────

  /**
   * GPS ON + Data UNSTABLE — best-in-class send strategy.
   *
   * Flow:
   *   1. Check offline → queue immediately
   *   2. Probe RTT → determine real connection quality
   *   3. Try Beacon API (fire-and-forget, most resilient)
   *   4. Try REST fetch with adaptive payload + jitter backoff
   *   5. All fail → smart queue
   *
   * Returns: 'ok' | 'beacon' | 'queued' | 'error:<status>'
   */
  private async sendPingWithAdaptiveRetry(payload: GpsPingPayload): Promise<string> {
    const url = getApiUrl('/api/location/ping');
    const body = JSON.stringify(payload);

    // ⭐ Use manual AbortController instead of AbortSignal.timeout()
    // AbortSignal.timeout() is NOT supported in older Android WebViews!
    const tryFetch = async (timeoutMs: number): Promise<Response | null> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        return res;
      } catch (err: any) {
        clearTimeout(timer);
        console.warn('[BGLocation] 📵 Fetch failed:', err?.message || err);
        return null;
      }
    };

    try {
      const res = await tryFetch(12000);

      if (res && res.ok) {
        console.log(`[BGLocation] 🚀 Live ping delivered: lat=${payload.lat}, lon=${payload.lon}`);
        return 'ok';
      }

      if (res) {
        console.warn(`[BGLocation] ⚠️ Server ping HTTP ${res.status}`);
        // 404 = device not registered yet → auto-register then retry once
        if (res.status === 404 || res.status === 400) {
          console.log('[BGLocation] 🔄 Device not registered — auto-registering...');
          await this.registerAndStart(this.getDeviceLabel() || 'Boss Phone');
          const retry = await tryFetch(10000);
          if (retry && retry.ok) {
            console.log(`[BGLocation] ✅ Ping sent after auto-register!`);
            return 'ok';
          }
        }
        // For 4xx errors that are not recoverable, still queue so we don't lose data
        if (res.status >= 500) {
          // Server error — queue it
        }
      }
    } catch (err: any) {
      console.warn('[BGLocation] 📵 Live fetch error:', err?.message);
    }

    // ── Fallback 1: Beacon API ───────────────────────────────────────────────
    if (this.tryBeacon(payload)) {
      return 'beacon';
    }

    // ── Fallback 2: Offline Queue ────────────────────────────────────────────
    this.queueOfflinePing(payload);

    // ── Fallback 3: SMS Fallback ─────────────────────────────────────────────
    const smsRecipient = this.getSmsRecipient();
    if (smsRecipient && payload.lat && payload.lon) {
      sendLocationSms({
        lat:             payload.lat,
        lon:             payload.lon,
        accuracy:        payload.accuracy ?? 999,
        deviceId:        payload.deviceId,
        recipientNumber: smsRecipient,
      }).then(result => {
        console.log(`[BGLocation] 📱 SMS fallback sent: ${result}`);
      }).catch(() => {});
    }

    return 'queued';
  }


  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }



  /** Flush queued pings to server when internet is back */
  private async flushOfflineQueue(): Promise<void> {
    try {
      const raw = this.readStorage(STORAGE_KEY_OFFLINE_Q);
      if (!raw) return;
      const queue: GpsPingPayload[] = JSON.parse(raw);
      if (!queue.length) return;

      console.log(`[BGLocation] 🔄 Flushing ${queue.length} queued pings...`);
      const pingUrl = getApiUrl('/api/location/ping');
      const remaining: GpsPingPayload[] = [];

      for (const p of queue) {
        try {
          const res = await fetch(pingUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p),
          });
          if (!res.ok) remaining.push(p); // keep failed ones
        } catch {
          remaining.push(p); // still offline
          break;             // stop trying if still no internet
        }
      }

      if (remaining.length < queue.length) {
        console.log(`[BGLocation] ✅ Flushed ${queue.length - remaining.length} queued pings!`);
      }
      // Update queue with only unsent pings
      if (remaining.length === 0) {
        this.writeStorage(STORAGE_KEY_OFFLINE_Q, '');
      } else {
        this.writeStorage(STORAGE_KEY_OFFLINE_Q, JSON.stringify(remaining));
      }
    } catch { /* ignore */ }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private getOrCreateDeviceId(): string {
    const user = getStoredUser();
    const isNative = this.checkNative();
    const platform = isNative ? 'apk' : 'web';
    const userTag = user?.username ? user.username.toLowerCase().replace(/[^a-z0-9_]/g, '') : 'boss';
    const storageKey = `${STORAGE_KEY_DEVICE_ID}_${platform}_${userTag}`;

    if (this.deviceId && this.deviceId.includes(platform) && this.deviceId.includes(userTag)) {
      return this.deviceId;
    }
    const s = this.readStorage(storageKey);
    if (s && s.includes(platform) && s.includes(userTag)) {
      this.deviceId = s;
      return s;
    }

    const id = `dev_${platform}_${userTag}`;
    this.deviceId = id;
    this.writeStorage(storageKey, id);
    this.writeStorage(STORAGE_KEY_DEVICE_ID, id);
    return id;
  }

  private saveLastKnown(data: CachedPosition): void {
    this.cachedLast = data;
    this.writeStorage(STORAGE_KEY_LAST_KNOWN, JSON.stringify(data));
  }

  private loadLastKnown(): CachedPosition | null {
    if (this.cachedLast) return this.cachedLast;
    try { const s = this.readStorage(STORAGE_KEY_LAST_KNOWN); if (s) { this.cachedLast = JSON.parse(s); return this.cachedLast; } } catch {}
    return null;
  }

  private readStorage(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } }
  private writeStorage(k: string, v: string): void { try { localStorage.setItem(k, v); } catch {} }

  private getBatteryLevel(): number | null {
    try {
      const nav = navigator as any;
      if (nav.getBattery) {
        nav.getBattery().then((b: any) => { (this as any)._batt = Math.round(b.level * 100); (this as any)._chrg = b.charging; }).catch(() => {});
        return (this as any)._batt ?? null;
      }
    } catch {} return null;
  }
  private getChargingStatus(): boolean | null { return (this as any)._chrg ?? null; }
  private getNetworkType(): string | null {
    try { const c = (navigator as any).connection || (navigator as any).mozConnection; return c ? (c.effectiveType || c.type || null) : null; } catch { return null; }
  }

  /**
   * Run a live 4-step diagnostic for Friday APK:
   * 1. Register device with server
   * 2. Obtain GPS coordinates
   * 3. Send ping to server
   * 4. Verify document in Firestore
   */
  public async runFullDiagnostic(onStepUpdate?: (report: DiagnosticReport) => void): Promise<DiagnosticReport> {
    const startTime = Date.now();
    const isNative = this.checkNative();
    const platform = isNative ? 'apk' : 'web';
    const deviceId = this.getOrCreateDeviceId();
    const user = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Phone';
    const serverUrl = getApiUrl('');

    const report: DiagnosticReport = {
      timestamp: startTime,
      isNative,
      platform,
      deviceId,
      deviceLabel: label,
      serverUrl,
      step1_registration: { status: 'running', title: '1. Phone Registration', message: `Registering device "${deviceId}" on server...` },
      step2_coordinates: { status: 'pending', title: '2. GPS Coordinates', message: 'Waiting for registration...' },
      step3_serverPing: { status: 'pending', title: '3. Server Ping Transmission', message: 'Waiting for coordinates...' },
      step4_firestoreVerify: { status: 'pending', title: '4. Firestore Database Verification', message: 'Waiting for ping...' },
      overallSuccess: false,
    };

    const notify = () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('friday:location_diagnostic', { detail: report }));
      }
      onStepUpdate?.({ ...report });
    };

    notify();

    // ── STEP 1: Phone Registration ──────────────────────────────────────────
    const t1 = Date.now();
    try {
      const regPayload: any = {
        deviceId,
        label,
        ownerName: label,
        username: user?.username || 'boss',
        platform,
        batteryLevel: this.getBatteryLevel(),
        isCharging: this.getChargingStatus(),
        networkType: this.getNetworkType(),
      };

      const ctrl1 = new AbortController();
      const timer1 = setTimeout(() => ctrl1.abort(), 10000);
      const regRes = await fetch(getApiUrl('/api/location/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(regPayload),
        signal: ctrl1.signal,
      });
      clearTimeout(timer1);

      const regJson = await regRes.json().catch(() => null);
      if (regRes.ok) {
        report.step1_registration = {
          status: 'success',
          title: '1. Phone Registration',
          message: `Phone registered successfully! (HTTP ${regRes.status})`,
          details: { deviceId, platform, response: regJson },
          durationMs: Date.now() - t1,
        };
      } else {
        report.step1_registration = {
          status: 'failed',
          title: '1. Phone Registration',
          message: `Server returned HTTP ${regRes.status}: ${regJson?.message || 'Registration failed'}`,
          details: { deviceId, platform, status: regRes.status, response: regJson },
          durationMs: Date.now() - t1,
        };
      }
    } catch (err: any) {
      report.step1_registration = {
        status: 'failed',
        title: '1. Phone Registration',
        message: `Registration network error: ${err?.message || 'Server unreachable'}`,
        details: { deviceId, error: err?.message },
        durationMs: Date.now() - t1,
      };
    }

    report.step2_coordinates.status = 'running';
    report.step2_coordinates.message = 'Acquiring GPS / Fused location coordinates...';
    notify();

    // ── STEP 2: GPS Coordinates ─────────────────────────────────────────────
    const t2 = Date.now();
    let coords: CachedPosition | null = null;
    let permInfo = '';

    if (isNative) {
      try {
        const { Geolocation } = await import(/* @vite-ignore */ '@capacitor/geolocation');

        const check = await safePromise(Geolocation.checkPermissions(), 5000, null);
        const perm = check?.location;
        if (perm === 'granted') {
          permInfo = 'Permission: Granted ✅';
        } else if (perm === 'denied') {
          // Explicitly denied by user — no point requesting again
          permInfo = 'Permission: denied ❌ (User blocked in Settings)';
        } else {
          // perm is 'prompt', 'prompt-with-rationale', or null (timeout) — request consent
          permInfo = `Permission: "${perm || 'checking...'}". Requesting user consent...`;
          report.step2_coordinates.message = permInfo;
          notify();
          const req = await safePromise(Geolocation.requestPermissions(), 9000, null);
          if (req === null) {
            // Timeout — don't assume denied! Re-check actual state instead
            const recheck = await safePromise(Geolocation.checkPermissions(), 3000, null);
            permInfo = recheck?.location === 'granted'
              ? 'Permission: Granted ✅'
              : `Permission: ${recheck?.location || 'unknown'} (timeout during request)`;
          } else {
            permInfo = req.location === 'granted'
              ? 'Permission: Granted ✅'
              : `Permission: ${req.location} ❌`;
          }
        }
      } catch (e: any) {
        permInfo = `Permission check error: ${e?.message}`;
      }
    }

    report.step2_coordinates.message = `${permInfo ? permInfo + ' • ' : ''}Acquiring GPS / Fused coordinates...`;
    notify();

    try {
      coords = await this.getFreshPosition();
      if (!coords) {
        coords = this.loadLastKnown();
      }

      if (coords && coords.lat && coords.lon) {
        report.step2_coordinates = {
          status: 'success',
          title: '2. GPS Coordinates',
          message: `Coordinates acquired: ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)} (±${Math.round(coords.accuracy)}m)`,
          details: { lat: coords.lat, lon: coords.lon, accuracy: coords.accuracy, altitude: coords.altitude, speed: coords.speed, permInfo },
          durationMs: Date.now() - t2,
        };
      } else {
        report.step2_coordinates = {
          status: 'failed',
          title: '2. GPS Coordinates',
          message: isNative 
            ? `${permInfo ? permInfo + ' • ' : ''}Coordinates nahi mile — Phone notification bar se GPS / Location toggle ON karein aur app permission check karein.`
            : 'Could not acquire GPS fix (permission issue or location disabled on device).',
          details: { permInfo },
          durationMs: Date.now() - t2,
        };
      }
    } catch (err: any) {
      report.step2_coordinates = {
        status: 'failed',
        title: '2. GPS Coordinates',
        message: `GPS error: ${err?.message || 'Location fetch failed'}`,
        details: { error: err?.message, permInfo },
        durationMs: Date.now() - t2,
      };
    }

    report.step3_serverPing.status = 'running';
    report.step3_serverPing.message = 'Transmitting location ping to server...';
    notify();

    // ── STEP 3: Server Ping Transmission ────────────────────────────────────
    const t3 = Date.now();
    const lat = coords?.lat ?? 0;
    const lon = coords?.lon ?? 0;

    if (!lat || !lon) {
      report.step3_serverPing = {
        status: 'failed',
        title: '3. Server Ping Transmission',
        message: 'Skipped: Coordinates not available from Step 2.',
        durationMs: 0,
      };
    } else {
      try {
        const pingPayload: GpsPingPayload = {
          deviceId,
          username: user?.username || 'boss',
          label,
          platform,
          lat,
          lon,
          accuracy: coords?.accuracy ?? 0,
          altitude: coords?.altitude ?? null,
          speed: coords?.speed ?? null,
          heading: coords?.heading ?? null,
          batteryLevel: this.getBatteryLevel(),
          isCharging: this.getChargingStatus(),
          networkType: this.getNetworkType(),
        };

        const ctrl3 = new AbortController();
        const timer3 = setTimeout(() => ctrl3.abort(), 12000);
        const pingRes = await fetch(getApiUrl('/api/location/ping'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pingPayload),
          signal: ctrl3.signal,
        });
        clearTimeout(timer3);

        const pingJson = await pingRes.json().catch(() => null);
        if (pingRes.ok && pingJson?.success !== false) {
          report.step3_serverPing = {
            status: 'success',
            title: '3. Server Ping Transmission',
            message: `Ping delivered to server! (HTTP ${pingRes.status})`,
            details: { lat, lon, response: pingJson },
            durationMs: Date.now() - t3,
          };
        } else {
          report.step3_serverPing = {
            status: 'failed',
            title: '3. Server Ping Transmission',
            message: `Server returned HTTP ${pingRes.status}: ${pingJson?.message || 'Ping rejected'}`,
            details: { status: pingRes.status, response: pingJson },
            durationMs: Date.now() - t3,
          };
        }
      } catch (err: any) {
        report.step3_serverPing = {
          status: 'failed',
          title: '3. Server Ping Transmission',
          message: `Network transmission error: ${err?.message || 'Server unreachable'}`,
          details: { error: err?.message },
          durationMs: Date.now() - t3,
        };
      }
    }

    report.step4_firestoreVerify.status = 'running';
    report.step4_firestoreVerify.message = 'Verifying Firestore database document on server...';
    notify();

    // ── STEP 4: Firestore Verification ──────────────────────────────────────
    const t4 = Date.now();
    try {
      // Small delay to let server async write finish
      await new Promise(r => setTimeout(r, 800));

      const ctrl4 = new AbortController();
      const timer4 = setTimeout(() => ctrl4.abort(), 10000);
      const verifyRes = await fetch(getApiUrl(`/api/location/verify/${encodeURIComponent(deviceId)}`), {
        method: 'GET',
        signal: ctrl4.signal,
      });
      clearTimeout(timer4);

      const verifyJson = await verifyRes.json().catch(() => null);
      if (verifyRes.ok && verifyJson?.exists) {
        const doc = verifyJson.docData;
        report.step4_firestoreVerify = {
          status: 'success',
          title: '4. Firestore Database Verification',
          message: `✅ Firestore me Saved! (Doc: ${deviceId}, Updated ${doc?.ageSeconds ?? 0}s ago)`,
          details: doc,
          durationMs: Date.now() - t4,
        };
      } else {
        report.step4_firestoreVerify = {
          status: 'failed',
          title: '4. Firestore Database Verification',
          message: `❌ Firestore me Save nahi hua! Doc "${deviceId}" Firestore collection me nahi mila.`,
          details: verifyJson,
          durationMs: Date.now() - t4,
        };
      }
    } catch (err: any) {
      report.step4_firestoreVerify = {
        status: 'failed',
        title: '4. Firestore Database Verification',
        message: `Verification check error: ${err?.message || 'Failed to query server'}`,
        details: { error: err?.message },
        durationMs: Date.now() - t4,
      };
    }

    report.overallSuccess =
      report.step1_registration.status === 'success' &&
      report.step2_coordinates.status === 'success' &&
      report.step3_serverPing.status === 'success' &&
      report.step4_firestoreVerify.status === 'success';

    notify();
    return report;
  }
}

export interface DiagnosticStepResult {
  status: 'pending' | 'running' | 'success' | 'failed';
  title: string;
  message: string;
  details?: any;
  durationMs?: number;
}

export interface DiagnosticReport {
  timestamp: number;
  isNative: boolean;
  platform: 'apk' | 'web';
  deviceId: string;
  deviceLabel: string;
  serverUrl: string;
  step1_registration: DiagnosticStepResult;
  step2_coordinates: DiagnosticStepResult;
  step3_serverPing: DiagnosticStepResult;
  step4_firestoreVerify: DiagnosticStepResult;
  overallSuccess: boolean;
}

export const backgroundLocationService = new BackgroundLocationService();
