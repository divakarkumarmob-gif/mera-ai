package com.friday.gamingbridge

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
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {

    private lateinit var statusText: TextView
    private lateinit var serverInput: EditText
    private lateinit var tokenInput: EditText
    private lateinit var connectBtn: Button
    private lateinit var accessibilityStatus: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Programmatic Cyberpunk UI layout (Clean, self-contained, no XML dependency issues)
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
            setPadding(48, 64, 48, 64)
            gravity = Gravity.CENTER_HORIZONTAL
        }
        scroll.addView(layout)

        // Title
        val title = TextView(this).apply {
            text = "⚡ FRIDAY GAMING BRIDGE"
            setTextColor(Color.parseColor("#38BDF8"))
            textSize = 22f
            paint.isFakeBoldText = true
            gravity = Gravity.CENTER
        }
        layout.addView(title)

        val subtitle = TextView(this).apply {
            text = "Tarika B: Zero-ADB Native Free Fire Co-Pilot"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 13f
            gravity = Gravity.CENTER
            setPadding(0, 8, 0, 48)
        }
        layout.addView(subtitle)

        // Status Card
        statusText = TextView(this).apply {
            text = "⚪ Ready to Connect"
            setTextColor(Color.parseColor("#E2E8F0"))
            textSize = 14f
            gravity = Gravity.CENTER
            background = createCardBg(Color.parseColor("#1E293B"), Color.parseColor("#334155"))
            setPadding(24, 24, 24, 24)
        }
        layout.addView(statusText)

        // Spacer
        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 32) })

        // Step 1: Accessibility Permission Button
        accessibilityStatus = TextView(this).apply {
            text = "Step 1: Accessibility Permission"
            setTextColor(Color.parseColor("#CBD5E1"))
            textSize = 14f
        }
        layout.addView(accessibilityStatus)

        val btnAccess = Button(this).apply {
            text = "⚙️ Grant Accessibility (Screen Touch)"
            setTextColor(Color.WHITE)
            background = createCardBg(Color.parseColor("#4F46E5"), Color.parseColor("#6366F1"))
            setOnClickListener {
                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
            }
        }
        layout.addView(btnAccess)

        // Spacer
        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 24) })

        // Step 2: Overlay Permission Button
        val btnOverlay = Button(this).apply {
            text = "🪟 Grant Floating Window (HUD)"
            setTextColor(Color.WHITE)
            background = createCardBg(Color.parseColor("#0F766E"), Color.parseColor("#14B8A6"))
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

        // Spacer
        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 36) })

        // Server URL Input
        val lblServer = TextView(this).apply {
            text = "FRIDAY Render Server URL:"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
        }
        layout.addView(lblServer)

        val savedUrl = prefs.getString("server_url", "https://mera-ai.onrender.com") ?: "https://mera-ai.onrender.com"
        serverInput = EditText(this).apply {
            setText(savedUrl)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            hint = "https://your-app.onrender.com"
            background = createCardBg(Color.parseColor("#1E293B"), Color.parseColor("#475569"))
            setPadding(24, 20, 24, 20)
        }
        layout.addView(serverInput)

        // Spacer
        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 24) })

        // Token Input
        val lblToken = TextView(this).apply {
            text = "App Key Token (Optional if open):"
            setTextColor(Color.parseColor("#94A3B8"))
            textSize = 12f
        }
        layout.addView(lblToken)

        val savedToken = prefs.getString("auth_token", "default_friday_key") ?: ""
        tokenInput = EditText(this).apply {
            setText(savedToken)
            setTextColor(Color.WHITE)
            setHintTextColor(Color.GRAY)
            hint = "App Session Token"
            background = createCardBg(Color.parseColor("#1E293B"), Color.parseColor("#475569"))
            setPadding(24, 20, 24, 20)
        }
        layout.addView(tokenInput)

        // Spacer
        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 40) })

        // Connect Button
        connectBtn = Button(this).apply {
            text = "🚀 CONNECT TO FRIDAY (START CO-PILOT)"
            setTextColor(Color.WHITE)
            paint.isFakeBoldText = true
            background = createCardBg(Color.parseColor("#059669"), Color.parseColor("#10B981"))
            setOnClickListener {
                toggleConnection()
            }
        }
        layout.addView(connectBtn)

        // Spacer
        layout.addView(Space(this).apply { layoutParams = LinearLayout.LayoutParams(1, 24) })

        // Test Headshot Button
        val testBtn = Button(this).apply {
            text = "🎯 Test Drag Headshot (Gesture Check)"
            setTextColor(Color.parseColor("#E0E7FF"))
            background = createCardBg(Color.parseColor("#312E81"), Color.parseColor("#4338CA"))
            setOnClickListener {
                val service = FridayAccessibilityService.instance
                if (service != null) {
                    Toast.makeText(this@MainActivity, "Executing Drag Headshot Gesture in 2s...", Toast.LENGTH_SHORT).show()
                    layout.postDelayed({
                        service.performBezierDrag(1850f, 750f, 1850f, 400f, 1850f, 320f, 90) { ok ->
                            Toast.makeText(this@MainActivity, if (ok) "✅ Headshot Drag Executed!" else "❌ Cancelled", Toast.LENGTH_SHORT).show()
                        }
                    }, 2000)
                } else {
                    Toast.makeText(this@MainActivity, "⚠️ Please Enable Accessibility first!", Toast.LENGTH_LONG).show()
                }
            }
        }
        layout.addView(testBtn)

        setContentView(scroll)

        FridayWsManager.onStatusChange = { connected, message ->
            statusText.text = message
            if (connected) {
                connectBtn.text = "🛑 DISCONNECT CO-PILOT"
                connectBtn.background = createCardBg(Color.parseColor("#DC2626"), Color.parseColor("#EF4444"))
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)) {
                    FloatingOverlayService.start(this)
                }
            } else {
                connectBtn.text = "🚀 CONNECT TO FRIDAY (START CO-PILOT)"
                connectBtn.background = createCardBg(Color.parseColor("#059669"), Color.parseColor("#10B981"))
            }
        }
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

            // Save preferences
            getSharedPreferences("friday_prefs", Context.MODE_PRIVATE).edit()
                .putString("server_url", url)
                .putString("auth_token", token)
                .apply()

            FridayWsManager.init(url, token)
            FridayWsManager.connect()
        }
    }

    private fun createCardBg(bgColor: Int, strokeColor: Int): GradientDrawable {
        return GradientDrawable().apply {
            setColor(bgColor)
            cornerRadius = 16f
            setStroke(2, strokeColor)
        }
    }
}
