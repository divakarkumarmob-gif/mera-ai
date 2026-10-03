package com.friday.ai.tools

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.ScanResult
import android.net.wifi.WifiManager
import android.util.Log
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject

object WifiScannerHelper {
    private const val TAG = "FridayWifi"

    data class WifiNetwork(val ssid: String, val bssid: String, val rssi: Int)

    fun getScanResults(context: Context): List<WifiNetwork> {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            Log.w(TAG, "Fine location permission required for WiFi scan")
            return emptyList()
        }

        return try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val results = wifiManager?.scanResults ?: emptyList()
            results.filter { !it.SSID.isNullOrEmpty() }.map {
                WifiNetwork(it.SSID, it.BSSID, it.level)
            }
        } catch (e: Exception) {
            Log.e(TAG, "WiFi scan failed: ${e.message}")
            emptyList()
        }
    }

    fun getScanResultsAsJson(context: Context): JSONArray {
        val list = getScanResults(context)
        val jsonArray = JSONArray()
        for (item in list) {
            val obj = JSONObject().apply {
                put("ssid", item.ssid)
                put("bssid", item.bssid)
                put("rssi", item.rssi)
            }
            jsonArray.put(obj)
        }
        return jsonArray
    }
}
