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

enum class CombatTacticalState {
    FAST_SPRINT_SEARCH,
    RUSH_SHOTGUN,
    MID_RANGE_SMG_DRAG,
    DEPLOY_GLOO_WALL,
    SPRINT_FLANK,
    SNIPE_HEAD,
    HEAL_BEHIND_COVER
}

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

    var currentTacticalState: CombatTacticalState = CombatTacticalState.FAST_SPRINT_SEARCH
        private set

    var onStateChanged: (() -> Unit)? = null

    private var botRunnable: Runnable? = null
    private var lastGlooTime: Long = 0
    private var lastHealTime: Long = 0

    fun setAutoBot(enabled: Boolean, context: Context? = null) {
        if (isAutoBotEnabled == enabled) return
        isAutoBotEnabled = enabled
        if (isAutoBotEnabled) {
            startAutonomousBrain(context)
        } else {
            stopAutonomousBrain()
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

    /**
     * Lock High-Speed Pro Sprint in Free Fire (Permanent fast sprint without stopping)
     */
    fun lockProSprint() {
        val service = FridayAccessibilityService.instance ?: return
        val dm = service.resources.displayMetrics
        val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()

        val joyX = screenWidth * 0.18f
        val joyY = screenHeight * 0.75f
        val sprintBtnX = screenWidth * 0.82f
        val sprintBtnY = screenHeight * 0.28f

        // 1. Drag joystick up to top sprint lock
        service.performDrag(joyX, joyY, joyX, joyY - 260f, 250) {
            // 2. Tap dedicated in-game Sprint icon
            mainHandler.postDelayed({
                service.performTap(sprintBtnX, sprintBtnY, 30)
            }, 30)
        }
    }

    fun triggerAutoRun() {
        lockProSprint()
    }

    /**
     * Precision Headshot Drag with Hitbox Targeting (Head / Neck / Chest)
     */
    fun triggerHeadshotDrag(gunType: String = "smg", targetHitbox: String = "head") {
        val service = FridayAccessibilityService.instance ?: return
        val dm = service.resources.displayMetrics
        val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()

        val fireX = screenWidth * 0.82f
        val fireY = screenHeight * 0.72f

        val liftMultiplier = when (targetHitbox.lowercase()) {
            "head" -> 1.0f
            "neck" -> 0.85f
            else -> 0.65f
        }

        when (gunType.lowercase()) {
            "shotgun", "m1887", "m1014" -> {
                // Explosive J-Drag for Shotguns (downward micro-pull then high speed lift)
                val liftY = (screenHeight * 0.42f) * liftMultiplier
                val dipY = fireY + 25f
                val midX = fireX + (if (isHumanBehaviorEnabled) (Math.random() * 16 - 8).toFloat() else 0f)
                service.performBezierDrag(fireX, fireY, midX, dipY, fireX, fireY - liftY, 70)
            }
            "sniper", "awm", "kar98" -> {
                // Quick-Scope Snap
                val scopeX = screenWidth * 0.72f
                val scopeY = screenHeight * 0.48f
                val switchWeaponX = screenWidth * 0.52f
                val switchWeaponY = screenHeight * 0.88f

                service.performTap(scopeX, scopeY, 25) {
                    mainHandler.postDelayed({
                        service.performTap(fireX, fireY, 30) {
                            mainHandler.postDelayed({
                                service.performTap(switchWeaponX, switchWeaponY, 25)
                            }, 20)
                        }
                    }, 30)
                }
            }
            else -> {
                // SMG / AR Straight Vertical Drag to Head with Recoil Control
                val liftY = (screenHeight * 0.32f) * liftMultiplier
                if (isHumanBehaviorEnabled) {
                    val midX = fireX + (Math.random() * 18 - 9).toFloat()
                    val midY = fireY - (liftY * 0.48f)
                    service.performBezierDrag(fireX, fireY, midX, midY, fireX, fireY - liftY, 105)
                } else {
                    service.performDrag(fireX, fireY, fireX, fireY - liftY, 90)
                }
            }
        }
    }

    /**
     * Instant 360 Sit-up Gloo Wall Placement (Feet defense)
     */
    fun triggerQuickGloo() {
        val now = System.currentTimeMillis()
        if (now - lastGlooTime < 1500) return
        lastGlooTime = now

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

        // Gloo Wall -> Crouch -> Drag Fire down to feet in 80ms
        service.performTap(glooX, glooY, 25) {
            mainHandler.postDelayed({
                service.performTap(crouchX, crouchY, 25) {
                    mainHandler.postDelayed({
                        service.performDrag(fireX, fireY, fireX, fireY + 180f, 45)
                    }, 15)
                }
            }, 20)
        }
    }

    /**
     * Auto Medkit / Heal
     */
    fun triggerAutoHeal() {
        val now = System.currentTimeMillis()
        if (now - lastHealTime < 4000) return
        lastHealTime = now

        val service = FridayAccessibilityService.instance ?: return
        val dm = service.resources.displayMetrics
        val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()

        val healX = screenWidth * 0.15f
        val healY = screenHeight * 0.85f
        service.performTap(healX, healY, 40)
    }

    /**
     * Execute Server AI Tactical Decision in real-time
     */
    fun executeTacticalAction(actionStr: String, targetHitbox: String = "head") {
        when (actionStr.uppercase()) {
            "RUSH_SHOTGUN" -> {
                lockProSprint()
                mainHandler.postDelayed({
                    triggerHeadshotDrag("shotgun", targetHitbox)
                    mainHandler.postDelayed({ triggerQuickGloo() }, 150)
                }, 300)
            }
            "MID_RANGE_SMG_DRAG" -> {
                triggerHeadshotDrag("smg", targetHitbox)
            }
            "DEPLOY_GLOO_WALL" -> {
                triggerQuickGloo()
            }
            "SPRINT_FLANK" -> {
                lockProSprint()
                val service = FridayAccessibilityService.instance ?: return
                val dm = service.resources.displayMetrics
                val screenWidth = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
                val screenHeight = Math.min(dm.widthPixels, dm.heightPixels).toFloat()
                service.performDrag(screenWidth * 0.65f, screenHeight * 0.5f, screenWidth * 0.78f, screenHeight * 0.5f, 70)
            }
            "SNIPE_HEAD" -> {
                triggerHeadshotDrag("sniper", "head")
            }
            "HEAL_BEHIND_COVER" -> {
                triggerQuickGloo()
                mainHandler.postDelayed({ triggerAutoHeal() }, 200)
            }
            else -> {
                lockProSprint()
            }
        }
    }

    /**
     * 100% Autonomous Intelligent Esports Brain Loop
     */
    private fun startAutonomousBrain(context: Context?) {
        stopAutonomousBrain()
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

        var brainCycle = 0

        botRunnable = object : Runnable {
            override fun run() {
                if (!isAutoBotEnabled) return

                brainCycle++

                val jumpX = screenWidth * 0.95f
                val jumpY = screenHeight * 0.60f
                val camX = screenWidth * 0.65f
                val camY = screenHeight * 0.50f

                when (brainCycle % 6) {
                    0 -> {
                        // High-Speed Sprint Lock
                        lockProSprint()
                    }
                    1 -> {
                        // Scan Horizon & Jump-Dodge
                        service.performDrag(camX, camY, camX + 120f, camY, 60) {
                            mainHandler.postDelayed({
                                service.performTap(jumpX, jumpY, 30)
                            }, 40)
                        }
                    }
                    2 -> {
                        // Auto Aim Headshot J-Drag
                        if (isAutoHeadshotEnabled) {
                            triggerHeadshotDrag("smg", "head")
                        }
                    }
                    3 -> {
                        // Sprint Zig-Zag Flank
                        lockProSprint()
                        service.performDrag(camX, camY, camX - 100f, camY, 60)
                    }
                    4 -> {
                        // Fast Shotgun Burst + Defense Gloo
                        if (isAutoHeadshotEnabled) {
                            triggerHeadshotDrag("shotgun", "head")
                        }
                    }
                    5 -> {
                        // Continuous Sprint Keepalive
                        lockProSprint()
                    }
                }

                mainHandler.postDelayed(this, 750)
            }
        }
        mainHandler.post(botRunnable!!)
    }

    private fun stopAutonomousBrain() {
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
