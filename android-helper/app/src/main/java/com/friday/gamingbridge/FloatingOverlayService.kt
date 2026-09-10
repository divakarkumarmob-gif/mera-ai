package com.friday.gamingbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.IBinder
import android.view.*
import android.widget.*
import androidx.core.app.NotificationCompat

class FloatingOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var floatingBubble: View? = null
    private var expandedPanel: View? = null
    private var isExpanded = false

    companion object {
        private const val CHANNEL_ID = "FridayOverlayChannel"
        private const val NOTIF_ID = 101

        fun start(context: Context) {
            val intent = Intent(context, FloatingOverlayService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, FloatingOverlayService::class.java)
            context.stopService(intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        startForegroundNotification()
        createFloatingBubble()
    }

    private fun dpToPx(dp: Int): Int = (dp * resources.displayMetrics.density).toInt()

    private fun startForegroundNotification() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(
                    CHANNEL_ID,
                    "FRIDAY Gaming Service",
                    NotificationManager.IMPORTANCE_LOW
                ).apply {
                    description = "Running in background for Free Fire in-game gesture bridge"
                }
                val manager = getSystemService(NotificationManager::class.java)
                manager?.createNotificationChannel(channel)
            }

            val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("FRIDAY Gaming HUD Active")
                .setContentText("Neural Free Fire Co-Pilot & Gesture Bridge connected")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

            startForeground(NOTIF_ID, notification)
        } catch (e: Throwable) {
            e.printStackTrace()
        }
    }

    private fun createFloatingBubble() {
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager

        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dpToPx(16)
            y = dpToPx(80)
        }

        val bubble = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dpToPx(14), dpToPx(8), dpToPx(14), dpToPx(8))
            gravity = Gravity.CENTER_VERTICAL
            background = createCardBg(Color.parseColor("#EE0B0F19"), Color.parseColor("#06B6D4"), 24f)
        }

        val icon = TextView(this).apply {
            text = "⚡"
            textSize = 15f
            setPadding(0, 0, dpToPx(6), 0)
        }
        bubble.addView(icon)

        val text = TextView(this).apply {
            text = "FRIDAY HUD"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 12f
            paint.isFakeBoldText = true
        }
        bubble.addView(text)

        // Drag & Click listener
        bubble.setOnTouchListener(object : View.OnTouchListener {
            private var initialX = 0
            private var initialY = 0
            private var initialTouchX = 0f
            private var initialTouchY = 0f
            private var hasMoved = false

            override fun onTouch(v: View?, event: MotionEvent?): Boolean {
                if (event == null) return false
                when (event.action) {
                    MotionEvent.ACTION_DOWN -> {
                        initialX = params.x
                        initialY = params.y
                        initialTouchX = event.rawX
                        initialTouchY = event.rawY
                        hasMoved = false
                        return true
                    }
                    MotionEvent.ACTION_MOVE -> {
                        val dx = (event.rawX - initialTouchX).toInt()
                        val dy = (event.rawY - initialTouchY).toInt()
                        if (Math.abs(dx) > 10 || Math.abs(dy) > 10) {
                            hasMoved = true
                            params.x = initialX + dx
                            params.y = initialY + dy
                            windowManager?.updateViewLayout(bubble, params)
                        }
                        return true
                    }
                    MotionEvent.ACTION_UP -> {
                        if (!hasMoved) {
                            toggleExpandedPanel()
                        }
                        return true
                    }
                }
                return false
            }
        })

        floatingBubble = bubble
        try {
            windowManager?.addView(floatingBubble, params)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun toggleExpandedPanel() {
        if (isExpanded) {
            hideExpandedPanel()
        } else {
            showExpandedPanel()
        }
    }

    private fun showExpandedPanel() {
        if (expandedPanel != null) return

        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val panelWidth = Math.min(dpToPx(340), (resources.displayMetrics.widthPixels * 0.90f).toInt())

        val panelParams = WindowManager.LayoutParams(
            panelWidth,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.CENTER
        }

        val scroll = ScrollView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
            background = createCardBg(Color.parseColor("#F7090D16"), Color.parseColor("#38BDF8"), 22f)
            setPadding(dpToPx(16), dpToPx(14), dpToPx(16), dpToPx(14))
        }

        val container = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        }
        scroll.addView(container)

        // 1. Header (Title + Close button)
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, dpToPx(10))
        }
        val headerTitle = TextView(this).apply {
            text = "⚡ FRIDAY GAMING HUD"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 14f
            paint.isFakeBoldText = true
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeBtn = TextView(this).apply {
            text = "✖"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 16f
            setPadding(dpToPx(12), dpToPx(4), dpToPx(4), dpToPx(4))
            setOnClickListener { hideExpandedPanel() }
        }
        header.addView(headerTitle)
        header.addView(closeBtn)
        container.addView(header)

        // 2. Feature Rows with Right-side Toggles
        // Row 1: Auto Bot (Autonomous Gameplay)
        val switchAutoBot = Switch(this).apply {
            isChecked = FridayGamingEngine.isAutoBotEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setAutoBot(isChecked, this@FloatingOverlayService)
                Toast.makeText(this@FloatingOverlayService, if (isChecked) "🟢 Auto-Bot Activated!" else "🔴 Auto-Bot Paused", Toast.LENGTH_SHORT).show()
            }
        }
        container.addView(createToggleRow("🤖 1. Auto Bot", "Full AI autonomous movement & combat", switchAutoBot))

        // Row 2: Auto Aim
        val switchAutoAim = Switch(this).apply {
            isChecked = FridayGamingEngine.isAutoAimEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setAutoAim(isChecked)
            }
        }
        container.addView(createToggleRow("🎯 2. Auto Aim", "Smart enemy aim-lock assist", switchAutoAim))

        // Row 3: Co-Pilot (Duo Mode)
        val switchCoPilot = Switch(this).apply {
            isChecked = FridayGamingEngine.isCoPilotEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setCoPilot(isChecked)
            }
        }
        container.addView(createToggleRow("👥 3. Co-Pilot (Duo)", "Duo play: You move, Friday shoots", switchCoPilot))

        // Row 4: Auto Headshot
        val switchHeadshot = Switch(this).apply {
            isChecked = FridayGamingEngine.isAutoHeadshotEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setAutoHeadshot(isChecked)
            }
        }
        container.addView(createToggleRow("🔴 4. Auto Headshot", "Instant J-drag red numbers aim", switchHeadshot))

        // Row 5: Humanized Behaviour
        val switchHuman = Switch(this).apply {
            isChecked = FridayGamingEngine.isHumanBehaviorEnabled
            setOnCheckedChangeListener { _, isChecked ->
                FridayGamingEngine.setHumanBehavior(isChecked)
            }
        }
        container.addView(createToggleRow("🧠 5. Human Behavior", "Anti-ban natural curved Bezier drag", switchHuman))

        // Spacer
        container.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(8)) })

        // 3. Send Best Sensi to WhatsApp (WhatsApp 2) Button
        val prefs = getSharedPreferences("friday_prefs", Context.MODE_PRIVATE)
        val serverUrl = prefs.getString("server_url", "https://mera-ai-3496.onrender.com") ?: "https://mera-ai-3496.onrender.com"

        val sendSensiBtn = Button(this).apply {
            text = "📤 Send Best Sensi to WhatsApp (WA2)"
            setTextColor(Color.WHITE)
            textSize = 11f
            paint.isFakeBoldText = true
            background = createCardBg(Color.parseColor("#047857"), Color.parseColor("#10B981"), 12f)
            setPadding(dpToPx(12), dpToPx(10), dpToPx(12), dpToPx(10))
            setOnClickListener {
                text = "⏳ Sending Sensi via WhatsApp 2..."
                isEnabled = false
                FridayGamingEngine.sendSensitivityToWhatsApp(serverUrl) { success, msg ->
                    text = "📤 Send Best Sensi to WhatsApp (WA2)"
                    isEnabled = true
                    Toast.makeText(this@FloatingOverlayService, if (success) "✅ $msg" else "❌ $msg", Toast.LENGTH_LONG).show()
                }
            }
        }
        container.addView(sendSensiBtn)

        // Spacer
        container.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, dpToPx(8)) })

        // 4. Quick Action Macro Buttons
        val macroRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER
        }

        val btnDrag = Button(this).apply {
            text = "🎯 Headshot"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dpToPx(4)
            }
            background = createCardBg(Color.parseColor("#DC2626"), Color.parseColor("#EF4444"), 10f)
            setOnClickListener {
                FridayGamingEngine.triggerHeadshotDrag()
                Toast.makeText(this@FloatingOverlayService, "🎯 Drag Headshot!", Toast.LENGTH_SHORT).show()
            }
        }

        val btnGloo = Button(this).apply {
            text = "🛡️ Gloo Wall"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = dpToPx(4)
            }
            background = createCardBg(Color.parseColor("#2563EB"), Color.parseColor("#3B82F6"), 10f)
            setOnClickListener {
                FridayGamingEngine.triggerQuickGloo()
                Toast.makeText(this@FloatingOverlayService, "🛡️ Fast Gloo Deployed!", Toast.LENGTH_SHORT).show()
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
                Toast.makeText(this@FloatingOverlayService, "🏃 Sprint Locked!", Toast.LENGTH_SHORT).show()
            }
        }

        macroRow.addView(btnDrag)
        macroRow.addView(btnGloo)
        macroRow.addView(btnRun)
        container.addView(macroRow)

        FridayGamingEngine.onStateChanged = {
            switchAutoBot.isChecked = FridayGamingEngine.isAutoBotEnabled
            switchAutoAim.isChecked = FridayGamingEngine.isAutoAimEnabled
            switchCoPilot.isChecked = FridayGamingEngine.isCoPilotEnabled
            switchHeadshot.isChecked = FridayGamingEngine.isAutoHeadshotEnabled
            switchHuman.isChecked = FridayGamingEngine.isHumanBehaviorEnabled
        }

        expandedPanel = scroll
        isExpanded = true
        try {
            windowManager?.addView(expandedPanel, panelParams)
        } catch (e: Exception) {
            e.printStackTrace()
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

    private fun hideExpandedPanel() {
        if (expandedPanel != null) {
            try {
                windowManager?.removeView(expandedPanel)
            } catch (e: Exception) {
                e.printStackTrace()
            }
            expandedPanel = null
        }
        isExpanded = false
    }

    private fun createCardBg(bgColor: Int, strokeColor: Int, radiusDp: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(bgColor)
            cornerRadius = dpToPx(radiusDp.toInt()).toFloat()
            setStroke(dpToPx(1), strokeColor)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        hideExpandedPanel()
        if (floatingBubble != null) {
            try {
                windowManager?.removeView(floatingBubble)
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }
}
