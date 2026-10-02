package com.friday.ai.plugins;

import android.Manifest;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.telephony.SmsManager;
import android.os.Build;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * FRIDAY AI — SmsSenderPlugin
 *
 * Native Android Capacitor plugin to send SMS using the device's own SIM.
 * Zero cost: uses device's built-in SmsManager, no external API needed.
 *
 * Works even when:
 *   ✅ Screen is OFF (called from WorkManager background job)
 *   ✅ App is backgrounded
 *   ✅ Internet/data is OFF (uses cellular SMS, not internet)
 *
 * Required permissions (in AndroidManifest.xml):
 *   <uses-permission android:name="android.permission.SEND_SMS" />
 *   <uses-permission android:name="android.permission.RECEIVE_SMS" />
 *
 * Usage from JS:
 *   SmsSender.sendSms({ to: "919876543210", message: "LOC:28.61:77.20:5:abc:1234" })
 */
@CapacitorPlugin(
    name = "SmsSender",
    permissions = {
        @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sms"),
    }
)
public class SmsSenderPlugin extends Plugin {

    private static final String TAG = "SmsSenderPlugin";
    private static final String SMS_SENT_ACTION = "com.friday.ai.SMS_SENT";

    /**
     * Check if SEND_SMS permission is granted.
     */
    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        boolean granted = ContextCompat.checkSelfPermission(
            getContext(), Manifest.permission.SEND_SMS
        ) == PackageManager.PERMISSION_GRANTED;
        result.put("granted", granted);
        call.resolve(result);
    }

    /**
     * Request SEND_SMS permission from user.
     */
    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.SEND_SMS)
                == PackageManager.PERMISSION_GRANTED) {
            JSObject result = new JSObject();
            result.put("granted", true);
            call.resolve(result);
            return;
        }
        // Save call and request permission
        saveCall(call);
        requestPermissionForAlias("sms", call, "smsPermissionCallback");
    }

    @PermissionCallback
    private void smsPermissionCallback(PluginCall call) {
        boolean granted = ContextCompat.checkSelfPermission(
            getContext(), Manifest.permission.SEND_SMS
        ) == PackageManager.PERMISSION_GRANTED;
        JSObject result = new JSObject();
        result.put("granted", granted);
        call.resolve(result);
    }

    /**
     * Send an SMS using the device's own SIM (SmsManager).
     *
     * @param call.to      Recipient phone number (e.g. "919876543210")
     * @param call.message SMS text body (max 160 chars per part)
     */
    @PluginMethod
    public void sendSms(PluginCall call) {
        String to      = call.getString("to");
        String message = call.getString("message");

        if (to == null || to.isEmpty()) {
            call.reject("Recipient number 'to' is required");
            return;
        }
        if (message == null || message.isEmpty()) {
            call.reject("Message body is required");
            return;
        }

        // Check permission
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.SEND_SMS)
                != PackageManager.PERMISSION_GRANTED) {
            call.reject("SEND_SMS permission not granted");
            return;
        }

        try {
            // Get SmsManager (API-level safe)
            SmsManager smsManager;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                smsManager = getContext().getSystemService(SmsManager.class);
            } else {
                smsManager = SmsManager.getDefault();
            }

            if (smsManager == null) {
                call.reject("SmsManager not available on this device");
                return;
            }

            // Sent intent — notifies when SMS is sent (optional delivery tracking)
            Intent sentIntent = new Intent(SMS_SENT_ACTION);
            PendingIntent sentPI = PendingIntent.getBroadcast(
                getContext(), 0, sentIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                    ? PendingIntent.FLAG_IMMUTABLE
                    : 0
            );

            // Split message if > 160 chars (handles multi-part SMS automatically)
            if (message.length() <= 160) {
                smsManager.sendTextMessage(to, null, message, sentPI, null);
            } else {
                // Multi-part SMS for longer messages
                java.util.ArrayList<String> parts = smsManager.divideMessage(message);
                java.util.ArrayList<PendingIntent> sentIntents = new java.util.ArrayList<>();
                for (int i = 0; i < parts.size(); i++) {
                    sentIntents.add(sentPI);
                }
                smsManager.sendMultipartTextMessage(to, null, parts, sentIntents, null);
            }

            android.util.Log.i(TAG, "✅ SMS sent to " + to + " | " + message.length() + " chars");

            JSObject result = new JSObject();
            result.put("sent", true);
            call.resolve(result);

        } catch (Exception e) {
            android.util.Log.e(TAG, "❌ SMS send failed: " + e.getMessage(), e);
            call.reject("SMS send failed: " + e.getMessage());
        }
    }
}
