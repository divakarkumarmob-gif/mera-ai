package com.friday.ai.tools

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.os.Build
import android.util.Log
import java.util.concurrent.Executors
import kotlin.math.sin

/**
 * High-performance, zero-asset synthesized Audio Chime Engine for FRIDAY.
 * Plays futuristic sci-fi earbud chimes directly into Bluetooth SCO / Headsets
 * without requiring any external MP3/WAV files.
 */
object SoundEffectsManager {
    private const val TAG = "FridaySfx"
    private const val SAMPLE_RATE = 44100
    private val executor = Executors.newSingleThreadExecutor()

    fun isNightHours(): Boolean {
        val cal = java.util.Calendar.getInstance()
        val hour = cal.get(java.util.Calendar.HOUR_OF_DAY)
        val minute = cal.get(java.util.Calendar.MINUTE)
        return (hour > 22 || (hour == 22 && minute >= 30) || hour < 6)
    }

    private fun getVolumeMultiplier(): Float {
        return if (isNightHours()) 0.40f else 1.0f
    }

    /**
     * Futuristic rising dual-tone chime: indicates FRIDAY is awake and listening.
     * Frequencies: 880Hz (A5) -> 1318.5Hz (E6)
     */
    fun playWakeChime() {
        executor.execute {
            try {
                // Generate two-tone rising chime: 90ms at 880Hz, then 110ms at 1318Hz
                val pcmPart1 = generateSineWave(880.0, 90, 0.45f)
                val pcmPart2 = generateSineWave(1318.5, 110, 0.50f)
                val combined = ShortArray(pcmPart1.size + pcmPart2.size)
                System.arraycopy(pcmPart1, 0, combined, 0, pcmPart1.size)
                System.arraycopy(pcmPart2, 0, combined, pcmPart1.size, pcmPart2.size)

                playPcmSound(combined)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to play wake chime: ${e.message}")
            }
        }
    }

    /**
     * Soft descending chime: indicates FRIDAY finished hearing you and is thinking/processing.
     * Frequencies: 1174Hz (D6) -> 784Hz (G5)
     */
    fun playDoneChime() {
        executor.execute {
            try {
                val pcmPart1 = generateSineWave(1174.6, 70, 0.40f)
                val pcmPart2 = generateSineWave(783.9, 90, 0.35f)
                val combined = ShortArray(pcmPart1.size + pcmPart2.size)
                System.arraycopy(pcmPart1, 0, combined, 0, pcmPart1.size)
                System.arraycopy(pcmPart2, 0, combined, pcmPart1.size, pcmPart2.size)

                playPcmSound(combined)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to play done chime: ${e.message}")
            }
        }
    }

    /**
     * Crisp high-pitch affirmation chime for completed action or trigger.
     */
    fun playAffirmationChime() {
        executor.execute {
            try {
                val pcm = generateSineWave(1760.0, 80, 0.40f)
                playPcmSound(pcm)
            } catch (e: Exception) {
                Log.w(TAG, "Failed to play affirmation chime: ${e.message}")
            }
        }
    }

    /**
     * Synthesizes a clean sine wave with gentle fade-in and fade-out envelope to avoid audio clicks.
     */
    private fun generateSineWave(frequencyHz: Double, durationMs: Int, volume: Float): ShortArray {
        val numSamples = (SAMPLE_RATE * (durationMs / 1000.0)).toInt()
        val buffer = ShortArray(numSamples)
        val angularFreq = 2.0 * Math.PI * frequencyHz / SAMPLE_RATE

        val fadeSamples = (numSamples * 0.15).toInt().coerceAtLeast(1)
        val scaledVolume = volume * getVolumeMultiplier()

        for (i in 0 until numSamples) {
            val rawSample = sin(angularFreq * i)

            // Smooth linear envelope (Attack & Decay) to prevent speaker pop
            val envelope = when {
                i < fadeSamples -> i.toFloat() / fadeSamples
                i > numSamples - fadeSamples -> (numSamples - i).toFloat() / fadeSamples
                else -> 1.0f
            }

            val sampleValue = (rawSample * envelope * scaledVolume * Short.MAX_VALUE).toInt()
            buffer[i] = sampleValue.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }

        return buffer
    }

    /**
     * Plays raw PCM buffer using Android AudioTrack configured for Voice/Communication output.
     */
    private fun playPcmSound(pcmBuffer: ShortArray) {
        val bufferSizeBytes = pcmBuffer.size * 2

        val audioAttributes = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANCE_SONIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()

        val audioFormat = AudioFormat.Builder()
            .setSampleRate(SAMPLE_RATE)
            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
            .build()

        var track: AudioTrack? = null
        try {
            track = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                AudioTrack.Builder()
                    .setAudioAttributes(audioAttributes)
                    .setAudioFormat(audioFormat)
                    .setBufferSizeInBytes(bufferSizeBytes)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()
            } else {
                @Suppress("DEPRECATION")
                AudioTrack(
                    AudioManager.STREAM_VOICE_CALL,
                    SAMPLE_RATE,
                    AudioFormat.CHANNEL_OUT_MONO,
                    AudioFormat.ENCODING_PCM_16BIT,
                    bufferSizeBytes,
                    AudioTrack.MODE_STATIC
                )
            }

            track.write(pcmBuffer, 0, pcmBuffer.size)
            track.play()

            // Wait until tone is finished playing before releasing track
            val playDurationMs = (pcmBuffer.size.toDouble() / SAMPLE_RATE * 1000).toLong() + 30L
            Thread.sleep(playDurationMs)
        } catch (e: Exception) {
            Log.e(TAG, "AudioTrack playback error: ${e.message}")
        } finally {
            try {
                track?.stop()
                track?.release()
            } catch (ignored: Exception) {}
        }
    }
}
