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

// ── Service Class ────────────────────────────────────────────────────────────

class DeviceLocationTrackerService {

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

    try {
      // Reverse geocode the coordinates to a human-readable address
      const address = await this.reverseGeocode(lat, lon);

      const updateData: any = {
        lat,
        lon,
        accuracy: data.accuracy || 0,
        altitude: data.altitude ?? null,
        speed: data.speed ?? null,
        heading: data.heading ?? null,
        address,
        lastUpdatedAt: now,
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

      await locationsCollection().doc(deviceId).set(updateData, { merge: true });

      return { success: true, message: "Location ping received." };
    } catch (err: any) {
      console.error("[LocationTracker] Ping error:", err?.message || err);
      return { success: false, message: `Ping failed: ${err?.message || "Unknown error"}` };
    }
  }

  /**
   * Get the latest known location of a device by username, label, owner name, or deviceId.
   * This is the main method called when Boss asks "bhai kahan hai?"
   */
  public async getDeviceLocation(personNameOrLabel: string): Promise<LocationQueryResult> {
    const rawQuery = (personNameOrLabel || "").trim().toLowerCase();
    const isSelfOrBoss =
      !rawQuery ||
      ["boss", "dk", "divakar", "mera", "meri", "me", "my", "khud", "self", "apna", "apni", "current", "admin", "owner", "location", "boss location", "live location"].some(
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

      // Single device auto-resolve
      if (allDocs.size === 1 && isSelfOrBoss) {
        bestMatch = allDocs.docs[0].data() as DeviceLocationEntry;
        bestScore = 100;
      }

      if (!bestMatch) {
        for (const doc of allDocs.docs) {
          const data = doc.data() as DeviceLocationEntry;
          const username = (data.username || "").toLowerCase();
          const label = (data.label || "").toLowerCase();
          const owner = (data.ownerName || "").toLowerCase();
          const deviceId = (data.deviceId || "").toLowerCase();

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
              bestMatch = data;
              bestScore = 100;
              break;
            }
          }

          // Exact match
          if (username === rawQuery || label === rawQuery || owner === rawQuery || deviceId === rawQuery) {
            bestMatch = data;
            bestScore = 100;
            break;
          }

          // Partial/fuzzy match
          let score = 0;
          if (username.includes(rawQuery) || rawQuery.includes(username)) score = 95;
          else if (label.includes(rawQuery) || rawQuery.includes(label)) score = 80;
          else if (owner.includes(rawQuery) || rawQuery.includes(owner)) score = 70;

          // Common Hindi terms mapping
          const hindiAliases: Record<string, string[]> = {
            boss: ["boss", "dk", "divakar", "mera", "meri", "me", "my", "khud", "self", "apna", "apni", "current", "admin", "owner", "location"],
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

          if (score > bestScore) {
            bestScore = score;
            bestMatch = data;
          }
        }
      }

      // If query was Boss/Self and still no explicit match, pick the most recently active device
      if ((!bestMatch || bestScore < 50) && isSelfOrBoss && allDocs.size > 0) {
        let mostRecent = allDocs.docs[0].data() as DeviceLocationEntry;
        for (const doc of allDocs.docs) {
          const d = doc.data() as DeviceLocationEntry;
          if ((d.lastUpdatedAt || 0) > (mostRecent.lastUpdatedAt || 0)) {
            mostRecent = d;
          }
        }
        bestMatch = mostRecent;
        bestScore = 90;
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
      if ((bestMatch.lat === 0 && bestMatch.lon === 0) || !bestMatch.address || bestMatch.address === "Location not yet received") {
        return {
          success: false,
          deviceId: bestMatch.deviceId,
          label: bestMatch.label,
          ownerName: bestMatch.ownerName,
          message: `Boss, "${bestMatch.label || bestMatch.ownerName}" phone system me registered hai, lekin abhi tak live GPS coordinates sync nahi hue hain. Kripya phone me Location (GPS) ON karke FRIDAY app/web open karein, live address turant update ho jayega.`,
        };
      }

      // Check if location is too old (stale > 24 hours)
      const ageMs = Date.now() - (bestMatch.lastUpdatedAt || 0);
      const ageMinutes = Math.floor(ageMs / 60000);
      const isStale = ageMs > 24 * 60 * 60 * 1000;

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

      const message = `📍 **${bestMatch.label || bestMatch.ownerName}** ki Live Location:\n\n` +
        `🏠 **Address:** ${bestMatch.address || "Address not available"}\n` +
        `🌐 **Coordinates:** ${bestMatch.lat.toFixed(6)}, ${bestMatch.lon.toFixed(6)}\n` +
        `🎯 **Accuracy:** ${Math.round(bestMatch.accuracy || 0)} meters\n` +
        `⏱️ **Last Updated:** ${lastUpdatedAgo}\n` +
        `${batteryStr}${networkStr}\n` +
        `📌 **Google Maps:** ${googleMapsUrl}` +
        staleWarning;

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
    } catch (err: any) {
      console.error("[LocationTracker] Query error:", err?.message || err);
      return {
        success: false,
        message: `Location query failed: ${err?.message || "Unknown error"}`,
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
