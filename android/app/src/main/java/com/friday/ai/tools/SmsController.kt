package com.friday.ai.tools

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Build
import android.telephony.SmsManager
import android.util.Log
import androidx.core.content.ContextCompat

object SmsController {
    private const val TAG = "FridaySms"

    fun sendSms(context: Context, phoneNumber: String, message: String): Boolean {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS)
            != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "SEND_SMS permission not granted")
            return false
        }

        return try {
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(SmsManager::class.java)
            } else {
                @Suppress("DEPRECATION")
                SmsManager.getDefault()
            }

            if (message.length <= 160) {
                smsManager.sendTextMessage(phoneNumber, null, message, null, null)
            } else {
                val parts = smsManager.divideMessage(message)
                smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
            }
            Log.i(TAG, "✉️ SMS successfully dispatched to $phoneNumber")
            true
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send SMS: ${e.message}", e)
            false
        }
    }

    fun sendEmergencySosSms(context: Context, emergencyNumber: String, location: Location?) {
        val locationText = if (location != null) {
            "Loc: https://maps.google.com/?q=${location.latitude},${location.longitude} (Acc: ${location.accuracy}m)"
        } else {
            "Location unavailable"
        }
        val sosMessage = "🚨 EMERGENCY SOS ALERT! I need help. $locationText - Sent via Friday AI"
        sendSms(context, emergencyNumber, sosMessage)
    }
}
