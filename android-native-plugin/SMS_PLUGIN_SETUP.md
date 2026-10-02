# FRIDAY AI — Android Native SMS Plugin Setup Guide

## Files Created (Copy to Android Project After `npx cap sync android`)

### 1. SmsSenderPlugin.java
Source: `android-native-plugin/src/main/java/com/friday/ai/plugins/SmsSenderPlugin.java`
Destination: `android/app/src/main/java/com/friday/ai/plugins/SmsSenderPlugin.java`

### 2. AndroidManifest.xml — Add these permissions
File: `android/app/src/main/AndroidManifest.xml`

Add inside `<manifest>` tag:
```xml
<uses-permission android:name="android.permission.SEND_SMS" />
<uses-permission android:name="android.permission.RECEIVE_SMS" />
<uses-permission android:name="android.permission.READ_SMS" />
```

### 3. MainActivity.java — Register the plugin
File: `android/app/src/main/java/com/friday/ai/MainActivity.java`

```java
import com.friday.ai.plugins.SmsSenderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SmsSenderPlugin.class);  // ← ADD THIS LINE
        super.onCreate(savedInstanceState);
    }
}
```

## SMS Format
Sent SMS looks like:
```
LOC:28.613900:77.209000:5:bc123456:1696259400
```
Fields: LOC:{lat}:{lon}:{accuracy_meters}:{short_deviceId}:{unix_timestamp}

## How to Configure in App (JS)
```typescript
import { backgroundLocationService } from './utils/backgroundLocationService';

// Set boss's number (India format: 91 + 10 digit number)
backgroundLocationService.setSmsRecipient('919876543210');

// Check if configured
backgroundLocationService.isSmsConfigured(); // → true/false

// Get current recipient
backgroundLocationService.getSmsRecipient(); // → "919876543210"
```

## Flow When Screen is OFF + GPS ON + Data OFF
```
WorkManager (every 60s) → location.js runner
  → GPS reads coords
  → navigator.onLine === false
  → queueOfflinePing() [localStorage]
  → sendLocationSms() → SmsSenderPlugin.sendSms()
     → Android SmsManager.sendTextMessage()
        → Cellular SMS sent (no internet needed) ✅
        → Screen OFF: ✅ (SmsManager works at OS level)
        → App backgrounded: ✅
        → Cost: ₹0 (most Indian plans)
```

## Cost Analysis (India)
| Carrier | SMS Cost |
|---------|----------|
| Jio     | FREE (unlimited SMS) |
| Airtel  | 25 paise/SMS or bundle |
| BSNL    | 1 paisa/SMS |
| Vi      | Free in plans |

## Build Steps
```bash
npx cap sync android     # sync web assets
npx cap open android     # open in Android Studio
# Build → Run on device
```
