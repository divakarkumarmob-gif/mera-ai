package com.friday.ai.tools

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
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

        @Volatile
        var instance: LocationTracker? = null
            private set

        /**
         * Returns best immediate location from memory or system providers without waiting.
         */
        @SuppressLint("MissingPermission")
        fun getImmediateLocation(context: Context): Location? {
            instance?.lastKnownLocation?.let { return it }

            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
            val hasFine = ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED
            val hasCoarse = ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_COARSE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

            if (!hasFine && !hasCoarse) return null

            return try {
                val gps = if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    lm.getLastKnownLocation(LocationManager.GPS_PROVIDER)
                } else null
                val net = if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER)
                } else null
                val pass = try { lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER) } catch (e: Exception) { null }

                listOfNotNull(gps, net, pass).maxByOrNull { it.time }
            } catch (e: Exception) {
                Log.w(TAG, "Error fetching immediate location: ${e.message}")
                null
            }
        }
    }

    private val fusedClient: FusedLocationProviderClient =
        LocationServices.getFusedLocationProviderClient(context)
    private var locationCallback: LocationCallback? = null
    private var nativeLocationListener: LocationListener? = null

    var lastKnownLocation: Location? = null
        private set

    var onLocationUpdated: ((Location) -> Unit)? = null

    init {
        instance = this
    }

    @SuppressLint("MissingPermission")
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

        // 1. Instant Cache Fix: Fetch last location immediately so server gets coordinates right now!
        queryImmediateLocationAndPing()

        // 2. Setup FusedLocationProviderClient updates
        locationCallback = object : LocationCallback() {
            override fun onLocationResult(result: LocationResult) {
                val loc = result.lastLocation ?: return
                handleNewLocation(loc, "FusedProvider")
            }
        }

        val priority = if (hasFine) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY
        val request = LocationRequest.Builder(priority, GPS_INTERVAL_MS)
            .setMinUpdateIntervalMillis(GPS_MIN_UPDATE_MS)
            .build()

        try {
            fusedClient.requestLocationUpdates(request, locationCallback!!, Looper.getMainLooper())
            Log.i(TAG, "🟢 Background GPS tracking started via FusedClient (every ${GPS_INTERVAL_MS / 1000}s)")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to start FusedLocation updates: ${e.message}", e)
        }

        // 3. Fallback/Dual-Channel: Setup native LocationManager updates for device compatibility
        try {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            if (lm != null) {
                nativeLocationListener = object : LocationListener {
                    override fun onLocationChanged(loc: Location) {
                        handleNewLocation(loc, "NativeLM")
                    }
                    @Deprecated("Deprecated in Java")
                    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
                    override fun onProviderEnabled(provider: String) {}
                    override fun onProviderDisabled(provider: String) {}
                }

                if (hasFine && lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.GPS_PROVIDER,
                        GPS_INTERVAL_MS,
                        10f,
                        nativeLocationListener!!,
                        Looper.getMainLooper()
                    )
                }
                if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                    lm.requestLocationUpdates(
                        LocationManager.NETWORK_PROVIDER,
                        GPS_INTERVAL_MS,
                        10f,
                        nativeLocationListener!!,
                        Looper.getMainLooper()
                    )
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Native LocationManager listener setup skipped: ${e.message}")
        }
    }

    @SuppressLint("MissingPermission")
    private fun queryImmediateLocationAndPing() {
        try {
            fusedClient.lastLocation.addOnSuccessListener { loc ->
                if (loc != null) {
                    Log.i(TAG, "⚡ Instant Fused lastLocation fix: lat=${loc.latitude}, lon=${loc.longitude}")
                    handleNewLocation(loc, "FusedInstant")
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Fused lastLocation query failed: ${e.message}")
        }

        val lmLoc = getImmediateLocation(context)
        if (lmLoc != null && (lastKnownLocation == null || lmLoc.time > lastKnownLocation!!.time)) {
            Log.i(TAG, "⚡ Instant LM fix: lat=${lmLoc.latitude}, lon=${lmLoc.longitude}")
            handleNewLocation(lmLoc, "LMInstant")
        }
    }

    private fun handleNewLocation(loc: Location, source: String) {
        lastKnownLocation = loc
        Log.d(TAG, "📍 GPS Update ($source): lat=${loc.latitude}, lon=${loc.longitude}, acc=${loc.accuracy}m")

        onLocationUpdated?.invoke(loc)

        // Forward ping to Friday backend
        FridayApiClient.sendLocationPing(context, loc)
    }

    fun stopTracking() {
        locationCallback?.let {
            fusedClient.removeLocationUpdates(it)
            locationCallback = null
        }
        nativeLocationListener?.let {
            val lm = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            lm?.removeUpdates(it)
            nativeLocationListener = null
        }
        Log.i(TAG, "🛑 Location tracking stopped")
    }
}
