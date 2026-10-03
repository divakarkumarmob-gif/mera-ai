package com.friday.ai.bluetooth

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.util.Log
import android.view.KeyEvent
import com.friday.ai.service.FridayForegroundService

object BluetoothControlManager {
    private const val TAG = "FridayBluetooth"

    // Click Debounce Threshold for 3-tap detection (520ms gives ample window for 3 clicks)
    private const val MULTI_CLICK_TIMEOUT_MS = 520L

    private var mediaSession: MediaSessionCompat? = null
    private val handler = Handler(Looper.getMainLooper())

    private var clickCount = 0

    var onActionTriggered: ((Action) -> Unit)? = null

    enum class Action {
        TOGGLE_MIC,        // 3 Taps (or Assist Key): Wake Friday / Start or Stop Listening
        VOICE_BRIEFING,    // 2 Taps: Weather, Tasks, Battery Briefing
        SILENT_SOS,        // 4+ Taps: Secret GPS Ping + SMS Alert
        STOP_SPEAKING      // Interrupt Friday TTS Speech
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
                        // Media Play passthrough
                    }

                    override fun onPause() {
                        // Media Pause passthrough
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
     * Core Key Event handler for Bluetooth Headsets:
     * - 3 Taps (or Voice Assist key from earbud): Activates FRIDAY (TOGGLE_MIC)
     * - 2 Taps: Voice Briefing
     * - 4+ Taps: Emergency SOS
     * - Tap and hold removed completely as requested.
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

        // Instant trigger when earbud 3-tap sends Voice Assist key
        if (isAssistKey && action == KeyEvent.ACTION_DOWN) {
            Log.i(TAG, "🎙️ Earbud Triple-Tap Assist Key detected -> Waking FRIDAY (TOGGLE_MIC)")
            dispatchAction(context, Action.TOGGLE_MIC)
            return true
        }

        // Fast shortcut for Next Track key (often explicit on neckbands)
        if (keyCode == KeyEvent.KEYCODE_MEDIA_NEXT && action == KeyEvent.ACTION_DOWN) {
            dispatchAction(context, Action.VOICE_BRIEFING)
            return true
        }

        if (action == KeyEvent.ACTION_DOWN) {
            return true
        } else if (action == KeyEvent.ACTION_UP) {
            clickCount++
            handler.removeCallbacksAndMessages(null)

            // Multi-tap evaluation after debounce window (450ms)
            handler.postDelayed({
                when (clickCount) {
                    1 -> {
                        Log.i(TAG, "🔘 Bluetooth Single Tap (Media passthrough)")
                    }
                    2 -> {
                        Log.i(TAG, "🔘 Bluetooth Double Tap -> VOICE_BRIEFING")
                        dispatchAction(context, Action.VOICE_BRIEFING)
                    }
                    3 -> {
                        Log.i(TAG, "🎙️ Bluetooth 3 Taps -> TOGGLE_MIC (Waking FRIDAY)")
                        dispatchAction(context, Action.TOGGLE_MIC)
                    }
                    else -> {
                        if (clickCount >= 4) {
                            Log.i(TAG, "🚨 Bluetooth 4+ Taps -> SILENT_SOS")
                            dispatchAction(context, Action.SILENT_SOS)
                        }
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

        val activeService = FridayForegroundService.instance
        if (activeService != null && FridayForegroundService.isRunning) {
            handler.post {
                activeService.handleBluetoothAction(action)
            }
            return
        }

        // Fallback: Dispatch via Service Intent
        val intent = Intent(context, FridayForegroundService::class.java).apply {
            putExtra(FridayForegroundService.EXTRA_BLUETOOTH_ACTION, action.name)
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
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
