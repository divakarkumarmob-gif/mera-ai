package com.friday.ai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import android.util.Log
import com.friday.ai.service.FridayForegroundService
import com.friday.ai.tools.SmsController

class SmsReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "FridaySmsReceiver"
        private const val TRIGGER_KEYWORD = "#FRIDAY_LOC"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (Telephony.Sms.Intents.SMS_RECEIVED_ACTION != intent?.action) return

        try {
            val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent)
            for (sms in messages) {
                val body = sms.displayMessageBody?.trim() ?: continue
                val sender = sms.displayOriginatingAddress ?: continue

                if (body.contains(TRIGGER_KEYWORD, ignoreCase = true)) {
                    Log.i(TAG, "📍 Remote GPS SMS Trigger received from $sender")
                    val loc = FridayForegroundService.currentLocation
                    SmsController.sendEmergencySosSms(context, sender, loc)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error processing incoming SMS: ${e.message}")
        }
    }
}
