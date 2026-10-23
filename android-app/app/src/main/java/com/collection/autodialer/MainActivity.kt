package com.collection.autodialer

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.*
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient

class MainActivity : AppCompatActivity(), TelephonyService.CallStateEventListener {

    lateinit var telephonyService: TelephonyService
    private lateinit var webView: WebView
    var lastDialedPhone: String = ""
    private var assignedCases = ArrayList<JSONObject>()
    private var currentCaseIndex = 0
    private var isAutoDialingActive = false
    private var isPaused = false
    private var currentCallDuration = 0
    private var currentAudioMode = TelephonyService.AudioMode.HEADSET

    // Telecaller KPI Metrics
    private var totalDialsToday = 0
    private var isDisconnectProcessing = false
    private var pendingAutoDialRunnable: Runnable? = null

    // 30-Minute Inactivity Auto-Logout Tracking
    private var lastUserInteractionTime = System.currentTimeMillis()
    private val INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000L

    override fun onUserInteraction() {
        super.onUserInteraction()
        lastUserInteractionTime = System.currentTimeMillis()
    }

    private val handler = Handler(Looper.getMainLooper())
    private var countdownTimer: CountDownTimer? = null
    private var callChronometerHandler: Handler? = null
    private var callStartTimeMillis: Long = 0
    var isCallInProgress = false

    // UI View References
    private lateinit var layoutNativeSplash: View
    private lateinit var layoutLogin: View
    private lateinit var layoutDialer: LinearLayout
    private lateinit var layoutLocked: LinearLayout

    private lateinit var tvDebtorName: TextView
    private lateinit var tvLoanAcc: TextView
    private lateinit var tvPhone: TextView
    private lateinit var tvOverdue: TextView
    private lateinit var tvDpd: TextView
    private lateinit var tvBucket: TextView
    private lateinit var tvCallStatus: TextView
    private lateinit var tvCallTimer: TextView
    private lateinit var tvQueueProgress: TextView

    // KPI Views
    private lateinit var tvStatDials: TextView
    private lateinit var tvStatPtps: TextView
    private lateinit var tvStatQueue: TextView

    private lateinit var btnStartDial: Button
    private lateinit var btnPause: Button
    private lateinit var btnNextLead: Button
    private lateinit var btnAudioToggle: Button
    private lateinit var btnAgentImport: Button
    private lateinit var btnRefreshQueue: Button
    private lateinit var btnClearQueue: Button
    private lateinit var btnExportFeedback: Button

    // Automated SMS Views
    private lateinit var cbAutoSms: CheckBox
    private lateinit var btnSmsTemplate: Button

    // Version Validation Views
    private lateinit var tvLoginVersion: TextView
    private lateinit var tvHeaderSubtext: TextView

    // Native Android File Picker for Agent Self-Allocation
    private val filePickerLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let { handleAgentFileImport(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Enforce Anti-Theft FLAG_SECURE (Blocks screenshots & recording)
        SecurityManager.enforceAntiScreenshot(this)

        setContentView(R.layout.activity_main)

        initViews()
        telephonyService = TelephonyService(this, this)

        // 24-Hour Ephemeral Security Auto-Purge of local logs
        purgeExpiredLocalLogs()

        // Runtime Telephony Permissions (Phone, Call Log)
        checkPermissions()

        // Check for in-app updates
        checkForAppUpdates()

        // Setup Real-Time Live-Sync Chromium OTA Engine
        setupLiveSyncWebView()

        // Check if agent is already logged in (for background sync)
        val agentId = SecurityManager.getAgentId(this)
        if (agentId != -1) {
            val agentCode = SecurityManager.getAgentCode(this)
            tvQueueProgress.text = if (agentCode.isNotEmpty()) agentCode else "AGT001"
            startHeartbeatCycle()
            fetchAssignedQueue(agentId, showToast = false)
        }

        // Show Live-Sync Chromium View by default for instant Over-The-Air zero-reinstall updates
        showWebView()
    }

    private fun initViews() {
        webView = findViewById(R.id.webView)
        layoutNativeSplash = findViewById(R.id.layoutNativeSplash)
        layoutLogin = findViewById(R.id.layoutLogin)
        layoutDialer = findViewById(R.id.layoutDialer)
        layoutLocked = findViewById(R.id.layoutLocked)

        tvDebtorName = findViewById(R.id.tvDebtorName)
        tvLoanAcc = findViewById(R.id.tvLoanAcc)
        tvPhone = findViewById(R.id.tvPhone)
        tvOverdue = findViewById(R.id.tvOverdue)
        tvDpd = findViewById(R.id.tvDpd)
        tvBucket = findViewById(R.id.tvBucket)
        tvCallStatus = findViewById(R.id.tvCallStatus)
        tvCallTimer = findViewById(R.id.tvCallTimer)
        tvQueueProgress = findViewById(R.id.tvQueueProgress)

        tvStatDials = findViewById(R.id.tvStatDials)
        tvStatPtps = findViewById(R.id.tvStatPtps)
        tvStatQueue = findViewById(R.id.tvStatQueue)

        btnStartDial = findViewById(R.id.btnStartDial)
        btnPause = findViewById(R.id.btnPause)
        btnNextLead = findViewById(R.id.btnNextLead)
        btnAudioToggle = findViewById(R.id.btnAudioToggle)
        btnAgentImport = findViewById(R.id.btnAgentImport)
        btnRefreshQueue = findViewById(R.id.btnRefreshQueue)
        btnClearQueue = findViewById(R.id.btnClearQueue)
        btnExportFeedback = findViewById(R.id.btnExportFeedback)

        cbAutoSms = findViewById(R.id.cbAutoSms)
        btnSmsTemplate = findViewById(R.id.btnSmsTemplate)

        tvLoginVersion = findViewById(R.id.tvLoginVersion)
        tvHeaderSubtext = findViewById(R.id.tvHeaderSubtext)
        displayAppVersion()

        setupButtonListeners()
    }

    private fun setupButtonListeners() {
        // SMS Configuration Listeners
        cbAutoSms.isChecked = SmsSenderService.isAutoSmsEnabled(this)
        cbAutoSms.setOnCheckedChangeListener { _, isChecked ->
            SmsSenderService.setAutoSmsEnabled(this, isChecked)
            Toast.makeText(this, if (isChecked) "Auto-SMS active on call" else "Auto-SMS paused", Toast.LENGTH_SHORT).show()
        }

        btnSmsTemplate.setOnClickListener {
            openSmsTemplateDialog()
        }

        // Refresh queue or Retry RNR pool from Cloudflare
        btnRefreshQueue.setOnClickListener {
            val agentId = SecurityManager.getAgentId(this)
            if (agentId != -1) {
                val mode = if (btnRefreshQueue.text.toString().contains("RNR", ignoreCase = true)) "rnr" else "fresh"
                fetchAssignedQueue(agentId, showToast = true, mode = mode)
            }
        }

        // Clear / Delete Previous Campaign Queue (Point 3)
        btnClearQueue.setOnClickListener {
            val agentId = SecurityManager.getAgentId(this)
            if (agentId == -1) return@setOnClickListener

            androidx.appcompat.app.AlertDialog.Builder(this)
                .setTitle("Clear Active Campaign?")
                .setMessage("Are you sure you want to remove all remaining cases from your active queue? This will give you a fresh, clean slate.")
                .setPositiveButton("Clear Queue") { _, _ ->
                    thread {
                        try {
                            val payload = JSONObject().apply {
                                put("agent_id", agentId)
                            }
                            val res = ApiClient.post("/api/allocations/clear-agent-queue", payload)
                            handler.post {
                                res.onSuccess {
                                    assignedCases.clear()
                                    currentCaseIndex = 0
                                    deleteFile("cached_cases.json")
                                    deleteFile("offline_cases.json")
                                    updateDebtorCard()
                                    Toast.makeText(this@MainActivity, "Queue cleared! Ready for fresh import.", Toast.LENGTH_SHORT).show()
                                }.onFailure { err ->
                                    Toast.makeText(this@MainActivity, "Failed: ${err.message}", Toast.LENGTH_SHORT).show()
                                }
                            }
                        } catch (e: Exception) {
                            e.printStackTrace()
                        }
                    }
                }
                .setNegativeButton("Cancel", null)
                .show()
        }

        // Export daily feedback / shift report
        btnExportFeedback.setOnClickListener {
            exportShiftFeedback()
        }

        btnAgentImport.setOnClickListener {
            filePickerLauncher.launch("*/*")
        }

        btnStartDial.setOnClickListener {
            if (!isAutoDialingActive) {
                startAutoDialing()
            } else {
                stopAutoDialing()
            }
        }

        btnPause.setOnClickListener {
            isPaused = !isPaused
            btnPause.text = if (isPaused) "Resume" else "Pause"
            tvCallStatus.text = if (isPaused) "Auto-dial paused" else "Resumed"
        }

        btnNextLead.setOnClickListener {
            advanceToNextLead(autoDial = isAutoDialingActive)
        }

        btnAudioToggle.setOnClickListener {
            currentAudioMode = when (currentAudioMode) {
                TelephonyService.AudioMode.HEADSET -> TelephonyService.AudioMode.SPEAKER
                TelephonyService.AudioMode.SPEAKER -> TelephonyService.AudioMode.EARPIECE
                TelephonyService.AudioMode.EARPIECE -> TelephonyService.AudioMode.HEADSET
            }
            telephonyService.setAudioOutput(currentAudioMode)
            btnAudioToggle.text = when (currentAudioMode) {
                TelephonyService.AudioMode.HEADSET -> "Earphone"
                TelephonyService.AudioMode.SPEAKER -> "Speaker"
                TelephonyService.AudioMode.EARPIECE -> "Handset"
            }
        }

        // Login Button
        findViewById<Button>(R.id.btnLoginSubmit).setOnClickListener {
            val code = findViewById<EditText>(R.id.etAgentCode).text.toString().trim()
            val pass = findViewById<EditText>(R.id.etAgentPassword).text.toString().trim()
            performLogin(code, pass)
        }
    }

    private fun openSmsTemplateDialog() {
        val context = this
        val currentDetails = SmsSenderService.getTemplateDetails(context)
        val currentBulk = SmsSenderService.getTemplateBulk(context)

        val scroll = ScrollView(context)
        val layout = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(40, 20, 40, 20)
        }

        // Section 1: Template with Full Details
        val tvLabel1 = TextView(context).apply {
            text = "1. FULL DETAILS TEMPLATE (Customer Name + Overdue Amount)"
            textSize = 11f
            setTextColor(0xFF2563EB.toInt())
            paint.isFakeBoldText = true
        }
        val etDetails = EditText(context).apply {
            setText(currentDetails)
            textSize = 13f
            minLines = 3
            background = ContextCompat.getDrawable(context, android.R.drawable.edit_text)
        }
        val tvHint1 = TextView(context).apply {
            text = "Placeholders: {NAME}, {AMOUNT}, {AGENT_PHONE}"
            textSize = 10f
            setTextColor(0xFF64748B.toInt())
        }

        // Section 2: Simple Bulk Template
        val tvLabel2 = TextView(context).apply {
            text = "\n2. SIMPLE BULK TEMPLATE (When Uploading Numbers Only)"
            textSize = 11f
            setTextColor(0xFFD97706.toInt())
            paint.isFakeBoldText = true
        }
        val etBulk = EditText(context).apply {
            setText(currentBulk)
            textSize = 13f
            minLines = 3
            background = ContextCompat.getDrawable(context, android.R.drawable.edit_text)
        }
        val tvHint2 = TextView(context).apply {
            text = "Placeholders: {AGENT_PHONE}"
            textSize = 10f
            setTextColor(0xFF64748B.toInt())
        }

        layout.addView(tvLabel1)
        layout.addView(etDetails)
        layout.addView(tvHint1)
        layout.addView(tvLabel2)
        layout.addView(etBulk)
        layout.addView(tvHint2)
        scroll.addView(layout)

        AlertDialog.Builder(context)
            .setTitle("SMS Templates Setup")
            .setView(scroll)
            .setPositiveButton("Save Templates") { _, _ ->
                val newDetails = etDetails.text.toString().trim()
                val newBulk = etBulk.text.toString().trim()
                if (newDetails.isNotEmpty()) SmsSenderService.saveTemplateDetails(context, newDetails)
                if (newBulk.isNotEmpty()) SmsSenderService.saveTemplateBulk(context, newBulk)
                Toast.makeText(context, "Templates saved successfully!", Toast.LENGTH_SHORT).show()
            }
            .setNeutralButton("Reset Default") { _, _ ->
                SmsSenderService.saveTemplateDetails(context, SmsSenderService.DEFAULT_TEMPLATE_DETAILS)
                SmsSenderService.saveTemplateBulk(context, SmsSenderService.DEFAULT_TEMPLATE_BULK)
                Toast.makeText(context, "Reset to standard templates.", Toast.LENGTH_SHORT).show()
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun performLogin(code: String, pass: String) {
        val hardwareUuid = SecurityManager.getHardwareFingerprint(this)
        val deviceModel = SecurityManager.getDeviceModelName()

        thread {
            val payload = JSONObject().apply {
                put("agent_code", code)
                put("password", pass)
                put("hardware_uuid", hardwareUuid)
                put("device_model", deviceModel)
            }

            val result = ApiClient.post("/api/auth/login", payload)
            handler.post {
                result.onSuccess { json ->
                    val agentObj = json.getJSONObject("agent")
                    val agentId = agentObj.getInt("id")
                    val agentPhone = agentObj.optString("phone", "")
                    SecurityManager.saveAgentSession(this, agentId, code, agentPhone)
                    tvQueueProgress.text = code
                    showDialerScreen()
                    startHeartbeatCycle()
                    fetchAssignedQueue(agentId, showToast = false)
                }.onFailure { err ->
                    Toast.makeText(this, err.message, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun fetchAssignedQueue(agentId: Int, showToast: Boolean, mode: String = "fresh") {
        tvCallStatus.text = if (mode == "rnr") "Loading RNR Retries..." else "Syncing queue..."
        thread {
            val result = ApiClient.get("/api/allocations/my-cases?agent_id=$agentId&mode=$mode")
            handler.post {
                result.onSuccess { json ->
                    val isShiftActive = json.optBoolean("shift_active", true)
                    if (!isShiftActive) {
                        assignedCases.clear()
                        deleteFile("cached_cases.json")
                        currentCaseIndex = 0
                        updateDebtorCard()
                        tvCallStatus.text = "Shift Closed (8:00 AM – 8:00 PM IST) • Auto-Purged"
                        if (showToast) {
                            Toast.makeText(this@MainActivity, "Daily shift closed (8 PM). All records auto-purged.", Toast.LENGTH_LONG).show()
                        }
                        return@onSuccess
                    }

                    val casesArray = json.getJSONArray("cases")
                    val rnrAvailable = json.optInt("rnr_available", 0)
                    assignedCases.clear()
                    for (i in 0 until casesArray.length()) {
                        assignedCases.add(casesArray.getJSONObject(i))
                    }
                    saveCasesLocally(casesArray)
                    currentCaseIndex = 0
                    updateDebtorCard()
                    btnRefreshQueue.text = "Refresh"
                    if (showToast) {
                        val msg = if (mode == "rnr") {
                            "Loaded ${assignedCases.size} Unanswered RNR leads for Retry!"
                        } else {
                            "Queue updated: ${assignedCases.size} leads loaded! ($rnrAvailable RNR retries ready)"
                        }
                        Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
                    }
                }.onFailure { err ->
                    loadCasesFromLocalStorage()
                }
            }
        }
    }

    private fun updateDebtorCard() {
        if (assignedCases.isEmpty()) {
            tvDebtorName.text = "Queue Empty! Import or Upload"
            tvPhone.text = "-"
            tvOverdue.text = "₹ 0"
            tvStatQueue.text = "0"
            tvCallStatus.text = "Ready (Queue Empty)"
            btnStartDial.isEnabled = false
            return
        }

        val remaining = assignedCases.size - currentCaseIndex
        tvStatQueue.text = if (remaining > 0) remaining.toString() else "0"
        tvStatDials.text = totalDialsToday.toString()
        tvStatPtps.text = if (assignedCases.isNotEmpty()) "$totalDialsToday / ${assignedCases.size}" else "$totalDialsToday"

        if (currentCaseIndex >= assignedCases.size) {
            tvDebtorName.text = "Queue Completed! 🎉"
            tvPhone.text = "-"
            tvOverdue.text = "₹ 0"
            btnStartDial.isEnabled = false
            stopAutoDialing()
            return
        }

        btnStartDial.isEnabled = true
        val item = assignedCases[currentCaseIndex]
        val name = item.optString("customer_name", "Unknown Lead")
        val isBulkNumber = name.startsWith("Lead #", ignoreCase = true) || name.equals("Personal Debtor Lead", ignoreCase = true)

        tvDebtorName.text = if (isBulkNumber) "Bulk Lead (${item.optString("primary_phone")})" else name
        tvLoanAcc.text = "Loan Acc: ${item.optString("loan_account_no", "-")}"
        tvPhone.text = item.optString("primary_phone", "-")
        tvOverdue.text = "₹ ${item.optDouble("overdue_amount", 0.0).toInt()}"
        tvDpd.text = "DPD: ${item.optInt("dpd", 0)} Days"
        tvBucket.text = item.optString("bucket", "BUCKET 1").uppercase()
    }

    private fun startAutoDialing() {
        if (assignedCases.isEmpty()) {
            Toast.makeText(this, "Import or allocate cases first!", Toast.LENGTH_SHORT).show()
            return
        }
        isAutoDialingActive = true
        isPaused = false
        btnStartDial.text = "Stop Auto-Dial"
        btnStartDial.backgroundTintList = ContextCompat.getColorStateList(this, android.R.color.holo_red_dark)
        dialCurrentCase()
    }

    private fun stopAutoDialing() {
        isAutoDialingActive = false
        btnStartDial.text = "Start Auto-Dialing"
        btnStartDial.backgroundTintList = ContextCompat.getColorStateList(this, android.R.color.holo_green_dark)
        countdownTimer?.cancel()
        stopCallTimerTicker()
        tvCallStatus.text = "Ready to Dial"
    }

    private fun dialCurrentCase() {
        if (currentCaseIndex >= assignedCases.size) {
            Toast.makeText(this, "Queue Completed!", Toast.LENGTH_LONG).show()
            stopAutoDialing()
            return
        }

        val item = assignedCases[currentCaseIndex]
        val phoneNumber = item.optString("primary_phone", "")
        if (phoneNumber.isEmpty()) {
            advanceToNextLead(autoDial = true)
            return
        }

        // 1-to-1 Truthful Hardware Dial Count
        totalDialsToday++
        tvStatDials.text = totalDialsToday.toString()
        val dialedProgress = if (assignedCases.isNotEmpty()) "$totalDialsToday / ${assignedCases.size}" else "$totalDialsToday"
        tvStatPtps.text = dialedProgress

        tvCallStatus.text = "Dialing $phoneNumber..."
        tvCallTimer.text = "00:00"
        isCallInProgress = true
        isDisconnectProcessing = false
        lastDialedPhone = phoneNumber

        // Direct Cellular SIM Call
        telephonyService.placeCall(phoneNumber)

        // Process Auto-SMS on Call Dispatch if enabled
        if (cbAutoSms.isChecked) {
            val debtorName = item.optString("customer_name", "Customer")
            val overdueAmt = "₹ ${item.optDouble("overdue_amount", 0.0).toInt()}"
            val agentPhone = SecurityManager.getAgentPhone(this)
            SmsSenderService.sendAutoSms(
                context = this,
                recipientPhone = phoneNumber,
                customerName = debtorName,
                overdueAmount = overdueAmt,
                agentPhone = agentPhone
            )
        }

        // Asynchronous Anonymous Telemetry Ping to Server (Accurate 1-to-1 Dial Metric)
        val agentId = SecurityManager.getAgentId(this)
        if (agentId != -1) {
            thread {
                try {
                    ApiClient.post("/api/telemetry/anonymous-call-stat", JSONObject().apply {
                        put("agent_id", agentId)
                        put("duration_seconds", 0)
                    })
                } catch (e: Exception) {
                    // Ignore telemetry network hiccup
                }
            }
        }
    }

    private fun startCallTimerTicker() {
        callStartTimeMillis = SystemClock.elapsedRealtime()
        callChronometerHandler = Handler(Looper.getMainLooper())
        val runnable = object : Runnable {
            override fun run() {
                if (isCallInProgress) {
                    val elapsed = (SystemClock.elapsedRealtime() - callStartTimeMillis) / 1000
                    val mins = elapsed / 60
                    val secs = elapsed % 60
                    tvCallTimer.text = String.format("%02d:%02d", mins, secs)
                    callChronometerHandler?.postDelayed(this, 1000)
                }
            }
        }
        callChronometerHandler?.post(runnable)
    }

    private fun stopCallTimerTicker() {
        callChronometerHandler?.removeCallbacksAndMessages(null)
        callChronometerHandler = null
    }

    override fun onCallConnected() {
        handler.post {
            tvCallStatus.text = "Call Connected • Talking..."
            startCallTimerTicker()
            if (::webView.isInitialized) {
                webView.evaluateJavascript("window.onNativeCallConnected && window.onNativeCallConnected();", null)
            }
        }
    }

    override fun onCallDisconnected(durationSeconds: Int) {
        if (!isCallInProgress && isDisconnectProcessing) {
            return
        }
        isDisconnectProcessing = true
        isCallInProgress = false

        handler.post {
            stopCallTimerTicker()
            bringAppToFront()

            // Strict Linear Single-Step Progression (+1 only)
            currentCaseIndex++
            updateDebtorCard()

            if (currentCaseIndex < assignedCases.size) {
                if (isAutoDialingActive && !isPaused) {
                    tvCallStatus.text = "Call Ended • Next lead in 1.2s..."
                    pendingAutoDialRunnable?.let { handler.removeCallbacks(it) }
                    val runnable = Runnable {
                        isDisconnectProcessing = false
                        if (isAutoDialingActive && !isPaused) {
                            dialCurrentCase()
                        }
                    }
                    pendingAutoDialRunnable = runnable
                    handler.postDelayed(runnable, 1200)
                } else {
                    tvCallStatus.text = "Call Ended • Ready for Next Lead"
                    isDisconnectProcessing = false
                }
            } else {
                tvCallStatus.text = "Queue Completed! 🎉 All leads dialed"
                stopAutoDialing()
                isDisconnectProcessing = false
                Toast.makeText(this@MainActivity, "All leads in queue have been dialed!", Toast.LENGTH_LONG).show()
            }

            // Sync with Live-Sync WebView if active
            if (::webView.isInitialized) {
                webView.evaluateJavascript("window.onNativeCallDisconnected && window.onNativeCallDisconnected(0);", null)
            }
        }
    }

    private fun bringAppToFront() {
        try {
            val intent = Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }
            startActivity(intent)
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun advanceToNextLead(autoDial: Boolean) {
        countdownTimer?.cancel()
        pendingAutoDialRunnable?.let { handler.removeCallbacks(it) }
        pendingAutoDialRunnable = null
        isDisconnectProcessing = false

        currentCaseIndex++
        updateDebtorCard()

        if (currentCaseIndex < assignedCases.size) {
            if (autoDial && !isPaused) {
                tvCallStatus.text = "Next call in 1.2s..."
                val runnable = Runnable {
                    if (isAutoDialingActive && !isPaused) {
                        dialCurrentCase()
                    }
                }
                pendingAutoDialRunnable = runnable
                handler.postDelayed(runnable, 1200)
            } else {
                tvCallStatus.text = "Ready to Dial"
            }
        } else {
            Toast.makeText(this, "Queue Completed!", Toast.LENGTH_LONG).show()
            tvCallStatus.text = "Queue Completed • All leads dialed"
            stopAutoDialing()
        }
    }

    private fun exportShiftFeedback() {
        val agentId = SecurityManager.getAgentId(this)
        if (agentId == -1) return

        Toast.makeText(this, "Preparing Shift Feedback Report...", Toast.LENGTH_SHORT).show()
        thread {
            val res = ApiClient.get("/api/reports/agent-export?agent_id=$agentId")
            res.onSuccess { json ->
                val records = json.optJSONArray("records") ?: JSONArray()
                if (records.length() == 0) {
                    handler.post {
                        Toast.makeText(this@MainActivity, "No call logs found for this shift yet.", Toast.LENGTH_SHORT).show()
                    }
                    return@onSuccess
                }

                val csv = StringBuilder()
                csv.append("Timestamp,Customer Name,Phone,Loan Account,Duration (sec),Disposition,PTP Amount\n")
                for (i in 0 until records.length()) {
                    val r = records.getJSONObject(i)
                    csv.append("\"${r.optString("called_at")}\",")
                    csv.append("\"${r.optString("customer_name")}\",")
                    csv.append("\"${r.optString("dialed_phone")}\",")
                    csv.append("\"${r.optString("loan_account_no")}\",")
                    csv.append("${r.optInt("call_duration_seconds")},")
                    csv.append("\"${r.optString("disposition")}\",")
                    csv.append("${r.optDouble("ptp_amount", 0.0)}\n")
                }

                handler.post {
                    val share = Intent(Intent.ACTION_SEND).apply {
                        type = "text/plain"
                        putExtra(Intent.EXTRA_SUBJECT, "Shift Feedback - ${SecurityManager.getAgentCode(this@MainActivity)}")
                        putExtra(Intent.EXTRA_TEXT, csv.toString())
                    }
                    startActivity(Intent.createChooser(share, "Export Feedback Via"))
                }
            }.onFailure { err ->
                handler.post {
                    Toast.makeText(this@MainActivity, "Export failed: ${err.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun checkForAppUpdates() {
        thread {
            try {
                val currentVersionCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    packageManager.getPackageInfo(packageName, 0).longVersionCode.toInt()
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getPackageInfo(packageName, 0).versionCode
                }

                val res = ApiClient.get("/api/version")
                res.onSuccess { json ->
                    val serverVersionCode = json.optInt("versionCode", 1)
                    val serverVersionName = json.optString("versionName", "1.0.4")
                    val apkUrl = json.optString("apkUrl", "")
                    val changelog = json.optString("changelog", "Automated SMS on Dial, Smart Templates, Seamless Updates")

                    if (serverVersionCode > currentVersionCode) {
                        handler.post {
                            showUpdatePromptDialog(serverVersionName, changelog, apkUrl)
                        }
                    }
                }
            } catch (e: Exception) {
                e.printStackTrace()
            }
        }
    }

    private fun displayAppVersion() {
        try {
            val pInfo = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                packageManager.getPackageInfo(packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
            } else {
                @Suppress("DEPRECATION")
                packageManager.getPackageInfo(packageName, 0)
            }
            val vName = pInfo.versionName ?: "1.0.8"
            val vCode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pInfo.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pInfo.versionCode.toLong()
            }
            val versionStr = "v$vName (Build $vCode)"
            tvLoginVersion.text = "Version $versionStr • Verified"
            tvHeaderSubtext.text = "Auto-Dialer Active • $versionStr"
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun showUpdatePromptDialog(serverVersionName: String, changelog: String, apkUrl: String) {
        AlertDialog.Builder(this)
            .setTitle("Update Available ($serverVersionName)")
            .setMessage("What's New:\n• $changelog\n\nUpgrade now for latest features & bug fixes.")
            .setPositiveButton("Update Now") { _, _ ->
                val browserIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(apkUrl))
                startActivity(browserIntent)
            }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun handleAgentFileImport(uri: android.net.Uri) {
        val agentId = SecurityManager.getAgentId(this)
        if (agentId == -1) return

        thread {
            try {
                val inputStream = contentResolver.openInputStream(uri)
                val reader = java.io.BufferedReader(java.io.InputStreamReader(inputStream))
                val casesArray = JSONArray()

                reader.readLine() // Read header
                var line: String?
                var count = 0
                while (reader.readLine().also { line = it } != null && count < 500) {
                    val parts = line!!.split(",")
                    if (parts.isNotEmpty()) {
                        val phone = parts.find { it.replace(Regex("\\D"), "").length >= 10 } ?: parts[0]
                        val cleanPhone = phone.replace(Regex("\\D"), "")
                        val name = if (parts.size > 1) parts[0].trim().replace("\"", "") else "Lead #${count + 1}"
                        val loan = if (parts.size > 2) parts[1].trim().replace("\"", "") else "SLF-${System.currentTimeMillis() % 10000}"

                        casesArray.put(JSONObject().apply {
                            put("id", count + 1)
                            put("primary_phone", cleanPhone)
                            put("customer_name", name)
                            put("loan_account_no", loan)
                            put("overdue_amount", 12500)
                            put("dpd", 30)
                            put("bucket", "BUCKET 1")
                        })
                        count++
                    }
                }
                reader.close()

                // 100% PRIVATE LOCAL STORAGE: Save directly to phone storage
                assignedCases.clear()
                for (i in 0 until casesArray.length()) {
                    assignedCases.add(casesArray.getJSONObject(i))
                }
                saveCasesLocally(casesArray)
                currentCaseIndex = 0

                // Synchronize active shift queue with Web Cockpit
                thread {
                    try {
                        val syncPayload = JSONObject().apply {
                            put("agent_id", agentId)
                            put("cases", casesArray)
                            put("clear_previous", true)
                        }
                        ApiClient.post("/api/allocations/upload-agent", syncPayload)
                    } catch (e: Exception) {
                        e.printStackTrace()
                    }
                }

                handler.post {
                    updateDebtorCard()
                    Toast.makeText(this@MainActivity, "Loaded $count leads directly into your phone storage!", Toast.LENGTH_LONG).show()

                    // Also sync into Live-Sync WebView if active
                    if (::webView.isInitialized) {
                        val casesJsonStr = casesArray.toString().replace("'", "\\'")
                        webView.evaluateJavascript("""
                            (function() {
                                try {
                                    cockpitCases = JSON.parse('$casesJsonStr');
                                    cockpitIndex = 0;
                                    localStorage.setItem('debtflow_cached_cases_' + ($agentId), JSON.stringify(cockpitCases));
                                    if (typeof renderCockpitCase === 'function') renderCockpitCase();
                                } catch(e) { console.error(e); }
                            })();
                        """.trimIndent(), null)
                    }
                }
            } catch (e: Exception) {
                handler.post {
                    Toast.makeText(this@MainActivity, "Failed to read file: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
        }
    }

    private fun startHeartbeatCycle() {
        val runnable = object : Runnable {
            override fun run() {
                val agentId = SecurityManager.getAgentId(this@MainActivity)
                if (agentId != -1) {
                    // Check 30-minute inactivity timeout
                    if (!isCallInProgress && !isAutoDialingActive && (System.currentTimeMillis() - lastUserInteractionTime > INACTIVITY_TIMEOUT_MS)) {
                        handler.post {
                            Toast.makeText(this@MainActivity, "Logged out due to 30 minutes of inactivity.", Toast.LENGTH_LONG).show()
                            SecurityManager.clearAgentSession(this@MainActivity)
                            layoutLogin.visibility = View.VISIBLE
                            layoutDialer.visibility = View.GONE
                        }
                        return
                    }

                    val hardwareUuid = SecurityManager.getHardwareFingerprint(this@MainActivity)
                    thread {
                        val payload = JSONObject().apply {
                            put("agent_id", agentId)
                            put("hardware_uuid", hardwareUuid)
                        }
                        ApiClient.post("/api/auth/heartbeat", payload)
                    }
                }
                handler.postDelayed(this, 60000)
            }
        }
        handler.postDelayed(runnable, 60000)
    }

    private fun setupLiveSyncWebView() {
        webView = findViewById(R.id.webView)
        webView.setBackgroundColor(android.graphics.Color.parseColor("#F8FAFC"))
        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.mediaPlaybackRequiresUserGesture = false

        webView.addJavascriptInterface(AndroidTelephonyBridge(this), "AndroidBridge")

        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                dismissNativeSplash()
            }

            override fun onReceivedError(view: WebView?, errorCode: Int, description: String?, failingUrl: String?) {
                super.onReceivedError(view, errorCode, description, failingUrl)
                dismissNativeSplash()
            }

            override fun onReceivedSslError(view: WebView?, handler: android.webkit.SslErrorHandler?, error: android.net.http.SslError?) {
                handler?.proceed()
                dismissNativeSplash()
            }

            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean {
                val url = request?.url?.toString() ?: return false
                return handleUrlOverride(url)
            }

            @Deprecated("Deprecated in Java")
            override fun shouldOverrideUrlLoading(view: WebView?, url: String?): Boolean {
                if (url == null) return false
                return handleUrlOverride(url)
            }

            private fun handleUrlOverride(url: String): Boolean {
                if (url.startsWith("tel:")) {
                    val phone = url.removePrefix("tel:")
                    lastDialedPhone = phone
                    telephonyService.placeCall(phone)
                    return true
                }
                if (url.endsWith(".apk")) {
                    val intent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))
                    startActivity(intent)
                    return true
                }
                return false
            }
        }

        webView.webChromeClient = WebChromeClient()
        webView.loadUrl("https://dialer.gdsdebtpro.workers.dev")
        handler.postDelayed({ dismissNativeSplash() }, 800)
    }

    private fun dismissNativeSplash() {
        if (::layoutNativeSplash.isInitialized && layoutNativeSplash.visibility == View.VISIBLE) {
            layoutNativeSplash.animate()
                .alpha(0f)
                .setDuration(200)
                .withEndAction { layoutNativeSplash.visibility = View.GONE }
                .start()
        }
    }

    fun showWebView() {
        dismissNativeSplash()
        webView.visibility = View.VISIBLE
        layoutLogin.visibility = View.GONE
        layoutDialer.visibility = View.GONE
        layoutLocked.visibility = View.GONE
    }

    fun showLoginScreen() {
        dismissNativeSplash()
        webView.visibility = View.GONE
        layoutLogin.visibility = View.VISIBLE
        layoutDialer.visibility = View.GONE
        layoutLocked.visibility = View.GONE
    }

    fun showDialerScreen() {
        dismissNativeSplash()
        webView.visibility = View.GONE
        layoutLogin.visibility = View.GONE
        layoutDialer.visibility = View.VISIBLE
        layoutLocked.visibility = View.GONE
    }

    private fun showLockedScreen(reason: String) {
        webView.visibility = View.GONE
        layoutLogin.visibility = View.GONE
        layoutDialer.visibility = View.GONE
        layoutLocked.visibility = View.VISIBLE
        findViewById<TextView>(R.id.tvLockReason).text = reason
    }

    private fun saveCasesLocally(casesArray: JSONArray) {
        try {
            val fos = openFileOutput("cached_cases.json", android.content.Context.MODE_PRIVATE)
            fos.write(casesArray.toString().toByteArray(Charsets.UTF_8))
            fos.close()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun loadCasesFromLocalStorage() {
        try {
            val fis = openFileInput("cached_cases.json")
            val text = fis.bufferedReader().use { it.readText() }
            val casesArray = JSONArray(text)
            assignedCases.clear()
            for (i in 0 until casesArray.length()) {
                assignedCases.add(casesArray.getJSONObject(i))
            }
            currentCaseIndex = 0
            handler.post {
                updateDebtorCard()
                Toast.makeText(this, "Loaded ${assignedCases.size} cases from phone storage.", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            handler.post {
                Toast.makeText(this, "Queue empty. Tap + Import or Refresh.", Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun saveOfflineCallLog(log: JSONObject) {
        try {
            log.put("timestamp", System.currentTimeMillis())
            val currentLogs = loadOfflineCallLogs()
            currentLogs.put(log)
            val fos = openFileOutput("offline_call_logs.json", android.content.Context.MODE_PRIVATE)
            fos.write(currentLogs.toString().toByteArray(Charsets.UTF_8))
            fos.close()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    // 24-Hour Ephemeral Security Policy: Automatically purges local records older than 24h
    private fun purgeExpiredLocalLogs() {
        try {
            val cutoff = System.currentTimeMillis() - (24 * 60 * 60 * 1000L) // 24 hours ago
            val logs = loadOfflineCallLogs()
            val freshLogs = JSONArray()
            for (i in 0 until logs.length()) {
                val obj = logs.getJSONObject(i)
                val ts = obj.optLong("timestamp", System.currentTimeMillis())
                if (ts >= cutoff) {
                    freshLogs.put(obj)
                }
            }
            val fos = openFileOutput("offline_call_logs.json", android.content.Context.MODE_PRIVATE)
            fos.write(freshLogs.toString().toByteArray(Charsets.UTF_8))
            fos.close()
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun loadOfflineCallLogs(): JSONArray {
        return try {
            val fis = openFileInput("offline_call_logs.json")
            val text = fis.bufferedReader().use { it.readText() }
            JSONArray(text)
        } catch (e: Exception) {
            JSONArray()
        }
    }

    private fun syncOfflineLogsIfNeeded(agentId: Int) {
        purgeExpiredLocalLogs()
        val logs = loadOfflineCallLogs()
        if (logs.length() == 0) return

        val payload = JSONObject().apply {
            put("agent_id", agentId)
            put("logs", logs)
        }

        val result = ApiClient.post("/api/calls/batch-sync", payload)
        result.onSuccess {
            deleteFile("offline_call_logs.json")
        }
    }

    private fun checkPermissions() {
        val perms = arrayOf(
            Manifest.permission.CALL_PHONE,
            Manifest.permission.READ_PHONE_STATE
        )
        val missing = perms.filter { ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, missing.toTypedArray(), 101)
        } else {
            telephonyService.ensureListenerRegistered()
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 101) {
            telephonyService.ensureListenerRegistered()
        }
    }

    override fun onResume() {
        super.onResume()
        checkForAppUpdates()
        val agentId = SecurityManager.getAgentId(this)
        if (agentId != -1 && assignedCases.isEmpty()) {
            fetchAssignedQueue(agentId, showToast = false)
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.visibility == View.VISIBLE && webView.canGoBack()) {
            webView.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}
