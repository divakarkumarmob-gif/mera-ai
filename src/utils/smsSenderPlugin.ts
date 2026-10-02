/**
 * FRIDAY AI — SMS Location Sender (Zero Cost Offline)
 *
 * Zero-cost GPS coordinates via native SMS (no API, no internet needed).
 *
 * Architecture:
 *   GPS ON + Data OFF → SmsSenderPlugin.sendSms() → SmsManager (Android native)
 *   → SMS to boss phone → Boss's FRIDAY app reads it → Firestore update
 *
 * SMS Format: "LOC:28.6139:77.2090:5:dev_abc123:1696259400"
 *             "LOC:{lat}:{lon}:{accuracy}:{deviceId}:{unixTimestamp}"
 *
 * Screen OFF support:
 *   Called from BackgroundRunner (WorkManager) → works even when screen is off
 *   Android SmsManager works natively at OS level
 *
 * Cost: Uses phone's own SIM SMS (no external API)
 *       India avg: ₹0–₹0.50 per SMS (most plans have free SMS)
 */

import { registerPlugin } from '@capacitor/core';

// ── Plugin interface ────────────────────────────────────────────────────────

export interface SmsSenderPlugin {
  /**
   * Send an SMS natively using Android SmsManager.
   * Works in background even with screen off.
   *
   * @param options.to      Recipient phone number (with country code, e.g. "919876543210")
   * @param options.message SMS text (max 160 chars recommended)
   * @returns               { sent: true } or throws on permission error
   */
  sendSms(options: { to: string; message: string }): Promise<{ sent: boolean }>;

  /**
   * Check if SEND_SMS permission is granted.
   */
  checkPermission(): Promise<{ granted: boolean }>;

  /**
   * Request SEND_SMS permission from user.
   */
  requestPermission(): Promise<{ granted: boolean }>;
}

const SmsSender = registerPlugin<SmsSenderPlugin>('SmsSender', {
  web: {
    // Web fallback — SMS not available on web
    sendSms: async ({ to, message }: { to: string; message: string }) => {
      console.warn('[SmsSender] SMS not available on web. Would send to:', to, '|', message);
      return { sent: false };
    },
    checkPermission: async () => ({ granted: false }),
    requestPermission: async () => ({ granted: false }),
  },
});

export { SmsSender };

// ── SMS Location Payload ────────────────────────────────────────────────────

export interface SmsLocationOptions {
  lat:       number;
  lon:       number;
  accuracy:  number;
  deviceId:  string;
  recipientNumber: string; // boss's phone number with country code
}

// ── High-level helper ───────────────────────────────────────────────────────

/**
 * Sends GPS coordinates as a compact SMS using the phone's own SIM.
 *
 * Format: "LOC:{lat}:{lon}:{acc}:{deviceId}:{ts}"
 * Example: "LOC:28.6139:77.2090:5:dev_abc123:1696259400"
 *
 * Returns: 'sent' | 'no-permission' | 'not-native' | 'error'
 */
export async function sendLocationSms(opts: SmsLocationOptions): Promise<'sent' | 'no-permission' | 'not-native' | 'error'> {
  const isNative = typeof window !== 'undefined' &&
    typeof (window as any).Capacitor !== 'undefined' &&
    (window as any).Capacitor?.isNativePlatform?.();

  if (!isNative) return 'not-native';
  if (!opts.recipientNumber) {
    console.warn('[SmsSender] No recipient number configured');
    return 'error';
  }

  try {
    // Check permission first
    const { granted } = await SmsSender.checkPermission();
    if (!granted) {
      const req = await SmsSender.requestPermission();
      if (!req.granted) {
        console.warn('[SmsSender] ❌ SEND_SMS permission denied');
        return 'no-permission';
      }
    }

    // Build compact SMS (under 160 chars)
    const ts  = Math.floor(Date.now() / 1000);
    const lat = opts.lat.toFixed(6);
    const lon = opts.lon.toFixed(6);
    const acc = Math.round(opts.accuracy);
    // Short device ID (last 8 chars to save space)
    const shortId = opts.deviceId.slice(-8);
    const message = `LOC:${lat}:${lon}:${acc}:${shortId}:${ts}`;

    // Safety: ensure under 160 chars
    if (message.length > 160) {
      console.warn('[SmsSender] ⚠️ Message too long:', message.length, 'chars');
    }

    console.log(`[SmsSender] 📤 Sending location SMS → ${opts.recipientNumber} | "${message}"`);

    const result = await SmsSender.sendSms({
      to:      opts.recipientNumber,
      message: message,
    });

    if (result.sent) {
      console.log('[SmsSender] ✅ Location SMS sent successfully');
      return 'sent';
    }
    return 'error';

  } catch (err: any) {
    console.error('[SmsSender] ❌ SMS error:', err?.message);
    return 'error';
  }
}

/**
 * Parse an incoming location SMS (for the receiver side).
 *
 * Input:  "LOC:28.613900:77.209000:5:bc123456:1696259400"
 * Output: { lat, lon, accuracy, shortDeviceId, timestamp } or null
 */
export function parseLocationSms(smsBody: string): {
  lat:           number;
  lon:           number;
  accuracy:      number;
  shortDeviceId: string;
  timestamp:     number;
} | null {
  if (!smsBody.startsWith('LOC:')) return null;
  try {
    const parts = smsBody.split(':');
    if (parts.length < 6) return null;
    const [, lat, lon, acc, shortId, ts] = parts;
    return {
      lat:           parseFloat(lat),
      lon:           parseFloat(lon),
      accuracy:      parseInt(acc, 10),
      shortDeviceId: shortId,
      timestamp:     parseInt(ts, 10),
    };
  } catch { return null; }
}
