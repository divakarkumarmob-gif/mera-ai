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
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.util.DisplayMetrics
import android.view.*
import android.widget.*
import androidx.core.app.NotificationCompat

class FloatingOverlayService : Service() {

    private var windowManager: WindowManager? = null
    private var floatingBubble: View? = null
    private var expandedPanel: View? = null
    private var isExpanded = false
    private var isAutoBotRunning = false
    private val botHandler = Handler(Looper.getMainLooper())
    private var botRunnable: Runnable? = null

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
                .setContentTitle("FRIDAY Gaming Bridge Active")
                .setContentText("Zero-ADB Accessibility Bridge connected for Free Fire")
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build()

            startForeground(NOTIF_ID, notification)
        } catch (e: Throwable) {
            e.printStackTrace()
        }
    }

    private fun getScreenMetrics(): Pair<Float, Float> {
        val dm = resources.displayMetrics
        // In landscape, width is the larger dimension
        val w = Math.max(dm.widthPixels, dm.heightPixels).toFloat()
        val h = Math.min(dm.widthPixels, dm.heightPixels).toFloat()
        return Pair(w, h)
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
            x = 30
            y = 120
        }

        val bubble = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(28, 16, 28, 16)
            gravity = Gravity.CENTER_VERTICAL
            background = createGradientDrawable(Color.parseColor("#E6090D16"), Color.parseColor("#06B6D4"), 30f)
        }

        val icon = TextView(this).apply {
            text = "⚡"
            textSize = 16f
            setPadding(0, 0, 10, 0)
        }
        bubble.addView(icon)

        val text = TextView(this).apply {
            text = "FRIDAY BOT"
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
                            toggleExpandedPanel(params.x, params.y)
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

    private fun toggleExpandedPanel(bubbleX: Int, bubbleY: Int) {
        if (isExpanded) {
            hideExpandedPanel()
        } else {
            showExpandedPanel(bubbleX, bubbleY)
        }
    }

    private fun showExpandedPanel(bubbleX: Int, bubbleY: Int) {
        if (expandedPanel != null) return

        val layoutFlag = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val panelParams = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            layoutFlag,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = Math.max(10, bubbleX - 20)
            y = bubbleY + 110
        }

        val (screenWidth, screenHeight) = getScreenMetrics()
        val service = FridayAccessibilityService.instance

        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(24, 20, 24, 20)
            background = createGradientDrawable(Color.parseColor("#F20F172A"), Color.parseColor("#38BDF8"), 24f)
        }

        // Header
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, 0, 0, 16)
        }
        val headerTitle = TextView(this).apply {
            text = "⚡ FRIDAY CO-PILOT HUD"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 13f
            paint.isFakeBoldText = true
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        }
        val closeBtn = TextView(this).apply {
            text = "✖"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 14f
            setPadding(16, 4, 8, 4)
            setOnClickListener { hideExpandedPanel() }
        }
        header.addView(headerTitle)
        header.addView(closeBtn)
        panel.addView(header)

        // 1. Auto-Play Bot Toggle Button
        val botBtn = Button(this).apply {
            text = if (isAutoBotRunning) "🟢 AUTO-PLAY BOT: ACTIVE" else "🔴 AUTO-PLAY BOT: OFF"
            setTextColor(Color.WHITE)
            textSize = 11f
            paint.isFakeBoldText = true
            background = createGradientDrawable(
                if (isAutoBotRunning) Color.parseColor("#059669") else Color.parseColor("#1E293B"),
                if (isAutoBotRunning) Color.parseColor("#10B981") else Color.parseColor("#475569"),
                14f
            )
            setOnClickListener {
                if (service == null) {
                    Toast.makeText(this@FloatingOverlayService, "⚠️ Please Enable Accessibility Permission first!", Toast.LENGTH_LONG).show()
                    return@setOnClickListener
                }
                isAutoBotRunning = !isAutoBotRunning
                if (isAutoBotRunning) {
                    text = "🟢 AUTO-PLAY BOT: ACTIVE"
                    background = createGradientDrawable(Color.parseColor("#059669"), Color.parseColor("#10B981"), 14f)
                    startAutonomousBotLoop(service, screenWidth, screenHeight)
                    Toast.makeText(this@FloatingOverlayService, "🤖 Friday Auto-Play Bot Started!", Toast.LENGTH_SHORT).show()
                } else {
                    text = "🔴 AUTO-PLAY BOT: OFF"
                    background = createGradientDrawable(Color.parseColor("#1E293B"), Color.parseColor("#475569"), 14f)
                    stopAutonomousBotLoop()
                    Toast.makeText(this@FloatingOverlayService, "🛑 Auto-Play Bot Paused", Toast.LENGTH_SHORT).show()
                }
            }
        }
        panel.addView(botBtn)

        panel.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 12) })

        // Actions Row 1: Headshot & Gloo Wall
        val row1 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }

        val headshotBtn = Button(this).apply {
            text = "🎯 Headshot Drag"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = 8
            }
            background = createGradientDrawable(Color.parseColor("#DC2626"), Color.parseColor("#EF4444"), 14f)
            setOnClickListener {
                if (service != null) {
                    val fireX = screenWidth * 0.82f
                    val fireY = screenHeight * 0.72f
                    val dragY = fireY - (screenHeight * 0.30f)
                    service.performBezierDrag(fireX, fireY, fireX, fireY - 120f, fireX, dragY, 90)
                    Toast.makeText(this@FloatingOverlayService, "🎯 Drag Headshot Executed!", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this@FloatingOverlayService, "⚠️ Accessibility not enabled", Toast.LENGTH_SHORT).show()
                }
            }
        }

        val glooBtn = Button(this).apply {
            text = "🛡️ Quick Gloo"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            background = createGradientDrawable(Color.parseColor("#2563EB"), Color.parseColor("#3B82F6"), 14f)
            setOnClickListener {
                if (service != null) {
                    val glooX = screenWidth * 0.20f
                    val glooY = screenHeight * 0.78f
                    val crouchX = screenWidth * 0.90f
                    val crouchY = screenHeight * 0.82f
                    val fireX = screenWidth * 0.82f
                    val fireY = screenHeight * 0.72f

                    service.performTap(glooX, glooY, 30) {
                        botHandler.postDelayed({
                            service.performTap(crouchX, crouchY, 30) {
                                botHandler.postDelayed({
                                    service.performDrag(fireX, fireY, fireX, fireY + 160f, 50)
                                }, 20)
                            }
                        }, 25)
                    }
                    Toast.makeText(this@FloatingOverlayService, "🛡️ Fast Gloo Wall Deployed!", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this@FloatingOverlayService, "⚠️ Accessibility not enabled", Toast.LENGTH_SHORT).show()
                }
            }
        }
        row1.addView(headshotBtn)
        row1.addView(glooBtn)
        panel.addView(row1)

        panel.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 12) })

        // Actions Row 2: Auto Run & Heal
        val row2 = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
        }

        val runBtn = Button(this).apply {
            text = "🏃 Sprint / Run"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginEnd = 8
            }
            background = createGradientDrawable(Color.parseColor("#7C3AED"), Color.parseColor("#8B5CF6"), 14f)
            setOnClickListener {
                if (service != null) {
                    val joyX = screenWidth * 0.18f
                    val joyY = screenHeight * 0.75f
                    service.performDrag(joyX, joyY, joyX, joyY - 200f, 350)
                    Toast.makeText(this@FloatingOverlayService, "🏃 Sprint Locked!", Toast.LENGTH_SHORT).show()
                }
            }
        }

        val healBtn = Button(this).apply {
            text = "💊 Auto Medkit"
            setTextColor(Color.WHITE)
            textSize = 10f
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            background = createGradientDrawable(Color.parseColor("#059669"), Color.parseColor("#10B981"), 14f)
            setOnClickListener {
                if (service != null) {
                    val healX = screenWidth * 0.15f
                    val healY = screenHeight * 0.85f
                    service.performTap(healX, healY, 50)
                    Toast.makeText(this@FloatingOverlayService, "💊 Medkit Used!", Toast.LENGTH_SHORT).show()
                }
            }
        }
        row2.addView(runBtn)
        row2.addView(healBtn)
        panel.addView(row2)

        expandedPanel = panel
        isExpanded = true
        try {
            windowManager?.addView(expandedPanel, panelParams)
        } catch (e: Exception) {
            e.printStackTrace()
        }
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

    private fun startAutonomousBotLoop(service: FridayAccessibilityService, screenWidth: Float, screenHeight: Float) {
        stopAutonomousBotLoop()

        var loopCount = 0
        botRunnable = object : Runnable {
            override fun run() {
                if (!isAutoBotRunning) return

                val joyX = screenWidth * 0.18f
                val joyY = screenHeight * 0.75f
                val fireX = screenWidth * 0.82f
                val fireY = screenHeight * 0.72f
                val jumpX = screenWidth * 0.95f
                val jumpY = screenHeight * 0.60f
                val camX = screenWidth * 0.65f
                val camY = screenHeight * 0.50f

                loopCount++

                when (loopCount % 4) {
                    0 -> {
                        // Forward Run
                        service.performDrag(joyX, joyY, joyX, joyY - 180f, 350)
                    }
                    1 -> {
                        // Camera Swipe & Jump
                        service.performDrag(camX, camY, camX + 100f, camY, 80) {
                            botHandler.postDelayed({
                                service.performTap(jumpX, jumpY, 40)
                            }, 50)
                        }
                    }
                    2 -> {
                        // Headshot J-Drag
                        val dragY = fireY - (screenHeight * 0.28f)
                        service.performBezierDrag(fireX, fireY, fireX, fireY - 100f, fireX, dragY, 90)
                    }
                    3 -> {
                        // Forward sprint
                        service.performDrag(joyX, joyY, joyX, joyY - 200f, 300)
                    }
                }

                botHandler.postDelayed(this, 1200)
            }
        }
        botHandler.post(botRunnable!!)
    }

    private fun stopAutonomousBotLoop() {
        if (botRunnable != null) {
            botHandler.removeCallbacks(botRunnable!!)
            botRunnable = null
        }
    }

    private fun createGradientDrawable(bgColor: Int, strokeColor: Int, radius: Float): GradientDrawable {
        return GradientDrawable().apply {
            setColor(bgColor)
            cornerRadius = radius
            setStroke(2, strokeColor)
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        isAutoBotRunning = false
        stopAutonomousBotLoop()
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
