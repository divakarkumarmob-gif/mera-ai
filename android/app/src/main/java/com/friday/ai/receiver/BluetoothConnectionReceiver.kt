package com.friday.ai.receiver

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothProfile
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.friday.ai.FridayApplication
import com.friday.ai.bluetooth.BluetoothAudioRouter
import com.friday.ai.service.FridayForegroundService
import com.friday.ai.tools.SoundEffectsManager
import com.friday.ai.tools.SpeechManager

class BluetoothConnectionReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "FridayBtConn"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        val device: BluetoothDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE, BluetoothDevice::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent.getParcelableExtra(BluetoothDevice.EXTRA_DEVICE)
        }

        val deviceName = try {
            device?.name ?: "Bluetooth Device"
        } catch (e: SecurityException) {
            "Bluetooth Device"
        }

        when (action) {
            BluetoothDevice.ACTION_ACL_CONNECTED -> {
                Log.i(TAG, "🟢 Connected to $deviceName")

                // 1. Exit Smart Sleep & Re-arm CPU WakeLock for instant response
                FridayForegroundService.instance?.exitSmartSleep()

                // 2. Enable Bluetooth SCO Audio Routing for earbud mic
                BluetoothAudioRouter.startBluetoothSco(context)

                // 3. Play wake chime & whisper greeting into earphone
                SoundEffectsManager.playWakeChime()
                SpeechManager.speak(context, "Friday online and armed. Connected to $deviceName.")
            }

            BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                Log.w(TAG, "🔴 Disconnected from $deviceName")

                // Check if any other Bluetooth headsets are still active
                var isOtherHeadsetConnected = false
                try {
                    val btAdapter = BluetoothAdapter.getDefaultAdapter()
                    if (btAdapter != null && btAdapter.isEnabled) {
                        val headsetProfile = btAdapter.getProfileConnectionState(BluetoothProfile.HEADSET)
                        val a2dpProfile = btAdapter.getProfileConnectionState(BluetoothProfile.A2DP)
                        if (headsetProfile == BluetoothProfile.STATE_CONNECTED || a2dpProfile == BluetoothProfile.STATE_CONNECTED) {
                            isOtherHeadsetConnected = true
                        }
                    }
                } catch (e: SecurityException) {
                    Log.w(TAG, "Bluetooth permission not granted for profile check: ${e.message}")
                }

                if (!isOtherHeadsetConnected) {
                    Log.i(TAG, "💤 No Bluetooth audio devices remaining. Triggering Smart Sleep.")
                    BluetoothAudioRouter.stopBluetoothSco(context)

                    // Enter Smart Sleep: releases WakeLock & WifiLock to let CPU enter Android Doze mode
                    FridayForegroundService.instance?.enterSmartSleep()
                }

                // Anti-lost warning & Smart Sleep status notification
                try {
                    val notif = NotificationCompat.Builder(context, FridayApplication.ALERT_CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.stat_notify_error)
                        .setContentTitle("Bluetooth Disconnected")
                        .setContentText("Disconnected from $deviceName. Smart Sleep active to save battery.")
                        .setPriority(NotificationCompat.PRIORITY_HIGH)
                        .setAutoCancel(true)
                        .build()

                    NotificationManagerCompat.from(context).notify(2001, notif)
                } catch (e: Exception) {
                    Log.e(TAG, "Failed to display disconnect alert: ${e.message}")
                }
            }
        }
    }
}
