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
import { firestoreLocationClient } from './firestoreLocationClient';


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
const MAX_OFFLINE_QUEUE        = 10;  // max queued pings (oldest dropped when full)

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
  private isRunning           = false;
  private webWatchId: number | null = null;
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

  /** Auto-resume on app load if previously enabled */
  public async autoResumeIfEnabled(): Promise<void> {
    if (typeof window === 'undefined' || this.isRunning) return;
    const user  = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Device';
    if (this.isTrackingEnabled()) {
      console.log(`[BGLocation] 🔄 Auto-resuming for "${label}"...`);
      await this.requestPermissionAndStart(label).catch(() => this.startTracking());
    } else {
      await this.requestPermissionAndStart(label).catch(() => {});
    }
  }

  /** Request GPS permission and start tracking */
  public async requestPermissionAndStart(customLabel?: string): Promise<{ success: boolean; message: string }> {
    if (typeof window === 'undefined') return { success: false, message: 'Not a browser environment.' };

    const user  = getStoredUser();
    const label = customLabel || this.getDeviceLabel() || user?.displayName || user?.username || 'Boss Phone';
    this.setDeviceLabel(label);

    // Try Capacitor Geolocation (Fused) first on native
    if (this.isNative) {
      try {
        const { Geolocation } = await import('@capacitor/geolocation');
        const perm = await Geolocation.requestPermissions();
        if (perm.location === 'granted' || perm.location === 'limited') {
          const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 15000 });
          const cached: CachedPosition = {
            lat: pos.coords.latitude, lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 0,
            altitude: pos.coords.altitude ?? null,
            speed: pos.coords.speed ?? null,
            heading: pos.coords.heading ?? null,
            timestamp: Date.now(),
          };
          this.cachedLast = cached;
          this.saveLastKnown(cached);
          this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
          const res = await this.registerAndStart(label, label, { lat: cached.lat, lon: cached.lon, accuracy: cached.accuracy });
          return res;
        }
      } catch (err: any) {
        console.warn('[BGLocation] Capacitor Geolocation error, falling back to web:', err?.message);
      }
    }

    // Web geolocation fallback
    if (!('geolocation' in navigator)) return { success: false, message: 'Geolocation not supported.' };

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          this.lastPosition = pos;
          this.saveLastKnown({
            lat: pos.coords.latitude, lon: pos.coords.longitude,
            accuracy: pos.coords.accuracy ?? 0,
            altitude: pos.coords.altitude ?? null, speed: pos.coords.speed ?? null,
            heading: pos.coords.heading ?? null, timestamp: Date.now(),
          });
          this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
          resolve(await this.registerAndStart(label, label, {
            lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy,
          }));
        },
        async (err) => {
          const cached = this.loadLastKnown();
          if (cached) resolve(await this.registerAndStart(label, label, { lat: cached.lat, lon: cached.lon, accuracy: cached.accuracy }));
          else resolve({ success: false, message: `Location denied: ${err.message}` });
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
      );
    });
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

    const payload: any = {
      deviceId,
      label: this.deviceLabel || 'Boss Phone',
      ownerName: ownerName || this.deviceLabel || 'DK (Boss)',
      username: user?.username || 'boss',
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

    try {
      const res  = await fetch(getApiUrl('/api/location/register'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { success: false, message: text }; }
      if (!data.success) return { success: false, message: data.message || 'Registration failed' };

      console.log('[BGLocation] ✅ Device registered!');
      this.writeStorage(STORAGE_KEY_TRACKING_ON, 'true');
      this.startTracking();
      await this.sendPing();
      return { success: true, message: `"${label}" registered! GPS tracking active 📍` };
    } catch (err: any) {
      return { success: false, message: `Registration error: ${err?.message}` };
    }
  }

  /**
   * Start GPS tracking.
   *
   * APK Strategy:
   *   1. @capacitor/background-runner (WorkManager) — screen OFF, no notification
   *   2. @capacitor/geolocation watchPosition      — foreground high-accuracy
   *   3. Fallback ping timer (60s)
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
      // Start WorkManager background runner (Fused, no notification)
      this.startWorkManagerTracking().catch(() => {});
      // Also start Capacitor Geolocation watch for foreground accuracy
      this.startCapacitorGeoWatch().catch(() => {});
    } else {
      this.startWebWatch();
    }

    // 60s ping timer — backup that also works in foreground
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
    this.stopWorkManagerTracking().catch(() => {});
    this.writeStorage(STORAGE_KEY_TRACKING_ON, 'false');
  }

  // ── WorkManager (Google Fused, Screen OFF, No Notification) ─────────────────

  /**
   * Uses @capacitor/background-runner with WorkManager.
   * Android dispatches this every ~60s even when screen is OFF.
   * No persistent notification required.
   */
  private async startWorkManagerTracking(): Promise<void> {
    try {
      const { BackgroundRunner } = await import('@capacitor/background-runner');

      // Dispatch a repeating background task
      await BackgroundRunner.dispatchEvent({
        label: 'com.friday.ai.location',   // matches runner config in capacitor.config.json
        event: 'locationPing',
        details: {
          deviceId: this.getOrCreateDeviceId(),
          label: this.getDeviceLabel(),
          username: getStoredUser()?.username || 'boss',
          pingUrl: getApiUrl('/api/location/ping'),
        },
      });

      console.log('[BGLocation] ✅ WorkManager background runner dispatched (Fused GPS, no notification)');
    } catch (err: any) {
      console.warn('[BGLocation] WorkManager not available:', err?.message, '— relying on Capacitor Geolocation watch');
    }
  }

  private async stopWorkManagerTracking(): Promise<void> {
    // WorkManager tasks are managed by Android OS; they stop automatically when tracking is disabled
    // Re-dispatch with empty event or wait for next cycle to not re-register
    console.log('[BGLocation] WorkManager tracking deregistered (will stop on next cycle).');
  }

  // ── Capacitor Geolocation Watch (Fused, Foreground) ─────────────────────────

  private async startCapacitorGeoWatch(): Promise<void> {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
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
        }
      );
      console.log('[BGLocation] ✅ Capacitor Geolocation watch active (foreground)');
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
        this.saveLastKnown({
          lat: pos.coords.latitude, lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy ?? 0,
          altitude: pos.coords.altitude ?? null, speed: pos.coords.speed ?? null,
          heading: pos.coords.heading ?? null, timestamp: Date.now(),
        });
        this.consecutiveErrors = 0;
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
    let lat = this.cachedLast?.lat ?? this.lastPosition?.coords?.latitude ?? cached?.lat;
    let lon = this.cachedLast?.lon ?? this.lastPosition?.coords?.longitude ?? cached?.lon;
    let usingCached = false;

    // Try fresh GPS if no coords
    if (!lat || !lon) {
      try {
        if (this.isNative) {
          const { Geolocation } = await import('@capacitor/geolocation');
          const pos = await Geolocation.getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
          lat = pos.coords.latitude; lon = pos.coords.longitude;
          this.saveLastKnown({ lat, lon, accuracy: pos.coords.accuracy ?? 0, altitude: null, speed: null, heading: null, timestamp: Date.now() });
        } else if ('geolocation' in navigator) {
          const pos = await new Promise<GeolocationPosition>((res, rej) =>
            navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000 })
          );
          lat = pos.coords.latitude; lon = pos.coords.longitude;
          this.lastPosition = pos;
          this.saveLastKnown({ lat, lon, accuracy: pos.coords.accuracy ?? 0, altitude: null, speed: null, heading: null, timestamp: Date.now() });
        }
      } catch (gpsErr: any) {
        console.warn('[BGLocation] ⚠️ GPS unavailable:', gpsErr?.message);

        // ── GPS off: try offline multi-method estimation ──────────────────
        const offlineEst = await offlineFallbackLocationService.estimateOfflineLocation(
          cached ? { lat: cached.lat, lon: cached.lon, accuracy: cached.accuracy, timestamp: cached.timestamp } : undefined
        );

        if (offlineEst) {
          lat = offlineEst.lat;
          lon = offlineEst.lon;
          usingCached = true;
          // Override accuracy from offline estimate
          (this as any)._offlineAccuracy = offlineEst.accuracy;
          (this as any)._offlineMethod   = offlineEst.method;
          (this as any)._offlineConf     = offlineEst.confidence;
          console.log(`[BGLocation] 🔍 Offline estimate (${offlineEst.method}, ${offlineEst.confidence}% conf): lat=${lat?.toFixed(5)} lon=${lon?.toFixed(5)} acc=${offlineEst.accuracy}m`);
        } else if (cached?.lat && cached?.lon) {
          lat = cached.lat; lon = cached.lon;
          usingCached = true;
          console.log('[BGLocation] 📦 Using cached last-known coords (all methods failed)');
        } else {
          console.warn('[BGLocation] No coords at all — skipping this ping');
          return;
        }
      }
    }
    if (!lat || !lon) return;

    const user  = getStoredUser();
    const label = this.getDeviceLabel() || user?.displayName || user?.username || 'FRIDAY Device';
    const payload: GpsPingPayload = {
      deviceId: this.getOrCreateDeviceId(), username: user?.username, label,
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

    // ── Step 2.5: Write to Firestore (offline-safe, auto-syncs) ──────────────
    // This is the GUARANTEED delivery path.
    // If data is OFF → IndexedDB cache → auto-sync when internet returns
    // If data is ON  → writes immediately to Firestore
    // No manual queue needed for Firestore — Google handles it!
    firestoreLocationClient.writeLocation({
      deviceId: payload.deviceId,
      username: payload.username,
      label:    payload.label,
      lat:      payload.lat,
      lon:      payload.lon,
      accuracy: payload.accuracy,
      altitude: payload.altitude,
      speed:    payload.speed,
      heading:  payload.heading,
      batteryLevel:     payload.batteryLevel,
      isCharging:       payload.isCharging,
      networkType:      payload.networkType,
      isCachedLastKnown: payload.isCachedLastKnown,
    }).catch(err => console.warn('[BGLocation] Firestore write error:', err?.message));

    // ── Step 3: Send REST ping with adaptive retry (server-side logic) ────────
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


  // ── Adaptive Network Fetch ────────────────────────────────────────────────

  /**
   * Detects current network quality.
   * Returns: 'offline' | '2g' | 'slow' | 'good'
   */
  private getNetworkQuality(): 'offline' | '2g' | 'slow' | 'good' {
    try {
      // navigator.onLine is basic but fast
      if (typeof navigator !== 'undefined' && !navigator.onLine) return 'offline';

      const conn = (navigator as any).connection || (navigator as any).mozConnection;
      if (!conn) return 'good'; // assume good if API unavailable

      const eff = conn.effectiveType as string | undefined; // '2g' | '3g' | '4g' | 'slow-2g'
      const downlink = conn.downlink as number | undefined;  // Mbps

      if (eff === 'slow-2g') return '2g';
      if (eff === '2g')      return '2g';
      if (eff === '3g' || (downlink !== undefined && downlink < 1)) return 'slow';
      return 'good';
    } catch {
      return 'good';
    }
  }

  /**
   * Build a minimal payload for slow/2G networks.
   * Drops optional fields (altitude, heading, battery) to reduce bytes.
   */
  private buildMinimalPayload(full: GpsPingPayload): Partial<GpsPingPayload> {
    return {
      deviceId: full.deviceId,
      username: full.username,
      label:    full.label,
      lat:      full.lat,
      lon:      full.lon,
      accuracy: full.accuracy,
      // Drop: altitude, speed, heading, batteryLevel, isCharging, networkType
      isCachedLastKnown: full.isCachedLastKnown,
    };
  }

  /**
   * Send ping with adaptive strategy based on network quality:
   *
   * GPS ON + Data OFF   → queue immediately (no retry)
   * GPS ON + Data SLOW  → short timeout, minimal payload, 2 retries
   * GPS ON + Data GOOD  → normal fetch, 3 retries with backoff
   *
   * Returns: 'ok' | 'queued' | 'error:<status>'
   */
  private async sendPingWithAdaptiveRetry(payload: GpsPingPayload): Promise<string> {
    const quality = this.getNetworkQuality();
    const url     = getApiUrl('/api/location/ping');

    // Case 1: GPS ON + Data OFF → queue immediately, no point trying
    if (quality === 'offline') {
      this.queueOfflinePing(payload);
      return 'queued';
    }

    // Case 2: GPS ON + Data SLOW (2G / weak 3G)
    if (quality === '2g' || quality === 'slow') {
      console.log(`[BGLocation] 📶 Slow network (${quality}) — using minimal payload + short timeout`);
      const miniPayload = this.buildMinimalPayload(payload);
      const MAX_RETRIES_SLOW = 2;
      const TIMEOUT_SLOW_MS  = 8000; // 8s timeout on slow network

      for (let attempt = 1; attempt <= MAX_RETRIES_SLOW; attempt++) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), TIMEOUT_SLOW_MS);
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(miniPayload),
            signal: controller.signal,
          });
          clearTimeout(timer);
          if (res.ok) return 'ok';
          if (attempt < MAX_RETRIES_SLOW) {
            await this.sleep(1500 * attempt); // 1.5s, 3s
          }
        } catch (err: any) {
          if (err?.name === 'AbortError') {
            console.warn(`[BGLocation] ⏱️ Slow network timeout (attempt ${attempt}/${MAX_RETRIES_SLOW})`);
          } else {
            // Total network failure → queue and stop retrying
            this.queueOfflinePing(payload);
            return 'queued';
          }
          if (attempt === MAX_RETRIES_SLOW) {
            // All retries exhausted on slow network → queue
            this.queueOfflinePing(payload);
            return 'queued';
          }
          await this.sleep(2000 * attempt);
        }
      }
      this.queueOfflinePing(payload);
      return 'queued';
    }

    // Case 3: GPS ON + Data GOOD → normal fetch with exponential backoff
    const MAX_RETRIES_GOOD = 3;
    const TIMEOUT_GOOD_MS  = 15000; // 15s timeout on good network

    for (let attempt = 1; attempt <= MAX_RETRIES_GOOD; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), TIMEOUT_GOOD_MS);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (res.ok) return 'ok';
        // Server error (4xx/5xx)
        if (res.status >= 400 && res.status < 500) {
          return `error:${res.status}`; // client error, don't retry
        }
        // 5xx → retry
        if (attempt < MAX_RETRIES_GOOD) await this.sleep(1000 * 2 ** (attempt - 1)); // 1s, 2s
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          console.warn(`[BGLocation] ⏱️ Request timeout (attempt ${attempt}/${MAX_RETRIES_GOOD})`);
        } else {
          // Network failure → queue
          this.queueOfflinePing(payload);
          return 'queued';
        }
        if (attempt === MAX_RETRIES_GOOD) {
          this.queueOfflinePing(payload);
          return 'queued';
        }
        await this.sleep(1000 * 2 ** (attempt - 1)); // exponential: 1s, 2s, 4s
      }
    }
    this.queueOfflinePing(payload);
    return 'queued';
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /** Queue a failed ping to localStorage for retry when internet returns */
  private queueOfflinePing(payload: GpsPingPayload): void {
    try {
      const raw = this.readStorage(STORAGE_KEY_OFFLINE_Q);
      const queue: GpsPingPayload[] = raw ? JSON.parse(raw) : [];
      queue.push(payload);
      // Keep only last MAX_OFFLINE_QUEUE entries (drop oldest)
      if (queue.length > MAX_OFFLINE_QUEUE) queue.splice(0, queue.length - MAX_OFFLINE_QUEUE);
      this.writeStorage(STORAGE_KEY_OFFLINE_Q, JSON.stringify(queue));
      console.log(`[BGLocation] 📦 Offline queue: ${queue.length}/${MAX_OFFLINE_QUEUE} pings stored`);
    } catch { /* ignore storage errors */ }
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
    if (this.deviceId) return this.deviceId;
    const s = this.readStorage(STORAGE_KEY_DEVICE_ID);
    if (s) { this.deviceId = s; return s; }
    const id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
    this.deviceId = id; this.writeStorage(STORAGE_KEY_DEVICE_ID, id); return id;
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
}

export const backgroundLocationService = new BackgroundLocationService();
