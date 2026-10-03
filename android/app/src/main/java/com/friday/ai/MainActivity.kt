package com.friday.ai

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
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
import android.location.LocationManager
import androidx.webkit.WebViewAssetLoader
import com.friday.ai.bluetooth.BluetoothAudioRouter
import com.friday.ai.bluetooth.BluetoothControlManager
import com.friday.ai.databinding.ActivityMainBinding
import com.friday.ai.network.FridayApiClient
import com.friday.ai.service.FridayAccessibilityService
import com.friday.ai.service.FridayForegroundService
import com.friday.ai.tools.LocationTracker
import com.friday.ai.tools.SmsController
import com.friday.ai.tools.WifiScannerHelper
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "FridayMainActivity"
        private const val ASSET_DOMAIN = "localhost"
        private const val START_URL = "https://localhost/index.html"
    }

    private lateinit var binding: ActivityMainBinding
    private lateinit var assetLoader: WebViewAssetLoader

    private val permissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val fineGranted = grants[Manifest.permission.ACCESS_FINE_LOCATION] == true
        val coarseGranted = grants[Manifest.permission.ACCESS_COARSE_LOCATION] == true
        if (fineGranted || coarseGranted) {
            checkAndRequestBackgroundLocation()
        }
        startFridayForegroundService()
    }

    private val bgLocationLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        Log.i(TAG, "Background location permission result: $granted")
        startFridayForegroundService()
    }

    private fun checkAndRequestBackgroundLocation() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            val bgGranted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.ACCESS_BACKGROUND_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            if (!bgGranted) {
                try {
                    bgLocationLauncher.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                } catch (e: Exception) {
                    Log.w(TAG, "Could not launch background location request: ${e.message}")
                }
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // Enable Chrome remote inspection: chrome://inspect
        WebView.setWebContentsDebuggingEnabled(true)

        setupLockscreenFlags()
        requestAppPermissions()
        startFridayForegroundService()

        // Init Bluetooth hardware control
        BluetoothControlManager.initMediaSession(this)
        BluetoothAudioRouter.startBluetoothSco(this)

        setupWebView()
        setupBluetoothUiBridge()
        handleAssistIntent(intent)
    }

    override fun onNewIntent(intent: Intent?) {
        super.onNewIntent(intent)
        setIntent(intent)
        setupLockscreenFlags()
        handleAssistIntent(intent)
    }

    private fun handleAssistIntent(intent: Intent?) {
        val action = intent?.action
        val triggerMic = intent?.getBooleanExtra("TRIGGER_MIC_ON_START", false) ?: false
        if (action == Intent.ACTION_VOICE_COMMAND || action == Intent.ACTION_ASSIST || triggerMic) {
            Log.i(TAG, "🎙️ Voice Assist intent detected: action=$action, triggerMic=$triggerMic -> Activating Friday Mic")

            // 1. Immediately wake Friday Foreground Service to listen via Bluetooth SCO & chime
            val activeService = com.friday.ai.service.FridayForegroundService.instance
            if (activeService != null && com.friday.ai.service.FridayForegroundService.isRunning) {
                activeService.handleBluetoothAction(com.friday.ai.bluetooth.BluetoothControlManager.Action.TOGGLE_MIC)
            } else {
                val serviceIntent = Intent(this, com.friday.ai.service.FridayForegroundService::class.java).apply {
                    putExtra(com.friday.ai.service.FridayForegroundService.EXTRA_BLUETOOTH_ACTION, com.friday.ai.bluetooth.BluetoothControlManager.Action.TOGGLE_MIC.name)
                }
                try {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        startForegroundService(serviceIntent)
                    } else {
                        startService(serviceIntent)
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to start service on assist intent: ${e.message}")
                }
            }

            // 2. Also trigger UI Webview mic button if screen is unlocked
            binding.root.postDelayed({
                binding.webView.evaluateJavascript(
                    """
                    (function() {
                        window.dispatchEvent(new CustomEvent('friday_bluetooth_toggle_mic'));
                        var btn = document.querySelector('button[aria-label*="Mic"], button[title*="Mic"], .mic-btn, [data-mic="true"]');
                        if (btn) btn.click();
                    })();
                    """.trimIndent(), null
                )
            }, 600)
        }
    }

    private fun setupLockscreenFlags() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
                setShowWhenLocked(true)
                setTurnScreenOn(true)
                val km = getSystemService(Context.KEYGUARD_SERVICE) as? android.app.KeyguardManager
                km?.requestDismissKeyguard(this, null)
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

        // Enable all high-performance Web features for Capsules, 3D Avatar, Login Modal & Gemini Live
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

        // Asset Loader to securely serve local bundled React assets from root "/"
        assetLoader = WebViewAssetLoader.Builder()
            .setDomain(ASSET_DOMAIN)
            .addPathHandler("/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

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

            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                Log.d("FRIDAY_WEB", "${consoleMessage?.message()} [${consoleMessage?.sourceId()}:${consoleMessage?.lineNumber()}]")
                return true
            }
        }

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView?,
                request: WebResourceRequest?
            ): WebResourceResponse? {
                val url = request?.url ?: return null
                if (url.host.equals(ASSET_DOMAIN, ignoreCase = true)) {
                    return assetLoader.shouldInterceptRequest(url)
                }
                return null
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                binding.loadingLayout.visibility = View.GONE
                injectNativeBridges()
            }

            override fun onReceivedError(view: WebView?, request: WebResourceRequest?, error: WebResourceError?) {
                super.onReceivedError(view, request, error)
                Log.w(TAG, "WebView error: ${error?.description} for ${request?.url}")
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                if (url.contains(ASSET_DOMAIN) || url.startsWith("https://mera-ai-3496.onrender.com")) {
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

            @JavascriptInterface
            fun hasLocationPermission(): Boolean {
                val hasFine = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_FINE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                val hasCoarse = ContextCompat.checkSelfPermission(
                    this@MainActivity, Manifest.permission.ACCESS_COARSE_LOCATION
                ) == PackageManager.PERMISSION_GRANTED
                return hasFine || hasCoarse
            }

            @JavascriptInterface
            fun hasBackgroundLocationPermission(): Boolean {
                return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContextCompat.checkSelfPermission(
                        this@MainActivity, Manifest.permission.ACCESS_BACKGROUND_LOCATION
                    ) == PackageManager.PERMISSION_GRANTED
                } else {
                    hasLocationPermission()
                }
            }

            @JavascriptInterface
            fun requestLocationPermission(): Boolean {
                runOnUiThread {
                    requestAppPermissions()
                }
                return true
            }

            @JavascriptInterface
            fun isGpsEnabled(): Boolean {
                val lm = getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return false
                return try {
                    lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                            lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)
                } catch (e: Exception) {
                    false
                }
            }

            @JavascriptInterface
            fun getLocation(): String {
                val loc = LocationTracker.getImmediateLocation(this@MainActivity)
                if (loc == null) {
                    return "{}"
                }
                val json = JSONObject().apply {
                    put("lat", loc.latitude)
                    put("lon", loc.longitude)
                    put("accuracy", loc.accuracy)
                    put("altitude", if (loc.hasAltitude()) loc.altitude else JSONObject.NULL)
                    put("speed", if (loc.hasSpeed()) loc.speed else JSONObject.NULL)
                    put("heading", if (loc.hasBearing()) loc.bearing else JSONObject.NULL)
                    put("timestamp", loc.time)
                    put("source", "native-android")
                }
                return json.toString()
            }

            @JavascriptInterface
            fun sendLocationPingNow(): Boolean {
                val loc = LocationTracker.getImmediateLocation(this@MainActivity)
                if (loc != null) {
                    FridayApiClient.sendLocationPing(this@MainActivity, loc)
                    return true
                }
                return false
            }

            @JavascriptInterface
            fun syncDeviceInfo(deviceId: String, username: String, label: String) {
                FridayApiClient.syncDeviceInfo(this@MainActivity, deviceId, username, label)
            }

            @JavascriptInterface
            fun openDefaultAssistantSettings(): Boolean {
                return try {
                    val intent = Intent(android.provider.Settings.ACTION_VOICE_INPUT_SETTINGS)
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    this@MainActivity.startActivity(intent)
                    true
                } catch (e: Exception) {
                    try {
                        val intent = Intent(android.provider.Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS)
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        this@MainActivity.startActivity(intent)
                        true
                    } catch (e2: Exception) {
                        false
                    }
                }
            }
        }, "FridayNativeBridge")

        // Push real-time native location updates directly into WebView
        LocationTracker.instance?.onLocationUpdated = { loc ->
            runOnUiThread {
                val script = """
                    (function() {
                        var d = {
                            lat: ${loc.latitude},
                            lon: ${loc.longitude},
                            accuracy: ${loc.accuracy},
                            altitude: ${if (loc.hasAltitude()) loc.altitude else "null"},
                            speed: ${if (loc.hasSpeed()) loc.speed else "null"},
                            heading: ${if (loc.hasBearing()) loc.bearing else "null"},
                            timestamp: ${loc.time}
                        };
                        window.dispatchEvent(new CustomEvent('friday:native_location', { detail: d }));
                    })();
                """.trimIndent()
                binding.webView.evaluateJavascript(script, null)
            }
        }

        // Safety fallback: Hide loading indicator after 2.5s even if load takes time
        binding.root.postDelayed({
            binding.loadingLayout.visibility = View.GONE
        }, 2500)

        // Load the local Friday Web App (Renders Login Prompt, Capsules, Starry Background, Gemini Live)
        Log.i(TAG, "Loading local Friday App from: $START_URL")
        webView.loadUrl(START_URL)
    }

    private fun injectNativeBridges() {
        val js = """
            (function() {
                console.log("[FRIDAY Native] Bridge injected into WebView");
                window.isFridayNativeApp = true;
                
                // Listen to Bluetooth Hardware Events dispatched from Kotlin
                window.addEventListener('friday_bluetooth_toggle_mic', function() {
                    console.log("[FRIDAY Native] Bluetooth Mic Trigger received in Web App!");
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
