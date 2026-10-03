package com.friday.ai.bluetooth

import android.content.Context
import android.media.AudioDeviceInfo
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
                if (isScoStarted) return

                am.mode = AudioManager.MODE_IN_COMMUNICATION

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val devices = am.availableCommunicationDevices
                    val btDevice = devices.firstOrNull {
                        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
                        it.type == AudioDeviceInfo.TYPE_BLE_HEADSET ||
                        it.type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP
                    }
                    if (btDevice != null) {
                        val success = am.setCommunicationDevice(btDevice)
                        Log.i(TAG, "🎙️ Modern Communication Device set (${btDevice.productName}): $success")
                        isScoStarted = success
                        if (success) return
                    }
                }

                // Fallback for Android < 12 or if modern device selection didn't catch
                if (am.isBluetoothScoAvailableOffCall) {
                    am.startBluetoothSco()
                    am.isBluetoothScoOn = true
                    isScoStarted = true
                    Log.i(TAG, "🎙️ Bluetooth SCO started (Legacy)")
                } else {
                    Log.w(TAG, "Bluetooth SCO off-call not available, using standard MODE_IN_COMMUNICATION")
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
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        am.clearCommunicationDevice()
                    }
                    if (am.isBluetoothScoOn) {
                        am.isBluetoothScoOn = false
                        am.stopBluetoothSco()
                    }
                    am.mode = AudioManager.MODE_NORMAL
                    isScoStarted = false
                    Log.i(TAG, "🛑 Bluetooth audio routing released (Mic returned to phone)")
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping Bluetooth audio routing: ${e.message}", e)
        }
    }
}
