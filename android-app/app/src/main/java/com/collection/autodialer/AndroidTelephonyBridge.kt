package com.collection.autodialer

import android.content.Context
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.webkit.JavascriptInterface
import android.widget.Toast

class AndroidTelephonyBridge(private val activity: MainActivity) {

    @JavascriptInterface
    fun makeSimCall(phoneNumber: String) {
        activity.runOnUiThread {
            activity.lastDialedPhone = phoneNumber
            activity.isCallInProgress = true
            activity.telephonyService.placeCall(phoneNumber)
        }
    }

    @JavascriptInterface
    fun getHardwareTalkDuration(phoneNumber: String): Int {
        return activity.telephonyService.getAccurateTalkDuration(phoneNumber)
    }

    @JavascriptInterface
    fun sendSimSms(phoneNumber: String, customerName: String, amount: String, agentPhone: String): Boolean {
        return SmsSenderService.sendAutoSms(activity, phoneNumber, customerName, amount, agentPhone)
    }

    @JavascriptInterface
    fun setAudioMode(mode: String) {
        activity.runOnUiThread {
            when (mode.uppercase()) {
                "SPEAKER" -> activity.telephonyService.setAudioOutput(TelephonyService.AudioMode.SPEAKER)
                "EARPHONE", "HEADSET" -> activity.telephonyService.setAudioOutput(TelephonyService.AudioMode.HEADSET)
                else -> activity.telephonyService.setAudioOutput(TelephonyService.AudioMode.EARPIECE)
            }
        }
    }

    @JavascriptInterface
    fun getHardwareFingerprint(): String {
        return SecurityManager.getHardwareFingerprint(activity)
    }

    @JavascriptInterface
    fun getAppVersion(): String {
        return "v1.1.0 (Live-Sync)"
    }

    @JavascriptInterface
    fun showToast(message: String) {
        activity.runOnUiThread {
            Toast.makeText(activity, message, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun hapticFeedback() {
        activity.runOnUiThread {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    val vm = activity.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
                    vm?.defaultVibrator?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK))
                } else {
                    @Suppress("DEPRECATION")
                    val v = activity.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
                    v?.vibrate(25)
                }
            } catch (e: Exception) {
                // Ignore haptic failure
            }
        }
    }
}
