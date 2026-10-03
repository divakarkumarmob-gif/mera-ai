package com.friday.ai.service

import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.core.app.NotificationCompat
import com.friday.ai.FridayApplication
import com.friday.ai.MainActivity
import com.friday.ai.R
import com.friday.ai.bluetooth.BluetoothControlManager
import com.friday.ai.network.FridayApiClient
import com.friday.ai.network.FridayWebSocketClient
import com.friday.ai.tools.LocationTracker
import com.friday.ai.tools.SmsController
import com.friday.ai.tools.SpeechManager
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class FridayForegroundService : Service() {

    companion object {
        private const val TAG = "FridayForeground"
        private const val NOTIFICATION_ID = 1001

        const val ACTION_START = "com.friday.ai.ACTION_START"
        const val ACTION_STOP = "com.friday.ai.ACTION_STOP"
        const val ACTION_NOTIF_MIC = "com.friday.ai.NOTIF_MIC"
        const val ACTION_NOTIF_BRIEFING = "com.friday.ai.NOTIF_BRIEFING"
        const val ACTION_NOTIF_SOS = "com.friday.ai.NOTIF_SOS"

        const val EXTRA_BLUETOOTH_ACTION = "EXTRA_BLUETOOTH_ACTION"

        var isRunning: Boolean = false
            private set

        var currentLocation: Location? = null
            get() = instance?.locationTracker?.lastKnownLocation

        private var instance: FridayForegroundService? = null
    }

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null
    private var locationTracker: LocationTracker? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        acquireLocks()

        locationTracker = LocationTracker(this)
        SpeechManager.init(this)
        BluetoothControlManager.initMediaSession(this)

        // Connect WebSocket for live AI agent communication
        FridayWebSocketClient.connect(this)

        // Wire speech recognition back to AI agent
        SpeechManager.onSpeechRecognized = { text ->
            Log.i(TAG, "User voice query: $text")
            FridayWebSocketClient.sendMessage(text)
        }

        // Wire AI agent responses to TTS voice
        FridayWebSocketClient.onMessageReceived = { responseText ->
            SpeechManager.speak(this, responseText)
        }

        Log.i(TAG, "🟢 FridayForegroundService created")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action

        when (action) {
            ACTION_STOP -> {
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_NOTIF_MIC -> {
                handleBluetoothAction(BluetoothControlManager.Action.TOGGLE_MIC)
                return START_STICKY
            }
            ACTION_NOTIF_BRIEFING -> {
                handleBluetoothAction(BluetoothControlManager.Action.VOICE_BRIEFING)
                return START_STICKY
            }
            ACTION_NOTIF_SOS -> {
                handleBluetoothAction(BluetoothControlManager.Action.SILENT_SOS)
                return START_STICKY
            }
        }

        // Bluetooth hardware action dispatched from BluetoothControlManager
        val btActionName = intent?.getStringExtra(EXTRA_BLUETOOTH_ACTION)
        if (!btActionName.isNullOrEmpty()) {
            try {
                val btAction = BluetoothControlManager.Action.valueOf(btActionName)
                handleBluetoothAction(btAction)
            } catch (e: Exception) {
                Log.e(TAG, "Unknown Bluetooth action: $btActionName")
            }
            return START_STICKY
        }

        startForegroundWithNotification()
        locationTracker?.startTracking()
        isRunning = true

        return START_STICKY
    }

    private fun handleBluetoothAction(action: BluetoothControlManager.Action) {
        when (action) {
            BluetoothControlManager.Action.TOGGLE_MIC -> {
                Log.i(TAG, "🎙️ Executing TOGGLE_MIC via Bluetooth")
                vibrateDevice(50L)
                SpeechManager.toggleListening(this)
            }

            BluetoothControlManager.Action.VOICE_BRIEFING -> {
                Log.i(TAG, "⚡ Executing VOICE_BRIEFING via Bluetooth")
                vibrateDevice(100L)
                executeQuickBriefing()
            }

            BluetoothControlManager.Action.SILENT_SOS -> {
                Log.i(TAG, "🚨 Executing SILENT_SOS via Bluetooth Triple Click")
                executeSilentSos()
            }

            BluetoothControlManager.Action.STOP_SPEAKING -> {
                Log.i(TAG, "🛑 Executing STOP_SPEAKING via Bluetooth Long Press")
                SpeechManager.stopSpeaking()
                vibrateDevice(30L)
            }
        }
    }

    private fun executeQuickBriefing() {
        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
        val currentTime = timeFormat.format(Date())

        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)

        val loc = locationTracker?.lastKnownLocation
        val locText = if (loc != null) "GPS signal locked." else "Locating satellite signal."

        val briefingText = "Good day, Sir. The time is $currentTime. Your battery is at $batteryPct percent. $locText Friday is standing by."
        SpeechManager.speak(this, briefingText)
    }

    private fun executeSilentSos() {
        // Haptic double pulse confirmation
        vibratePattern(longArrayOf(0, 150, 100, 250))

        val loc = locationTracker?.lastKnownLocation

        // 1. Post to Friday Backend Server
        FridayApiClient.triggerSosAlert(this, loc) { success, msg ->
            Log.i(TAG, "Backend SOS callback: success=$success, msg=$msg")
        }

        // 2. Dispatch Emergency SMS if configured
        val prefs = getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
        val emergencyContact = prefs.getString("emergency_contact", "")?.trim()
        if (!emergencyContact.isNullOrEmpty()) {
            SmsController.sendEmergencySosSms(this, emergencyContact, loc)
        }

        // 3. Audio confirmation in earbud
        SpeechManager.speak(this, "Emergency SOS broadcasted. Location dispatched.")
    }

    private fun startForegroundWithNotification() {
        val notif = buildNotification()

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                startForeground(NOTIFICATION_ID, notif, types)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                startForeground(NOTIFICATION_ID, notif, types)
            } else {
                startForeground(NOTIFICATION_ID, notif)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Foreground start fallback: ${e.message}")
            try { startForeground(NOTIFICATION_ID, notif) } catch (ignored: Throwable) {}
        }
    }

    private fun buildNotification(): Notification {
        val openAppIntent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openAppPending = PendingIntent.getActivity(
            this, 0, openAppIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        // Mic Action Button
        val micIntent = Intent(this, FridayForegroundService::class.java).apply { action = ACTION_NOTIF_MIC }
        val micPending = PendingIntent.getService(
            this, 1, micIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        // Briefing Action Button
        val briefingIntent = Intent(this, FridayForegroundService::class.java).apply { action = ACTION_NOTIF_BRIEFING }
        val briefingPending = PendingIntent.getService(
            this, 2, briefingIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        // SOS Action Button
        val sosIntent = Intent(this, FridayForegroundService::class.java).apply { action = ACTION_NOTIF_SOS }
        val sosPending = PendingIntent.getService(
            this, 3, sosIntent,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
        )

        return NotificationCompat.Builder(this, FridayApplication.FOREGROUND_CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("FRIDAY AI Active")
            .setContentText("🎧 Bluetooth Button Ready • 📍 GPS Syncing")
            .setContentIntent(openAppPending)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(android.R.drawable.ic_btn_speak_now, "Mic", micPending)
            .addAction(android.R.drawable.ic_menu_info_details, "Briefing", briefingPending)
            .addAction(android.R.drawable.ic_dialog_alert, "SOS", sosPending)
            .build()
    }

    private fun acquireLocks() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (wakeLock == null || !wakeLock!!.isHeld) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FridayAI:ServiceWakeLock")
                wakeLock?.acquire(24 * 60 * 60 * 1000L) // 24 hours
            }
        } catch (e: Exception) {
            Log.e(TAG, "WakeLock error: ${e.message}")
        }

        try {
            val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
            if (wifiLock == null || !wifiLock!!.isHeld) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "FridayAI:WifiLock")
                wifiLock?.acquire()
            }
        } catch (e: Exception) {
            Log.e(TAG, "WifiLock error: ${e.message}")
        }
    }

    private fun releaseLocks() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
            wakeLock = null
        } catch (ignored: Exception) {}

        try {
            if (wifiLock?.isHeld == true) wifiLock?.release()
            wifiLock = null
        } catch (ignored: Exception) {}
    }

    private fun vibrateDevice(durationMs: Long) {
        try {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createOneShot(durationMs, VibrationEffect.DEFAULT_AMPLITUDE))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(durationMs)
            }
        } catch (ignored: Exception) {}
    }

    private fun vibratePattern(pattern: LongArray) {
        try {
            val vibrator = getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                vibrator?.vibrate(VibrationEffect.createWaveform(pattern, -1))
            } else {
                @Suppress("DEPRECATION")
                vibrator?.vibrate(pattern, -1)
            }
        } catch (ignored: Exception) {}
    }

    override fun onDestroy() {
        isRunning = false
        locationTracker?.stopTracking()
        BluetoothControlManager.release()
        FridayWebSocketClient.disconnect()
        SpeechManager.destroy()
        releaseLocks()
        instance = null
        super.onDestroy()
        Log.i(TAG, "🔴 FridayForegroundService destroyed")
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
