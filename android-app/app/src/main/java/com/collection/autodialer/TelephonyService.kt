package com.collection.autodialer

import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.net.Uri
import android.os.Build
import android.telephony.PhoneStateListener
import android.telephony.TelephonyCallback
import android.telephony.TelephonyManager

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
    fun ensureListenerRegistered() {
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
            } else {
                @Suppress("DEPRECATION")
                telephonyManager.listen(object : PhoneStateListener() {
                    @Deprecated("Deprecated in Java")
                    override fun onCallStateChanged(state: Int, phoneNumber: String?) {
                        handleStateChange(state)
                    }
                }, PhoneStateListener.LISTEN_CALL_STATE)
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
        return isCallActive || telephonyManager.callState != TelephonyManager.CALL_STATE_IDLE
    }

    fun resetCallState() {
        isCallActive = false
        callStartTime = 0L
    }

    /**
     * Inspects the native Android CallLog provider to distinguish between:
     * 1) Real Connected Talk (CallLog.Calls.DURATION > 0)
     * 2) Unanswered / Ringing Dropped / Busy (CallLog.Calls.DURATION == 0)
     */
    fun getAccurateTalkDuration(dialedNumber: String): Int {
        try {
            if (androidx.core.content.ContextCompat.checkSelfPermission(
                    context,
                    android.Manifest.permission.READ_CALL_LOG
                ) == android.content.pm.PackageManager.PERMISSION_GRANTED
            ) {
                val cursor = context.contentResolver.query(
                    android.provider.CallLog.Calls.CONTENT_URI,
                    arrayOf(
                        android.provider.CallLog.Calls.NUMBER,
                        android.provider.CallLog.Calls.DURATION,
                        android.provider.CallLog.Calls.TYPE
                    ),
                    null,
                    null,
                    "${android.provider.CallLog.Calls.DATE} DESC"
                )
                cursor?.use {
                    if (it.moveToFirst()) {
                        val durIndex = it.getColumnIndex(android.provider.CallLog.Calls.DURATION)
                        if (durIndex != -1) {
                            return it.getInt(durIndex)
                        }
                    }
                }
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
        return 0
    }
}
