package com.friday.ai

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.View
import android.view.WindowManager
import android.webkit.*
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import com.friday.ai.bluetooth.BluetoothAudioRouter
import com.friday.ai.bluetooth.BluetoothControlManager
import com.friday.ai.databinding.ActivityMainBinding
import com.friday.ai.network.FridayApiClient
import com.friday.ai.service.FridayAccessibilityService
import com.friday.ai.service.FridayForegroundService
import com.friday.ai.tools.SmsController
import com.friday.ai.tools.WifiScannerHelper

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "FridayMainActivity"
    }

    private lateinit var binding: ActivityMainBinding

    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) {
        startFridayForegroundService()
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        setupLockscreenFlags()
        requestAppPermissions()
        startFridayForegroundService()

        // Init Bluetooth hardware control
        BluetoothControlManager.initMediaSession(this)
        BluetoothAudioRouter.startBluetoothSco(this)

        setupWebView()
        setupBluetoothUiBridge()
    }

    private fun setupLockscreenFlags() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
            } else {
                @Suppress("DEPRECATION")
                window.addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
                    WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun requestAppPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.RECORD_AUDIO,
            Manifest.permission.MODIFY_AUDIO_SETTINGS,
            Manifest.permission.CAMERA,
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION,
            Manifest.permission.SEND_SMS
        )

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.BLUETOOTH_CONNECT)
        }

        val ungranted = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (ungranted.isNotEmpty()) {
            permissionsLauncher.launch(ungranted.toTypedArray())
        }
    }

    private fun startFridayForegroundService() {
        val serviceIntent = Intent(this, FridayForegroundService::class.java).apply {
            action = FridayForegroundService.ACTION_START
        }
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent)
            } else {
                startService(serviceIntent)
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error starting foreground service: ${e.message}")
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webView = binding.webView
        val settings = webView.settings

        // Enable all high-performance Web features for Capsules, 3D Avatar & Gemini Live
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setGeolocationEnabled(true)
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        // Auto-grant Camera, Mic and Geolocation to WebView for Gemini Live Voice & Vision
        webView.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest?) {
                runOnUiThread {
                    try {
                        request?.grant(request.resources)
                        Log.i(TAG, "Granted WebView permissions: ${request?.resources?.joinToString()}")
                    } catch (e: Exception) {
                        Log.e(TAG, "Permission grant error: ${e.message}")
                    }
                }
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?
            ) {
                callback?.invoke(origin, true, false)
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: Bitmap?) {
                super.onPageStarted(view, url, favicon)
                binding.loadingLayout.visibility = View.VISIBLE
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                binding.loadingLayout.visibility = View.GONE
                injectNativeBridges()
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                if (request?.isForMainFrame == true) {
                    Log.w(TAG, "WebView connection error: ${error?.description}. Retrying in 3s...")
                    view?.postDelayed({
                        val url = FridayApiClient.getBackendUrl(this@MainActivity)
                        view.loadUrl(url)
                    }, 3000)
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    return false // Let WebView load it
                }
                return try {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
                    startActivity(intent)
                    true
                } catch (e: Exception) {
                    true
                }
            }
        }

        // Add JavaScript interfaces (Bridges for Touch and Native Tools)
        webView.addJavascriptInterface(object : Any() {
            @JavascriptInterface
            fun dispatchTap(x: Float, y: Float, duration: Long): Boolean {
                return FridayAccessibilityService.dispatchTap(x, y, duration)
            }

            @JavascriptInterface
            fun dispatchDrag(sx: Float, sy: Float, ex: Float, ey: Float, duration: Long): Boolean {
                return FridayAccessibilityService.dispatchDrag(sx, sy, ex, ey, duration)
            }

            @JavascriptInterface
            fun isAccessibilityActive(): Boolean {
                return FridayAccessibilityService.instance != null
            }
        }, "AndroidGamingBridge")

        webView.addJavascriptInterface(object : Any() {
            @JavascriptInterface
            fun sendSms(to: String, msg: String): Boolean {
                return SmsController.sendSms(this@MainActivity, to, msg)
            }

            @JavascriptInterface
            fun getWifiNetworks(): String {
                return WifiScannerHelper.getScanResultsAsJson(this@MainActivity).toString()
            }

            @JavascriptInterface
            fun getBackendUrl(): String {
                return FridayApiClient.getBackendUrl(this@MainActivity)
            }
        }, "FridayNativeBridge")

        // Load the full Friday Web App
        val backendUrl = FridayApiClient.getBackendUrl(this)
        Log.i(TAG, "Loading Friday App from: $backendUrl")
        webView.loadUrl(backendUrl)
    }

    private fun injectNativeBridges() {
        val js = """
            (function() {
                console.log("[FRIDAY Native] Bridge injected into WebView");
                window.isFridayNativeApp = true;
                
                // Listen to Bluetooth Hardware Events dispatched from Kotlin
                window.addEventListener('friday_bluetooth_toggle_mic', function() {
                    console.log("[FRIDAY Native] Bluetooth Mic Trigger received in Web App!");
                    // Find and click the Live AI Mic button in UI
                    var micBtn = document.querySelector('[data-mic-trigger="true"]') ||
                                 document.querySelector('button[aria-label*="Mic"]') ||
                                 document.querySelector('button[title*="Mic"]') ||
                                 document.querySelector('.live-mic-btn');
                    if (micBtn) {
                        micBtn.click();
                    }
                });
            })();
        """.trimIndent()
        binding.webView.evaluateJavascript(js, null)
    }

    /**
     * Bridges Bluetooth button actions directly into the Friday Web UI (Gemini Live & Capsules)
     */
    private fun setupBluetoothUiBridge() {
        BluetoothControlManager.onActionTriggered = { action ->
            runOnUiThread {
                when (action) {
                    BluetoothControlManager.Action.TOGGLE_MIC -> {
                        Log.i(TAG, "🎧 Bluetooth -> Toggle Mic in Friday UI")
                        val script = """
                            (function() {
                                window.dispatchEvent(new CustomEvent('friday_bluetooth_toggle_mic'));
                                var btn = document.querySelector('button[aria-label*="Mic"], button[title*="Mic"], .mic-btn, [data-mic="true"]');
                                if (btn) btn.click();
                            })();
                        """.trimIndent()
                        binding.webView.evaluateJavascript(script, null)
                    }

                    BluetoothControlManager.Action.VOICE_BRIEFING -> {
                        Log.i(TAG, "🎧 Bluetooth -> Trigger Voice Briefing in Friday UI")
                        val script = "window.dispatchEvent(new CustomEvent('friday_bluetooth_briefing'));"
                        binding.webView.evaluateJavascript(script, null)
                    }

                    BluetoothControlManager.Action.SILENT_SOS -> {
                        Log.i(TAG, "🚨 Bluetooth -> Trigger SOS in Friday UI")
                        val script = "window.dispatchEvent(new CustomEvent('friday_bluetooth_sos'));"
                        binding.webView.evaluateJavascript(script, null)
                    }

                    BluetoothControlManager.Action.STOP_SPEAKING -> {
                        Log.i(TAG, "🛑 Bluetooth -> Stop / Interrupt in Friday UI")
                        val script = """
                            (function() {
                                window.dispatchEvent(new CustomEvent('friday_bluetooth_stop'));
                                if (window.speechSynthesis) window.speechSynthesis.cancel();
                            })();
                        """.trimIndent()
                        binding.webView.evaluateJavascript(script, null)
                    }
                }
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        binding.webView.destroy()
        super.onDestroy()
    }
}
