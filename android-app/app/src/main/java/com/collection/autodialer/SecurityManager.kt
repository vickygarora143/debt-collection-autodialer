package com.collection.autodialer

import android.app.Activity
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.provider.Settings
import android.view.WindowManager
import org.json.JSONObject
import java.security.MessageDigest

object SecurityManager {

    private const val PREFS_NAME = "DebtFlowSecurePrefs"
    private const val KEY_AGENT_ID = "agent_id"
    private const val KEY_AGENT_CODE = "agent_code"
    private const val KEY_IS_LOCKED = "is_locked"

    // 1. Blocks Screenshots and Screen Recording on Android
    fun enforceAntiScreenshot(activity: Activity) {
        activity.window.setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        )
    }

    // 2. Hardware Device Binding Identifier
    fun getHardwareFingerprint(context: Context): String {
        val androidId = Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID) ?: "UNKNOWN_ID"
        val rawFingerprint = "$androidId|${Build.MANUFACTURER}|${Build.MODEL}|${Build.HARDWARE}"
        
        return try {
            val digest = MessageDigest.getInstance("SHA-256")
            val hash = digest.digest(rawFingerprint.toByteArray(Charsets.UTF_8))
            hash.joinToString("") { "%02x".format(it) }.substring(0, 32)
        } catch (e: Exception) {
            androidId
        }
    }

    fun getDeviceModelName(): String {
        return "${Build.MANUFACTURER.capitalize()} ${Build.MODEL}"
    }

    // 3. Remote Kill-Switch Local Execution (Wipe & Lock)
    fun executeEmergencyWipeAndLock(context: Context, onLocked: () -> Unit) {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putBoolean(KEY_IS_LOCKED, true)
            .remove(KEY_AGENT_ID)
            .remove(KEY_AGENT_CODE)
            .apply()

        // Invoke UI callback to show permanent lock screen
        onLocked()
    }

    fun isDeviceLocked(context: Context): Boolean {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_IS_LOCKED, false)
    }

    fun saveAgentSession(context: Context, agentId: Int, agentCode: String) {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit()
            .putInt(KEY_AGENT_ID, agentId)
            .putString(KEY_AGENT_CODE, agentCode)
            .putBoolean(KEY_IS_LOCKED, false)
            .apply()
    }

    fun getAgentId(context: Context): Int {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getInt(KEY_AGENT_ID, -1)
    }

    fun getAgentCode(context: Context): String {
        val prefs: SharedPreferences = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        return prefs.getString(KEY_AGENT_CODE, "") ?: ""
    }
}
