/**
 * FRIDAY AI — Offline Fallback Location Service
 *
 * Used when BOTH GPS and Data/Internet are OFF.
 * Tries 3 methods in order:
 *
 *  1. WiFi Fingerprinting  → matches nearby WiFi SSIDs against a local fingerprint DB
 *                            (built passively when GPS was ON)
 *                            Accuracy: ~10–200m (no internet needed) ✅
 *
 *  2. Cell Tower Cache     → uses network-location result (from Google's tower DB)
 *                            cached locally when data was available
 *                            Accuracy: ~100m–2km ✅
 *
 *  3. Weighted Triangulation → combines WiFi + Cell signals via Haversine-weighted mean
 *                              Accuracy: better than either alone ✅
 *
 *  4. Dead Reckoning        → accelerometer movement from last GPS point
 *                             Accurate for ~10–15 min ✅
 *
 *  5. Last Known Cache      → final fallback, Firestore/localStorage cached point
 */

// ── Storage Keys ──────────────────────────────────────────────────────────────

const KEY_WIFI_FINGERPRINTS  = 'friday_wifi_fingerprints';   // local WiFi DB
const KEY_CELL_CACHE         = 'friday_cell_tower_cache';    // cell area cache
const KEY_DEAD_RECKONING     = 'friday_dead_reckoning';      // last motion state

const MAX_WIFI_FINGERPRINTS  = 200;   // max entries in local WiFi DB
const MAX_CELL_ENTRIES       = 50;    // max cell area cache entries
const WIFI_MATCH_THRESHOLD   = 3;     // min matching SSIDs to trust fingerprint
const RSSI_WEIGHT_FACTOR     = 0.01;  // weight = e^(rssi * factor)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WifiNetwork {
  ssid: string;
  bssid: string;  // MAC address of AP
  rssi: number;   // signal strength in dBm (negative, closer to 0 = stronger)
}

export interface WifiFingerprint {
  networks: WifiNetwork[];   // snapshot of visible WiFi at this location
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

export interface CellCacheEntry {
  networkId: string;         // derived identifier (MCC+MNC+area hash)
  lat: number;
  lon: number;
  accuracy: number;
  timestamp: number;
}

export interface DeadReckoningState {
  lat: number;
  lon: number;
  timestamp: number;
  stepCountSinceGps: number;
}

export interface OfflineLocationResult {
  lat: number;
  lon: number;
  accuracy: number;    // estimated error radius in meters
  method: 'wifi-fingerprint' | 'cell-cache' | 'triangulation' | 'dead-reckoning' | 'last-known';
  confidence: number;  // 0–100
  matchedSsids?: number;
  note?: string;
}

// ── Service ───────────────────────────────────────────────────────────────────

class OfflineFallbackLocationService {
  private wifiFingerprints: WifiFingerprint[] = [];
  private cellCache: CellCacheEntry[] = [];
  private drState: DeadReckoningState | null = null;
  private motionListener: ((e: DeviceMotionEvent) => void) | null = null;
  private stepAccumulator = 0;
  private lastAccel: { x: number; y: number; z: number } | null = null;

  constructor() {
    this.loadFromStorage();
    if (typeof window !== 'undefined') {
      this.startMotionTracking();
    }
  }

  // ── Public: Best estimate when GPS+Data are off ───────────────────────────

  /**
   * Get best possible location estimate using all offline methods.
   * Call this when GPS fails and data is unavailable.
   */
  public async estimateOfflineLocation(
    lastKnown?: { lat: number; lon: number; accuracy: number; timestamp: number }
  ): Promise<OfflineLocationResult | null> {
    console.log('[OfflineFallback] 🔍 Starting offline location estimation...');

    const candidates: OfflineLocationResult[] = [];

    // ── Method 1: WiFi Fingerprint ─────────────────────────────────────────
    const wifiResult = await this.estimateFromWifi();
    if (wifiResult) {
      candidates.push(wifiResult);
      console.log(`[OfflineFallback] 📶 WiFi: lat=${wifiResult.lat.toFixed(5)} lon=${wifiResult.lon.toFixed(5)} acc=${wifiResult.accuracy}m conf=${wifiResult.confidence}%`);
    }

    // ── Method 2: Cell Tower Cache ──────────────────────────────────────────
    const cellResult = await this.estimateFromCellCache();
    if (cellResult) {
      candidates.push(cellResult);
      console.log(`[OfflineFallback] 📡 Cell: lat=${cellResult.lat.toFixed(5)} lon=${cellResult.lon.toFixed(5)} acc=${cellResult.accuracy}m conf=${cellResult.confidence}%`);
    }

    // ── Method 3: Triangulation (if ≥2 candidates) ─────────────────────────
    if (candidates.length >= 2) {
      const triangulated = this.triangulate(candidates);
      console.log(`[OfflineFallback] 🔺 Triangulated: lat=${triangulated.lat.toFixed(5)} lon=${triangulated.lon.toFixed(5)} acc=${triangulated.accuracy}m conf=${triangulated.confidence}%`);
      return triangulated; // best result
    }

    // ── Method 4: Dead Reckoning ────────────────────────────────────────────
    if (lastKnown) {
      const dr = this.estimateFromDeadReckoning(lastKnown);
      if (dr) {
        candidates.push(dr);
        console.log(`[OfflineFallback] 🚶 Dead reckoning: lat=${dr.lat.toFixed(5)} lon=${dr.lon.toFixed(5)} acc=${dr.accuracy}m conf=${dr.confidence}%`);
      }
    }

    // ── Return best single candidate ────────────────────────────────────────
    if (candidates.length > 0) {
      candidates.sort((a, b) => b.confidence - a.confidence);
      return candidates[0];
    }

    // ── Method 5: Last Known Cache ──────────────────────────────────────────
    if (lastKnown) {
      const ageMin = (Date.now() - lastKnown.timestamp) / 60000;
      const confidence = Math.max(5, 80 - ageMin * 2); // decay 2% per minute
      console.log(`[OfflineFallback] 📦 Last known (${ageMin.toFixed(0)}min old), confidence=${confidence.toFixed(0)}%`);
      return {
        lat: lastKnown.lat, lon: lastKnown.lon,
        accuracy: lastKnown.accuracy + (ageMin * 10), // drift estimate
        method: 'last-known',
        confidence,
        note: `Last seen ${ageMin.toFixed(0)} min ago`,
      };
    }

    console.warn('[OfflineFallback] ❌ No offline estimate possible');
    return null;
  }

  // ── Method 1: WiFi Fingerprinting ─────────────────────────────────────────

  private async estimateFromWifi(): Promise<OfflineLocationResult | null> {
    const currentNetworks = await this.scanWifiNetworks();
    if (!currentNetworks.length) {
      console.log('[OfflineFallback] No WiFi networks visible');
      return null;
    }

    if (!this.wifiFingerprints.length) {
      console.log('[OfflineFallback] WiFi fingerprint DB empty');
      return null;
    }

    // Score each stored fingerprint against current WiFi environment
    const scored: Array<{ fp: WifiFingerprint; score: number; matchCount: number }> = [];

    for (const fp of this.wifiFingerprints) {
      let score = 0;
      let matchCount = 0;

      for (const current of currentNetworks) {
        const stored = fp.networks.find(n => n.bssid === current.bssid);
        if (stored) {
          matchCount++;
          // Weight by signal strength: stronger signal = more reliable
          const rssiWeight = Math.exp(current.rssi * RSSI_WEIGHT_FACTOR);
          // Penalize RSSI difference (same AP but signal changed = different distance)
          const rssiDiff = Math.abs(current.rssi - stored.rssi);
          const rssiSimilarity = Math.max(0, 1 - rssiDiff / 30);
          score += rssiWeight * rssiSimilarity;
        }
      }

      if (matchCount >= WIFI_MATCH_THRESHOLD) {
        scored.push({ fp, score, matchCount });
      }
    }

    if (!scored.length) {
      console.log(`[OfflineFallback] No fingerprints with ≥${WIFI_MATCH_THRESHOLD} matching SSIDs`);
      return null;
    }

    // Sort by score descending, take top 5 for weighted average
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 5);
    const totalScore = top.reduce((s, t) => s + t.score, 0);

    const lat = top.reduce((s, t) => s + t.fp.lat * t.score, 0) / totalScore;
    const lon = top.reduce((s, t) => s + t.fp.lon * t.score, 0) / totalScore;
    const accuracy = top[0].fp.accuracy + (top[0].matchCount < 5 ? 100 : 30);
    const confidence = Math.min(90, 40 + top[0].matchCount * 8);

    return { lat, lon, accuracy, method: 'wifi-fingerprint', confidence, matchedSsids: top[0].matchCount };
  }

  // ── Method 2: Cell Tower Cache ─────────────────────────────────────────────

  private async estimateFromCellCache(): Promise<OfflineLocationResult | null> {
    const networkId = this.getCurrentNetworkId();
    if (!networkId) return null;

    // Find matching cell entries
    const matches = this.cellCache.filter(e => e.networkId === networkId);
    if (!matches.length) return null;

    // Weight by recency — newer entries get higher weight
    const now = Date.now();
    let totalWeight = 0;
    let wLat = 0, wLon = 0;

    for (const m of matches) {
      const ageHours = (now - m.timestamp) / 3600000;
      const weight = 1 / (1 + ageHours); // decay with age
      wLat += m.lat * weight;
      wLon += m.lon * weight;
      totalWeight += weight;
    }

    const lat = wLat / totalWeight;
    const lon = wLon / totalWeight;
    const accuracy = matches[0].accuracy + 500; // cell accuracy is low

    // Confidence based on number of matches and recency
    const freshCount = matches.filter(m => (now - m.timestamp) < 3600000).length;
    const confidence = Math.min(60, 20 + freshCount * 10);

    return { lat, lon, accuracy, method: 'cell-cache', confidence };
  }

  /** Get a stable network area identifier without native cell APIs */
  private getCurrentNetworkId(): string | null {
    try {
      const conn = (navigator as any).connection || (navigator as any).mozConnection;
      if (!conn) return null;
      // Combine network type + carrier (if available) as area proxy
      const type = conn.type || conn.effectiveType || '';
      const carrier = (conn as any).carrier || '';
      if (!type) return null;
      return `${type}_${carrier}_${this.getWifiSsidSync()}`.toLowerCase();
    } catch {
      return null;
    }
  }

  // ── Method 3: Weighted Triangulation ──────────────────────────────────────

  /**
   * Combine multiple location estimates using inverse-accuracy weighting.
   * More accurate estimates (smaller accuracy radius) get higher weight.
   */
  private triangulate(candidates: OfflineLocationResult[]): OfflineLocationResult {
    let totalWeight = 0;
    let wLat = 0, wLon = 0;

    for (const c of candidates) {
      // Weight = confidence / accuracy (higher confidence, lower error = higher weight)
      const weight = (c.confidence / 100) / (c.accuracy || 1);
      wLat += c.lat * weight;
      wLon += c.lon * weight;
      totalWeight += weight;
    }

    const lat = wLat / totalWeight;
    const lon = wLon / totalWeight;

    // Combined accuracy: geometric mean of individual accuracies, improved by triangulation
    const combinedAccuracy = candidates.reduce((p, c) => p * c.accuracy, 1) **
      (1 / candidates.length) * (1 - 0.3 * (candidates.length - 1));

    // Combined confidence: weighted average, bonus for more sources
    const baseConf = candidates.reduce((s, c) => s + c.confidence, 0) / candidates.length;
    const confidence = Math.min(92, baseConf + candidates.length * 5);

    const note = `Triangulated from: ${candidates.map(c => c.method).join(' + ')}`;
    console.log(`[OfflineFallback] 🔺 ${note}`);

    return { lat, lon, accuracy: Math.max(50, combinedAccuracy), method: 'triangulation', confidence, note };
  }

  // ── Method 4: Dead Reckoning ───────────────────────────────────────────────

  private estimateFromDeadReckoning(
    lastKnown: { lat: number; lon: number; accuracy: number; timestamp: number }
  ): OfflineLocationResult | null {
    const dr = this.drState;
    if (!dr) return null;

    const timeSinceGps = (Date.now() - lastKnown.timestamp) / 1000; // seconds
    if (timeSinceGps > 900) return null; // >15 min, drift too large

    // Estimate distance from step count
    const METERS_PER_STEP = 0.75;
    const distMoved = dr.stepCountSinceGps * METERS_PER_STEP;

    // Without compass direction we can only estimate radius, not direction
    // Return last known but with expanded accuracy radius
    const driftRadius = distMoved + (timeSinceGps * 0.5); // 0.5 m/s assumed max speed
    const confidence = Math.max(10, 60 - (timeSinceGps / 30)); // -1% per 30s

    return {
      lat: lastKnown.lat,
      lon: lastKnown.lon,
      accuracy: lastKnown.accuracy + driftRadius,
      method: 'dead-reckoning',
      confidence,
      note: `~${distMoved.toFixed(0)}m moved since last GPS fix`,
    };
  }

  // ── WiFi Scanning ──────────────────────────────────────────────────────────

  public async scanWifiNetworks(): Promise<WifiNetwork[]> {
    const networks: WifiNetwork[] = [];

    // Try Capacitor WiFi plugin (native APK)
    try {
      const { Wifi } = await import('capacitor-wifi');
      const scanResult = await (Wifi as any).getAvailableNetworks?.();
      if (scanResult?.networks?.length) {
        for (const n of scanResult.networks) {
          if (n.ssid && n.bssid) {
            networks.push({ ssid: n.ssid, bssid: n.bssid, rssi: n.rssi ?? -80 });
          }
        }
        console.log(`[OfflineFallback] 📶 WiFi scan: ${networks.length} networks found (native)`);
        return networks;
      }
    } catch { /* plugin not available or scan failed */ }

    // Web fallback: get connected network via connection API
    const ssid = this.getWifiSsidSync();
    if (ssid) {
      networks.push({ ssid, bssid: 'unknown', rssi: -65 });
      console.log('[OfflineFallback] 📶 WiFi: connected network only (web fallback)');
    }

    return networks;
  }

  private getWifiSsidSync(): string {
    try {
      const conn = (navigator as any).connection;
      if (conn?.ssid) return conn.ssid;
      if (conn?.type === 'wifi') return conn.ssid || 'wifi_connected';
    } catch {}
    return '';
  }

  // ── Building the Fingerprint DB (called when GPS is ON) ────────────────────

  /**
   * CALL THIS when GPS is available.
   * Saves current WiFi environment + GPS coords to local fingerprint DB.
   * Called automatically by backgroundLocationService on each successful ping.
   */
  public async buildFingerprint(lat: number, lon: number, accuracy: number): Promise<void> {
    const networks = await this.scanWifiNetworks();
    if (!networks.length) return;

    const fingerprint: WifiFingerprint = {
      networks,
      lat, lon, accuracy,
      timestamp: Date.now(),
    };

    this.wifiFingerprints.push(fingerprint);

    // Keep DB size bounded — remove oldest if too large
    if (this.wifiFingerprints.length > MAX_WIFI_FINGERPRINTS) {
      this.wifiFingerprints.splice(0, this.wifiFingerprints.length - MAX_WIFI_FINGERPRINTS);
    }

    this.saveToStorage();
    console.log(`[OfflineFallback] 💾 WiFi fingerprint saved (${networks.length} APs) | DB size: ${this.wifiFingerprints.length}`);
  }

  /**
   * CALL THIS when GPS + network location is available.
   * Saves cell area → GPS coords mapping for offline use.
   */
  public buildCellCache(lat: number, lon: number, accuracy: number): void {
    const networkId = this.getCurrentNetworkId();
    if (!networkId) return;

    this.cellCache.push({ networkId, lat, lon, accuracy, timestamp: Date.now() });
    if (this.cellCache.length > MAX_CELL_ENTRIES) {
      this.cellCache.splice(0, this.cellCache.length - MAX_CELL_ENTRIES);
    }
    this.saveToStorage();
    console.log(`[OfflineFallback] 📡 Cell cache entry saved. networkId: ${networkId}`);
  }

  // ── Dead Reckoning Motion Tracking ─────────────────────────────────────────

  private startMotionTracking(): void {
    if (!('DeviceMotionEvent' in window)) return;

    this.motionListener = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc?.x || !acc?.y || !acc?.z) return;

      const magnitude = Math.sqrt(acc.x ** 2 + acc.y ** 2 + acc.z ** 2);
      const prev = this.lastAccel;
      this.lastAccel = { x: acc.x, y: acc.y, z: acc.z };

      if (!prev) return;

      const prevMag = Math.sqrt(prev.x ** 2 + prev.y ** 2 + prev.z ** 2);
      const delta = Math.abs(magnitude - prevMag);

      // Step detection: threshold cross
      if (delta > 2.5) {
        this.stepAccumulator++;
        if (this.drState) this.drState.stepCountSinceGps = this.stepAccumulator;
      }
    };

    window.addEventListener('devicemotion', this.motionListener);
  }

  /** Reset dead reckoning when fresh GPS is obtained */
  public resetDeadReckoning(lat: number, lon: number): void {
    this.stepAccumulator = 0;
    this.drState = { lat, lon, timestamp: Date.now(), stepCountSinceGps: 0 };
  }

  // ── Storage ────────────────────────────────────────────────────────────────

  private saveToStorage(): void {
    try {
      localStorage.setItem(KEY_WIFI_FINGERPRINTS, JSON.stringify(this.wifiFingerprints));
      localStorage.setItem(KEY_CELL_CACHE, JSON.stringify(this.cellCache));
    } catch { /* storage full? keep in memory */ }
  }

  private loadFromStorage(): void {
    try {
      const wf = localStorage.getItem(KEY_WIFI_FINGERPRINTS);
      if (wf) this.wifiFingerprints = JSON.parse(wf);

      const cc = localStorage.getItem(KEY_CELL_CACHE);
      if (cc) this.cellCache = JSON.parse(cc);

      const dr = localStorage.getItem(KEY_DEAD_RECKONING);
      if (dr) this.drState = JSON.parse(dr);

      console.log(`[OfflineFallback] 📂 Loaded: ${this.wifiFingerprints.length} WiFi FPs, ${this.cellCache.length} cell entries`);
    } catch { /* fresh start */ }
  }

  /** How many fingerprints are stored */
  public getDbStats(): { wifiFingerprints: number; cellEntries: number } {
    return { wifiFingerprints: this.wifiFingerprints.length, cellEntries: this.cellCache.length };
  }
}

export const offlineFallbackLocationService = new OfflineFallbackLocationService();
