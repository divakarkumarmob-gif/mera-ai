package com.friday.ai

import android.Manifest
import android.animation.ObjectAnimator
import android.animation.PropertyValuesHolder
import android.animation.ValueAnimator
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.friday.ai.bluetooth.BluetoothAudioRouter
import com.friday.ai.bluetooth.BluetoothControlManager
import com.friday.ai.databinding.ActivityMainBinding
import com.friday.ai.network.FridayWebSocketClient
import com.friday.ai.service.FridayForegroundService
import com.friday.ai.tools.SpeechManager

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private var pulseAnimator: ObjectAnimator? = null

    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val allGranted = permissions.entries.all { it.value }
        if (allGranted) {
            startFridayForegroundService()
        } else {
            Toast.makeText(this, "Permissions required for background GPS & Voice", Toast.LENGTH_LONG).show()
            startFridayForegroundService()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupLockscreenFlags()
        startOrbPulseAnimation()
        setupListeners()
        requestAppPermissions()

        SpeechManager.init(this)
        BluetoothControlManager.initMediaSession(this)
        BluetoothAudioRouter.startBluetoothSco(this)
    }

    private fun setupLockscreenFlags() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
            } else {
                @Suppress("DEPRECATION")
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun requestAppPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.SEND_SMS
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        }

        val ungranted = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (ungranted.isNotEmpty()) {
            permissionsLauncher.launch(ungranted.toTypedArray())
        } else {
            startFridayForegroundService()
        }
    }

    private fun startFridayForegroundService() {
        val serviceIntent = Intent(this, FridayForegroundService::class.java).apply {
            action = FridayForegroundService.ACTION_START
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun setupListeners() {
        // UI Action Buttons
        binding.btnMic.setOnClickListener {
            SpeechManager.toggleListening(this)
        }

        binding.btnBriefing.setOnClickListener {
            val intent = Intent(this, FridayForegroundService::class.java).apply {
                action = FridayForegroundService.ACTION_NOTIF_BRIEFING
            }
            startService(intent)
        }

        binding.btnSos.setOnClickListener {
            val intent = Intent(this, FridayForegroundService::class.java).apply {
                action = FridayForegroundService.ACTION_NOTIF_SOS
            }
            startService(intent)
        }

        // Speech Listeners
        SpeechManager.onListeningStateChanged = { listening ->
            runOnUiThread {
                if (listening) {
                    binding.tvOrbState.text = "LISTENING"
                    binding.tvOrbState.setTextColor(getColor(R.color.friday_cyan_glow))
                    binding.tvTranscript.text = "Listening to your voice..."
                } else {
                    binding.tvOrbState.text = "STANDBY"
                    binding.tvOrbState.setTextColor(getColor(R.color.friday_text_main))
                }
            }
        }

        SpeechManager.onSpeechRecognized = { text ->
            runOnUiThread {
                binding.tvTranscript.text = "You: $text"
                binding.tvOrbState.text = "THINKING"
            }
        }

        FridayWebSocketClient.onMessageReceived = { response ->
            runOnUiThread {
                binding.tvTranscript.text = "Friday: $response"
                binding.tvOrbState.text = "SPEAKING"
            }
        }

        FridayWebSocketClient.onStateChanged = { state ->
            runOnUiThread {
                binding.tvOrbState.text = state
                if (state == "SPEAKING") {
                    binding.tvOrbState.setTextColor(getColor(R.color.friday_cyan_glow))
                } else if (state == "THINKING") {
                    binding.tvOrbState.setTextColor(getColor(R.color.friday_purple))
                }
            }
        }

        FridayWebSocketClient.onConnectionStateChanged = { connected ->
            runOnUiThread {
                if (connected) {
                    binding.tvStatusBadge.text = "ONLINE"
                    binding.tvStatusBadge.setTextColor(getColor(R.color.friday_emerald))
                } else {
                    binding.tvStatusBadge.text = "OFFLINE"
                    binding.tvStatusBadge.setTextColor(getColor(R.color.friday_red))
                }
            }
        }
    }

    private fun startOrbPulseAnimation() {
        val scaleX = PropertyValuesHolder.ofFloat(View.SCALE_X, 1.0f, 1.15f, 1.0f)
        val scaleY = PropertyValuesHolder.ofFloat(View.SCALE_Y, 1.0f, 1.15f, 1.0f)
        val alpha = PropertyValuesHolder.ofFloat(View.ALPHA, 0.4f, 0.9f, 0.4f)

        pulseAnimator = ObjectAnimator.ofPropertyValuesHolder(binding.orbMiddleRing, scaleX, scaleY, alpha).apply {
            duration = 2400L
            repeatCount = ValueAnimator.INFINITE
            repeatMode = ValueAnimator.RESTART
            start()
        }
    }

    override fun onDestroy() {
        pulseAnimator?.cancel()
        super.onDestroy()
    }
}
