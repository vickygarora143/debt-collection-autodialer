package com.collection.autodialer

import android.content.Context
import android.content.Intent
import android.net.Uri

object SmsSenderService {

    const val PREFS_SMS = "DebtFlowSmsPrefs"
    const val KEY_AUTO_SMS_ENABLED = "auto_sms_enabled"
    const val KEY_TEMPLATE_DETAILS = "template_details"
    const val KEY_TEMPLATE_BULK = "template_bulk"

    const val DEFAULT_TEMPLATE_DETAILS = "Dear {NAME}, your overdue balance is {AMOUNT}. Please clear your dues immediately or contact {AGENT_PHONE}. - Collection Dept."
    const val DEFAULT_TEMPLATE_BULK = "Dear Customer, please contact your recovery officer regarding your overdue account on {AGENT_PHONE}. Urgent callback required."

    fun isAutoSmsEnabled(context: Context): Boolean {
        val prefs = context.getSharedPreferences(PREFS_SMS, Context.MODE_PRIVATE)
        return prefs.getBoolean(KEY_AUTO_SMS_ENABLED, true)
    }

    fun setAutoSmsEnabled(context: Context, enabled: Boolean) {
        val prefs = context.getSharedPreferences(PREFS_SMS, Context.MODE_PRIVATE)
        prefs.edit().putBoolean(KEY_AUTO_SMS_ENABLED, enabled).apply()
    }

    fun getTemplateDetails(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_SMS, Context.MODE_PRIVATE)
        return prefs.getString(KEY_TEMPLATE_DETAILS, DEFAULT_TEMPLATE_DETAILS) ?: DEFAULT_TEMPLATE_DETAILS
    }

    fun saveTemplateDetails(context: Context, template: String) {
        val prefs = context.getSharedPreferences(PREFS_SMS, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_TEMPLATE_DETAILS, template).apply()
    }

    fun getTemplateBulk(context: Context): String {
        val prefs = context.getSharedPreferences(PREFS_SMS, Context.MODE_PRIVATE)
        return prefs.getString(KEY_TEMPLATE_BULK, DEFAULT_TEMPLATE_BULK) ?: DEFAULT_TEMPLATE_BULK
    }

    fun saveTemplateBulk(context: Context, template: String) {
        val prefs = context.getSharedPreferences(PREFS_SMS, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_TEMPLATE_BULK, template).apply()
    }

    fun sendAutoSms(
        context: Context,
        recipientPhone: String,
        customerName: String,
        overdueAmount: String,
        agentPhone: String
    ): Boolean {
        return try {
            val cleanPhone = recipientPhone.replace(Regex("[^0-9+]"), "")
            if (cleanPhone.length < 10) return false

            val hasValidDetails = customerName.isNotEmpty() &&
                    !customerName.startsWith("Lead #", ignoreCase = true) &&
                    !customerName.equals("Personal Debtor Lead", ignoreCase = true) &&
                    !customerName.equals("Unknown Lead", ignoreCase = true) &&
                    overdueAmount.isNotEmpty() &&
                    !overdueAmount.equals("₹ 0", ignoreCase = true)

            val rawTemplate = if (hasValidDetails) {
                getTemplateDetails(context)
            } else {
                getTemplateBulk(context)
            }

            // Interpolate dynamic placeholders
            val personalizedText = rawTemplate
                .replace("{NAME}", customerName)
                .replace("{AMOUNT}", overdueAmount)
                .replace("{AGENT_PHONE}", if (agentPhone.isNotEmpty()) agentPhone else "our office")

            // Safe, Google Play Protect-compliant system SMS Intent (Requires 0 dangerous SMS permissions)
            val smsIntent = Intent(Intent.ACTION_SENDTO).apply {
                data = Uri.parse("smsto:$cleanPhone")
                putExtra("sms_body", personalizedText)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(smsIntent)
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }

    /**
     * Automated Urgent Callback Notice for Unanswered (RNR) Calls
     */
    fun sendRnrCallbackSms(
        context: Context,
        recipientPhone: String,
        customerName: String,
        overdueAmount: String,
        agentPhone: String
    ): Boolean {
        return try {
            val cleanPhone = recipientPhone.replace(Regex("[^0-9+]"), "")
            if (cleanPhone.length < 10) return false

            val text = "URGENT NOTICE: We attempted to reach you regarding your overdue loan account. Immediate callback required. Contact Recovery Officer at ${if (agentPhone.isNotEmpty()) agentPhone else "our office"}."

            val smsIntent = Intent(Intent.ACTION_SENDTO).apply {
                data = Uri.parse("smsto:$cleanPhone")
                putExtra("sms_body", text)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(smsIntent)
            true
        } catch (e: Exception) {
            e.printStackTrace()
            false
        }
    }
}
