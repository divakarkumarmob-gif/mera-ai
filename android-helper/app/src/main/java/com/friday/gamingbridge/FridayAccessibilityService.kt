package com.friday.gamingbridge

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.util.Log
import android.view.accessibility.AccessibilityEvent

class FridayAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "FridayAccessService"
        var instance: FridayAccessibilityService? = null
            private set

        val isRunning: Boolean
            get() = instance != null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "🟢 FRIDAY Accessibility Service Connected & Active! Ready to dispatch in-game gestures.")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Can inspect current active window if needed
    }

    override fun onInterrupt() {
        Log.w(TAG, "FRIDAY Accessibility Service Interrupted")
    }

    override fun onDestroy() {
        super.onDestroy()
        if (instance == this) {
            instance = null
        }
        Log.i(TAG, "🔴 FRIDAY Accessibility Service Destroyed")
    }

    /**
     * Dispatch a single tap at (x, y) with duration in milliseconds
     */
    fun performTap(x: Float, y: Float, durationMs: Long = 50, callback: ((Boolean) -> Unit)? = null) {
        val path = Path().apply {
            moveTo(x, y)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceAtLeast(20))
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "⚡ Tap executed at ($x, $y)")
                callback?.invoke(true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "❌ Tap cancelled at ($x, $y)")
                callback?.invoke(false)
            }
        }, null)
    }

    /**
     * Dispatch a straight line drag/swipe from (startX, startY) to (endX, endY)
     */
    fun performDrag(
        startX: Float,
        startY: Float,
        endX: Float,
        endY: Float,
        durationMs: Long = 100,
        callback: ((Boolean) -> Unit)? = null
    ) {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceAtLeast(30))
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "⚡ Drag executed: ($startX, $startY) -> ($endX, $endY) in ${durationMs}ms")
                callback?.invoke(true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "❌ Drag cancelled: ($startX, $startY) -> ($endX, $endY)")
                callback?.invoke(false)
            }
        }, null)
    }

    /**
     * Dispatch a curved Bezier drag for natural humanized headshots & aim smoothing
     */
    fun performBezierDrag(
        startX: Float,
        startY: Float,
        midX: Float,
        midY: Float,
        endX: Float,
        endY: Float,
        durationMs: Long = 110,
        callback: ((Boolean) -> Unit)? = null
    ) {
        val path = Path().apply {
            moveTo(startX, startY)
            quadTo(midX, midY, endX, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, durationMs.coerceAtLeast(30))
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        dispatchGesture(gesture, object : GestureResultCallback() {
            override fun onCompleted(gestureDescription: GestureDescription?) {
                Log.d(TAG, "⚡ Bezier Drag executed: ($startX, $startY) via ($midX, $midY) -> ($endX, $endY)")
                callback?.invoke(true)
            }

            override fun onCancelled(gestureDescription: GestureDescription?) {
                Log.w(TAG, "❌ Bezier Drag cancelled")
                callback?.invoke(false)
            }
        }, null)
    }
}
