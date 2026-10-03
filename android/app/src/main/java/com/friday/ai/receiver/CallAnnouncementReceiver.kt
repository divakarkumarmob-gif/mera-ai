package com.friday.ai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.ContactsContract
import android.telephony.TelephonyManager
import android.util.Log
import com.friday.ai.bluetooth.BluetoothAudioRouter
import com.friday.ai.tools.SpeechManager

/**
 * Caller Name Whisper Engine:
 * Intercepts cellular phone calls when the phone is locked / screen-off in pocket,
 * resolves the caller's saved contact name, and whispers it into the connected Bluetooth earbud.
 */
class CallAnnouncementReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "FridayCallAnnounce"
        private var lastState: String? = null
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != TelephonyManager.ACTION_PHONE_STATE_CHANGED) return

        val state = intent.getStringExtra(TelephonyManager.EXTRA_STATE) ?: return
        if (state == lastState) return
        lastState = state

        Log.d(TAG, "Telephony state changed: $state")

        when (state) {
            TelephonyManager.EXTRA_STATE_RINGING -> {
                val incomingNumber = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER)
                val callerName = resolveContactName(context, incomingNumber)

                Log.i(TAG, "📞 Ringing: callerName='$callerName', number='$incomingNumber'")

                // Ensure audio is routed to earbud
                BluetoothAudioRouter.startBluetoothSco(context)

                // Build whisper announcement
                val announcement = if (!callerName.isNullOrEmpty() && callerName != incomingNumber) {
                    "Incoming call from $callerName."
                } else if (!incomingNumber.isNullOrEmpty()) {
                    val lastDigits = incomingNumber.takeLast(4).map { "$it " }.joinToString("")
                    "Incoming call from number ending in $lastDigits."
                } else {
                    "Incoming phone call."
                }

                SpeechManager.speak(context, announcement)
            }

            TelephonyManager.EXTRA_STATE_OFFHOOK, TelephonyManager.EXTRA_STATE_IDLE -> {
                // Call was answered or dropped/rejected -> stop speech
                SpeechManager.stopSpeaking()
            }
        }
    }

    /**
     * Look up saved contact name from Android ContactsProvider using normalized phone number
     */
    private fun resolveContactName(context: Context, number: String?): String? {
        if (number.isNullOrEmpty()) return null
        return try {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
            val projection = arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME)
            val cursor = context.contentResolver.query(uri, projection, null, null, null)
            cursor?.use {
                if (it.moveToFirst()) {
                    val idx = it.getColumnIndex(ContactsContract.PhoneLookup.DISPLAY_NAME)
                    if (idx >= 0) it.getString(idx) else null
                } else null
            }
        } catch (e: Exception) {
            Log.w(TAG, "Contact lookup note: ${e.message}")
            null
        }
    }
}
