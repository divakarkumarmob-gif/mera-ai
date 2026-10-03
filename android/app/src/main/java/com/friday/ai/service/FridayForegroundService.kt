package com.friday.ai.service

import android.app.Notification
import android.app.NotificationManager
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
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import com.friday.ai.tools.LocationTracker
import com.friday.ai.tools.SmsController
import com.friday.ai.tools.SpeechManager
import com.friday.ai.tools.SoundEffectsManager
import com.friday.ai.tools.TorchController
import java.text.SimpleDateFormat
import java.util.Calendar
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

        var isSmartSleep: Boolean = false
            private set

        var currentLocation: Location? = null
            get() = instance?.locationTracker?.lastKnownLocation

        var instance: FridayForegroundService? = null
            private set
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

        // Wire speech recognition: offline resolver first, then cloud AI fallback
        SpeechManager.onSpeechRecognized = { text ->
            Log.i(TAG, "User voice query: $text")
            if (!handleOfflineVoiceCommand(text)) {
                if (FridayWebSocketClient.isConnected) {
                    FridayWebSocketClient.sendMessage(text)
                } else {
                    SpeechManager.speak(this, "Internet is offline, Boss. I can execute offline commands like torch, time, battery, and SOS.")
                }
            }
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
                wakeScreen()
                SpeechManager.toggleListening(this)

                // Launch / bring Friday assistant to screen over lockscreen
                try {
                    val launchIntent = Intent(this, com.friday.ai.MainActivity::class.java).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
                        putExtra("TRIGGER_MIC_ON_START", true)
                    }
                    startActivity(launchIntent)
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to launch MainActivity on TOGGLE_MIC: ${e.message}")
                }
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
                SoundEffectsManager.playDoneChime()
                vibrateDevice(30L)
            }
        }
    }

    private fun executeQuickBriefing() {
        // 1. Futuristic audio chime + double haptic pulse
        SoundEffectsManager.playAffirmationChime()
        vibratePattern(longArrayOf(0, 70, 50, 90))

        // 2. Dynamic time-based greeting
        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY)
        val greeting = when {
            hour in 5..11 -> "Good morning Boss."
            hour in 12..16 -> "Good afternoon Boss."
            hour in 17..21 -> "Good evening Boss."
            else -> "Good night Boss."
        }

        val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
        val currentTime = timeFormat.format(Date())

        // 3. Battery status & charging detection
        val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
        val batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
        val isCharging = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val status = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_STATUS)
            status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
        } else {
            false
        }

        val batteryReport = when {
            isCharging -> "Battery is at $batteryPct percent and charging."
            batteryPct <= 20 -> "Warning, battery is low at $batteryPct percent."
            else -> "Battery is at $batteryPct percent."
        }

        // 4. Network connectivity
        val cm = getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val activeNetwork = cm?.activeNetwork
        val caps = cm?.getNetworkCapabilities(activeNetwork)
        val netStatus = when {
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true -> "Wi-Fi online."
            caps?.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) == true -> "Mobile network active."
            else -> "Offline mode."
        }

        // 5. GPS status
        val loc = locationTracker?.lastKnownLocation
        val locStatus = if (loc != null) "GPS locked." else "Locating satellite."

        // 6. Complete concise briefing (< 6 seconds)
        val whisperTag = if (SpeechManager.isWhisperModeActive(this)) "Night whisper active." else ""
        val briefingText = "$greeting The time is $currentTime. $batteryReport $netStatus $locStatus $whisperTag Friday is standing by."
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

    private fun handleOfflineVoiceCommand(rawText: String): Boolean {
        val query = rawText.lowercase(Locale.getDefault()).trim()

        // 1. Torch / Flashlight ON
        if (query.contains("torch on") || query.contains("turn on torch") || query.contains("flashlight on") ||
            query.contains("torch chalu") || query.contains("light on") || query.contains("light chalu") ||
            query.contains("torch jalao") || query.contains("flash on")) {
            val ok = TorchController.setTorch(this, true)
            SoundEffectsManager.playAffirmationChime()
            SpeechManager.speak(this, if (ok) "Flashlight turned on." else "Flashlight is unavailable.")
            return true
        }

        // 2. Torch / Flashlight OFF
        if (query.contains("torch off") || query.contains("turn off torch") || query.contains("flashlight off") ||
            query.contains("torch band") || query.contains("light off") || query.contains("light band") ||
            query.contains("torch bujhao") || query.contains("flash off")) {
            TorchController.setTorch(this, false)
            SoundEffectsManager.playAffirmationChime()
            SpeechManager.speak(this, "Flashlight turned off.")
            return true
        }

        // 3. Time Inquiry
        if (query.contains("time kya") || query.contains("kitna time") || query.contains("what time") ||
            query.contains("current time") || query.contains("samay kya") || query == "time") {
            val timeFormat = SimpleDateFormat("h:mm a", Locale.getDefault())
            val currentTime = timeFormat.format(Date())
            SoundEffectsManager.playAffirmationChime()
            SpeechManager.speak(this, "The time is $currentTime, Boss.")
            return true
        }

        // 4. Battery Inquiry
        if (query.contains("battery") || query.contains("charge") || query.contains("charging") || query.contains("kitni charging")) {
            val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
            val batteryPct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
            SoundEffectsManager.playAffirmationChime()
            SpeechManager.speak(this, "Battery is currently at $batteryPct percent, Boss.")
            return true
        }

        // 5. Quick Briefing
        if (query.contains("briefing") || query.contains("system status") || query.contains("status update") || query.contains("update do")) {
            executeQuickBriefing()
            return true
        }

        // 6. Emergency SOS
        if (query == "sos" || query.contains("emergency") || query.contains("bachao") || query.contains("help me")) {
            executeSilentSos()
            return true
        }

        return false
    }

    private fun startForegroundWithNotification() {
        val notif = buildNotification()

        val hasFine = androidx.core.content.ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.ACCESS_FINE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val hasCoarse = androidx.core.content.ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.ACCESS_COARSE_LOCATION
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED
        val hasMic = androidx.core.content.ContextCompat.checkSelfPermission(
            this, android.Manifest.permission.RECORD_AUDIO
        ) == android.content.pm.PackageManager.PERMISSION_GRANTED

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                if (hasFine || hasCoarse) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                }
                if (hasMic) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                }
                startForeground(NOTIFICATION_ID, notif, types)
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                var types = 0
                if (hasFine || hasCoarse) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
                }
                if (hasMic) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                }
                if (types != 0) {
                    startForeground(NOTIFICATION_ID, notif, types)
                } else {
                    startForeground(NOTIFICATION_ID, notif)
                }
            } else {
                startForeground(NOTIFICATION_ID, notif)
            }
        } catch (e: Exception) {
            Log.w(TAG, "Foreground start fallback: ${e.message}")
            try { startForeground(NOTIFICATION_ID, notif) } catch (ignored: Throwable) {}
        }
    }

    fun enterSmartSleep() {
        if (isSmartSleep) return
        isSmartSleep = true
        Log.i(TAG, "🌙 Entering Smart Sleep Mode (WakeLock released to save battery, Doze mode enabled)")
        releaseLocks()
        locationTracker?.stopTracking()
        updateNotification("FRIDAY AI (Smart Sleep)", "💤 Earbuds Disconnected • Battery Saver Active")
    }

    fun exitSmartSleep() {
        if (!isSmartSleep) return
        isSmartSleep = false
        Log.i(TAG, "☀️ Exiting Smart Sleep Mode (Earbuds Reconnected, WakeLock re-armed)")
        acquireLocks()
        locationTracker?.startTracking()
        updateNotification("FRIDAY AI Active", "🎧 Bluetooth Button Ready • 📍 GPS Syncing")
    }

    fun updateNotification(title: String, content: String) {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        nm?.notify(NOTIFICATION_ID, buildNotification(title, content))
    }

    private fun buildNotification(title: String? = null, content: String? = null): Notification {
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
            .setContentTitle(title ?: "FRIDAY AI Active")
            .setContentText(content ?: "🎧 Bluetooth Button Ready • 📍 GPS Syncing")
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

    private fun wakeScreen() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            @Suppress("DEPRECATION")
            val screenLock = pm.newWakeLock(
                PowerManager.SCREEN_BRIGHT_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
                "FridayAI:ScreenWakeUp"
            )
            screenLock.acquire(3000L)
            Log.i(TAG, "💡 Screen turned ON via WakeLock for voice interaction")
        } catch (e: Exception) {
            Log.w(TAG, "Screen wake error: ${e.message}")
        }
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
