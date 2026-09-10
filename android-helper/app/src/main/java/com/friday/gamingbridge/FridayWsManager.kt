package com.friday.gamingbridge

import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import okhttp3.*
import org.json.JSONObject
import java.util.concurrent.TimeUnit

object FridayWsManager {
    private const val TAG = "FridayWsManager"
    private var client: OkHttpClient? = null
    private var webSocket: WebSocket? = null
    private var serverUrl: String = ""
    private var sessionToken: String = ""
    private var isManuallyStopped = false
    private val mainHandler = Handler(Looper.getMainLooper())

    var isConnected: Boolean = false
        private set

    var onStatusChange: ((Boolean, String) -> Unit)? = null

    fun init(url: String, token: String) {
        this.serverUrl = url.trim().trimEnd('/')
        this.sessionToken = token.trim()
        this.isManuallyStopped = false

        if (client == null) {
            client = OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(10, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }
    }

    fun connect() {
        if (serverUrl.isEmpty()) {
            notifyStatus(false, "Server URL is missing")
            return
        }

        isManuallyStopped = false
        disconnect()

        val wsUrl = if (serverUrl.startsWith("http://")) {
            serverUrl.replace("http://", "ws://") + "/live"
        } else if (serverUrl.startsWith("https://")) {
            serverUrl.replace("https://", "wss://") + "/live"
        } else if (!serverUrl.startsWith("ws://") && !serverUrl.startsWith("wss://")) {
            "wss://$serverUrl/live"
        } else {
            "$serverUrl/live"
        }

        Log.i(TAG, "Connecting to FRIDAY WebSocket: $wsUrl")
        notifyStatus(false, "Connecting to FRIDAY Server...")

        val request = Request.Builder()
            .url(wsUrl)
            .build()

        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.i(TAG, "🟢 WebSocket Connected to Server!")
                isConnected = true
                notifyStatus(true, "Connected! Sending Device Auth...")

                // Send Auth & Registration packet
                val authPacket = JSONObject().apply {
                    put("type", "auth")
                    put("token", sessionToken)
                    put("clientType", "android_helper")
                    put("isAndroidHelper", true)
                    put("deviceName", "${Build.MANUFACTURER} ${Build.MODEL}")
                    put("model", Build.DEVICE)
                    put("androidVersion", Build.VERSION.RELEASE)
                }
                webSocket.send(authPacket.toString())
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleIncomingMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WebSocket Closing: $code / $reason")
                isConnected = false
                notifyStatus(false, "Closing: $reason")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.w(TAG, "WebSocket Closed: $code / $reason")
                isConnected = false
                notifyStatus(false, "Disconnected")
                scheduleReconnect()
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.e(TAG, "WebSocket Failure: ${t.message}")
                isConnected = false
                notifyStatus(false, "Error: ${t.localizedMessage ?: "Connection failed"}")
                scheduleReconnect()
            }
        })
    }

    fun disconnect() {
        isManuallyStopped = true
        webSocket?.close(1000, "User requested disconnect")
        webSocket = null
        isConnected = false
        notifyStatus(false, "Disconnected")
    }

    private fun scheduleReconnect() {
        if (!isManuallyStopped && serverUrl.isNotEmpty()) {
            mainHandler.postDelayed({
                if (!isConnected && !isManuallyStopped) {
                    Log.i(TAG, "🔄 Auto-reconnecting to FRIDAY Server...")
                    connect()
                }
            }, 3000)
        }
    }

    private fun notifyStatus(connected: Boolean, message: String) {
        mainHandler.post {
            onStatusChange?.invoke(connected, message)
        }
    }

    private fun handleIncomingMessage(text: String) {
        try {
            val json = JSONObject(text)
            val type = json.optString("type")

            if (type == "auth_ack" || type == "android_helper_registered") {
                Log.i(TAG, "✅ Device Registered with FRIDAY AI Server!")
                notifyStatus(true, "🟢 Active & Ready for Free Fire!")
                return
            }

            if (type == "ANDROID_GESTURE" || type == "gaming_copilot_event") {
                val gesture = json.optString("gesture")
                val service = FridayAccessibilityService.instance

                if (service == null) {
                    Log.w(TAG, "⚠️ Accessibility Service is not active. Please enable in Settings!")
                    notifyStatus(true, "⚠️ Enable Accessibility in Settings!")
                    return
                }

                when (gesture.uppercase()) {
                    "TAP" -> {
                        val x = json.optDouble("x", 0.0).toFloat()
                        val y = json.optDouble("y", 0.0).toFloat()
                        val duration = json.optLong("durationMs", 50)
                        service.performTap(x, y, duration)
                    }

                    "DRAG" -> {
                        val startX = json.optDouble("startX", 0.0).toFloat()
                        val startY = json.optDouble("startY", 0.0).toFloat()
                        val endX = json.optDouble("endX", 0.0).toFloat()
                        val endY = json.optDouble("endY", 0.0).toFloat()
                        val duration = json.optLong("durationMs", 100)

                        if (json.has("midX") && json.has("midY")) {
                            val midX = json.optDouble("midX").toFloat()
                            val midY = json.optDouble("midY").toFloat()
                            service.performBezierDrag(startX, startY, midX, midY, endX, endY, duration)
                        } else {
                            service.performDrag(startX, startY, endX, endY, duration)
                        }
                    }

                    else -> {
                        // High-level macro fallback (e.g. drag_headshot directly in event)
                        val action = json.optString("action")
                        val gunType = json.optString("gunType", "smg")
                        if (action == "drag_headshot") {
                            val fireBtnX = 1850f
                            val fireBtnY = 750f
                            val lift = if (gunType == "shotgun") 420f else 320f
                            val speed = if (gunType == "shotgun") 70L else 100L
                            service.performDrag(fireBtnX, fireBtnY, fireBtnX, fireBtnY - lift, speed)
                        } else if (action == "quick_gloo") {
                            service.performTap(420f, 820f, 30) {
                                mainHandler.postDelayed({
                                    service.performTap(1980f, 880f, 30) {
                                        mainHandler.postDelayed({
                                            service.performDrag(1850f, 750f, 1850f, 950f, 50)
                                        }, 20)
                                    }
                                }, 25)
                            }
                        } else if (action == "heal") {
                            service.performTap(350f, 920f, 50)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling message: ${e.message}", e)
        }
    }
}
