/**
 * FRIDAY AI — Background Runner (WorkManager)
 *
 * This file runs inside Android's WorkManager via @capacitor/background-runner.
 * It is executed by the OS even when the screen is OFF and the app is not in foreground.
 *
 * Flow:
 *   Android WorkManager wakes up every ~60s →
 *   Calls this script → Gets GPS via Geolocation API →
 *   Sends ping to FRIDAY server → Sleeps again
 *
 * NO permanent notification required! ✅
 */

addEventListener('locationPing', async (resolve, reject, args) => {
  try {
    const deviceId = args?.deviceId || 'unknown_device';
    const label    = args?.label    || 'Boss Phone';
    const username = args?.username || 'boss';
    const pingUrl  = args?.pingUrl  || 'https://mera-ai-3496.onrender.com/api/location/ping';

    // Get current GPS position using Capacitor's background-compatible API
    const position = await new Promise((res, rej) => {
      if (typeof CapacitorGeolocation !== 'undefined') {
        // Native Capacitor Geolocation available in background runner context
        CapacitorGeolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000,
        }).then(res).catch(rej);
      } else {
        rej(new Error('CapacitorGeolocation not available in runner'));
      }
    });

    if (!position || !position.coords) {
      resolve({ success: false, reason: 'No GPS position' });
      return;
    }

    const { latitude: lat, longitude: lon, accuracy, altitude, speed, heading } = position.coords;

    // Send ping to server
    const response = await fetch(pingUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId, label, username,
        lat, lon, accuracy: accuracy ?? 0,
        altitude: altitude ?? null,
        speed: speed ?? null,
        heading: heading ?? null,
        batteryLevel: null,
        isCharging: null,
        networkType: null,
        isCachedLastKnown: false,
      }),
    });

    const ok = response.status >= 200 && response.status < 300;
    console.log(`[BackgroundRunner] ${ok ? '✅' : '❌'} Ping ${ok ? 'sent' : 'failed'}: lat=${lat}, lon=${lon}`);

    resolve({ success: ok, lat, lon });
  } catch (err) {
    console.error('[BackgroundRunner] Error:', err?.message || err);
    reject(err?.message || 'Unknown error');
  }
});
