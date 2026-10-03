package com.friday.ai

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log

class FridayApplication : Application() {

    companion object {
        const val TAG = "FridayAI"
        const val FOREGROUND_CHANNEL_ID = "friday_core_channel"
        const val ALERT_CHANNEL_ID = "friday_alert_channel"

        lateinit var instance: FridayApplication
            private set
    }

    override fun onCreate() {
        super.onCreate()
        instance = this

        // Global crash protection
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            Log.e(TAG, "Uncaught exception on thread ${t.name}: ${e.message}", e)
        }

        createNotificationChannels()
        Log.i(TAG, "FRIDAY Application initialized successfully")
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Channel 1: 24/7 Core Persistent Service Channel
            val coreChannel = NotificationChannel(
                FOREGROUND_CHANNEL_ID,
                getString(R.string.channel_name),
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = getString(R.string.channel_desc)
                setShowBadge(false)
                setSound(null, null)
                enableVibration(false)
            }

            // Channel 2: High-Priority Emergency / SOS Alert Channel
            val alertChannel = NotificationChannel(
                ALERT_CHANNEL_ID,
                "FRIDAY Alerts & SOS",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Critical alerts, SOS triggers and Bluetooth status"
                setShowBadge(true)
                enableVibration(true)
            }

            notificationManager.createNotificationChannel(coreChannel)
            notificationManager.createNotificationChannel(alertChannel)
        }
    }
}
