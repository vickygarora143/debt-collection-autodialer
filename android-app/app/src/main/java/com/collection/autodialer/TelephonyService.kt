package com.collection.autodialer

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

class TelephonyService(private val context: Context, private val listener: CallStateEventListener) {

    private val telephonyManager = context.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager

    private var isCallActive = false
    private var callStartTime: Long = 0

    interface CallStateEventListener {
        fun onCallConnected()
        fun onCallDisconnected(durationSeconds: Int)
    }

    enum class AudioMode {
        HEADSET, SPEAKER, EARPIECE
    }

    init {
        registerCallStateListener()
    }

    // 1. Direct Cellular SIM Calling
    fun placeCall(phoneNumber: String) {
        val cleanNumber = phoneNumber.replace(Regex("[^0-9+]"), "")
        isCallActive = true
        callStartTime = System.currentTimeMillis()
        try {
            val callIntent = Intent(Intent.ACTION_CALL).apply {
                data = Uri.parse("tel:$cleanNumber")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(callIntent)
        } catch (e: SecurityException) {
            // Safe fallback if CALL_PHONE permission not yet granted
            val dialIntent = Intent(Intent.ACTION_DIAL).apply {
                data = Uri.parse("tel:$cleanNumber")
                flags = Intent.FLAG_ACTIVITY_NEW_TASK
            }
            context.startActivity(dialIntent)
        } catch (e: Exception) {
            e.printStackTrace()
            isCallActive = false
            callStartTime = 0L
        }
    }

    // 2. Audio Output Routing (Headset / Speaker / Handset)
    fun setAudioOutput(mode: AudioMode) {
        when (mode) {
            AudioMode.SPEAKER -> {
                audioManager.mode = AudioManager.MODE_IN_CALL
                audioManager.isSpeakerphoneOn = true
            }
            AudioMode.HEADSET -> {
                audioManager.isSpeakerphoneOn = false
                audioManager.mode = AudioManager.MODE_IN_CALL
            }
            AudioMode.EARPIECE -> {
                audioManager.isSpeakerphoneOn = false
                audioManager.mode = AudioManager.MODE_IN_CALL
            }
        }
    }

    // 3. Telephony State Monitoring across Android versions
    private var isListenerRegistered = false

    fun ensureListenerRegistered() {
        if (isListenerRegistered) return
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                telephonyManager.registerTelephonyCallback(
                    context.mainExecutor,
                    object : TelephonyCallback(), TelephonyCallback.CallStateListener {
                        override fun onCallStateChanged(state: Int) {
                            handleStateChange(state)
                        }
                    }
                )
                isListenerRegistered = true
            } else {
                @Suppress("DEPRECATION")
                telephonyManager.listen(object : PhoneStateListener() {
                    @Deprecated("Deprecated in Java")
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                        handleStateChange(state)
                    }
                }, PhoneStateListener.LISTEN_CALL_STATE)
                isListenerRegistered = true
            }
        } catch (e: SecurityException) {
            // Permission pending from user; will be registered once permission granted
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun registerCallStateListener() {
        ensureListenerRegistered()
    }

    private fun handleStateChange(state: Int) {
        when (state) {
            TelephonyManager.CALL_STATE_OFFHOOK -> {
                // Call dialed / active
                isCallActive = true
                if (callStartTime == 0L) {
                    callStartTime = System.currentTimeMillis()
                }
                listener.onCallConnected()
            }
            TelephonyManager.CALL_STATE_IDLE -> {
                // Call ended, dropped, rejected, or canceled
                val wasActive = isCallActive || callStartTime > 0L
                isCallActive = false
                if (wasActive) {
                    val duration = if (callStartTime > 0L) ((System.currentTimeMillis() - callStartTime) / 1000).toInt() else 0
                    callStartTime = 0L
                    listener.onCallDisconnected(if (duration > 0) duration else 0)
                }
            }
            TelephonyManager.CALL_STATE_RINGING -> {
                // Outbound or inbound ringing
            }
        }
    }

    fun isCurrentlyInCall(): Boolean {
        return try {
            if (isCallActive) return true
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_PHONE_STATE) == PackageManager.PERMISSION_GRANTED) {
                telephonyManager.callState != TelephonyManager.CALL_STATE_IDLE
            } else {
                false
            }
        } catch (e: Exception) {
            isCallActive
        }
    }

    fun resetCallState() {
        isCallActive = false
        callStartTime = 0L
    }

    /**
     * Pure in-memory duration tracking (No CallLog access needed - 100% Agent Privacy Protected)
     */
    fun getAccurateTalkDuration(dialedNumber: String): Int {
        if (callStartTime > 0L) {
            val dur = ((System.currentTimeMillis() - callStartTime) / 1000).toInt()
            return if (dur > 0) dur else 0
        }
        return 0
    }
}
