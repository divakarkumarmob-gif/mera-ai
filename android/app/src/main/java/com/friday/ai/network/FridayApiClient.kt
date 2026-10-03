package com.friday.ai.network

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.location.Location
import android.os.BatteryManager
import android.os.Build
import android.util.Log
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.TimeUnit

object FridayApiClient {
    private const val TAG = "FridayApi"
    
    // Configured live production backend URL
    const val DEFAULT_BACKEND_URL = "https://mera-ai-3496.onrender.com"

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

    fun getBackendUrl(context: Context): String {
        val prefs = context.getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
        return prefs.getString("backend_url", DEFAULT_BACKEND_URL)?.trimEnd('/') ?: DEFAULT_BACKEND_URL
    }

    fun setBackendUrl(context: Context, url: String) {
        val prefs = context.getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
        prefs.edit().putString("backend_url", url.trim().trimEnd('/')).apply()
    }

    fun syncDeviceInfo(context: Context, deviceId: String, username: String, label: String) {
        val prefs = context.getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
        prefs.edit()
            .putString("device_id", deviceId.trim())
            .putString("username", username.trim())
            .putString("device_label", label.trim())
            .apply()
        Log.i(TAG, "Synced device info: deviceId=$deviceId, username=$username, label=$label")
    }

    fun getDeviceId(context: Context): String {
        val prefs = context.getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
        return prefs.getString("device_id", "dev_apk_boss") ?: "dev_apk_boss"
    }

    fun getDeviceLabel(context: Context): String {
        val prefs = context.getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
        return prefs.getString("device_label", "Boss Phone (${Build.MODEL})") ?: "Boss Phone (${Build.MODEL})"
    }

    fun getUsername(context: Context): String {
        val prefs = context.getSharedPreferences("FridayPrefs", Context.MODE_PRIVATE)
        return prefs.getString("username", "boss") ?: "boss"
    }

    /**
     * Pings the server with current device GPS coordinates + Battery telemetry
     * Target: POST /api/location/ping
     */
    fun sendLocationPing(context: Context, location: Location) {
        val backendUrl = getBackendUrl(context)
        val url = "$backendUrl/api/location/ping"

        // Battery Telemetry
        var batteryLevel: Int? = null
        var isCharging: Boolean? = null
        try {
            val batteryIntent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val level = batteryIntent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale = batteryIntent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            if (level >= 0 && scale > 0) {
                batteryLevel = (level * 100) / scale
            }
            val status = batteryIntent?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL
        } catch (ignored: Exception) {}

        val deviceId = getDeviceId(context)
        val label = getDeviceLabel(context)
        val username = getUsername(context)

        val json = JSONObject().apply {
            put("deviceId", deviceId)
            put("label", label)
            put("username", username)
            put("ownerName", username)
            put("platform", "apk")
            put("lat", location.latitude)
            put("lon", location.longitude)
            put("accuracy", location.accuracy)
            put("altitude", if (location.hasAltitude()) location.altitude else JSONObject.NULL)
            put("speed", if (location.hasSpeed()) location.speed else JSONObject.NULL)
            put("batteryLevel", batteryLevel ?: JSONObject.NULL)
            put("isCharging", isCharging ?: JSONObject.NULL)
            put("source", "native-kotlin-service")
            put("lastUpdatedAt", System.currentTimeMillis())
        }

        val body = json.toString().toRequestBody(JSON_MEDIA)
        val request = Request.Builder()
            .url(url)
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.w(TAG, "Location ping failed to $url: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful) {
                        Log.d(TAG, "✅ Location ping delivered to Friday backend HTTP ${it.code}")
                    } else {
                        Log.w(TAG, "Location ping rejected by server HTTP ${it.code}")
                    }
                }
            }
        })
    }

    /**
     * Sends emergency SOS trigger to backend to notify configured WhatsApp / Telegram contacts
     */
    fun triggerSosAlert(context: Context, location: Location?, callback: (Boolean, String) -> Unit) {
        val backendUrl = getBackendUrl(context)
        val url = "$backendUrl/api/sos/trigger"

        val deviceId = "dev_apk_boss"
        val json = JSONObject().apply {
            put("deviceId", deviceId)
            put("triggerSource", "bluetooth_triple_click")
            if (location != null) {
                put("lat", location.latitude)
                put("lon", location.longitude)
                put("mapsUrl", "https://maps.google.com/?q=${location.latitude},${location.longitude}")
            }
            put("timestamp", System.currentTimeMillis())
        }

        val body = json.toString().toRequestBody(JSON_MEDIA)
        val request = Request.Builder()
            .url(url)
            .post(body)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "SOS Alert network failed: ${e.message}")
                callback(false, e.message ?: "Network error")
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    if (it.isSuccessful) {
                        Log.i(TAG, "🚨 SOS Alert successfully processed by Friday backend")
                        callback(true, "SOS sent to server")
                    } else {
                        Log.w(TAG, "SOS Alert HTTP response: ${it.code}")
                        callback(false, "Server HTTP ${it.code}")
                    }
                }
            }
        })
    }
}
