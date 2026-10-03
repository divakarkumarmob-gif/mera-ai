package com.friday.ai.network

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import com.friday.ai.service.FridayAccessibilityService
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object FridayWebSocketClient {
    private const val TAG = "FridayWs"
    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private val handler = Handler(Looper.getMainLooper())

    var isConnected: Boolean = false
        private set

    var onMessageReceived: ((String) -> Unit)? = null
    var onConnectionStateChanged: ((Boolean) -> Unit)? = null
    var onStateChanged: ((String) -> Unit)? = null

    fun connect(context: Context) {
        if (isConnected && webSocket != null) return

        val backendUrl = FridayApiClient.getBackendUrl(context)
        val wsUrl = when {
            backendUrl.startsWith("https://") -> backendUrl.replace("https://", "wss://") + "/live"
            backendUrl.startsWith("http://") -> backendUrl.replace("http://", "ws://") + "/live"
            else -> "wss://$backendUrl/live"
        }

        Log.i(TAG, "Connecting to Friday Live WebSocket at: $wsUrl")

        if (client == null) {
            client = OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .writeTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(20, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }

        val request = Request.Builder().url(wsUrl).build()

        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "🟢 Friday WebSocket connection established with https://mera-ai-3496.onrender.com")
                isConnected = true
                handler.post { onConnectionStateChanged?.invoke(true) }

                // 1. Send Security Authentication Packet
                val authPacket = JSONObject().apply {
                    put("type", "auth")
                    put("token", "default_friday_key")
                    put("isAndroidHelper", true)
                    put("deviceName", "FRIDAY Native Android")
                    put("model", Build.MODEL)
                }
                ws.send(authPacket.toString())

                // 2. Initialize Gemini Live Assistant Session
                val initPacket = JSONObject().apply {
                    put("type", "init")
                    put("voice", "Aoede")
                    put("thinkingLevel", "high")
                }
                ws.send(initPacket.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)

                    // 1. Text transcript from Friday / Gemini
                    if (json.has("text")) {
                        val speechText = json.getString("text")
                        handler.post { onMessageReceived?.invoke(speechText) }
                    }

                    // 2. State indicators (Speaking / Thinking)
                    if (json.has("type")) {
                        val type = json.getString("type")
                        when (type) {
                            "speaking" -> handler.post { onStateChanged?.invoke("SPEAKING") }
                            "thinking" -> handler.post { onStateChanged?.invoke("THINKING") }
                            "auth_ack" -> Log.i(TAG, "✅ Server authenticated session token")
                            "android_helper_registered" -> Log.i(TAG, "🎮 Registered as Accessibility Touch Driver")
                        }
                    }

                    // 3. Screen Touch Automation Command (Free Fire / System Control)
                    if (json.has("action")) {
                        val action = json.getString("action")
                        when (action) {
                            "tap" -> {
                                val x = json.optDouble("x", 0.0).toFloat()
                                val y = json.optDouble("y", 0.0).toFloat()
                                val duration = json.optLong("duration", 50L)
                                FridayAccessibilityService.dispatchTap(x, y, duration)
                            }
                            "drag" -> {
                                val sx = json.optDouble("startX", 0.0).toFloat()
                                val sy = json.optDouble("startY", 0.0).toFloat()
                                val ex = json.optDouble("endX", 0.0).toFloat()
                                val ey = json.optDouble("endY", 0.0).toFloat()
                                val duration = json.optLong("duration", 300L)
                                FridayAccessibilityService.dispatchDrag(sx, sy, ex, ey, duration)
                            }
                        }
                    }

                } catch (e: Exception) {
                    // Plain text payload fallback
                    handler.post { onMessageReceived?.invoke(text) }
                }
            }

            override fun onClosing(ws: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WebSocket closing: $reason (code $code)")
            }

            override fun onClosed(ws: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WebSocket closed: $reason")
                isConnected = false
                handler.post { onConnectionStateChanged?.invoke(false) }
            }

            override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket connection error: ${t.message}")
                isConnected = false
                handler.post { onConnectionStateChanged?.invoke(false) }

                // Auto-reconnect to backend after 4 seconds
                handler.postDelayed({
                    connect(context)
                }, 4000)
            }
        })
    }

    fun sendMessage(text: String) {
        val payload = JSONObject().apply {
            put("type", "chat_message")
            put("text", text)
        }
        webSocket?.send(payload.toString())
    }

    fun disconnect() {
        webSocket?.close(1000, "Normal closure")
        webSocket = null
        isConnected = false
        onConnectionStateChanged?.invoke(false)
    }
}
