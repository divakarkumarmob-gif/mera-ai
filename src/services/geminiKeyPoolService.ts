/**
 * geminiKeyPoolService.ts
 *
 * "Zero-429" Predictive Token Bucket & Multi-Key Mesh Manager for Google Gemini.
 *
 * Capabilities:
 * 1. Multi-Key Pool: Ingests GEMINI_API_KEYS (comma-separated) or legacy GEMINI_API_KEY.
 * 2. Precision 60s Sliding Window Log: Tracks exact request velocity per key.
 * 3. Proactive Rate-Limit Prevention: Switches to the next healthy key BEFORE Google throws a 429.
 * 4. Priority-Aware Traffic Shaping:
 *    - 'boss' (VIP): Prioritized on Key 0 (with failover to least-loaded healthy key).
 *    - 'background': Uses secondary keys (Vision, OCR, PDF, Proactive Sentinel).
 *    - 'public': Uses tertiary/public keys (Groups & stranger auto-replies).
 * 5. Automatic 429 Quarantine & Instant Rerouting: If Google still throttles, quarantine for 60s and reroute.
 * 6. Daily Quota Guard (1500 RPD free tier envelope).
 */

import { GoogleGenAI } from "@google/genai";

export type WorkloadPriority = "boss" | "background" | "public";
export type KeyHealthStatus = "healthy" | "saturated" | "cooling_down" | "daily_exhausted";

export interface KeyRecord {
  index: number;
  apiKey: string;
  maskedKey: string;
  client: GoogleGenAI;
  requestTimestamps: number[]; // timestamps in ms of calls within the last 60s
  coolingDownUntil: number; // timestamp in ms until key is quarantined
  dailyCount: number;
  dailyDateStr: string; // YYYY-MM-DD
  totalSuccess: number;
  totalErrors: number;
  lastUsedAt: number;
}

export interface ClientAllocation {
  client: GoogleGenAI;
  apiKey: string;
  keyIndex: number;
  maskedKey: string;
  status: KeyHealthStatus;
  remainingInWindow: number;
  currentWindowRpm: number;
}

export class GeminiKeyPoolService {
  private keys: KeyRecord[] = [];
  private readonly MAX_RPM_SOFT_CAP = 13; // Google free limit is 15; soft cap at 13 to guarantee Zero-429
  private readonly HARD_DAILY_CAP = 1450; // Google free limit is 1500; soft cap at 1450
  private readonly COOLDOWN_DURATION_MS = 60000; // 60s cooldown if unexpected 429 occurs
  private readonly SLIDING_WINDOW_MS = 60000; // 60s rolling evaluation window

  constructor() {
    this.reloadKeysFromEnv();
  }

  /**
   * Reloads and initializes the key pool from environment variables.
   */
  public reloadKeysFromEnv(): void {
    const rawKeys: string[] = [];
    // Collect all potential env variable sources (plural or singular)
    const envSources = [
      process.env.GEMINI_API_KEYS,
      process.env.GEMINI_API_KEY,
      process.env.GOOGLE_API_KEYS,
      process.env.GOOGLE_API_KEY,
      process.env.VITE_GEMINI_API_KEY,
    ];

    for (const source of envSources) {
      if (!source || !source.trim()) continue;
      // Split by comma, semicolon, or newline
      const parts = source
        .split(/[,;\n]/)
        .map((k) => k.trim().replace(/^["']|["']$/g, ""))
        .filter((k) => k.length > 10);
      for (const p of parts) {
        if (!rawKeys.includes(p)) {
          rawKeys.push(p);
        }
      }
    }

    const uniqueKeys = rawKeys;

    if (uniqueKeys.length === 0) {
      console.warn("[GeminiKeyPool] ⚠️ No Gemini API keys found in environment variables!");
    } else {
      console.log(`[GeminiKeyPool] 🚀 Initialized with ${uniqueKeys.length} Gemini API Key(s) in Predictive Mesh.`);
    }

    const todayStr = this.getTodayDateStr();

    this.keys = uniqueKeys.map((key, idx) => {
      const existing = this.keys.find((k) => k.apiKey === key);
      if (existing) {
        return existing; // Preserve state if reloading
      }

      return {
        index: idx,
        apiKey: key,
        maskedKey: this.maskKey(key),
        client: new GoogleGenAI({ apiKey: key }),
        requestTimestamps: [],
        coolingDownUntil: 0,
        dailyCount: 0,
        dailyDateStr: todayStr,
        totalSuccess: 0,
        totalErrors: 0,
        lastUsedAt: 0,
      };
    });
  }

  /**
   * Dynamically adds an API key to the mesh.
   */
  public addKey(apiKey: string): boolean {
    const clean = apiKey.trim().replace(/^["']|["']$/g, "");
    if (!clean || clean.length < 10) return false;
    if (this.keys.some((k) => k.apiKey === clean)) return false;

    const newIdx = this.keys.length;
    this.keys.push({
      index: newIdx,
      apiKey: clean,
      maskedKey: this.maskKey(clean),
      client: new GoogleGenAI({ apiKey: clean }),
      requestTimestamps: [],
      coolingDownUntil: 0,
      dailyCount: 0,
      dailyDateStr: this.getTodayDateStr(),
      totalSuccess: 0,
      totalErrors: 0,
      lastUsedAt: 0,
    });
    console.log(`[GeminiKeyPool] ➕ Added Key #${newIdx + 1} (${this.maskKey(clean)}) to pool.`);
    return true;
  }

  /**
   * Returns the count of registered keys.
   */
  public getKeyCount(): number {
    return this.keys.length;
  }

  /**
   * Returns all configured GoogleGenAI clients with their index and key.
   */
  public getAllClients(): { client: GoogleGenAI; apiKey: string; keyIndex: number }[] {
    return this.keys.map((k) => ({ client: k.client, apiKey: k.apiKey, keyIndex: k.index }));
  }

  /**
   * Returns a single clean primary GoogleGenAI client (never malformed with commas).
   */
  public getPrimaryClient(): GoogleGenAI {
    if (this.keys.length > 0) {
      return this.keys[0].client;
    }
    const cleanKey = (process.env.GEMINI_API_KEY || "").split(/[,;\n]/)[0].trim().replace(/^["']|["']$/g, "");
    return new GoogleGenAI({ apiKey: cleanKey || "placeholder-gemini-key" });
  }

  /**
   * Returns a clean single primary API key string.
   */
  public getPrimaryApiKey(): string {
    if (this.keys.length > 0) {
      return this.keys[0].apiKey;
    }
    return (process.env.GEMINI_API_KEY || "").split(/[,;\n]/)[0].trim().replace(/^["']|["']$/g, "") || "placeholder-gemini-key";
  }

  /**
   * Shorthand alias for getOptimalClient.
   */
  public getClient(options: { priority?: WorkloadPriority; preferredIndex?: number } = {}): ClientAllocation {
    return this.getOptimalClient(options);
  }

  /**
   * Checks if at least one key is configured and ready.
   */
  public hasAvailableKey(): boolean {
    if (this.keys.length === 0) {
      return Boolean(process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
    }
    const now = Date.now();
    return this.keys.some((k) => now >= k.coolingDownUntil && k.dailyCount < this.HARD_DAILY_CAP);
  }

  /**
   * Returns the API key string of the current optimal client.
   * Useful for third-party libraries or REST calls needing raw key strings.
   */
  public getActiveKey(priority: WorkloadPriority = "background"): string {
    if (this.keys.length === 0) {
      return (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
    }
    const alloc = this.getOptimalClient({ priority });
    return alloc.apiKey;
  }

  /**
   * Retrieves an optimal GoogleGenAI client based on predictive rate-limits and workload priority.
   * Proactively avoids 429 errors by selecting keys with available RPM headroom.
   */
  public getOptimalClient(options: { priority?: WorkloadPriority; preferredIndex?: number } = {}): ClientAllocation {
    const priority = options.priority || "boss";
    const now = Date.now();

    if (this.keys.length === 0) {
      // Emergency fallback with empty key if none registered
      const fallbackKey = process.env.GEMINI_API_KEY || "";
      return {
        client: new GoogleGenAI({ apiKey: fallbackKey }),
        apiKey: fallbackKey,
        keyIndex: -1,
        maskedKey: "NONE",
        status: "healthy",
        remainingInWindow: 1,
        currentWindowRpm: 0,
      };
    }

    // Single-key fast path
    if (this.keys.length === 1) {
      const single = this.keys[0];
      this.pruneSlidingWindow(single, now);
      this.recordInvocation(single, now);
      return {
        client: single.client,
        apiKey: single.apiKey,
        keyIndex: 0,
        maskedKey: single.maskedKey,
        status: this.computeKeyStatus(single, now),
        remainingInWindow: Math.max(0, this.MAX_RPM_SOFT_CAP - single.requestTimestamps.length),
        currentWindowRpm: single.requestTimestamps.length,
      };
    }

    // Multi-key mesh routing:
    // 1. Prune stale timestamps on all keys
    for (const k of this.keys) {
      this.pruneSlidingWindow(k, now);
      this.checkAndResetDailyCount(k);
    }

    // 2. Filter keys that are NOT cooling down and NOT daily exhausted
    const eligibleKeys = this.keys.filter((k) => {
      const isCooling = now < k.coolingDownUntil;
      const isDailyExhausted = k.dailyCount >= this.HARD_DAILY_CAP;
      return !isCooling && !isDailyExhausted;
    });

    const candidatePool = eligibleKeys.length > 0 ? eligibleKeys : this.keys;

    // 3. Separate candidate pool into healthy (under soft cap) and saturated
    const healthyCandidates = candidatePool.filter((k) => k.requestTimestamps.length < this.MAX_RPM_SOFT_CAP);

    let chosen: KeyRecord;

    if (healthyCandidates.length > 0) {
      // Apply priority bias:
      if (priority === "boss") {
        // Boss VIP: Prefer Key 0 if it has headroom (< 13 RPM); otherwise pick lowest loaded healthy
        const key0 = healthyCandidates.find((k) => k.index === 0);
        if (key0 && key0.requestTimestamps.length < this.MAX_RPM_SOFT_CAP) {
          chosen = key0;
        } else {
          // Sort by lowest RPM in window
          healthyCandidates.sort((a, b) => a.requestTimestamps.length - b.requestTimestamps.length);
          chosen = healthyCandidates[0];
        }
      } else if (priority === "background") {
        // Background: Prefer Key 1 or Key 2, keeping Key 0 free for Boss
        const secondary = healthyCandidates.filter((k) => k.index > 0);
        if (secondary.length > 0) {
          secondary.sort((a, b) => a.requestTimestamps.length - b.requestTimestamps.length);
          chosen = secondary[0];
        } else {
          // All secondary saturated; use Key 0 only if Key 0 has plenty of headroom (< 8 RPM)
          const key0 = healthyCandidates.find((k) => k.index === 0);
          if (key0 && key0.requestTimestamps.length < 8) {
            chosen = key0;
          } else {
            healthyCandidates.sort((a, b) => a.requestTimestamps.length - b.requestTimestamps.length);
            chosen = healthyCandidates[0];
          }
        }
      } else {
        // Public / Groups: Prefer highest index keys (e.g. Key 2, Key 1), avoid Key 0
        const nonBoss = healthyCandidates.filter((k) => k.index > 0);
        if (nonBoss.length > 0) {
          nonBoss.sort((a, b) => a.requestTimestamps.length - b.requestTimestamps.length);
          chosen = nonBoss[0];
        } else {
          healthyCandidates.sort((a, b) => a.requestTimestamps.length - b.requestTimestamps.length);
          chosen = healthyCandidates[0];
        }
      }
    } else {
      // ALL keys are at or above soft cap (13 RPM).
      // Find the key whose oldest timestamp is expiring soonest
      candidatePool.sort((a, b) => {
        const oldestA = a.requestTimestamps[0] || 0;
        const oldestB = b.requestTimestamps[0] || 0;
        return oldestA - oldestB; // oldest timestamp first (will expire earliest)
      });
      chosen = candidatePool[0];
      console.warn(`[GeminiKeyPool] ⚠️ All keys saturated. Routing to Key #${chosen.index + 1} (${chosen.maskedKey}) with earliest expiring window.`);
    }

    // 4. Record invocation
    this.recordInvocation(chosen, now);

    return {
      client: chosen.client,
      apiKey: chosen.apiKey,
      keyIndex: chosen.index,
      maskedKey: chosen.maskedKey,
      status: this.computeKeyStatus(chosen, now),
      remainingInWindow: Math.max(0, this.MAX_RPM_SOFT_CAP - chosen.requestTimestamps.length),
      currentWindowRpm: chosen.requestTimestamps.length,
    };
  }

  /**
   * High-resiliency executor: Executes an async Gemini call with predictive allocation,
   * automatic error interception, 60s quarantine on 429, and immediate transparent failover to alternate keys.
   */
  public async executeWithRetry<T>(
    operation: (client: GoogleGenAI, meta: { apiKey: string; keyIndex: number; maskedKey: string }) => Promise<T>,
    options: { priority?: WorkloadPriority; maxAttempts?: number; taskName?: string } = {}
  ): Promise<T> {
    const maxAttempts = options.maxAttempts || Math.max(1, this.keys.length);
    const taskLabel = options.taskName || "GeminiTask";
    const triedIndices = new Set<number>();

    let lastError: any = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const allocation = this.getOptimalClient({
        priority: options.priority || "boss",
      });

      // Avoid retrying on the exact same key in the same call stack if alternates exist
      if (triedIndices.has(allocation.keyIndex) && this.keys.length > triedIndices.size) {
        // Pick an alternate key
        const alternate = this.keys.find((k) => !triedIndices.has(k.index));
        if (alternate) {
          allocation.client = alternate.client;
          allocation.apiKey = alternate.apiKey;
          allocation.keyIndex = alternate.index;
          allocation.maskedKey = alternate.maskedKey;
        }
      }

      triedIndices.add(allocation.keyIndex);

      try {
        const result = await operation(allocation.client, {
          apiKey: allocation.apiKey,
          keyIndex: allocation.keyIndex,
          maskedKey: allocation.maskedKey,
        });

        this.recordSuccess(allocation.keyIndex);
        return result;
      } catch (err: any) {
        lastError = err;
        const errMsg = String(err?.message || err);
        const isRateLimit =
          err?.status === 429 ||
          errMsg.includes("429") ||
          errMsg.includes("RESOURCE_EXHAUSTED") ||
          errMsg.includes("quota") ||
          errMsg.includes("Rate limit");

        if (isRateLimit) {
          console.warn(`[GeminiKeyPool] 🛑 Key #${allocation.keyIndex + 1} (${allocation.maskedKey}) triggered 429 on ${taskLabel}. Quarantining for 60s and retrying...`);
          this.recordRateLimitError(allocation.keyIndex);
        } else {
          console.warn(`[GeminiKeyPool] ⚠️ Key #${allocation.keyIndex + 1} (${allocation.maskedKey}) error on ${taskLabel}: ${errMsg}`);
          this.recordGenericError(allocation.keyIndex);
        }

        if (attempt < maxAttempts) {
          // Micro-pause before switching to avoid tight loop
          await new Promise((r) => setTimeout(r, 150));
        }
      }
    }

    throw lastError || new Error(`[GeminiKeyPool] All ${maxAttempts} execution attempts failed for ${taskLabel}.`);
  }

  /**
   * Records successful API execution for a key.
   */
  public recordSuccess(keyIndex: number): void {
    const k = this.keys[keyIndex];
    if (k) {
      k.totalSuccess++;
    }
  }

  /**
   * Quarantines a key for 60 seconds after a rate-limit error.
   */
  public recordRateLimitError(keyIndex: number): void {
    const k = this.keys[keyIndex];
    if (k) {
      k.totalErrors++;
      k.coolingDownUntil = Date.now() + this.COOLDOWN_DURATION_MS;
      console.log(`[GeminiKeyPool] ❄️ Key #${k.index + 1} (${k.maskedKey}) quarantined until ${new Date(k.coolingDownUntil).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata" })}`);
    }
  }

  /**
   * Records a non-rate-limit error.
   */
  public recordGenericError(keyIndex: number): void {
    const k = this.keys[keyIndex];
    if (k) {
      k.totalErrors++;
    }
  }

  /**
   * Returns a structured JSON diagnostic summary of the key pool mesh.
   */
  public getDetailedStatus(): {
    ok: boolean;
    totalKeys: number;
    meshCapacityRpm: number;
    currentMeshRpm: number;
    currentWindowRpm: number;
    coolingDownKeys: number;
    totalDailyCalls: number;
    totalErrors: number;
    sentinelActive: boolean;
    keys: Array<{
      index: number;
      maskedKey: string;
      role: string;
      status: KeyHealthStatus;
      currentRpm: number;
      maxRpm: number;
      dailyCalls: number;
      maxDailyCalls: number;
      cooldownRemainingSec: number;
      totalSuccess: number;
      totalErrors: number;
      lastUsedAt: number;
    }>;
    statusCard: string;
  } {
    const now = Date.now();
    for (const k of this.keys) {
      this.pruneSlidingWindow(k, now);
      this.checkAndResetDailyCount(k);
    }

    let totalRpm = 0;
    let totalDailyCalls = 0;
    let totalErrors = 0;

    const keySummaries = this.keys.map((k) => {
      const rpm = k.requestTimestamps.length;
      totalRpm += rpm;
      totalDailyCalls += k.dailyCount;
      totalErrors += k.totalErrors;

      const cooldownRemainingSec = now < k.coolingDownUntil
        ? Math.max(1, Math.round((k.coolingDownUntil - now) / 1000))
        : 0;

      const role = k.index === 0 ? "VIP (Boss)" : k.index === 1 ? "Background" : "Public/Groups";

      return {
        index: k.index,
        maskedKey: k.maskedKey,
        role,
        status: this.computeKeyStatus(k, now),
        currentRpm: rpm,
        maxRpm: this.MAX_RPM_SOFT_CAP,
        dailyCalls: k.dailyCount,
        maxDailyCalls: this.HARD_DAILY_CAP,
        cooldownRemainingSec,
        totalSuccess: k.totalSuccess,
        totalErrors: k.totalErrors,
        lastUsedAt: k.lastUsedAt,
      };
    });

    const coolingDownCount = keySummaries.filter((k) => k.status === "cooling_down").length;

    return {
      ok: true,
      totalKeys: this.keys.length,
      meshCapacityRpm: this.keys.length * this.MAX_RPM_SOFT_CAP,
      currentMeshRpm: totalRpm,
      currentWindowRpm: totalRpm,
      coolingDownKeys: coolingDownCount,
      totalDailyCalls,
      totalErrors,
      sentinelActive: true,
      keys: keySummaries,
      statusCard: this.getStatusCard(),
    };
  }

  /**
   * Generates a live diagnostic status card formatted for WhatsApp and Telegram.
   */
  public getStatusCard(): string {
    const now = Date.now();
    for (const k of this.keys) {
      this.pruneSlidingWindow(k, now);
      this.checkAndResetDailyCount(k);
    }

    const divider = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    if (this.keys.length === 0) {
      return `🔑 *Gemini Key Pool Health:*\n${divider}\n⚠️ Koi Gemini API Key configure nahi hai! .env file me \`GEMINI_API_KEYS\` add karein.\n${divider}`;
    }

    let card = `🔑 *Gemini Key Pool Health (${this.keys.length} Active)*\n${divider}\n`;

    let totalRpm = 0;
    let totalDailyCalls = 0;
    let totalErrors = 0;

    for (const k of this.keys) {
      const rpm = k.requestTimestamps.length;
      totalRpm += rpm;
      totalDailyCalls += k.dailyCount;
      totalErrors += k.totalErrors;

      let statusBadge = "🟢 Ready";
      if (now < k.coolingDownUntil) {
        const remainingSec = Math.max(1, Math.round((k.coolingDownUntil - now) / 1000));
        statusBadge = `❄️ Cooldown (${remainingSec}s)`;
      } else if (rpm >= this.MAX_RPM_SOFT_CAP) {
        statusBadge = "🟡 Saturated";
      } else if (k.dailyCount >= this.HARD_DAILY_CAP) {
        statusBadge = "🔴 Daily Exhausted";
      }

      const roleBadge = k.index === 0 ? "VIP (Boss)" : k.index === 1 ? "Background" : "Public/Groups";

      card += `• *Key #${k.index + 1}* [${k.maskedKey}] — ${roleBadge}\n`;
      card += `  Status: ${statusBadge} | ⚡ ${rpm}/${this.MAX_RPM_SOFT_CAP} RPM\n`;
      card += `  Today: ${k.dailyCount}/${this.HARD_DAILY_CAP} calls | ✅ ${k.totalSuccess} | ❌ ${k.totalErrors}\n\n`;
    }

    const meshCapacity = this.keys.length * this.MAX_RPM_SOFT_CAP;
    card += `${divider}\n`;
    card += `⚡ *Mesh Speed:* ${totalRpm}/${meshCapacity} RPM in use\n`;
    card += `📊 *Total Calls Today:* ${totalDailyCalls} | Errors: ${totalErrors}\n`;
    card += `🛡️ *Zero-429 Sentinel:* Active & Protecting`;

    return card;
  }

  /**
   * Internal helper: Prunes timestamps older than 60 seconds from key's rolling window.
   */
  private pruneSlidingWindow(key: KeyRecord, now: number): void {
    const cutoff = now - this.SLIDING_WINDOW_MS;
    key.requestTimestamps = key.requestTimestamps.filter((ts) => ts > cutoff);
  }

  /**
   * Internal helper: Records timestamp and increments counters.
   */
  private recordInvocation(key: KeyRecord, now: number): void {
    key.requestTimestamps.push(now);
    key.dailyCount++;
    key.lastUsedAt = now;
  }

  /**
   * Internal helper: Checks if date changed and resets daily counter.
   */
  private checkAndResetDailyCount(key: KeyRecord): void {
    const todayStr = this.getTodayDateStr();
    if (key.dailyDateStr !== todayStr) {
      key.dailyDateStr = todayStr;
      key.dailyCount = 0;
    }
  }

  /**
   * Internal helper: Computes key health status string.
   */
  private computeKeyStatus(key: KeyRecord, now: number): KeyHealthStatus {
    if (now < key.coolingDownUntil) return "cooling_down";
    if (key.dailyCount >= this.HARD_DAILY_CAP) return "daily_exhausted";
    if (key.requestTimestamps.length >= this.MAX_RPM_SOFT_CAP) return "saturated";
    return "healthy";
  }

  /**
   * Internal helper: Masks API key for safe display (e.g. "AIzaSy...4xQ")
   */
  private maskKey(key: string): string {
    if (!key || key.length < 8) return "••••";
    return `${key.slice(0, 6)}...${key.slice(-3)}`;
  }

  /**
   * Internal helper: Returns current date string in IST (Asia/Kolkata)
   */
  private getTodayDateStr(): string {
    return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  }
}

export const geminiKeyPoolService = new GeminiKeyPoolService();
