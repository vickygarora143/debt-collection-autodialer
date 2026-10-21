package com.collection.autodialer

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.CountDownTimer
import android.os.Handler
import android.os.Looper
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

    private val handler = Handler(Looper.getMainLooper())
    private var countdownTimer: CountDownTimer? = null

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

    private lateinit var btnStartDial: Button
    private lateinit var btnPause: Button
    private lateinit var btnAudioToggle: Button
    private lateinit var btnAgentImport: Button
    private lateinit var layoutDispositions: LinearLayout

    // Native Android File Picker for Agent Self-Allocation
    private val filePickerLauncher = registerForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.GetContent()
    ) { uri ->
        uri?.let { handleAgentFileImport(it) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 1. Enforce Anti-Theft FLAG_SECURE (Blocks screenshots & recording)
        SecurityManager.enforceAntiScreenshot(this)

        setContentView(R.layout.activity_main)

        initViews()
        telephonyService = TelephonyService(this, this)

        // 2. Check if Kill-Switch was previously activated
        if (SecurityManager.isDeviceLocked(this)) {
            showLockedScreen("Access Revoked by Super Administrator.")
            return
        }

        // 3. Check Runtime Telephony Permissions
        checkPermissions()

        // 4. Check if agent is already logged in
        val agentId = SecurityManager.getAgentId(this)
        if (agentId != -1) {
            showDialerScreen()
            startHeartbeatCycle()
            fetchAssignedQueue(agentId)
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

        btnStartDial = findViewById(R.id.btnStartDial)
        btnPause = findViewById(R.id.btnPause)
        btnAudioToggle = findViewById(R.id.btnAudioToggle)
        btnAgentImport = findViewById(R.id.btnAgentImport)
        layoutDispositions = findViewById(R.id.layoutDispositions)

        setupButtonListeners()
    }

    private fun setupButtonListeners() {
        btnAgentImport.setOnClickListener {
            // Open native Android file picker to select CSV / Excel
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

        btnAudioToggle.setOnClickListener {
            currentAudioMode = when (currentAudioMode) {
                TelephonyService.AudioMode.HEADSET -> TelephonyService.AudioMode.SPEAKER
                TelephonyService.AudioMode.SPEAKER -> TelephonyService.AudioMode.EARPIECE
                TelephonyService.AudioMode.EARPIECE -> TelephonyService.AudioMode.HEADSET
            }
            telephonyService.setAudioOutput(currentAudioMode)
            btnAudioToggle.text = currentAudioMode.name
        }

        // Disposition 1-Tap Buttons
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
                    showDialerScreen()
                    startHeartbeatCycle()
                    fetchAssignedQueue(agentId)
                }.onFailure { err ->
                    Toast.makeText(this, err.message, Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    private fun fetchAssignedQueue(agentId: Int) {
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
                }.onFailure { err ->
                    if (err is ApiException && err.code == "ACCOUNT_REVOKED") {
                        SecurityManager.executeEmergencyWipeAndLock(this) {
                            showLockedScreen("Your account has been revoked by Super Admin.")
                        }
                    } else {
                        // Offline Fallback: Load saved cases even if internet is off
                        loadCasesFromLocalStorage()
                    }
                }
            }
        }
    }

    private fun updateDebtorCard() {
        if (assignedCases.isEmpty()) {
            tvDebtorName.text = "No cases allocated"
            tvQueueProgress.text = "0 / 0"
            btnStartDial.isEnabled = false
            return
        }

        btnStartDial.isEnabled = true
        val item = assignedCases[currentCaseIndex]
        tvQueueProgress.text = "${currentCaseIndex + 1} of ${assignedCases.size}"
        tvDebtorName.text = item.optString("customer_name", "Unknown")
        tvLoanAcc.text = "Loan: ${item.optString("loan_account_no", "-")}"
        tvPhone.text = item.optString("primary_phone", "-")
        tvOverdue.text = "₹ ${item.optDouble("overdue_amount", 0.0).toInt()}"
        tvDpd.text = "DPD: ${item.optInt("dpd", 0)}"
        tvBucket.text = item.optString("bucket", "B1")
    }

    private fun startAutoDialing() {
        if (assignedCases.isEmpty()) return
        isAutoDialingActive = true
        btnStartDial.text = "Stop Auto-Dial"
        dialCurrentCase()
    }

    private fun stopAutoDialing() {
        isAutoDialingActive = false
        btnStartDial.text = "Start Auto-Dialing"
        countdownTimer?.cancel()
        tvCallStatus.text = "Ready"
    }

    private fun dialCurrentCase() {
        if (currentCaseIndex >= assignedCases.size) {
            Toast.makeText(this, "Allocation Queue Completed!", Toast.LENGTH_LONG).show()
            stopAutoDialing()
            return
        }

        val item = assignedCases[currentCaseIndex]
        val phoneNumber = item.optString("primary_phone", "")
        tvCallStatus.text = "Dialing $phoneNumber..."
        telephonyService.placeCall(phoneNumber)
    }

    // Callbacks from TelephonyService
    override fun onCallConnected() {
        handler.post {
            tvCallStatus.text = "Call Connected"
            layoutDispositions.visibility = View.GONE
        }
    }

    override fun onCallDisconnected(durationSeconds: Int) {
        currentCallDuration = durationSeconds
        handler.post {
            tvCallStatus.text = "Call Disconnected ($durationSeconds s)"
            layoutDispositions.visibility = View.VISIBLE

            // Start 5-second countdown to next call
            startCountdownTimer()
        }
    }

    private fun startCountdownTimer() {
        countdownTimer?.cancel()
        countdownTimer = object : CountDownTimer(4000, 1000) {
            override fun onTick(millisUntilFinished: Long) {
                val sec = millisUntilFinished / 1000
                tvCallStatus.text = "Tap Tag or Auto-Next in ${sec}s..."
            }

            override fun onFinish() {
                recordDisposition("RNR") // Default to RNR if agent didn't tap
            }
        }.start()
    }

    private fun recordDisposition(disposition: String) {
        countdownTimer?.cancel()
        layoutDispositions.visibility = View.GONE

        if (assignedCases.isEmpty()) return
        val currentCase = assignedCases[currentCaseIndex]
        val allocId = currentCase.getInt("id")
        val phone = currentCase.getString("primary_phone")
        val agentId = SecurityManager.getAgentId(this)

        // Sync disposition to Cloudflare D1 or store offline if no internet
        thread {
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
        }

        // Advance to next debtor in queue
        currentCaseIndex++
        if (currentCaseIndex < assignedCases.size) {
            updateDebtorCard()
            if (isAutoDialingActive && !isPaused) {
                handler.postDelayed({ dialCurrentCase() }, 1500)
            }
        } else {
            Toast.makeText(this, "All allocated cases dialed!", Toast.LENGTH_LONG).show()
            stopAutoDialing()
        }
    }

    // Periodic Super Admin Heartbeat (Kill-Switch Enforcer)
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
                        val result = ApiClient.post("/api/auth/heartbeat", payload)
                        result.onFailure { err ->
                            if (err is ApiException && (err.code == "ACCOUNT_REVOKED" || err.statusCode == 403)) {
                                handler.post {
                                    SecurityManager.executeEmergencyWipeAndLock(this@MainActivity) {
                                        showLockedScreen("Super Admin has revoked your access.")
                                    }
                                }
                            }
                        }
                    }
                }
                handler.postDelayed(this, 60000) // Every 60s
            }
        }
        handler.postDelayed(runnable, 60000)
    }

    private fun showLoginScreen() {
        layoutLogin.visibility = View.VISIBLE
        layoutDialer.visibility = View.GONE
        layoutLocked.visibility = View.GONE
    }

    // ----------------------------------------------------
    // OFFLINE CALLING & LOCAL PERSISTENCE HELPERS
    // ----------------------------------------------------
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
                Toast.makeText(this, "Offline Mode: Loaded ${assignedCases.size} cases from phone storage.", Toast.LENGTH_SHORT).show()
            }
        } catch (e: Exception) {
            handler.post {
                Toast.makeText(this, "No internet and no cached cases found.", Toast.LENGTH_LONG).show()
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
            handler.post {
                Toast.makeText(this, "Internet offline: Call outcome saved locally.", Toast.LENGTH_SHORT).show()
            }
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
            handler.post {
                Toast.makeText(this, "Synced ${logs.length()} offline calls to Cloudflare D1!", Toast.LENGTH_SHORT).show()
            }
        }
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

    private fun handleAgentFileImport(uri: android.net.Uri) {
        val agentId = SecurityManager.getAgentId(this)
        if (agentId == -1) return

        thread {
            try {
                val inputStream = contentResolver.openInputStream(uri)
                val reader = java.io.BufferedReader(java.io.InputStreamReader(inputStream))
                val casesArray = JSONArray()

                var line: String? = reader.readLine() // Read header
                var count = 0
                while (reader.readLine().also { line = it } != null && count < 300) {
                    val parts = line!!.split(",")
                    if (parts.isNotEmpty()) {
                        val phone = parts.find { it.replace(Regex("\\D"), "").length >= 10 } ?: parts[0]
                        val name = if (parts.size > 1) parts[0] else "Lead #${count + 1}"
                        val loan = if (parts.size > 2) parts[1] else "SLF-${System.currentTimeMillis() % 10000}"

                        casesArray.put(JSONObject().apply {
                            put("primary_phone", phone.replace(Regex("\\D"), ""))
                            put("customer_name", name)
                            put("loan_account_no", loan)
                            put("overdue_amount", 10000)
                            put("dpd", 30)
                            put("bucket", "SELF")
                        })
                        count++
                    }
                }
                reader.close()

                val payload = JSONObject().apply {
                    put("agent_id", agentId)
                    put("cases", casesArray)
                }

                val result = ApiClient.post("/api/allocations/upload-agent", payload)
                handler.post {
                    result.onSuccess {
                        Toast.makeText(this@MainActivity, "Loaded $count personal leads successfully!", Toast.LENGTH_LONG).show()
                        fetchAssignedQueue(agentId)
                    }.onFailure { err ->
                        Toast.makeText(this@MainActivity, "Upload error: ${err.message}", Toast.LENGTH_LONG).show()
                    }
                }
            } catch (e: Exception) {
                handler.post {
                    Toast.makeText(this@MainActivity, "Failed to read file: ${e.message}", Toast.LENGTH_SHORT).show()
                }
            }
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
}
