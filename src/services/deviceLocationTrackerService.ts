/**
 * FRIDAY AI — Family Device Live Location Tracker Service
 * Firestore-backed GPS tracking system for registered family devices.
 * 
 * Flow:
 * 1. Family member opens FRIDAY APK → device auto-registers with label (e.g., "Bhai")
 * 2. APK sends GPS ping every 60s to POST /api/location/ping
 * 3. Boss asks "bhai kahan hai?" via voice/WhatsApp
 * 4. This service fetches latest GPS from Firestore → reverse geocodes → returns formatted location
 */

import { db, FieldValue } from "./firebaseAdmin";

// ── Location Helpers ──────────────────────────────────────────────────────────
// Persistence layers (in order of priority):
//   1. Firestore  → primary DB, survives restarts, works for N users
//   2. RAM cache  → instant in-process queries, hydrated from Firestore on boot
//
// TG is NOT used for location persistence (single pinned msg = broken for multi-user,
// and conflicts with Memory Bot's existing pinned fact vault).

/** No-op: TG no longer used for location backup */
async function savePingToTelegram(_label: string, _lat: number, _lon: number, _address: string, _ts: number): Promise<void> {
  // Intentionally removed — Firestore + RAM cache is sufficient and correct.
}

/** Last-resort Firestore re-query if RAM cache miss (e.g. first query after cold boot before hydration finishes) */
async function fetchLocationFromTelegram(label: string): Promise<DeviceLocationEntry | null> {
  // Renamed for compat — now queries Firestore directly instead of TG
  try {
    const snap = await locationsCollection().get();
    if (snap.empty) return null;
    const lq = label.toLowerCase();
    const bossAliases = ["boss", "dk", "divakar", "mera", "me", "self", "apna", "owner"];
    const isBoss = !lq || bossAliases.some(a => lq === a || lq.includes(a));
    let best: DeviceLocationEntry | null = null;
    for (const doc of snap.docs) {
      const d = doc.data() as DeviceLocationEntry;
      if (!(d.lat && d.lon && !(d.lat === 0 && d.lon === 0))) continue;
      const dl = (d.label || "").toLowerCase();
      const du = (d.username || "").toLowerCase();
      const matched = dl.includes(lq) || du.includes(lq) ||
        (isBoss && (["boss","dk","divakar"].some(a => dl.includes(a) || du.includes(a))));
      if (matched || (isBoss && !best)) {
        if (!best || (d.lastUpdatedAt || 0) > (best.lastUpdatedAt || 0)) {
          best = d;
        }
      }
    }
    if (!best && isBoss && snap.size >= 1) {
      const all = snap.docs.map(d => d.data() as DeviceLocationEntry);
      all.sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));
      best = all[0];
    }
    return best;
  } catch {
    return null;
  }
}

// ── Interfaces ───────────────────────────────────────────────────────────────

export interface DeviceLocationEntry {
  deviceId: string;
  username?: string; // Linked User Profile (e.g. "boss", "bhai")
  label: string;
  ownerName: string;
  lat: number;
  lon: number;
  accuracy: number;
  altitude: number | null;
  speed: number | null;
  heading: number | null;
  address: string;
  lastUpdatedAt: number;
  registeredAt: number;
  batteryLevel: number | null;
  isCharging: boolean | null;
  networkType: string | null;
  isCachedLastKnown?: boolean;
}

export interface LocationQueryResult {
  success: boolean;
  deviceId?: string;
  username?: string;
  label?: string;
  ownerName?: string;
  lat?: number;
  lon?: number;
  accuracy?: number;
  address?: string;
  googleMapsUrl?: string;
  lastUpdatedAt?: number;
  lastUpdatedAgo?: string;
  batteryLevel?: number | null;
  isCharging?: boolean | null;
  networkType?: string | null;
  isCached?: boolean;
  message: string;
}

// ── Firestore Collection ─────────────────────────────────────────────────────

const locationsCollection = () => db.collection("device_locations");

// ── Reverse Geocoding Cache (In-memory, avoids hammering Nominatim) ──────────

interface GeocodeCacheEntry {
  address: string;
  timestamp: number;
}

const geocodeCache = new Map<string, GeocodeCacheEntry>();
const GEOCODE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_LOCATION_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours - location considered stale
const MAX_CACHED_LOCATION_AGE_MS = 48 * 60 * 60 * 1000; // 48 hours - cached position valid up to this age

// ── ⭐ Server-side RAM cache (zero-latency fallback when Firestore fails) ─────
// Key = label.toLowerCase() (e.g. "boss phone", "bhai")
// Updated on every successful ping — no external dependency needed
const locationRamCache = new Map<string, DeviceLocationEntry>();

function updateRamCache(entry: DeviceLocationEntry): void {
  const keys = new Set<string>();
  if (entry.label)     keys.add(entry.label.toLowerCase());
  if (entry.ownerName) keys.add(entry.ownerName.toLowerCase());
  if (entry.username)  keys.add(entry.username.toLowerCase());
  if (entry.deviceId)  keys.add(entry.deviceId.toLowerCase());
  for (const k of keys) locationRamCache.set(k, entry);
  console.log(`[LocationTracker] 🗂️ RAM cache updated for keys: ${[...keys].join(", ")}`);
}

function getRamCacheEntry(rawQuery: string): DeviceLocationEntry | null {
  const q = rawQuery.toLowerCase();
  // Direct match
  if (locationRamCache.has(q)) return locationRamCache.get(q)!;
  // Boss/self aliases
  const bossAliases = ["boss", "dk", "divakar", "mera", "me", "self", "apna", "owner", "admin"];
  const isBossQuery = !q || bossAliases.some(a => q === a || q.includes(a));
  if (isBossQuery) {
    let bestBossEntry: DeviceLocationEntry | null = null;
    for (const [key, entry] of locationRamCache) {
      if (["boss", "dk", "divakar"].some(a => key.includes(a))) {
        if (!bestBossEntry || (entry.lastUpdatedAt || 0) > (bestBossEntry.lastUpdatedAt || 0)) {
          bestBossEntry = entry;
        }
      }
    }
    if (bestBossEntry) return bestBossEntry;
    // If only one or multiple devices cached, return the most recent one
    if (locationRamCache.size > 0) {
      const all = [...locationRamCache.values()];
      all.sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));
      return all[0];
    }
  }
  // Partial match
  let bestPartial: DeviceLocationEntry | null = null;
  for (const [key, entry] of locationRamCache) {
    if (key.includes(q) || q.includes(key)) {
      if (!bestPartial || (entry.lastUpdatedAt || 0) > (bestPartial.lastUpdatedAt || 0)) {
        bestPartial = entry;
      }
    }
  }
  return bestPartial;
}


// ── Service Class ────────────────────────────────────────────────────────────

class DeviceLocationTrackerService {

  constructor() {
    // On server boot → hydrate RAM cache from ALL persistence layers
    this.hydrateRamCacheOnBoot().catch(() => {});
  }

  /** Boot hydration: Firestore (primary) → TG pinned vault (fallback) */
  private async hydrateRamCacheOnBoot(): Promise<void> {
    let hydratedFromFirestore = false;

    // 1️⃣ Try Firestore first
    try {
      const snap = await locationsCollection().orderBy("lastUpdatedAt", "desc").get();
      if (!snap.empty) {
        let count = 0;
        for (const doc of snap.docs) {
          const d = doc.data() as DeviceLocationEntry;
          const hasCoords = d.lat && d.lon && !(d.lat === 0 && d.lon === 0);
          if (hasCoords) {
            updateRamCache(d);
            count++;
          }
        }
        if (count > 0) {
          console.log(`[LocationTracker] 🔥 Boot hydration: ${count} device(s) loaded from Firestore into RAM cache`);
          hydratedFromFirestore = true;
        }
      }
    } catch (err: any) {
      console.warn("[LocationTracker] Firestore boot hydration failed:", err?.message || err);
    }

    // 2️⃣ TG vault as fallback (or supplement) if Firestore had no valid data
    if (!hydratedFromFirestore) {
      await hydrateCacheFromTelegramVault();
    } else {
      // Still hydrate TG vault silently to keep vaultMessageId updated for future writes
      hydrateCacheFromTelegramVault().catch(() => {});
    }
  }

  /**
   * Register a new device for live location tracking.
   * Called when a family member opens FRIDAY APK and grants location permission.
   */
  public async registerDevice(
    deviceId: string,
    label: string,
    ownerName?: string,
    username?: string,
    initialCoords?: {
      lat: number;
      lon: number;
      accuracy?: number;
      altitude?: number | null;
      speed?: number | null;
      heading?: number | null;
      batteryLevel?: number | null;
      isCharging?: boolean | null;
      networkType?: string | null;
    }
  ): Promise<{ success: boolean; message: string; deviceId: string }> {
    const cleanLabel = (label || "Unknown Device").trim();
    const cleanOwner = (ownerName || cleanLabel).trim();
    const cleanUser = (username || "").trim().toLowerCase();
    const now = Date.now();

    try {
      let initialAddress = "Location not yet received";
      let hasValidCoords = false;

      if (initialCoords && initialCoords.lat !== undefined && initialCoords.lon !== undefined && (initialCoords.lat !== 0 || initialCoords.lon !== 0)) {
        try {
          initialAddress = await this.reverseGeocode(initialCoords.lat, initialCoords.lon);
          hasValidCoords = true;
        } catch {}
      }

      // Check if device already registered
      const existingDoc = await locationsCollection().doc(deviceId).get();
      if (existingDoc.exists) {
        // Update label/owner/username/coords if changed
        const updatePayload: any = {
          label: cleanLabel,
          ownerName: cleanOwner,
        };
        if (cleanUser) updatePayload.username = cleanUser;
        if (hasValidCoords && initialCoords) {
          updatePayload.lat = initialCoords.lat;
          updatePayload.lon = initialCoords.lon;
          updatePayload.accuracy = initialCoords.accuracy || 0;
          updatePayload.address = initialAddress;
          updatePayload.lastUpdatedAt = now;
          if (initialCoords.altitude !== undefined) updatePayload.altitude = initialCoords.altitude;
          if (initialCoords.speed !== undefined) updatePayload.speed = initialCoords.speed;
          if (initialCoords.heading !== undefined) updatePayload.heading = initialCoords.heading;
          if (initialCoords.batteryLevel !== undefined) updatePayload.batteryLevel = initialCoords.batteryLevel;
          if (initialCoords.isCharging !== undefined) updatePayload.isCharging = initialCoords.isCharging;
          if (initialCoords.networkType !== undefined) updatePayload.networkType = initialCoords.networkType;
        }
        await locationsCollection().doc(deviceId).update(updatePayload);
        console.log(`[LocationTracker] Device "${deviceId}" re-registered as "${cleanLabel}" (Coords: ${hasValidCoords ? "Updated" : "Preserved"})`);
        return {
          success: true,
          deviceId,
          message: `Device "${cleanLabel}" already registered, info updated.`,
        };
      }

      // New device registration
      const newDeviceData: any = {
        deviceId,
        label: cleanLabel,
        ownerName: cleanOwner,
        lat: hasValidCoords && initialCoords ? initialCoords.lat : 0,
        lon: hasValidCoords && initialCoords ? initialCoords.lon : 0,
        accuracy: hasValidCoords && initialCoords ? initialCoords.accuracy || 0 : 0,
        altitude: initialCoords?.altitude ?? null,
        speed: initialCoords?.speed ?? null,
        heading: initialCoords?.heading ?? null,
        address: initialAddress,
        lastUpdatedAt: hasValidCoords ? now : now,
        registeredAt: now,
        batteryLevel: initialCoords?.batteryLevel ?? null,
        isCharging: initialCoords?.isCharging ?? null,
        networkType: initialCoords?.networkType ?? null,
      };
      if (cleanUser) newDeviceData.username = cleanUser;

      await locationsCollection().doc(deviceId).set(newDeviceData);

      console.log(`[LocationTracker] Device "${deviceId}" registered as "${cleanLabel}" (Address: ${initialAddress})`);
      return {
        success: true,
        deviceId,
        message: `Device "${cleanLabel}" successfully registered for live tracking!`,
      };
    } catch (err: any) {
      console.error("[LocationTracker] Registration error:", err?.message || err);
      return {
        success: false,
        deviceId,
        message: `Registration failed: ${err?.message || "Unknown error"}`,
      };
    }
  }

  /**
   * Receive and store a GPS ping from a tracked device.
   * Called every 60 seconds by the client backgroundLocationService.
   */
  public async receivePing(data: {
    deviceId: string;
    username?: string;
    label?: string;
    lat: number;
    lon: number;
    accuracy?: number;
    altitude?: number | null;
    speed?: number | null;
    heading?: number | null;
    batteryLevel?: number | null;
    isCharging?: boolean | null;
    networkType?: string | null;
    isCachedLastKnown?: boolean;
  }): Promise<{ success: boolean; message: string }> {
    const { deviceId, lat, lon } = data;
    if (!deviceId || lat === undefined || lon === undefined) {
      return { success: false, message: "Missing deviceId, lat, or lon." };
    }

    // Validate coordinates
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return { success: false, message: "Invalid GPS coordinates." };
    }

    const now = Date.now();

    // ── Always save coordinates first, geocoding is best-effort ───────────
    const isCached = data.isCachedLastKnown === true;
    const fallbackAddress = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;

    // Build update payload with valid coords (guaranteed at this point)
    const updateData: any = {
      lat,
      lon,
      accuracy: data.accuracy || 0,
      altitude: data.altitude ?? null,
      speed: data.speed ?? null,
      heading: data.heading ?? null,
      address: fallbackAddress, // will be overwritten if geocoding succeeds
      lastUpdatedAt: now,
      isCachedLastKnown: isCached,
    };

    if (data.username) {
      updateData.username = data.username.toLowerCase().trim();
    }
    if (data.label) {
      updateData.label = data.label.trim();
    }

    // Only update battery/network if provided
    if (data.batteryLevel !== undefined) updateData.batteryLevel = data.batteryLevel;
    if (data.isCharging !== undefined) updateData.isCharging = data.isCharging;
    if (data.networkType !== undefined) updateData.networkType = data.networkType;

    try {
      // Save coordinates immediately so they're never lost
      await locationsCollection().doc(deviceId).set(updateData, { merge: true });
      console.log(`[LocationTracker] ✅ Ping saved: deviceId=${deviceId}, lat=${lat}, lon=${lon}`);
    } catch (err: any) {
      console.error("[LocationTracker] ❌ Firestore write FAILED for ping:", err?.message || err);
      // Even if Firestore fails, still update RAM cache so queries work!
    }

    // ⭐ Always update RAM cache immediately (works even if Firestore fails)
    updateRamCache({
      deviceId,
      label: (data.label || "Boss").trim(),
      ownerName: (data.label || "Boss").trim(),
      username: (data.username || "").toLowerCase(),
      lat, lon,
      accuracy: data.accuracy || 0,
      altitude: data.altitude ?? null,
      speed: data.speed ?? null,
      heading: data.heading ?? null,
      address: fallbackAddress,
      lastUpdatedAt: now,
      registeredAt: now,
      batteryLevel: data.batteryLevel ?? null,
      isCharging: data.isCharging ?? null,
      networkType: data.networkType ?? null,
      isCachedLastKnown: isCached,
    });

    // Async geocoding — update address in background (non-blocking)
    this.reverseGeocode(lat, lon).then(async (address) => {
      try {
        await locationsCollection().doc(deviceId).update({ address });
        // Also update RAM cache with real address
        updateRamCache({ ...locationRamCache.get(deviceId.toLowerCase()) ?? {}, deviceId, label: (data.label || "Boss").trim(), ownerName: (data.label || "Boss").trim(), username: (data.username || "").toLowerCase(), lat, lon, accuracy: data.accuracy || 0, altitude: data.altitude ?? null, speed: data.speed ?? null, heading: data.heading ?? null, address, lastUpdatedAt: now, registeredAt: now, batteryLevel: data.batteryLevel ?? null, isCharging: data.isCharging ?? null, networkType: data.networkType ?? null });
        savePingToTelegram((data.label || "Boss").trim(), lat, lon, address, now).catch(() => {});
      } catch { /* non-critical */ }
    }).catch(() => {
      // geocoding failed — still save to TG with coordinate-based address
      savePingToTelegram((data.label || "Boss").trim(), lat, lon, fallbackAddress, now).catch(() => {});
    });

    return { success: true, message: "Location ping received." };
  }

  /**
   * Get the latest known location of a device by username, label, owner name, or deviceId.
   * This is the main method called when Boss asks "bhai kahan hai?"
   */
  public async getDeviceLocation(personNameOrLabel: string): Promise<LocationQueryResult> {
    const rawQuery = (personNameOrLabel || "").trim().toLowerCase();
    const isSelfOrBoss =
      !rawQuery ||
      // NOTE: "location", "boss location", "live location" removed — they were too greedy
      // and caused "bhai ki location" to always resolve as Boss device.
      ["boss", "dk", "divakar", "mera", "meri", "me", "my", "khud", "self", "apna", "apni", "current", "admin", "owner"].some(
        (term) => rawQuery === term || rawQuery.includes(term)
      );

    try {
      // Search all tracked devices
      const allDocs = await locationsCollection().get();
      if (allDocs.empty) {
        return {
          success: false,
          message: "Abhi koi bhi device live tracking ke liye connect ya register nahi hai. Friday app ya web open karte hi GPS auto-start ho jata hai.",
        };
      }

      // If only 1 device registered, or if Boss/Self query, prioritize Boss device or single device
      let bestMatch: DeviceLocationEntry | null = null;
      let bestScore = 0;

      // Candidate tracking to prioritize the most recent active device
      interface Candidate {
        entry: DeviceLocationEntry;
        score: number;
        hasCoords: boolean;
        lastUpdatedAt: number;
      }

      const candidates: Candidate[] = [];

      for (const doc of allDocs.docs) {
        const data = doc.data() as DeviceLocationEntry;
        const username = (data.username || "").toLowerCase();
        const label = (data.label || "").toLowerCase();
        const owner = (data.ownerName || "").toLowerCase();
        const deviceId = (data.deviceId || "").toLowerCase();

        let score = 0;

        // If query is for Boss / Self
        if (isSelfOrBoss) {
          if (
            username.includes("boss") ||
            username.includes("dk") ||
            username.includes("divakar") ||
            label.includes("boss") ||
            label.includes("dk") ||
            label.includes("divakar") ||
            owner.includes("boss") ||
            owner.includes("dk") ||
            owner.includes("divakar")
          ) {
            score = 100;
          } else {
            // Registered device without explicit boss label
            score = 70;
          }
        }

        // Exact match
        if (username === rawQuery || label === rawQuery || owner === rawQuery || deviceId === rawQuery) {
          score = Math.max(score, 100);
        }

        // Partial/fuzzy match
        if (username.includes(rawQuery) || rawQuery.includes(username)) score = Math.max(score, 95);
        else if (label.includes(rawQuery) || rawQuery.includes(label)) score = Math.max(score, 80);
        else if (owner.includes(rawQuery) || rawQuery.includes(owner)) score = Math.max(score, 70);

        // Common Hindi terms mapping
        const hindiAliases: Record<string, string[]> = {
          boss: ["boss", "dk", "divakar", "mera", "meri", "me", "my", "khud", "self", "apna", "apni", "current", "admin", "owner", "phone", "mobile"],
          bhai: ["bhai", "brother", "bro", "bhaiya", "bhaiyya"],
          papa: ["papa", "father", "dad", "daddy", "pitaji", "abba", "abbu"],
          mummy: ["mummy", "mother", "mom", "maa", "amma", "ammi"],
          behen: ["behen", "sister", "sis", "didi", "behan"],
          wife: ["wife", "biwi", "patni", "mrs"],
          husband: ["husband", "pati", "hubby"],
        };

        for (const [, aliases] of Object.entries(hindiAliases)) {
          const queryMatchesAlias = aliases.some((a) => rawQuery.includes(a) || a.includes(rawQuery));
          const userMatchesAlias = username && aliases.some((a) => username.includes(a) || a.includes(username));
          const labelMatchesAlias = aliases.some((a) => label.includes(a) || a.includes(label));
          const ownerMatchesAlias = aliases.some((a) => owner.includes(a) || a.includes(owner));
          if (queryMatchesAlias && (userMatchesAlias || labelMatchesAlias || ownerMatchesAlias)) {
            score = Math.max(score, 85);
          }
        }

        if (score >= 50) {
          const hasCoords = Boolean(
            data.lat !== undefined &&
            data.lon !== undefined &&
            !(data.lat === 0 && data.lon === 0)
          );
          candidates.push({
            entry: data,
            score,
            hasCoords,
            lastUpdatedAt: data.lastUpdatedAt || 0,
          });
        }
      }

      // Sort candidates:
      // 1. Decisive score difference (>20) prioritizes matching person (e.g. "bhai" vs "boss")
      // 2. For matching devices (e.g. multiple Boss devices): The most recent ping ALWAYS wins!
      // 3. Prefer devices with valid coordinates
      candidates.sort((a, b) => {
        if (Math.abs(a.score - b.score) > 20) {
          return b.score - a.score;
        }
        // Both are matching candidates. Prioritize recency!
        const timeDiff = (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0);
        if (Math.abs(timeDiff) > 60000) { // >1 min difference: newer ping wins
          return timeDiff;
        }
        if (a.hasCoords !== b.hasCoords) {
          return a.hasCoords ? -1 : 1;
        }
        return b.score - a.score;
      });

      if (candidates.length > 0) {
        bestMatch = candidates[0].entry;
        bestScore = candidates[0].score;
      }

      // Check RAM cache: if RAM cache has a ping that is NEWER than bestMatch, use RAM cache!
      const ramEntry = getRamCacheEntry(rawQuery || (bestMatch?.label ?? "boss"));
      if (ramEntry && (ramEntry.lastUpdatedAt || 0) > (bestMatch?.lastUpdatedAt || 0)) {
        console.log(`[LocationTracker] ⚡ Newer ping found in RAM cache (${new Date(ramEntry.lastUpdatedAt).toISOString()}) vs Firestore (${bestMatch ? new Date(bestMatch.lastUpdatedAt).toISOString() : 'none'})`);
        bestMatch = ramEntry;
        bestScore = Math.max(bestScore, 95);
      }

      if (!bestMatch || bestScore < 50) {
        // List all registered devices
        const deviceLabels = allDocs.docs.map((d) => d.data().label || d.data().deviceId).join(", ");
        return {
          success: false,
          message: `"${personNameOrLabel}" naam ka koi device registered nahi mila. Registered devices: ${deviceLabels}`,
        };
      }

      // Check if device has never sent valid coordinates yet
      const ageMs = Date.now() - (bestMatch.lastUpdatedAt || 0);
      const isCached = bestMatch.isCachedLastKnown === true;
      const hasValidCoords = bestMatch.lat !== undefined && bestMatch.lon !== undefined &&
        !(bestMatch.lat === 0 && bestMatch.lon === 0);
      const hasValidAddress = bestMatch.address &&
        bestMatch.address !== "Location not yet received" &&
        bestMatch.address !== "0.0000, 0.0000";

      // If no valid coords AND no valid address → try RAM cache first, then TG
      if (!hasValidCoords && !hasValidAddress) {
        // 1️⃣ RAM cache (instant — always updated on every ping)
        const ramEntry = getRamCacheEntry(bestMatch.label || rawQuery || "boss");
        if (ramEntry && ramEntry.lat && ramEntry.lon && !(ramEntry.lat === 0 && ramEntry.lon === 0)) {
          console.log(`[LocationTracker] ✅ Serving from RAM cache for "${rawQuery}"`);
          bestMatch = ramEntry;
        } else {
          // 2️⃣ TG fallback (may not work if memory bot consumed updates)
          try {
            const tgEntry = await fetchLocationFromTelegram(bestMatch.label || rawQuery || "boss");
            if (tgEntry) {
              bestMatch = tgEntry;
            } else {
              return {
                success: false,
                deviceId: bestMatch.deviceId,
                label: bestMatch.label,
                ownerName: bestMatch.ownerName,
                message: `Boss, "${bestMatch.label || bestMatch.ownerName}" phone system me registered hai, lekin abhi tak live GPS coordinates sync nahi hue hain.\n\n📱 FRIDAY app/web open karein aur location permission dein — location turant update ho jayegi!`,
              };
            }
          } catch {
            return {
              success: false,
              message: `Boss, "${bestMatch.label || bestMatch.ownerName}" phone system me registered hai, lekin abhi tak live GPS coordinates sync nahi hue hain.\n\n📱 FRIDAY app/web open karein aur location permission dein — location turant update ho jayegi!`,
            };
          }
        }
      }

      // If we have valid coords but address is still fallback, use coords as address
      if (hasValidCoords && !hasValidAddress) {
        bestMatch.address = `${bestMatch.lat!.toFixed(5)}, ${bestMatch.lon!.toFixed(5)} (GPS coordinates)`;
      }

      // If we have cached position but no live GPS fix, check age
      if (!hasValidCoords && isCached) {
        if (ageMs > MAX_CACHED_LOCATION_AGE_MS) {
          return {
            success: false,
            deviceId: bestMatch.deviceId,
            label: bestMatch.label,
            ownerName: bestMatch.ownerName,
            message: `Boss, "${bestMatch.label || bestMatch.ownerName}" ka cached location bhi ${Math.floor(ageMs / (60*60*1000))} ghante purana hai. Device shayad offline hai ya GPS permission expire ho gayi hai.`,
          };
        }
        // Use cached position with note
        const cachedAddress = bestMatch.address || "Cached location";
        const googleMapsUrl = `https://www.google.com/maps?q=${bestMatch.lat},${bestMatch.lon}`;
        const batteryStr =
          bestMatch.batteryLevel !== null && bestMatch.batteryLevel !== undefined
            ? `🔋 ${bestMatch.batteryLevel}%${bestMatch.isCharging ? " (Charging)" : ""}`
            : "";
        const networkStr = bestMatch.networkType ? ` | 📡 ${bestMatch.networkType.toUpperCase()}` : "";

        // Format age
        const ageMinutes = Math.floor(ageMs / 60000);
        let lastUpdatedAgo: string;
        if (ageMinutes < 1) lastUpdatedAgo = "Abhi abhi (Just now)";
        else if (ageMinutes < 60) lastUpdatedAgo = `${ageMinutes} minute${ageMinutes > 1 ? "s" : ""} pehle`;
        else if (ageMinutes < 1440) lastUpdatedAgo = `${Math.floor(ageMinutes / 60)} ghante pehle`;
        else lastUpdatedAgo = `${Math.floor(ageMinutes / 1440)} din pehle`;

        const message =
          `📍 *${bestMatch.label || bestMatch.ownerName}* ki Location\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `🏠 *Address:*\n${cachedAddress}\n` +
          `\n` +
          `🌐 *Coordinates:*\n${bestMatch.lat.toFixed(6)}, ${bestMatch.lon.toFixed(6)}\n` +
          `\n` +
          `⏱️ *Last Updated:* ${lastUpdatedAgo}\n` +
          (batteryStr ? `${batteryStr}\n` : "") +
          (bestMatch.networkType ? `📡 *Network:* ${bestMatch.networkType.toUpperCase()}\n` : "") +
          `\n` +
          `📌 *Google Maps:*\n${googleMapsUrl}\n` +
          `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
          `ℹ️ _Cached location — Live GPS fix pending_`;

        return {
          success: true,
          deviceId: bestMatch.deviceId,
          label: bestMatch.label,
          ownerName: bestMatch.ownerName,
          lat: bestMatch.lat,
          lon: bestMatch.lon,
          accuracy: bestMatch.accuracy,
          address: cachedAddress,
          googleMapsUrl,
          lastUpdatedAt: bestMatch.lastUpdatedAt,
          lastUpdatedAgo,
          batteryLevel: bestMatch.batteryLevel,
          isCharging: bestMatch.isCharging,
          networkType: bestMatch.networkType,
          isCached: true,
          message,
        };
      }

      // Check if location is too old (stale > 24 hours)
      const ageMsLive = Date.now() - (bestMatch.lastUpdatedAt || 0);
      const ageMinutes = Math.floor(ageMsLive / 60000);
      const isStale = ageMsLive > STALE_LOCATION_THRESHOLD_MS;

      // Format "last updated ago" string
      let lastUpdatedAgo: string;
      if (ageMinutes < 1) lastUpdatedAgo = "Abhi abhi (Just now)";
      else if (ageMinutes < 60) lastUpdatedAgo = `${ageMinutes} minute${ageMinutes > 1 ? "s" : ""} pehle`;
      else if (ageMinutes < 1440) lastUpdatedAgo = `${Math.floor(ageMinutes / 60)} ghante pehle`;
      else lastUpdatedAgo = `${Math.floor(ageMinutes / 1440)} din pehle`;

      // Google Maps URL
      const googleMapsUrl = `https://www.google.com/maps?q=${bestMatch.lat},${bestMatch.lon}`;

      // Battery info
      const batteryStr =
        bestMatch.batteryLevel !== null && bestMatch.batteryLevel !== undefined
          ? `🔋 ${bestMatch.batteryLevel}%${bestMatch.isCharging ? " (Charging)" : ""}`
          : "";

      // Build message
      const staleWarning = isStale
        ? `\n⚠️ Warning: Yeh location ${lastUpdatedAgo} ki hai. Device shayad offline hai.`
        : "";

      const networkStr = bestMatch.networkType ? ` | 📡 ${bestMatch.networkType.toUpperCase()}` : "";

      const message =
        `📍 *${bestMatch.label || bestMatch.ownerName}* ki Live Location\n` +
        `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
        `🏠 *Address:*\n${bestMatch.address || "Address not available"}\n` +
        `\n` +
        `🌐 *Coordinates:*\n${bestMatch.lat.toFixed(6)}, ${bestMatch.lon.toFixed(6)}\n` +
        `\n` +
        `🎯 *Accuracy:* ${Math.round(bestMatch.accuracy || 0)} meters\n` +
        `⏱️ *Last Updated:* ${lastUpdatedAgo}\n` +
        (batteryStr ? `${batteryStr}\n` : "") +
        (bestMatch.networkType ? `📡 *Network:* ${bestMatch.networkType.toUpperCase()}\n` : "") +
        `\n` +
        `📌 *Google Maps:*\n${googleMapsUrl}` +
        (isStale ? `\n\n⚠️ _Warning: ${lastUpdatedAgo} ki location hai — device offline ho sakta hai_` : "");

      return {
        success: true,
        deviceId: bestMatch.deviceId,
        label: bestMatch.label,
        ownerName: bestMatch.ownerName,
        lat: bestMatch.lat,
        lon: bestMatch.lon,
        accuracy: bestMatch.accuracy,
        address: bestMatch.address,
        googleMapsUrl,
        lastUpdatedAt: bestMatch.lastUpdatedAt,
        lastUpdatedAgo,
        batteryLevel: bestMatch.batteryLevel,
        isCharging: bestMatch.isCharging,
        networkType: bestMatch.networkType,
        message,
      };
    } catch (firestoreErr: any) {
      console.error("[LocationTracker] ❌ Firestore getDeviceLocation failed:", firestoreErr?.message || firestoreErr);
      // ── Firestore completely failed → try Telegram fallback ──────────────
      try {
        const tgEntry = await fetchLocationFromTelegram(rawQuery || "boss");
        if (tgEntry) {
          const ageMs = Date.now() - (tgEntry.lastUpdatedAt || 0);
          const ageMinutes = Math.floor(ageMs / 60000);
          let lastUpdatedAgo: string;
          if (ageMinutes < 1) lastUpdatedAgo = "Abhi abhi";
          else if (ageMinutes < 60) lastUpdatedAgo = `${ageMinutes} min pehle`;
          else lastUpdatedAgo = `${Math.floor(ageMinutes / 60)} ghante pehle`;

          const googleMapsUrl = `https://www.google.com/maps?q=${tgEntry.lat},${tgEntry.lon}`;
          return {
            success: true,
            deviceId: tgEntry.deviceId,
            label: tgEntry.label,
            ownerName: tgEntry.ownerName,
            lat: tgEntry.lat,
            lon: tgEntry.lon,
            address: tgEntry.address,
            googleMapsUrl,
            lastUpdatedAt: tgEntry.lastUpdatedAt,
            lastUpdatedAgo,
            isCached: true,
            message:
              `📍 *${tgEntry.label}* ki Location _(Telegram Backup)_\n` +
              `━━━━━━━━━━━━━━━━━━━━━━━━\n` +
              `📮 *Address:* ${tgEntry.address}\n` +
              `⏱️ *Last seen:* ${lastUpdatedAgo}\n` +
              `\n🗺️ [Google Maps pe dekhein](${googleMapsUrl})\n` +
              `\n⚠️ _Firestore unavailable — Telegram backup se mila._`,
          };
        }
      } catch { /* TG also failed */ }

      return {
        success: false,
        message: `Location service temporarily unavailable. Firestore error: ${firestoreErr?.message || "Unknown"}`
      };
    }
  }

  /**
   * List all registered tracked devices with their latest known location.
   */
  public async listAllDevices(): Promise<{
    success: boolean;
    count: number;
    devices: Array<{
      deviceId: string;
      label: string;
      address: string;
      lastUpdatedAgo: string;
      lat: number;
      lon: number;
      batteryLevel: number | null;
    }>;
    message: string;
  }> {
    try {
      const allDocs = await locationsCollection().orderBy("lastUpdatedAt", "desc").get();
      const devices = allDocs.docs.map((doc) => {
        const d = doc.data() as DeviceLocationEntry;
        const ageMs = Date.now() - (d.lastUpdatedAt || 0);
        const ageMinutes = Math.floor(ageMs / 60000);
        let lastUpdatedAgo: string;
        if (ageMinutes < 1) lastUpdatedAgo = "Just now";
        else if (ageMinutes < 60) lastUpdatedAgo = `${ageMinutes}m ago`;
        else if (ageMinutes < 1440) lastUpdatedAgo = `${Math.floor(ageMinutes / 60)}h ago`;
        else lastUpdatedAgo = `${Math.floor(ageMinutes / 1440)}d ago`;

        return {
          deviceId: d.deviceId,
          label: d.label || d.ownerName || d.deviceId,
          address: d.address || "Unknown",
          lastUpdatedAgo,
          lat: d.lat,
          lon: d.lon,
          batteryLevel: d.batteryLevel,
        };
      });

      return {
        success: true,
        count: devices.length,
        devices,
        message: `${devices.length} device(s) registered for live tracking.`,
      };
    } catch (err: any) {
      console.error("[LocationTracker] List error:", err?.message || err);
      return {
        success: false,
        count: 0,
        devices: [],
        message: `Failed to list devices: ${err?.message || "Unknown error"}`,
      };
    }
  }

  /**
   * Reverse geocode coordinates to a human-readable address using Nominatim (OpenStreetMap).
   * Uses in-memory cache to avoid rate limiting.
   */
  private async reverseGeocode(lat: number, lon: number): Promise<string> {
    // Round to ~100m precision for caching
    const cacheKey = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    const cached = geocodeCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < GEOCODE_CACHE_TTL_MS) {
      return cached.address;
    }

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "FRIDAY-AI-LocationTracker/1.0",
          "Accept-Language": "en,hi",
        },
      });
      clearTimeout(timeout);

      if (!res.ok) {
        console.warn(`[LocationTracker] Nominatim returned HTTP ${res.status}`);
        return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
      }

      const data = await res.json();
      const address = data.display_name || `${lat.toFixed(4)}, ${lon.toFixed(4)}`;

      // Cache the result
      geocodeCache.set(cacheKey, { address, timestamp: Date.now() });

      // Cleanup old cache entries (keep max 500)
      if (geocodeCache.size > 500) {
        const keys = Array.from(geocodeCache.keys());
        for (let i = 0; i < 100; i++) geocodeCache.delete(keys[i]);
      }

      return address;
    } catch (err: any) {
      console.warn("[LocationTracker] Reverse geocode failed:", err?.message || err);
      return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
    }
  }

  /**
   * Remove a tracked device by deviceId or label.
   */
  public async removeDevice(deviceIdOrLabel: string): Promise<{ success: boolean; message: string }> {
    const query = (deviceIdOrLabel || "").trim();
    if (!query) return { success: false, message: "Device ID or label required." };

    try {
      // Try by exact deviceId first
      const doc = await locationsCollection().doc(query).get();
      if (doc.exists) {
        await locationsCollection().doc(query).delete();
        return { success: true, message: `Device "${query}" removed from tracking.` };
      }

      // Try by label
      const snap = await locationsCollection()
        .where("label", "==", query)
        .limit(1)
        .get();

      if (!snap.empty) {
        await snap.docs[0].ref.delete();
        return { success: true, message: `Device "${snap.docs[0].data().label}" removed from tracking.` };
      }

      return { success: false, message: `Device "${query}" not found.` };
    } catch (err: any) {
      return { success: false, message: `Remove failed: ${err?.message || "Unknown error"}` };
    }
  }
}

export const deviceLocationTrackerService = new DeviceLocationTrackerService();
