package com.friday.ai.network

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
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

    fun connect(context: Context) {
        if (isConnected && webSocket != null) return

        val backendUrl = FridayApiClient.getBackendUrl(context)
        val wsUrl = when {
            backendUrl.startsWith("https://") -> backendUrl.replace("https://", "wss://") + "/live"
            backendUrl.startsWith("http://") -> backendUrl.replace("http://", "ws://") + "/live"
            else -> "wss://$backendUrl/live"
        }

        Log.i(TAG, "Connecting to Friday WebSocket: $wsUrl")

        if (client == null) {
            client = OkHttpClient.Builder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .writeTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(25, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build()
        }

        val request = Request.Builder().url(wsUrl).build()

        webSocket = client?.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(ws: WebSocket, response: Response) {
                Log.i(TAG, "🟢 Friday WebSocket connection established!")
                isConnected = true
                handler.post { onConnectionStateChanged?.invoke(true) }

                // Send Device Info Registration Packet
                val authPacket = JSONObject().apply {
                    put("type", "device_auth")
                    put("client", "friday_native_android")
                    put("model", android.os.Build.MODEL)
                }
                ws.send(authPacket.toString())
            }

            override fun onMessage(ws: WebSocket, text: String) {
                Log.d(TAG, "Received: $text")
                handler.post { onMessageReceived?.invoke(text) }
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
                Log.e(TAG, "WebSocket error: ${t.message}")
                isConnected = false
                handler.post { onConnectionStateChanged?.invoke(false) }

                // Auto-reconnect after 5 seconds
                handler.postDelayed({
                    connect(context)
                }, 5000)
            }
        })
    }

    fun sendMessage(text: String) {
        webSocket?.send(text)
    }

    fun disconnect() {
        webSocket?.close(1000, "Normal closure")
        webSocket = null
        isConnected = false
        onConnectionStateChanged?.invoke(false)
    }
}
