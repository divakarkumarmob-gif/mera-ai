package com.friday.ai.receiver

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.view.KeyEvent
import com.friday.ai.bluetooth.BluetoothControlManager

class BluetoothMediaButtonReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "FridayMediaReceiver"
    }

    override fun onReceive(context: Context, intent: Intent?) {
        if (intent == null || Intent.ACTION_MEDIA_BUTTON != intent.action) return

        val keyEvent = intent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT)
        if (keyEvent != null) {
            Log.d(TAG, "Media button received: keyCode=${keyEvent.keyCode}, action=${keyEvent.action}")
            val handled = BluetoothControlManager.handleKeyEvent(context, keyEvent)
            if (handled && isOrderedBroadcast) {
                abortBroadcast()
            }
        }
    }
}
