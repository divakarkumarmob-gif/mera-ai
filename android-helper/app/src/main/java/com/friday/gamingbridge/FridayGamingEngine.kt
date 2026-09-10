package com.friday.gamingbridge

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Toast
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException

object FridayGamingEngine {
    private const val TAG = "FridayGamingEngine"
    private val mainHandler = Handler(Looper.getMainLooper())
    private val httpClient = OkHttpClient()

    // Control States
    var isAutoBotEnabled: Boolean = false
        private set
    var isAutoAimEnabled: Boolean = true
        private set
    var isCoPilotEnabled: Boolean = true
        private set
    var isAutoHeadshotEnabled: Boolean = true
        private set
    var isHumanBehaviorEnabled: Boolean = true
        private set

    var onStateChanged: (() -> Unit)? = null

    private var botRunnable: Runnable? = null

    fun setAutoBot(enabled: Boolean, context: Context? = null) {
        if (isAutoBotEnabled == enabled) return
        isAutoBotEnabled = enabled
        if (isAutoBotEnabled) {
            startAutonomousLoop(context)
        } else {
            stopAutonomousLoop()
        }
        notifyStateChange()
    }

    fun setAutoAim(enabled: Boolean) {
        isAutoAimEnabled = enabled
        notifyStateChange()
    }

    fun setCoPilot(enabled: Boolean) {
        isCoPilotEnabled = enabled
        notifyStateChange()
    }

    fun setAutoHeadshot(enabled: Boolean) {
        isAutoHeadshotEnabled = enabled
        notifyStateChange()
    }

    fun setHumanBehavior(enabled: Boolean) {
        isHumanBehaviorEnabled = enabled
        notifyStateChange()
    }

    private fun notifyStateChange() {
        mainHandler.post {
            onStateChanged?.invoke()
        }
    }

    fun triggerHeadshotDrag() {
        val service = FridayAccessibilityService.instance ?: return
        val dm = service.resources.displayMetrics
        val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()

        val fireX = screenWidth * 0.82f
        val fireY = screenHeight * 0.72f
        val liftY = screenHeight * 0.32f

        if (isHumanBehaviorEnabled) {
            val midX = fireX + (Math.random() * 20 - 10).toFloat()
            val midY = fireY - (liftY * 0.45f)
            service.performBezierDrag(fireX, fireY, midX, midY, fireX, fireY - liftY, 95)
        } else {
            service.performDrag(fireX, fireY, fireX, fireY - liftY, 80)
        }
    }

    fun triggerQuickGloo() {
        val service = FridayAccessibilityService.instance ?: return
        val dm = service.resources.displayMetrics
        val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()

        val glooX = screenWidth * 0.20f
        val glooY = screenHeight * 0.78f
        val crouchX = screenWidth * 0.90f
        val crouchY = screenHeight * 0.82f
        val fireX = screenWidth * 0.82f
        val fireY = screenHeight * 0.72f

        service.performTap(glooX, glooY, 30) {
            mainHandler.postDelayed({
                service.performTap(crouchX, crouchY, 30) {
                    mainHandler.postDelayed({
                        service.performDrag(fireX, fireY, fireX, fireY + 160f, 50)
                    }, 20)
                }
            }, 25)
        }
    }

    fun triggerAutoRun() {
        val service = FridayAccessibilityService.instance ?: return
        val dm = service.resources.displayMetrics
        val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()

        val joyX = screenWidth * 0.18f
        val joyY = screenHeight * 0.75f
        service.performDrag(joyX, joyY, joyX, joyY - 220f, 400)
    }

    private fun startAutonomousLoop(context: Context?) {
        stopAutonomousLoop()
        val service = FridayAccessibilityService.instance
        if (service == null) {
            context?.let {
                Toast.makeText(it, "⚠️ Accessibility Permission not active!", Toast.LENGTH_LONG).show()
            }
            isAutoBotEnabled = false
            notifyStateChange()
            return
        }

        val dm = service.resources.displayMetrics
        val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()

        var loopStep = 0
        botRunnable = object : Runnable {
            override fun run() {
                if (!isAutoBotEnabled) return

                val joyX = screenWidth * 0.18f
                val joyY = screenHeight * 0.75f
                val fireX = screenWidth * 0.82f
                val fireY = screenHeight * 0.72f
                val jumpX = screenWidth * 0.95f
                val jumpY = screenHeight * 0.60f
                val camX = screenWidth * 0.65f
                val camY = screenHeight * 0.50f

                loopStep++

                when (loopStep % 4) {
                    0 -> {
                        // Forward movement sprint
                        service.performDrag(joyX, joyY, joyX, joyY - 180f, 350)
                    }
                    1 -> {
                        // Camera look & jump
                        service.performDrag(camX, camY, camX + 110f, camY, 80) {
                            mainHandler.postDelayed({
                                service.performTap(jumpX, jumpY, 40)
                            }, 50)
                        }
                    }
                    2 -> {
                        // Auto Aim / Headshot check
                        if (isAutoHeadshotEnabled) {
                            val lift = screenHeight * 0.30f
                            if (isHumanBehaviorEnabled) {
                                service.performBezierDrag(fireX, fireY, fireX + 10f, fireY - (lift * 0.5f), fireX, fireY - lift, 90)
                            } else {
                                service.performDrag(fireX, fireY, fireX, fireY - lift, 80)
                            }
                        }
                    }
                    3 -> {
                        // Continuous Sprint
                        service.performDrag(joyX, joyY, joyX, joyY - 200f, 300)
                    }
                }

                mainHandler.postDelayed(this, 1200)
            }
        }
        mainHandler.post(botRunnable!!)
    }

    private fun stopAutonomousLoop() {
        if (botRunnable != null) {
            mainHandler.removeCallbacks(botRunnable!!)
            botRunnable = null
        }
    }

    /**
     * Send Best Free Fire Sensitivity Settings to Boss DK's WhatsApp using WhatsApp 2
     */
    fun sendSensitivityToWhatsApp(serverUrl: String, callback: (Boolean, String) -> Unit) {
        val cleanUrl = serverUrl.trim().trimEnd('/')
        val httpUrl = if (cleanUrl.startsWith("ws://")) {
            cleanUrl.replace("ws://", "http://")
        } else if (cleanUrl.startsWith("wss://")) {
            cleanUrl.replace("wss://", "https://")
        } else if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
            "https://$cleanUrl"
        } else {
            cleanUrl
        } + "/api/gaming/freefire/send-sensitivity-whatsapp"

        val bodyJson = JSONObject().apply {
            put("playerTag", "Boss DK")
            put("source", "android_touch_helper")
            put("autoBotActive", isAutoBotEnabled)
            put("autoAim", isAutoAimEnabled)
            put("coPilot", isCoPilotEnabled)
            put("humanBehavior", isHumanBehaviorEnabled)
        }

        val requestBody = bodyJson.toString().toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder()
            .url(httpUrl)
            .post(requestBody)
            .build()

        httpClient.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                Log.e(TAG, "Failed to send sensitivity to WhatsApp", e)
                mainHandler.post {
                    callback(false, "Network error: ${e.localizedMessage}")
                }
            }

            override fun onResponse(call: Call, response: Response) {
                val resStr = response.body?.string() ?: "{}"
                try {
                    val resJson = JSONObject(resStr)
                    val ok = resJson.optBoolean("ok", response.isSuccessful)
                    val msg = resJson.optString("message", "Sensitivity sent to WhatsApp via WhatsApp 2!")
                    mainHandler.post {
                        callback(ok, msg)
                    }
                } catch (e: Exception) {
                    mainHandler.post {
                        callback(response.isSuccessful, if (response.isSuccessful) "Sensitivity sent!" else "Server returned ${response.code}")
                    }
                }
            }
        })
    }
}
