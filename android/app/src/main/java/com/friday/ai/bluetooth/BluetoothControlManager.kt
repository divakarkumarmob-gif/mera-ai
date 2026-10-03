package com.friday.ai.bluetooth

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import android.view.KeyEvent
import com.friday.ai.service.FridayForegroundService

object BluetoothControlManager {
    private const val TAG = "FridayBluetooth"

    // Click Debounce Thresholds
    private const val MULTI_CLICK_TIMEOUT_MS = 450L
    private const val LONG_PRESS_TIMEOUT_MS = 900L

    private var mediaSession: MediaSessionCompat? = null
    private val handler = Handler(Looper.getMainLooper())

    private var clickCount = 0
    private var lastDownTime = 0L
    private var isLongPressTriggered = false

    var onActionTriggered: ((Action) -> Unit)? = null

    enum class Action {
        TOGGLE_MIC,        // Single Click: Wake Friday / Start or Stop Listening
        VOICE_BRIEFING,    // Double Click: Weather, Tasks, Unread Messages
        SILENT_SOS,        // Triple Click: Secret GPS Ping + SMS Alert
        STOP_SPEAKING      // Long Press: Interrupt Friday TTS Speech
    }

    /**
     * Initializes the MediaSessionCompat to claim hardware media buttons from Bluetooth headsets
     */
    fun initMediaSession(context: Context) {
        if (mediaSession != null) return

        try {
            mediaSession = MediaSessionCompat(context, "FridayMediaSession").apply {
                setFlags(
                    MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS or
                    MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS
                )

                val state = PlaybackStateCompat.Builder()
                    .setActions(
                        PlaybackStateCompat.ACTION_PLAY or
                        PlaybackStateCompat.ACTION_PAUSE or
                        PlaybackStateCompat.ACTION_PLAY_PAUSE or
                        PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                        PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS or
                        PlaybackStateCompat.ACTION_STOP
                    )
                    .setState(PlaybackStateCompat.STATE_PLAYING, 0, 1.0f)
                    .build()

                setPlaybackState(state)

                setCallback(object : MediaSessionCompat.Callback() {
                    override fun onMediaButtonEvent(mediaButtonEvent: Intent?): Boolean {
                        val keyEvent = mediaButtonEvent?.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
                        if (keyEvent != null) {
                            return handleKeyEvent(context, keyEvent)
                        }
                        return super.onMediaButtonEvent(mediaButtonEvent)
                    }

                    override fun onPlay() {
                        dispatchAction(context, Action.TOGGLE_MIC)
                    }

                    override fun onPause() {
                        dispatchAction(context, Action.TOGGLE_MIC)
                    }

                    override fun onSkipToNext() {
                        dispatchAction(context, Action.VOICE_BRIEFING)
                    }

                    override fun onStop() {
                        dispatchAction(context, Action.STOP_SPEAKING)
                    }
                })

                isActive = true
            }
            Log.i(TAG, "🟢 Friday MediaSession registered & active for Bluetooth buttons")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to initialize MediaSession: ${e.message}", e)
        }
    }

    /**
     * Core Key Event handler for Bluetooth Headsets (Play/Pause, HeadsetHook, Next, Prev)
     */
    fun handleKeyEvent(context: Context, event: KeyEvent): Boolean {
        val keyCode = event.keyCode
        val action = event.action

        // Supported Bluetooth Keys
        val isAssistKey = keyCode == KeyEvent.KEYCODE_VOICE_ASSIST || keyCode == KeyEvent.KEYCODE_ASSIST
        val isMediaKey = keyCode == KeyEvent.KEYCODE_HEADSETHOOK ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PLAY ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PAUSE ||
                keyCode == KeyEvent.KEYCODE_MEDIA_NEXT ||
                keyCode == KeyEvent.KEYCODE_MEDIA_PREVIOUS ||
                isAssistKey

        if (!isMediaKey) return false

        // Instant trigger for Bluetooth Voice Assist key (Earbud Tap & Hold)
        if (isAssistKey && action == KeyEvent.ACTION_DOWN) {
            Log.i(TAG, "🎙️ Bluetooth Tap & Hold Assist Key -> Opening Friday & TOGGLE_MIC")
            dispatchAction(context, Action.TOGGLE_MIC)
            return true
        }

        // Fast shortcut for Next Track key (often explicit on neckbands)
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT && action == KeyEvent.ACTION_DOWN) {
            dispatchAction(context, Action.VOICE_BRIEFING)
            return true
        }

        if (action == KeyEvent.ACTION_DOWN) {
            if (event.repeatCount == 0) {
                lastDownTime = System.currentTimeMillis()
                isLongPressTriggered = false

                // Schedule long-press check
                handler.postDelayed({
                    if (!isLongPressTriggered && (System.currentTimeMillis() - lastDownTime >= LONG_PRESS_TIMEOUT_MS)) {
                        isLongPressTriggered = true
                        clickCount = 0
                        Log.i(TAG, "🔘 Bluetooth Long Press -> STOP_SPEAKING")
                        dispatchAction(context, Action.STOP_SPEAKING)
                    }
                }, LONG_PRESS_TIMEOUT_MS)
            }
            return true
        } else if (action == KeyEvent.ACTION_UP) {
            val pressDuration = System.currentTimeMillis() - lastDownTime

            // If long press was already dispatched, ignore UP event
            if (isLongPressTriggered || pressDuration >= LONG_PRESS_TIMEOUT_MS) {
                return true
            }

            clickCount++
            handler.removeCallbacksAndMessages(null)

            // Multi-click evaluation after debounce window
            handler.postDelayed({
                when (clickCount) {
                    1 -> {
                        Log.i(TAG, "🔘 Bluetooth Single Click -> TOGGLE_MIC")
                        dispatchAction(context, Action.TOGGLE_MIC)
                    }
                    2 -> {
                        Log.i(TAG, "🔘 Bluetooth Double Click -> VOICE_BRIEFING")
                        dispatchAction(context, Action.VOICE_BRIEFING)
                    }
                    3 -> {
                        Log.i(TAG, "🚨 Bluetooth Triple Click -> SILENT_SOS")
                        dispatchAction(context, Action.SILENT_SOS)
                    }
                    else -> {
                        Log.i(TAG, "🔘 Bluetooth Multiple Clicks ($clickCount) -> TOGGLE_MIC")
                        dispatchAction(context, Action.TOGGLE_MIC)
                    }
                }
                clickCount = 0
            }, MULTI_CLICK_TIMEOUT_MS)

            return true
        }

        return false
    }

    private fun dispatchAction(context: Context, action: Action) {
        onActionTriggered?.invoke(action)

        // Also broadcast command to FridayForegroundService
        val intent = Intent(context, FridayForegroundService::class.java).apply {
            putExtra(FridayForegroundService.EXTRA_BLUETOOTH_ACTION, action.name)
        }
        try {
            context.startService(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to forward Bluetooth action to service: ${e.message}")
        }
    }

    fun release() {
        mediaSession?.apply {
            isActive = false
            release()
        }
        mediaSession = null
    }
}
