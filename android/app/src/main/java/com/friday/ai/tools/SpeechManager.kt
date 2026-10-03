package com.friday.ai.tools

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import java.util.Locale

object SpeechManager : TextToSpeech.OnInitListener {
    private const val TAG = "FridaySpeech"
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    val isSpeaking: Boolean
        get() = tts?.isSpeaking == true

    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false
    private val mainHandler = Handler(Looper.getMainLooper())

    private var appContext: Context? = null

    // Continuous 3-minute session state
    var isSessionActive: Boolean = false
        private set

    // 3 Minutes continuous silence timeout (180,000 ms)
    private const val SESSION_TIMEOUT_MS = 180_000L
    private var sessionTimeoutRunnable: Runnable? = null

    private val restartListeningRunnable = Runnable {
        if (isSessionActive && !isSpeaking) {
            internalStartListening()
        }
    }

    var onSpeechRecognized: ((String) -> Unit)? = null
    var onListeningStateChanged: ((Boolean) -> Unit)? = null

    fun init(context: Context) {
        appContext = context.applicationContext
        if (tts == null) {
            tts = TextToSpeech(context.applicationContext, this)
        }
    }

    override fun onInit(status: Int) {
        if (status == TextToSpeech.SUCCESS) {
            val result = tts?.setLanguage(Locale.US)
            if (result == TextToSpeech.LANG_MISSING_DATA || result == TextToSpeech.LANG_NOT_SUPPORTED) {
                Log.w(TAG, "Default US language not supported, using device default")
                tts?.language = Locale.getDefault()
            }
            tts?.setPitch(1.05f)
            tts?.setSpeechRate(1.0f)
            isTtsReady = true

            // Set up UtteranceProgressListener to seamlessly resume listening when Friday finishes speaking
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(utteranceId: String?) {
                    // Temporarily stop listening while speaking to prevent echo
                    mainHandler.post {
                        stopListeningInternal()
                    }
                }

                override fun onDone(utteranceId: String?) {
                    mainHandler.post {
                        if (isSessionActive) {
                            Log.i(TAG, "🔊 Friday finished speaking -> Auto-resuming listening loop")
                            mainHandler.removeCallbacks(restartListeningRunnable)
                            mainHandler.postDelayed(restartListeningRunnable, 350L)
                        }
                    }
                }

                override fun onError(utteranceId: String?) {
                    mainHandler.post {
                        if (isSessionActive) {
                            mainHandler.removeCallbacks(restartListeningRunnable)
                            mainHandler.postDelayed(restartListeningRunnable, 350L)
                        }
                    }
                }
            })

            Log.i(TAG, "🟢 Friday TTS Engine ready with UtteranceProgressListener")
        } else {
            Log.e(TAG, "TTS Initialization failed with status $status")
        }
    }

    fun isNightHours(): Boolean {
        val cal = java.util.Calendar.getInstance()
        val hour = cal.get(java.util.Calendar.HOUR_OF_DAY)
        val minute = cal.get(java.util.Calendar.MINUTE)
        // 10:30 PM (22:30) to 06:00 AM (06:00)
        return (hour > 22 || (hour == 22 && minute >= 30) || hour < 6)
    }

    fun isWhisperModeActive(context: Context? = null): Boolean {
        val ctx = context ?: appContext
        if (ctx != null) {
            val prefs = ctx.getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
            val override = prefs.getString("whisper_mode", "auto")
            if (override == "always") return true
            if (override == "disabled") return false
        }
        return isNightHours()
    }

    fun speak(context: Context, text: String, queueMode: Int = TextToSpeech.QUEUE_FLUSH) {
        mainHandler.post {
            init(context)
            if (isTtsReady && tts != null) {
                val whisperActive = isWhisperModeActive(context)
                if (whisperActive) {
                    tts?.setPitch(0.92f)
                    tts?.setSpeechRate(0.90f)
                } else {
                    tts?.setPitch(1.05f)
                    tts?.setSpeechRate(1.0f)
                }

                val params = Bundle().apply {
                    putFloat(
                        TextToSpeech.Engine.KEY_PARAM_VOLUME,
                        if (whisperActive) 0.45f else 1.0f
                    )
                }

                val utteranceId = "friday_speech_${System.currentTimeMillis()}"
                tts?.speak(text, queueMode, params, utteranceId)
            } else {
                Log.w(TAG, "TTS not ready yet, queuing...")
            }
        }
    }

    fun stopSpeaking() {
        mainHandler.post {
            try {
                if (tts?.isSpeaking == true) {
                    tts?.stop()
                    Log.i(TAG, "🛑 Friday speech stopped (interrupted)")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping TTS: ${e.message}")
            }
        }
    }

    /**
     * Toggles the continuous session:
     * - If active -> Ends session (User triple-tapped to dismiss)
     * - If inactive -> Starts continuous 3-minute listening session
     */
    fun toggleListening(context: Context) {
        mainHandler.post {
            if (isSessionActive) {
                Log.i(TAG, "🔘 Earbud Triple-Tap while active -> Ending Session")
                endSession(feedbackMessage = "Theek hai Boss, standby par hoon.")
            } else {
                Log.i(TAG, "🔘 Earbud Triple-Tap while inactive -> Starting 3-minute Continuous Session")
                startContinuousSession(context)
            }
        }
    }

    /**
     * Starts continuous listening session for up to 3 minutes of silence.
     */
    fun startContinuousSession(context: Context) {
        mainHandler.post {
            appContext = context.applicationContext
            isSessionActive = true
            Log.i(TAG, "🎙️ Friday Continuous 3-minute Session Started")
            SoundEffectsManager.playWakeChime()
            resetInactivityTimer()
            internalStartListening()
        }
    }

    /**
     * Resets the 3-minute silence countdown timer.
     * Called on start of session and whenever user speaks a sentence.
     */
    fun resetInactivityTimer() {
        sessionTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
        sessionTimeoutRunnable = Runnable {
            if (isSessionActive) {
                Log.i(TAG, "⏳ 3 Minutes of continuous silence reached. Automatically closing session.")
                endSession(feedbackMessage = "3 minute silence ho gaya hai Boss. Standby par ja rahi hoon.")
            }
        }
        mainHandler.postDelayed(sessionTimeoutRunnable!!, SESSION_TIMEOUT_MS)
        Log.d(TAG, "⏱️ Inactivity timer reset to 3 minutes (${SESSION_TIMEOUT_MS / 1000}s)")
    }

    /**
     * Ends the continuous session immediately.
     */
    fun endSession(feedbackMessage: String? = null) {
        mainHandler.post {
            if (!isSessionActive && speechRecognizer == null) return@post
            isSessionActive = false
            sessionTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
            mainHandler.removeCallbacks(restartListeningRunnable)
            stopListeningInternal()

            Log.i(TAG, "🛑 Friday Session Closed")
            if (!feedbackMessage.isNullOrEmpty()) {
                val ctx = appContext
                if (ctx != null) {
                    speak(ctx, feedbackMessage)
                } else {
                    SoundEffectsManager.playDoneChime()
                }
            } else {
                SoundEffectsManager.playDoneChime()
            }
        }
    }

    private fun internalStartListening() {
        val context = appContext ?: return
        if (isSpeaking) {
            Log.d(TAG, "TTS is speaking, deferring listen restart...")
            return
        }

        try {
            if (speechRecognizer == null) {
                speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context)
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }

            speechRecognizer?.setRecognitionListener(object : RecognitionListener {
                override fun onReadyForSpeech(params: Bundle?) {
                    isListening = true
                    onListeningStateChanged?.invoke(true)
                    Log.i(TAG, "🎙️ Friday is listening (session active: $isSessionActive)...")
                }

                override fun onBeginningOfSpeech() {
                    Log.d(TAG, "Speech detected...")
                }

                override fun onRmsChanged(rmsdB: Float) {}
                override fun onBufferReceived(buffer: ByteArray?) {}

                override fun onEndOfSpeech() {
                    isListening = false
                    onListeningStateChanged?.invoke(false)
                }

                override fun onError(error: Int) {
                    isListening = false
                    onListeningStateChanged?.invoke(false)
                    Log.d(TAG, "SpeechRecognizer error: $error (sessionActive=$isSessionActive)")

                    // If session is still active and 3 minutes haven't passed, keep looping!
                    if (isSessionActive && !isSpeaking) {
                        mainHandler.removeCallbacks(restartListeningRunnable)
                        // Recreate recognizer if it encounters internal client/busy errors
                        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || error == SpeechRecognizer.ERROR_CLIENT) {
                            try {
                                speechRecognizer?.destroy()
                                speechRecognizer = null
                            } catch (ignored: Exception) {}
                        }
                        // Short 250ms backoff before listening again
                        mainHandler.postDelayed(restartListeningRunnable, 250L)
                    }
                }

                override fun onResults(results: Bundle?) {
                    isListening = false
                    onListeningStateChanged?.invoke(false)

                    val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                    val spokenText = matches?.firstOrNull()?.trim()

                    if (!spokenText.isNullOrEmpty()) {
                        Log.i(TAG, "🗣️ Recognized: \"$spokenText\"")
                        // Reset 3-minute silence timer on every spoken phrase!
                        if (isSessionActive) {
                            resetInactivityTimer()
                        }
                        onSpeechRecognized?.invoke(spokenText)
                    } else if (isSessionActive && !isSpeaking) {
                        // Empty result during active session -> keep listening
                        mainHandler.removeCallbacks(restartListeningRunnable)
                        mainHandler.postDelayed(restartListeningRunnable, 250L)
                    }
                }

                override fun onPartialResults(partialResults: Bundle?) {}
                override fun onEvent(eventType: Int, params: Bundle?) {}
            })

            speechRecognizer?.startListening(intent)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start speech recognizer: ${e.message}", e)
            isListening = false
            onListeningStateChanged?.invoke(false)
            if (isSessionActive && !isSpeaking) {
                mainHandler.removeCallbacks(restartListeningRunnable)
                mainHandler.postDelayed(restartListeningRunnable, 500L)
            }
        }
    }

    private fun stopListeningInternal() {
        try {
            speechRecognizer?.stopListening()
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping recognizer: ${e.message}")
        }
        isListening = false
        onListeningStateChanged?.invoke(false)
    }

    fun startListening(context: Context) {
        startContinuousSession(context)
    }

    fun stopListening() {
        endSession()
    }

    fun destroy() {
        try {
            isSessionActive = false
            sessionTimeoutRunnable?.let { mainHandler.removeCallbacks(it) }
            mainHandler.removeCallbacks(restartListeningRunnable)

            tts?.stop()
            tts?.shutdown()
            tts = null
            isTtsReady = false

            speechRecognizer?.destroy()
            speechRecognizer = null
            isListening = false
        } catch (e: Exception) {
            Log.e(TAG, "Error destroying speech manager: ${e.message}")
        }
    }
}

