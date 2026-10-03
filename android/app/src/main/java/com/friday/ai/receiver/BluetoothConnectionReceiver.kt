package com.friday.ai.receiver

import android.bluetooth.BluetoothDevice
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.friday.ai.FridayApplication
import com.friday.ai.bluetooth.BluetoothAudioRouter
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
                // Enable Bluetooth SCO Audio Routing for earbud mic
                BluetoothAudioRouter.startBluetoothSco(context)

                // Whisper Greeting into earphone
                SpeechManager.speak(context, "Friday online. Connected to $deviceName.")
            }

            BluetoothDevice.ACTION_ACL_DISCONNECTED -> {
                Log.w(TAG, "🔴 Disconnected from $deviceName")
                BluetoothAudioRouter.stopBluetoothSco(context)

                // Anti-lost warning
                try {
                    val notif = NotificationCompat.Builder(context, FridayApplication.ALERT_CHANNEL_ID)
                        .setSmallIcon(android.R.drawable.stat_notify_error)
                        .setContentTitle("Bluetooth Disconnected")
                        .setContentText("Disconnected from $deviceName. Ensure your phone is with you.")
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
