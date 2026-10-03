package com.friday.ai.tools

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.os.Looper
import android.util.Log
import androidx.core.content.ContextCompat
import com.friday.ai.network.FridayApiClient
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority

class LocationTracker(private val context: Context) {
    companion object {
        private const val TAG = "FridayLocation"
        private const val GPS_INTERVAL_MS = 30_000L
        private const val GPS_MIN_UPDATE_MS = 15_000L
    }

    private val fusedClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)
    private var locationCallback: LocationCallback? = null
    var lastKnownLocation: Location? = null
        private set

    fun startTracking() {
        val hasFine = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_FINE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED
        val hasCoarse = ContextCompat.checkSelfPermission(
            context, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED

        if (!hasFine && !hasCoarse) {
            Log.w(TAG, "Location permissions not granted, skipping GPS start")
            return
        }

        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                lastKnownLocation = loc
                Log.d(TAG, "📍 GPS Update: lat=${loc.latitude}, lon=${loc.longitude}, acc=${loc.accuracy}m")

                // Forward ping to Friday backend
                FridayApiClient.sendLocationPing(context, loc)
            }
        }

        val priority = if (hasFine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val request = LocationRequest.Builder(priority, GPS_INTERVAL_MS)
            .setMinUpdateIntervalMillis(GPS_MIN_UPDATE_MS)
            .build()

        try {
            fusedClient.requestLocationUpdates(request, locationCallback!!, Looper.getMainLooper())
            Log.i(TAG, "🟢 Background GPS tracking started (every ${GPS_INTERVAL_MS / 1000}s)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start location updates: ${e.message}", e)
        }
    }

    fun stopTracking() {
        locationCallback?.let {
            fusedClient.removeLocationUpdates(it)
            locationCallback = null
            Log.i(TAG, "🛑 Location tracking stopped")
        }
    }
}
