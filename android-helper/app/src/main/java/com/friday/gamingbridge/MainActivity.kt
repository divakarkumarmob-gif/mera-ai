package com.friday.gamingbridge

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.Gravity
import android.view.ViewGroup
import android.widget.*

class MainActivity : Activity() {

    private lateinit var statusText: TextView
    private lateinit var serverInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var connectBtn: Button
    private lateinit var accessibilityStatus: TextView

    private fun dpToPx(dp: Int): Int = (dp * resources.displayMetrics.density).toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        try {
            Thread.setDefaultUncaughtExceptionHandler { _, throwable ->
                throwable.printStackTrace()
            }
        } catch (ignored: Throwable) {}

        val prefs = getSharedPreferences("friday_prefs", Context.MODE_PRIVATE)

        val scroll = ScrollView(this).apply {
            setBackgroundColor(Color.parseColor("#090D16"))
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
        }

        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(18), dpToPx(24), dpToPx(18), dpToPx(36))
            gravity = Gravity.CENTER_HORIZONTAL
        }
        scroll.addView(layout)

        // Title
        val title = TextView(this).apply {
            text = "⚡ FRIDAY GAMING BRIDGE"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 20f
            paint.isFakeBoldText = true
            gravity = Gravity.CENTER
            setPadding(0, 0, 0, dpToPx(16))
        }
        layout.addView(title)

        // Status Card
        statusText = TextView(this).apply {
            text = "⚪ Ready to Connect"
            setTextColor(Color.parseColor("#E2E8F0"))
            textSize = 13f
            gravity = Gravity.CENTER
            background = createCardBg(Color.parseColor("#1E293B"), Color.parseColor("#334155"), 14f)
            setPadding(dpToPx(14), dpToPx(12), dpToPx(14), dpToPx(12))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        layout.addView(statusText)

        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(12)) })

        // Step 1: Accessibility Permission Button
        accessibilityStatus = TextView(this).apply {
            text = "Step 1: Accessibility Permission"
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 13f
        }
        layout.addView(accessibilityStatus)

        val btnAccess = Button(this).apply {
            text = "⚙️ Grant Accessibility (Screen Touch)"
            setTextColor(Color.WHITE)
            textSize = 12f
            background = createCardBg(Color.parseColor("#4F46E5"), Color.parseColor("#6366F1"), 12f)
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }
        layout.addView(btnAccess)

        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(8)) })

        // Step 2: Overlay Permission Button
        val btnOverlay = Button(this).apply {
            text = "🪟 Grant Floating Window (HUD)"
            setTextColor(Color.WHITE)
            textSize = 12f
            background = createCardBg(Color.parseColor("#0F766E"), Color.parseColor("#14B8A6"), 12f)
            setOnClickListener {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && !Settings.canDrawOverlays(this@MainActivity)) {
                    val intent = Intent(
                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                        Uri.parse("package:$packageName")
                    )
                    startActivity(intent)
                } else {
                    Toast.makeText(this@MainActivity, "Overlay already granted!", Toast.LENGTH_SHORT).show()
                }
            }
        }
        layout.addView(btnOverlay)

        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(12)) })

        // Server URL Input
        val lblServer = TextView(this).apply {
            text = "FRIDAY Render Server URL:"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 11f
        }
        layout.addView(lblServer)

        val savedUrl = prefs.getString("server_url", "https://mera-ai-3496.onrender.com") ?: "https://mera-ai-3496.onrender.com"
        serverInput = EditText(this).apply {
            setText(savedUrl)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            textSize = 13f
            hint = "https://mera-ai-3496.onrender.com"
            background = createCardBg(Color.parseColor("#1E293B"), Color.parseColor("#475569"), 10f)
            setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        layout.addView(serverInput)

        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(8)) })

        // Token Input
        val lblToken = TextView(this).apply {
            text = "App Key Token (Optional if open):"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 11f
        }
        layout.addView(lblToken)

        val savedToken = prefs.getString("auth_token", "default_friday_key") ?: "default_friday_key"
        tokenInput = EditText(this).apply {
            setText(savedToken)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            textSize = 13f
            hint = "default_friday_key"
            background = createCardBg(Color.parseColor("#1E293B"), Color.parseColor("#475569"), 10f)
            setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        layout.addView(tokenInput)

        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(14)) })

        // Connect Button
        connectBtn = Button(this).apply {
            text = "🚀 CONNECT TO FRIDAY (START CO-PILOT)"
            setTextColor(Color.WHITE)
            textSize = 13f
            paint.isFakeBoldText = true
            background = createCardBg(Color.parseColor("#059669"), Color.parseColor("#10B981"), 12f)
            setOnClickListener {
                toggleConnection()
            }
        }
        layout.addView(connectBtn)

        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(16)) })

        // ==================== DASHBOARD IN-GAME HUD CONTROL BOX ====================
        val hudCard = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dpToPx(16), dpToPx(14), dpToPx(16), dpToPx(14))
            background = createCardBg(Color.parseColor("#0F172A"), Color.parseColor("#38BDF8"), 16f)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }

        val hudHeader = TextView(this).apply {
            text = "⚡ FRIDAY IN-GAME HUD CONTROLS"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 13f
            paint.isFakeBoldText = true
            setPadding(0, 0, 0, dpToPx(10))
        }
        hudCard.addView(hudHeader)

        // 1. Auto Bot Toggle
        val switchAutoBot = Switch(this).apply {
            isChecked = FridayGamingEngine.isAutoBotEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setAutoBot(isChecked, this@MainActivity)
                Toast.makeText(this@MainActivity, if (isChecked) "🟢 Auto-Bot Active!" else "🔴 Auto-Bot Paused", Toast.LENGTH_SHORT).show()
            }
        }
        hudCard.addView(createToggleRow("🤖 1. Auto Bot", "Full AI autonomous movement & combat", switchAutoBot))

        // 2. Auto Aim Toggle
        val switchAutoAim = Switch(this).apply {
            isChecked = FridayGamingEngine.isAutoAimEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setAutoAim(isChecked)
            }
        }
        hudCard.addView(createToggleRow("🎯 2. Auto Aim", "Smart enemy aim-lock assist", switchAutoAim))

        // 3. Co-Pilot (Duo Mode) Toggle
        val switchCoPilot = Switch(this).apply {
            isChecked = FridayGamingEngine.isCoPilotEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setCoPilot(isChecked)
            }
        }
        hudCard.addView(createToggleRow("👥 3. Co-Pilot (Duo)", "Duo play: You move, Friday shoots", switchCoPilot))

        // 4. Auto Headshot Toggle
        val switchHeadshot = Switch(this).apply {
            isChecked = FridayGamingEngine.isAutoHeadshotEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setAutoHeadshot(isChecked)
            }
        }
        hudCard.addView(createToggleRow("🔴 4. Auto Headshot", "Instant J-drag red numbers aim", switchHeadshot))

        // 5. Humanized Behaviour Toggle
        val switchHuman = Switch(this).apply {
            isChecked = FridayGamingEngine.isHumanBehaviorEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setHumanBehavior(isChecked)
            }
        }
        hudCard.addView(createToggleRow("🧠 5. Human Behavior", "Anti-ban natural curved Bezier drag", switchHuman))

        hudCard.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(8)) })

        // Send Best Sensi to WhatsApp (WhatsApp 2) Button
        val sendSensiBtn = Button(this).apply {
            text = "📤 Send Best Sensi to WhatsApp (WA2)"
            setTextColor(Color.WHITE)
            textSize = 11f
            paint.isFakeBoldText = true
            background = createCardBg(Color.parseColor("#047857"), Color.parseColor("#10B981"), 12f)
            setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
            setOnClickListener {
                val currentUrl = serverInput.text.toString().trim()
                text = "⏳ Sending Sensi via WhatsApp 2..."
                isEnabled = false
                FridayGamingEngine.sendSensitivityToWhatsApp(currentUrl) { success, msg ->
                    text = "📤 Send Best Sensi to WhatsApp (WA2)"
                    isEnabled = true
                    Toast.makeText(this@MainActivity, if (success) "✅ $msg" else "❌ $msg", Toast.LENGTH_LONG).show()
                }
            }
        }
        hudCard.addView(sendSensiBtn)

        hudCard.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(8)) })

        // Quick Macro Row
        val macroRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }

        val btnDrag = Button(this).apply {
            text = "🎯 Headshot Drag"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dpToPx(4)
            }
            background = createCardBg(Color.parseColor("#DC2626"), Color.parseColor("#EF4444"), 10f)
            setOnClickListener {
                FridayGamingEngine.triggerHeadshotDrag()
                Toast.makeText(this@MainActivity, "🎯 Drag Headshot Executed!", Toast.LENGTH_SHORT).show()
            }
        }

        val btnGloo = Button(this).apply {
            text = "🛡️ Quick Gloo"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dpToPx(4)
            }
            background = createCardBg(Color.parseColor("#2563EB"), Color.parseColor("#3B82F6"), 10f)
            setOnClickListener {
                FridayGamingEngine.triggerQuickGloo()
                Toast.makeText(this@MainActivity, "🛡️ Fast Gloo Deployed!", Toast.LENGTH_SHORT).show()
            }
        }

        val btnRun = Button(this).apply {
            text = "🏃 Auto Run"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            background = createCardBg(Color.parseColor("#7C3AED"), Color.parseColor("#8B5CF6"), 10f)
            setOnClickListener {
                FridayGamingEngine.triggerAutoRun()
                Toast.makeText(this@MainActivity, "🏃 Sprint Locked!", Toast.LENGTH_SHORT).show()
            }
        }

        macroRow.addView(btnDrag)
        macroRow.addView(btnGloo)
        macroRow.addView(btnRun)
        hudCard.addView(macroRow)

        layout.addView(hudCard)

        setContentView(scroll)

        FridayGamingEngine.onStateChanged = {
            switchAutoBot.isChecked = FridayGamingEngine.isAutoBotEnabled
            switchAutoAim.isChecked = FridayGamingEngine.isAutoAimEnabled
            switchCoPilot.isChecked = FridayGamingEngine.isCoPilotEnabled
            switchHeadshot.isChecked = FridayGamingEngine.isAutoHeadshotEnabled
            switchHuman.isChecked = FridayGamingEngine.isHumanBehaviorEnabled
        }

        FridayWsManager.onStatusChange = { connected, message ->
            statusText.text = message
            if (connected) {
                connectBtn.text = "🛑 DISCONNECT CO-PILOT"
                connectBtn.background = createCardBg(Color.parseColor("#DC2626"), Color.parseColor("#EF4444"), 12f)
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                    FloatingOverlayService.start(this)
                }
            } else {
                connectBtn.text = "🚀 CONNECT TO FRIDAY (START CO-PILOT)"
                connectBtn.background = createCardBg(Color.parseColor("#059669"), Color.parseColor("#10B981"), 12f)
            }
        }
    }

    private fun createToggleRow(titleText: String, subtitleText: String, switchView: Switch): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dpToPx(8), dpToPx(6), dpToPx(8), dpToPx(6))
            background = createCardBg(Color.parseColor("#141D2E"), Color.parseColor("#1E293B"), 10f)
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            ).apply {
                bottomMargin = dpToPx(6)
            }
        }

        val textCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }

        val title = TextView(this).apply {
            text = titleText
            setTextColor(Color.WHITE)
            textSize = 12f
            paint.isFakeBoldText = true
        }
        val sub = TextView(this).apply {
            text = subtitleText
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 9.5f
        }
        textCol.addView(title)
        textCol.addView(sub)

        row.addView(textCol)
        row.addView(switchView)
        return row
    }

    override fun onResume() {
        super.onResume()
        val isAccessRunning = FridayAccessibilityService.isRunning
        accessibilityStatus.text = if (isAccessRunning) {
            "Step 1: Accessibility ✅ ACTIVE"
        } else {
            "Step 1: Accessibility ⚠️ DISABLED (Click below)"
        }
        accessibilityStatus.setTextColor(
            if (isAccessRunning) Color.parseColor("#22C55E") else Color.parseColor("#F59E0B")
        )
    }

    private fun toggleConnection() {
        if (FridayWsManager.isConnected) {
            FridayWsManager.disconnect()
            FloatingOverlayService.stop(this)
        } else {
            val url = serverInput.text.toString().trim()
            val token = tokenInput.text.toString().trim()

            getSharedPreferences("friday_prefs", Context.MODE_PRIVATE).edit()
                .putString("server_url", url)
                .putString("auth_token", token)
                .apply()

            FridayWsManager.init(url, token)
            FridayWsManager.connect()
        }
    }

    private fun createCardBg(bgColor: Int, strokeColor: Int, radiusDp: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(bgColor)
            cornerRadius = dpToPx(radiusDp.toInt()).toFloat()
            setStroke(dpToPx(1), strokeColor)
        }
    }
}
