package com.friday.ai.bluetooth

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.util.Log

object BluetoothAudioRouter {
    private const val TAG = "FridayBtAudio"
    private var audioManager: AudioManager? = null
    private var isScoStarted = false

    fun startBluetoothSco(context: Context) {
        try {
            if (audioManager == null) {
                audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            }

            audioManager?.let { am ->
                if (!am.isBluetoothScoAvailableOffCall) {
                    Log.w(TAG, "Bluetooth SCO is not available off call on this device")
                    return
                }

                if (!isScoStarted) {
                    am.mode = AudioManager.MODE_IN_COMMUNICATION
                    am.startBluetoothSco()
                    am.isBluetoothScoOn = true
                    isScoStarted = true
                    Log.i(TAG, "🎙️ Bluetooth SCO started (Mic routed to Bluetooth headset)")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error starting Bluetooth SCO: ${e.message}", e)
        }
    }

    fun stopBluetoothSco(context: Context) {
        try {
            audioManager?.let { am ->
                if (isScoStarted) {
                    am.isBluetoothScoOn = false
                    am.stopBluetoothSco()
                    am.mode = AudioManager.MODE_NORMAL
                    isScoStarted = false
                    Log.i(TAG, "🛑 Bluetooth SCO stopped (Mic routed back to phone)")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping Bluetooth SCO: ${e.message}", e)
        }
    }
}
