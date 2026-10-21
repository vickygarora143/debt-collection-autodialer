package com.collection.autodialer

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONArray
import org.json.JSONObject
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity(), TelephonyService.CallStateEventListener {

    private lateinit var telephonyService: TelephonyService
    private var assignedCases = ArrayList<JSONObject>()
    private var currentCaseIndex = 0
    private var isAutoDialingActive = false
    private var isPaused = false
    private var currentCallDuration = 0
    private var currentAudioMode = TelephonyService.AudioMode.HEADSET

    // Telecaller KPI Metrics
    private var totalDialsToday = 0
    private var totalPtpsToday = 0

    private val handler = Handler(Looper.getMainLooper())
    private var countdownTimer: CountDownTimer? = null
    private var callChronometerHandler: Handler? = null
    private var callStartTimeMillis: Long = 0
    private var isCallInProgress = false

    // UI View References
    private lateinit var layoutLogin: LinearLayout
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
    private lateinit var btnExportFeedback: Button
    private lateinit var layoutDispositions: LinearLayout

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

        // Runtime Telephony Permissions
        checkPermissions()

        // Check for in-app updates (Point 6)
        checkForAppUpdates()

        // Check if agent is already logged in
        val agentId = SecurityManager.getAgentId(this)
        if (agentId != -1) {
            val agentCode = SecurityManager.getAgentCode(this)
            tvQueueProgress.text = if (agentCode.isNotEmpty()) agentCode else "AGT001"
            showDialerScreen()
            startHeartbeatCycle()
            fetchAssignedQueue(agentId, showToast = false)
        } else {
            showLoginScreen()
        }
    }

    private fun initViews() {
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
        btnExportFeedback = findViewById(R.id.btnExportFeedback)
        layoutDispositions = findViewById(R.id.layoutDispositions)

        setupButtonListeners()
    }

    private fun setupButtonListeners() {
        // Point 3: Refresh queue from Cloudflare without logout
        btnRefreshQueue.setOnClickListener {
            val agentId = SecurityManager.getAgentId(this)
            if (agentId != -1) {
                fetchAssignedQueue(agentId, showToast = true)
            }
        }

        // Point 2: Export daily feedback / shift report
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

        // Point 5: 1-Tap Recovery Feedback Buttons (Always accessible)
        findViewById<Button>(R.id.btnDispPtp).setOnClickListener { recordDisposition("PTP") }
        findViewById<Button>(R.id.btnDispBrokenPtp).setOnClickListener { recordDisposition("BROKEN_PTP") }
        findViewById<Button>(R.id.btnDispRnr).setOnClickListener { recordDisposition("RNR") }
        findViewById<Button>(R.id.btnDispBusy).setOnClickListener { recordDisposition("BUSY") }
        findViewById<Button>(R.id.btnDispWrong).setOnClickListener { recordDisposition("WRONG_NUMBER") }
        findViewById<Button>(R.id.btnDispPaid).setOnClickListener { recordDisposition("PAID_ONLINE") }

        // Login Button
        findViewById<Button>(R.id.btnLoginSubmit).setOnClickListener {
            val code = findViewById<EditText>(R.id.etAgentCode).text.toString().trim()
            val pass = findViewById<EditText>(R.id.etAgentPassword).text.toString().trim()
            performLogin(code, pass)
        }
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
                    SecurityManager.saveAgentSession(this, agentId, code)
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

    // Point 3: Instant Queue Fetch / Refresh
    private fun fetchAssignedQueue(agentId: Int, showToast: Boolean) {
        tvCallStatus.text = "Syncing queue..."
        thread {
            val result = ApiClient.get("/api/allocations/my-cases?agent_id=$agentId")
            handler.post {
                result.onSuccess { json ->
                    val casesArray = json.getJSONArray("cases")
                    assignedCases.clear()
                    for (i in 0 until casesArray.length()) {
                        assignedCases.add(casesArray.getJSONObject(i))
                    }
                    saveCasesLocally(casesArray)
                    currentCaseIndex = 0
                    updateDebtorCard()
                    if (showToast) {
                        Toast.makeText(this, "Queue updated: ${assignedCases.size} cases loaded!", Toast.LENGTH_SHORT).show()
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
        tvStatPtps.text = totalPtpsToday.toString()

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
        tvDebtorName.text = item.optString("customer_name", "Unknown Lead")
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

        totalDialsToday++
        tvStatDials.text = totalDialsToday.toString()

        tvCallStatus.text = "Dialing $phoneNumber..."
        tvCallTimer.text = "00:00"
        isCallInProgress = true

        telephonyService.placeCall(phoneNumber)
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

    // Callbacks from TelephonyService
    override fun onCallConnected() {
        handler.post {
            tvCallStatus.text = "Call Connected • Talking..."
            startCallTimerTicker()
        }
    }

    // Point 1 & Point 4: Smart Call Analysis & Truecaller Overlay Bypass
    override fun onCallDisconnected(durationSeconds: Int) {
        currentCallDuration = durationSeconds
        isCallInProgress = false
        handler.post {
            stopCallTimerTicker()
            
            // Point 1: Bring DebtFlow to front immediately (bypassing Truecaller overlay)
            bringAppToFront()

            // Point 4: Telephony Smart Outcome Analysis
            val autoTag = if (durationSeconds > 0) "CONNECTED" else "RNR"
            tvCallStatus.text = if (durationSeconds > 0) {
                "Call Ended (${durationSeconds}s) • Tap Outcome Tag"
            } else {
                "Ringing Dropped (RNR) • Next in 4s..."
            }

            // Start countdown to next call
            startCountdownTimer(defaultTag = if (durationSeconds > 0) "RNR" else "RNR")
        }
    }

    // Point 1: Re-surface DebtFlow over any overlay
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

    private fun startCountdownTimer(defaultTag: String = "RNR") {
        countdownTimer?.cancel()
        countdownTimer = object : CountDownTimer(4000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val sec = millisUntilFinished / 1000
                tvCallStatus.text = "Tap Tag or Auto-Next in ${sec}s..."
            }

            override fun onFinish() {
                recordDisposition(defaultTag)
            }
        }.start()
    }

    private fun recordDisposition(disposition: String) {
        countdownTimer?.cancel()

        if (disposition == "PTP") {
            totalPtpsToday++
            tvStatPtps.text = totalPtpsToday.toString()
        }

        if (assignedCases.isNotEmpty() && currentCaseIndex < assignedCases.size) {
            val currentCase = assignedCases[currentCaseIndex]
            val allocId = currentCase.optInt("id", 0)
            val phone = currentCase.optString("primary_phone", "")
            val agentId = SecurityManager.getAgentId(this)

            thread {
                try {
                    val payload = JSONObject().apply {
                        put("allocation_id", allocId)
                        put("agent_id", agentId)
                        put("dialed_phone", phone)
                        put("call_duration_seconds", currentCallDuration)
                        put("disposition", disposition)
                    }
                    val res = ApiClient.post("/api/calls/log", payload)
                    if (res.isFailure) {
                        saveOfflineCallLog(payload)
                    } else {
                        syncOfflineLogsIfNeeded(agentId)
                    }
                } catch (e: Exception) {
                    e.printStackTrace()
                }
            }
        }

        advanceToNextLead(autoDial = isAutoDialingActive)
    }

    private fun advanceToNextLead(autoDial: Boolean) {
        countdownTimer?.cancel()
        currentCaseIndex++

        updateDebtorCard()

        if (currentCaseIndex < assignedCases.size) {
            if (autoDial && !isPaused) {
                tvCallStatus.text = "Next call starting in 1.5s..."
                handler.postDelayed({
                    if (isAutoDialingActive && !isPaused) {
                        dialCurrentCase()
                    }
                }, 1500)
            } else {
                tvCallStatus.text = "Ready to Dial"
            }
        } else {
            Toast.makeText(this, "Queue Completed!", Toast.LENGTH_LONG).show()
            stopAutoDialing()
        }
    }

    // Point 2: Export Agent Shift Feedback as CSV
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

    // Point 6: In-App Auto-Update Check
    private fun checkForAppUpdates() {
        thread {
            val res = ApiClient.get("/api/version")
            res.onSuccess { json ->
                val serverVersionCode = json.optInt("versionCode", 1)
                val serverVersionName = json.optString("versionName", "1.0.2")
                val apkUrl = json.optString("apkUrl", "")
                val changelog = json.optString("changelog", "Performance improvements")

                if (serverVersionCode > 1) {
                    handler.post {
                        androidx.appcompat.app.AlertDialog.Builder(this)
                            .setTitle("Update Available ($serverVersionName)")
                            .setMessage("New Features:\n• $changelog\n\nWould you like to update now?")
                            .setPositiveButton("Update Now") { _, _ ->
                                val browserIntent = Intent(Intent.ACTION_VIEW, android.net.Uri.parse(apkUrl))
                                startActivity(browserIntent)
                            }
                            .setNegativeButton("Later", null)
                            .show()
                    }
                }
            }
        }
    }

    // Point 7: Import New Cases & Automatically Remove Previous Completed/Old Cases
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

                // Point 7: Wipe local device cache immediately so previous cases are cleared
                deleteFile("cached_cases.json")
                assignedCases.clear()

                val payload = JSONObject().apply {
                    put("agent_id", agentId)
                    put("cases", casesArray)
                    put("clear_previous", true)
                }

                val result = ApiClient.post("/api/allocations/upload-agent", payload)
                handler.post {
                    result.onSuccess {
                        Toast.makeText(this@MainActivity, "Replaced queue with $count fresh leads!", Toast.LENGTH_LONG).show()
                        fetchAssignedQueue(agentId, showToast = false)
                    }.onFailure { err ->
                        for (i in 0 until casesArray.length()) {
                            assignedCases.add(casesArray.getJSONObject(i))
                        }
                        saveCasesLocally(casesArray)
                        currentCaseIndex = 0
                        updateDebtorCard()
                        Toast.makeText(this@MainActivity, "Loaded $count fresh leads locally!", Toast.LENGTH_LONG).show()
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

    private fun showLoginScreen() {
        layoutLogin.visibility = View.VISIBLE
        layoutDialer.visibility = View.GONE
        layoutLocked.visibility = View.GONE
    }

    private fun showDialerScreen() {
        layoutLogin.visibility = View.GONE
        layoutDialer.visibility = View.VISIBLE
        layoutLocked.visibility = View.GONE
    }

    private fun showLockedScreen(reason: String) {
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
            val currentLogs = loadOfflineCallLogs()
            currentLogs.put(log)
            val fos = openFileOutput("offline_call_logs.json", android.content.Context.MODE_PRIVATE)
            fos.write(currentLogs.toString().toByteArray(Charsets.UTF_8))
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
            Manifest.permission.READ_PHONE_STATE,
            Manifest.permission.READ_CALL_LOG
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
        if (isCallInProgress) {
            isCallInProgress = false
            stopCallTimerTicker()
            tvCallStatus.text = "Call Ended • Tap Outcome Tag"
            startCountdownTimer()
        }

        // Point 3: Auto-refresh queue on resume if queue is currently empty
        val agentId = SecurityManager.getAgentId(this)
        if (agentId != -1 && assignedCases.isEmpty()) {
            fetchAssignedQueue(agentId, showToast = false)
        }
    }
}
