package com.friday.ai.tools

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.os.Build
import android.util.Log

/**
 * Zero-internet Hardware Torch/Flashlight Controller for FRIDAY.
 * Operates instantly without network latency even when phone screen is OFF.
 */
object TorchController {
    private const val TAG = "FridayTorch"

    var isTorchOn: Boolean = false
        private set

    fun setTorch(context: Context, enable: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            Log.w(TAG, "Torch mode requires Android M (API 23)+")
            return false
        }

        return try {
            val cameraManager = context.getSystemService(Context.CAMERA_SERVICE) as? CameraManager
            if (cameraManager == null) {
                Log.w(TAG, "CameraManager not available")
                return false
            }

            var flashCameraId: String? = null
            for (id in cameraManager.cameraIdList) {
                val characteristics = cameraManager.getCameraCharacteristics(id)
                val hasFlash = characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true
                val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
                if (hasFlash && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    flashCameraId = id
                    break
                }
            }

            // Fallback: any camera with flash unit
            if (flashCameraId == null) {
                for (id in cameraManager.cameraIdList) {
                    val characteristics = cameraManager.getCameraCharacteristics(id)
                    if (characteristics.get(CameraCharacteristics.FLASH_INFO_AVAILABLE) == true) {
                        flashCameraId = id
                        break
                    }
                }
            }

            if (flashCameraId != null) {
                cameraManager.setTorchMode(flashCameraId, enable)
                isTorchOn = enable
                Log.i(TAG, "🔦 Torch state set to: $enable (Camera ID: $flashCameraId)")
                true
            } else {
                Log.w(TAG, "No camera with flash unit found on this device")
                false
            }
        } catch (e: Exception) {
            Log.e(TAG, "Failed to toggle torch: ${e.message}")
            false
        }
    }

    fun toggleTorch(context: Context): Boolean {
        return setTorch(context, !isTorchOn)
    }
}
