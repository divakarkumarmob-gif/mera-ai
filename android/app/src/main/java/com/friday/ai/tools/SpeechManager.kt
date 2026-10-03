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
import android.util.Log
import java.util.Locale

object SpeechManager : TextToSpeech.OnInitListener {
    private const val TAG = "FridaySpeech"
    private var tts: TextToSpeech? = null
    private var isTtsReady = false

    private var speechRecognizer: SpeechRecognizer? = null
    private var isListening = false
    private val mainHandler = Handler(Looper.getMainLooper())

    var onSpeechRecognized: ((String) -> Unit)? = null
    var onListeningStateChanged: ((Boolean) -> Unit)? = null

    fun init(context: Context) {
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
            Log.i(TAG, "🟢 Friday TTS Engine ready")
        } else {
            Log.e(TAG, "TTS Initialization failed with status $status")
        }
    }

    fun speak(context: Context, text: String, queueMode: Int = TextToSpeech.QUEUE_FLUSH) {
        mainHandler.post {
            init(context)
            if (isTtsReady && tts != null) {
                tts?.speak(text, queueMode, null, "friday_speech_${System.currentTimeMillis()}")
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

    fun toggleListening(context: Context) {
        mainHandler.post {
            if (isListening) {
                stopListening()
            } else {
                startListening(context)
            }
        }
    }

    fun startListening(context: Context) {
        mainHandler.post {
            if (isListening) return@post

            // If Friday is speaking, stop speaking first
            stopSpeaking()

            try {
                if (speechRecognizer == null) {
                    speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context.applicationContext)
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
                        Log.i(TAG, "🎙️ Friday is listening...")
                    }

                    override fun onBeginningOfSpeech() {}
                    override fun onRmsChanged(rmsdB: Float) {}
                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        isListening = false
                        onListeningStateChanged?.invoke(false)
                    }

                    override fun onError(error: Int) {
                        isListening = false
                        onListeningStateChanged?.invoke(false)
                        Log.w(TAG, "Speech recognition error code: $error")
                    }

                    override fun onResults(results: Bundle?) {
                        isListening = false
                        onListeningStateChanged?.invoke(false)
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val spokenText = matches?.firstOrNull()?.trim()
                        if (!spokenText.isNullOrEmpty()) {
                            Log.i(TAG, "🗣️ Recognized: \"$spokenText\"")
                            onSpeechRecognized?.invoke(spokenText)
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
            }
        }
    }

    fun stopListening() {
        mainHandler.post {
            try {
                speechRecognizer?.stopListening()
            } catch (e: Exception) {
                Log.e(TAG, "Error stopping recognizer: ${e.message}")
            }
            isListening = false
            onListeningStateChanged?.invoke(false)
        }
    }

    fun destroy() {
        try {
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
