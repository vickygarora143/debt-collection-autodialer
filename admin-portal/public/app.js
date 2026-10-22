// DebtFlow Pro — Two Dedicated Interfaces (Super Admin & Agent Telecaller Cockpit)

let currentRole = 'agent'; // 'agent' | 'admin'
let currentAgent = null; // { id, agent_code, full_name, phone }
let dispositionChart = null;

// Telecaller Cockpit Queue State
let cockpitCases = [];
let cockpitIndex = 0;
let cockpitCalling = false;
let cockpitPaused = false;
let cockpitTimerSecs = 0;
let cockpitInterval = null;
let cockpitAudioMode = 'HEADSET';

// Admin State
let allAgentsCache = [];
let currentUploadedCases = [];

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initDatePickers();
    initDropZone();

    // Check if user is already logged in
    const savedRole = localStorage.getItem('debtflow_role');
    const savedAgent = localStorage.getItem('debtflow_agent');

    if (savedRole === 'admin') {
        showAdminView();
    } else if (savedRole === 'agent' && savedAgent) {
        currentAgent = JSON.parse(savedAgent);
        showAgentView();
    } else {
        showLoginView();
    }
});

// ----------------------------------------------------
// 1. AUTHENTICATION & ROLE SELECTION (AGENT ID AS LOGIN)
// ----------------------------------------------------
function selectLoginRole(role) {
    currentRole = role;
    const tabAgent = document.getElementById('role-tab-agent');
    const tabAdmin = document.getElementById('role-tab-admin');
    const lblLoginId = document.getElementById('lbl-login-id');
    const inputLogin = document.getElementById('login-username');
    const btnSubmit = document.getElementById('btn-login-submit');
    const infoText = document.getElementById('login-info-text');

    if (role === 'agent') {
        tabAgent.className = 'py-2.5 rounded-xl bg-white text-blue-700 shadow-sm transition flex items-center justify-center gap-1.5';
        tabAdmin.className = 'py-2.5 rounded-xl text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5';
        lblLoginId.innerText = 'Agent ID (Login ID)';
        inputLogin.placeholder = 'e.g. AGT001';
        btnSubmit.innerHTML = `<span>Enter Telecaller Cockpit</span> <i data-lucide="arrow-right" class="w-4 h-4"></i>`;
        infoText.innerText = 'Agents: Use your assigned Agent ID (e.g. AGT001). Device will be hardware-locked on 1st login.';
    } else {
        tabAdmin.className = 'py-2.5 rounded-xl bg-white text-blue-700 shadow-sm transition flex items-center justify-center gap-1.5';
        tabAgent.className = 'py-2.5 rounded-xl text-slate-600 hover:text-slate-900 transition flex items-center justify-center gap-1.5';
        lblLoginId.innerText = 'Admin Username';
        inputLogin.placeholder = 'e.g. admin';
        btnSubmit.innerHTML = `<span>Enter Super Admin HQ</span> <i data-lucide="arrow-right" class="w-4 h-4"></i>`;
        infoText.innerText = 'Super Admin: Full governance, live monitoring, allocations, and remote kill-switch rights.';
    }
    lucide.createIcons();
}

async function handleUserLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();

    const btn = document.getElementById('btn-login-submit');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Authenticating...`;
    lucide.createIcons();

    try {
        const payload = currentRole === 'admin'
            ? { role: 'admin', username, password }
            : { role: 'agent', agent_code: username, password, hardware_uuid: 'WEB_' + Date.now().toString(36) };

        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const rawText = await res.text();
        let data = {};
        try {
            data = JSON.parse(rawText);
        } catch (parseErr) {
            alert('Server error: ' + (rawText || 'Invalid response from server'));
            return;
        }

        if (data.error) {
            alert('Authentication Failed: ' + data.error);
            return;
        }

        if (currentRole === 'admin') {
            localStorage.setItem('debtflow_role', 'admin');
            showAdminView();
        } else {
            currentAgent = data.agent || { id: 1, agent_code: username.toUpperCase(), full_name: 'Telecaller' };
            localStorage.setItem('debtflow_role', 'agent');
            localStorage.setItem('debtflow_agent', JSON.stringify(currentAgent));
            showAgentView();
        }
    } catch (err) {
        alert('Login error: ' + err.message);
    } finally {
        btn.disabled = false;
        selectLoginRole(currentRole);
    }
}

function logoutUser() {
    localStorage.removeItem('debtflow_role');
    localStorage.removeItem('debtflow_agent');
    currentAgent = null;
    showLoginView();
}

function showLoginView() {
    document.getElementById('view-login').classList.remove('hidden');
    document.getElementById('view-admin').classList.add('hidden');
    document.getElementById('view-agent').classList.add('hidden');
}

function showAdminView() {
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('view-admin').classList.remove('hidden');
    document.getElementById('view-agent').classList.add('hidden');
    lucide.createIcons();
    loadDashboardStats();
    loadAgents();
    loadReports();
}

function showAgentView() {
    document.getElementById('view-login').classList.add('hidden');
    document.getElementById('view-admin').classList.add('hidden');
    document.getElementById('view-agent').classList.remove('hidden');
    lucide.createIcons();
    initAgentCockpit();
}

// ----------------------------------------------------
// 2. INTERFACE 2: TELECALLER AGENT COCKPIT LOGIC
// ----------------------------------------------------
async function initAgentCockpit() {
    if (!currentAgent) return;
    document.getElementById('agent-cockpit-code').innerText = currentAgent.agent_code;
    document.getElementById('agent-cockpit-name').innerText = currentAgent.full_name || 'Telecaller Staff';

    loadAgentCasesAndStats();

    // Battery-saving background sync (Only syncs when online and not actively dialing)
    if (window.agentQueueInterval) clearInterval(window.agentQueueInterval);
    window.agentQueueInterval = setInterval(() => {
        if (currentAgent && !cockpitCalling && !turboAutoDialing && navigator.onLine) {
            loadAgentCasesAndStats(true);
        }
    }, 60000);
}

async function refreshAgentQueue() {
    const btn = document.getElementById('btn-refresh-queue');
    if (btn) btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5 animate-spin"></i> Refreshing...`;
    await loadAgentCasesAndStats();
    if (btn) {
        btn.innerHTML = `<i data-lucide="check" class="w-3.5 h-3.5 text-emerald-600"></i> Updated!`;
        setTimeout(() => {
            btn.innerHTML = `<i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Refresh`;
            if (window.lucide) lucide.createIcons();
        }, 1500);
    }
}

async function exportAgentFeedback() {
    if (!currentAgent) return;
    try {
        const res = await fetch(`/api/reports/agent-export?agent_id=${currentAgent.id}`);
        const data = await res.json();
        const records = data.records || [];
        if (records.length === 0) {
            alert('No call records logged yet for this shift.');
            return;
        }

        const headers = ["Timestamp", "Customer Name", "Phone", "Loan Account", "Duration (sec)", "Disposition", "PTP Amount", "PTP Date"];
        const rows = records.map(r => [
            `"${String(r.called_at || '').replace(/"/g, '""')}"`,
            `"${String(r.customer_name || '').replace(/"/g, '""')}"`,
            `"${String(r.dialed_phone || '').replace(/"/g, '""')}"`,
            `"${String(r.loan_account_no || '').replace(/"/g, '""')}"`,
            r.call_duration_seconds || 0,
            `"${String(r.disposition || '').replace(/"/g, '""')}"`,
            r.ptp_amount || 0,
            `"${String(r.ptp_date || '').replace(/"/g, '""')}"`
        ]);

        // UTF-8 BOM (\uFEFF) ensures clean Microsoft Excel formatting and Blob download prevents truncation on '#'
        const csvContent = "\uFEFF" + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `DebtFlow_Feedback_${currentAgent.agent_code}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Failed to export feedback: ' + e.message);
    }
}

// 1-Click Clear / Delete Previous Campaign Queue
async function clearAgentCampaign() {
    if (!currentAgent) return;
    const confirmClear = confirm(`Are you sure you want to remove all remaining cases from your active queue?\n\nThis will clear the previous campaign so you can start fresh today.`);
    if (!confirmClear) return;

    try {
        const res = await fetch('/api/allocations/clear-agent-queue', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: currentAgent.id })
        });
        const data = await res.json();
        if (data.success) {
            cockpitCases = [];
            cockpitIndex = 0;
            localStorage.removeItem('debtflow_cached_cases_' + currentAgent.id);
            document.getElementById('agent-stat-queue').innerText = '0';
            renderCockpitCase();
            alert('Previous campaign cleared! Your queue is now 0. You can import fresh leads now.');
        } else {
            alert('Error clearing queue: ' + (data.error || 'Server error'));
        }
    } catch (e) {
        alert('Failed to clear queue: ' + e.message);
    }
}

async function loadAgentCasesAndStats() {
    if (!currentAgent) return;

    try {
        const res = await fetch(`/api/allocations/my-cases?agent_id=${currentAgent.id}`);
        const data = await res.json();
        cockpitCases = data.cases || [];

        // Save local offline copy
        localStorage.setItem('debtflow_cached_cases_' + currentAgent.id, JSON.stringify(cockpitCases));

        document.getElementById('agent-stat-queue').innerText = cockpitCases.length;

        // Fetch dials today
        const statsRes = await fetch('/api/dashboard/stats');
        const statsData = await statsRes.json();
        const myStats = (statsData.leaderboard || []).find(l => l.agent_code === currentAgent.agent_code);

        document.getElementById('agent-stat-dials').innerText = myStats ? myStats.calls_made : 0;
        document.getElementById('agent-stat-ptps').innerText = myStats ? myStats.ptp_count : 0;

        cockpitIndex = 0;
        renderCockpitCase();
    } catch (e) {
        console.warn('Network offline or slow, loading local cached cases:', e);
        cockpitCases = JSON.parse(localStorage.getItem('debtflow_cached_cases_' + currentAgent.id) || '[]');
        document.getElementById('agent-stat-queue').innerText = cockpitCases.length;
        cockpitIndex = 0;
        renderCockpitCase();
    }
}

// Pure Turbo Auto-Dialer State (Ultra-Low Latency & Market Recovery Standards)
let turboAutoDialing = false;
let turboPaceMode = 'turbo'; // 'turbo' (1.2s), 'standard' (2.5s), 'manual'
let turboPacingTimer = null;
let cockpitCallStartTime = 0;
let cockpitDialsCount = parseInt(localStorage.getItem('debtflow_today_dials') || '0', 10);

function setTurboPace(mode) {
    turboPaceMode = mode;
    ['turbo', 'standard', 'manual'].forEach(m => {
        const btn = document.getElementById(`pace-btn-${m}`);
        if (!btn) return;
        if (m === mode) {
            btn.className = "px-2.5 py-1.5 rounded-xl bg-white text-emerald-700 shadow-sm border border-slate-200 transition text-[11px] font-extrabold flex items-center gap-1";
        } else {
            btn.className = "px-2.5 py-1.5 rounded-xl text-slate-600 hover:text-slate-900 transition text-[11px] font-bold";
        }
    });
}

function renderCockpitCase() {
    // Sync Auto-SMS preference checkbox
    const autoSmsBox = document.getElementById('cockpit-auto-sms');
    if (autoSmsBox) {
        autoSmsBox.checked = getAgentSmsTemplates().autoSms;
    }

    const statDials = document.getElementById('agent-stat-dials');
    if (statDials) statDials.innerText = cockpitDialsCount;

    if (cockpitCases.length === 0) {
        document.getElementById('cockpit-case-name').innerText = "Queue Empty! Import leads above";
        document.getElementById('cockpit-case-loan').innerText = "Loan Acc: -";
        document.getElementById('cockpit-case-phone').innerText = "-";
        document.getElementById('cockpit-case-amount').innerText = "₹ 0";
        document.getElementById('cockpit-case-dpd').innerText = "DPD: 0 Days";
        document.getElementById('cockpit-case-bucket').innerText = "DONE";
        document.getElementById('cockpit-call-status-text').innerText = "Ready to Dial";
        document.getElementById('cockpit-call-timer').innerText = "00:00";
        const prog = document.getElementById('agent-stat-prog');
        if (prog) prog.innerText = "0 / 0";
        const qLeft = document.getElementById('agent-stat-queue');
        if (qLeft) qLeft.innerText = "0";
        const counter = document.getElementById('cockpit-case-counter');
        if (counter) counter.innerText = "Lead #0 of 0";
        return;
    }

    const dialedCount = cockpitCases.filter(c => c._dialed).length;
    const remainingCount = cockpitCases.length - dialedCount;

    // Progress Stats
    const prog = document.getElementById('agent-stat-prog');
    if (prog) prog.innerText = `${dialedCount} / ${cockpitCases.length} Dialed`;
    const qLeft = document.getElementById('agent-stat-queue');
    if (qLeft) qLeft.innerText = remainingCount;
    const counter = document.getElementById('cockpit-case-counter');
    if (counter) counter.innerText = `Lead #${cockpitIndex + 1} of ${cockpitCases.length}`;

    const item = cockpitCases[cockpitIndex];
    if (!item) return;

    document.getElementById('cockpit-case-name').innerText = item.customer_name + (item._dialed ? ' (Dialed ✓)' : '');
    document.getElementById('cockpit-case-loan').innerText = `Loan Acc: ${item.loan_account_no}`;
    
    const phone = String(item.primary_phone || '');
    document.getElementById('cockpit-case-phone').innerText = phone.length >= 10
        ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
        : phone;

    document.getElementById('cockpit-case-amount').innerText = `₹ ${Number(item.overdue_amount || 0).toLocaleString()}`;
    document.getElementById('cockpit-case-dpd').innerText = `DPD: ${item.dpd || 0} Days`;
    document.getElementById('cockpit-case-bucket').innerText = item.bucket || 'BUCKET 1';

    if (!cockpitCalling) {
        document.getElementById('cockpit-call-status-text').innerText = item._dialed ? "Lead Dialed • Ready for Next" : "Ready to Dial";
        document.getElementById('cockpit-call-timer').innerText = "00:00";
    }
}

function toggleTurboAutoDial() {
    if (turboAutoDialing) {
        stopTurboAutoDial();
    } else {
        startTurboAutoDial();
    }
}

function startTurboAutoDial() {
    if (cockpitCases.length === 0) {
        alert('Please import cases first using "+ Import List" or tap "Refresh".');
        return;
    }

    // Check if current case is already dialed, if so advance to first undialed
    if (cockpitCases[cockpitIndex] && cockpitCases[cockpitIndex]._dialed) {
        let firstUndialed = cockpitCases.findIndex(c => !c._dialed);
        if (firstUndialed !== -1) {
            cockpitIndex = firstUndialed;
            renderCockpitCase();
        } else {
            alert('All leads in queue have already been dialed! Tap "+ Import List" or "Clear Queue" for a new batch.');
            return;
        }
    }

    turboAutoDialing = true;
    cockpitPaused = false;
    updateTurboDialerUI(true);
    triggerCockpitDial();
}

function stopTurboAutoDial() {
    turboAutoDialing = false;
    clearTimeout(turboPacingTimer);
    if (cockpitCalling) {
        endCockpitCall();
    }
    updateTurboDialerUI(false);
    document.getElementById('cockpit-call-status-text').innerText = "Auto-Dialer Stopped • Ready";
}

function updateTurboDialerUI(active) {
    const btn = document.getElementById('cockpit-dial-btn');
    const text = document.getElementById('cockpit-dial-btn-text');
    if (!btn) return;
    if (active) {
        btn.classList.replace('bg-emerald-600', 'bg-rose-600');
        btn.classList.replace('hover:bg-emerald-700', 'hover:bg-rose-700');
        btn.classList.replace('shadow-emerald-600/25', 'shadow-rose-600/25');
        if (text) text.innerText = "STOP AUTO-DIALING";
    } else {
        btn.classList.replace('bg-rose-600', 'bg-emerald-600');
        btn.classList.replace('hover:bg-rose-700', 'hover:bg-emerald-700');
        btn.classList.replace('shadow-rose-600/25', 'shadow-emerald-600/25');
        if (text) text.innerText = "START TURBO AUTO-DIAL";
    }
    lucide.createIcons();
}

function advanceCockpitCase(direction) {
    clearTimeout(turboPacingTimer);
    if (cockpitCases.length === 0) return;

    if (direction > 0) {
        // Mark current as processed
        if (cockpitCases[cockpitIndex]) {
            cockpitCases[cockpitIndex]._dialed = true;
        }
        // Look for next un-dialed lead
        let nextIndex = -1;
        for (let i = cockpitIndex + 1; i < cockpitCases.length; i++) {
            if (!cockpitCases[i]._dialed) {
                nextIndex = i;
                break;
            }
        }
        if (nextIndex === -1) {
            // Check from beginning
            for (let i = 0; i < cockpitCases.length; i++) {
                if (!cockpitCases[i]._dialed) {
                    nextIndex = i;
                    break;
                }
            }
        }
        if (nextIndex === -1) {
            // All dialed!
            stopTurboAutoDial();
            renderCockpitCase();
            document.getElementById('cockpit-call-status-text').innerText = "Queue Complete! All leads dialed ✓";
            alert('Campaign Complete: All leads have been dialed!');
            return;
        }
        cockpitIndex = nextIndex;
    } else {
        cockpitIndex = (cockpitIndex - 1 + cockpitCases.length) % cockpitCases.length;
    }

    renderCockpitCase();
    if (turboAutoDialing && !cockpitPaused) {
        triggerCockpitDial();
    }
}

function triggerCockpitDial() {
    if (cockpitCalling) {
        endCockpitCall();
        return;
    }

    if (cockpitCases.length === 0) {
        alert('Please import cases first using the "+ Import List" button.');
        return;
    }

    const item = cockpitCases[cockpitIndex];
    if (!item) return;

    // Immediately flag this lead as DIALED so it can never be duplicate-dialed!
    item._dialed = true;
    cockpitCalling = true;
    cockpitTimerSecs = 0;
    cockpitCallStartTime = Date.now();

    // Process Auto-SMS on Call
    const autoSmsChecked = document.getElementById('cockpit-auto-sms') ? document.getElementById('cockpit-auto-sms').checked : true;
    let smsStatusNote = "";
    if (autoSmsChecked && item) {
        const tmpls = getAgentSmsTemplates();
        const agentPhone = currentAgent ? (currentAgent.phone || currentAgent.agent_id || 'Officer') : 'Officer';
        const isBulk = !item.customer_name || item.customer_name.startsWith('Lead #') || item.customer_name.startsWith('Personal Debtor Lead');
        
        let smsText = isBulk ? tmpls.bulk : tmpls.details;
        smsText = smsText
            .replace(/{NAME}/g, item.customer_name || 'Customer')
            .replace(/{AMOUNT}/g, Number(item.overdue_amount || 0).toLocaleString())
            .replace(/{AGENT_PHONE}/g, agentPhone);

        console.log(`[SIM AUTO-SMS DISPATCHED] To: ${item.primary_phone} | Msg: ${smsText}`);
        smsStatusNote = " • Auto-SMS Sent 💬";
    }

    document.getElementById('cockpit-call-status-text').innerText = `Dialing SIM (${cockpitAudioMode})${smsStatusNote}...`;

    // 1. Android Telephony Bridge Integration (Zero-Lag Direct Hardware GSM SIM Calling)
    if (window.AndroidBridge && item && item.primary_phone) {
        window.AndroidBridge.makeSimCall(item.primary_phone);
        if (autoSmsChecked) {
            const tmpls = getAgentSmsTemplates();
            const agentPhone = currentAgent ? (currentAgent.phone || currentAgent.agent_id || 'Officer') : 'Officer';
            const isBulk = !item.customer_name || item.customer_name.startsWith('Lead #') || item.customer_name.startsWith('Personal Debtor Lead');
            let smsText = isBulk ? tmpls.bulk : tmpls.details;
            smsText = smsText
                .replace(/{NAME}/g, item.customer_name || 'Customer')
                .replace(/{AMOUNT}/g, Number(item.overdue_amount || 0).toLocaleString())
                .replace(/{AGENT_PHONE}/g, agentPhone);
            window.AndroidBridge.sendSimSms(item.primary_phone, item.customer_name || 'Customer', String(item.overdue_amount || 0), agentPhone);
        }
    } else if (item && item.primary_phone && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) {
        window.location.href = `tel:${item.primary_phone}`;
    }

    clearInterval(cockpitInterval);
    cockpitInterval = setInterval(() => {
        cockpitTimerSecs++;
        const mins = String(Math.floor(cockpitTimerSecs / 60)).padStart(2, '0');
        const secs = String(cockpitTimerSecs % 60).padStart(2, '0');
        document.getElementById('cockpit-call-timer').innerText = `${mins}:${secs}`;
    }, 1000);

    lucide.createIcons();
}

// Global Native Telephony Listeners (Invoked directly by Android Bridge)
window.onNativeCallConnected = function() {
    document.getElementById('cockpit-call-status-text').innerText = `Call Connected • Speaking via SIM...`;
};

window.onNativeCallDisconnected = function(durationSeconds) {
    if (!cockpitCalling && cockpitTimerSecs === 0) return; // Prevent duplicate triggers

    cockpitTimerSecs = durationSeconds || 0;
    endCockpitCall();

    cockpitDialsCount++;
    localStorage.setItem('debtflow_today_dials', String(cockpitDialsCount));

    // Mark current case dialed
    if (cockpitCases[cockpitIndex]) {
        cockpitCases[cockpitIndex]._dialed = true;
    }

    // Find the next UN-DIALED lead sequentially
    let nextIndex = -1;
    for (let i = cockpitIndex + 1; i < cockpitCases.length; i++) {
        if (!cockpitCases[i]._dialed) {
            nextIndex = i;
            break;
        }
    }
    if (nextIndex === -1) {
        for (let i = 0; i < cockpitCases.length; i++) {
            if (!cockpitCases[i]._dialed) {
                nextIndex = i;
                break;
            }
        }
    }

    // If all cases are dialed, campaign finishes!
    if (nextIndex === -1) {
        stopTurboAutoDial();
        renderCockpitCase();
        document.getElementById('cockpit-call-status-text').innerText = `Call Ended (${durationSeconds}s) • Campaign Complete ✓ (All Dialed)`;
        alert(`🎉 Campaign Complete: All ${cockpitCases.length} debtor leads have been successfully dialed!`);
        return;
    }

    // Advance queue to next un-dialed customer
    cockpitIndex = nextIndex;
    renderCockpitCase();

    if (!turboAutoDialing) {
        document.getElementById('cockpit-call-status-text').innerText = `Call Ended (${durationSeconds}s) • Ready for Lead #${cockpitIndex + 1}`;
        return;
    }

    if (cockpitPaused) {
        document.getElementById('cockpit-call-status-text').innerText = `Call Ended (${durationSeconds}s) • Paused (Take Notes)`;
        return;
    }

    if (turboPaceMode === 'manual') {
        document.getElementById('cockpit-call-status-text').innerText = `Call Ended (${durationSeconds}s) • Tap [Dial Next] or [Next Lead]`;
        return;
    }

    // Auto-pacing to next customer
    const delayMs = turboPaceMode === 'turbo' ? 1200 : 2500;
    const delaySec = (delayMs / 1000).toFixed(1);
    const nextName = cockpitCases[cockpitIndex] ? cockpitCases[cockpitIndex].customer_name : 'Next';
    document.getElementById('cockpit-call-status-text').innerText = `Next: ${nextName} in ${delaySec}s...`;

    clearTimeout(turboPacingTimer);
    turboPacingTimer = setTimeout(() => {
        if (turboAutoDialing && !cockpitPaused && cockpitCases.length > 0) {
            triggerCockpitDial();
        }
    }, delayMs);
};

// Dual Fail-Safe: Detect App Resume / Visibility Change
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && cockpitCalling) {
        console.log('[TELEPHONY FAIL-SAFE] App resumed into foreground. Inspecting call state...');
        const elapsed = Math.max(0, Math.floor((Date.now() - cockpitCallStartTime) / 1000));
        setTimeout(() => {
            if (cockpitCalling) {
                console.log('[TELEPHONY FAIL-SAFE] Auto-terminating stuck call and advancing lead.');
                window.onNativeCallDisconnected(elapsed);
            }
        }, 400);
    }
});

function endCockpitCall() {
    cockpitCalling = false;
    clearInterval(cockpitInterval);
    document.getElementById('cockpit-call-status-text').innerText = 'Call Ended • Ready';
    lucide.createIcons();
}

function logCockpitCall(disposition) {
    // Kept as lightweight fallback for compatibility
    if (cockpitCalling) endCockpitCall();
}

function toggleCockpitPause() {
    cockpitPaused = !cockpitPaused;
    const btn = document.getElementById('cockpit-pause-btn');
    if (cockpitPaused) {
        clearTimeout(turboPacingTimer);
        btn.classList.add('bg-amber-100', 'text-amber-800', 'border-amber-300');
        btn.innerHTML = `<i data-lucide="play" class="w-4 h-4"></i> <span>Resume</span>`;
        document.getElementById('cockpit-call-status-text').innerText = 'Auto-Dialer Paused (Notes Time)';
    } else {
        btn.classList.remove('bg-amber-100', 'text-amber-800', 'border-amber-300');
        btn.innerHTML = `<i data-lucide="pause" class="w-4 h-4"></i> <span>Pause</span>`;
        document.getElementById('cockpit-call-status-text').innerText = 'Resumed • Dialing next...';
        if (turboAutoDialing && !cockpitCalling) {
            advanceCockpitCase(1);
        }
    }
    lucide.createIcons();
}

function toggleSimAudio() {
    const btn = document.getElementById('cockpit-audio-btn');
    if (cockpitAudioMode === 'HEADSET') {
        cockpitAudioMode = 'SPEAKER';
        btn.innerHTML = `<i data-lucide="volume-2" class="w-3.5 h-3.5"></i> Speaker`;
        btn.className = 'px-2.5 py-1.5 bg-white text-amber-700 rounded-xl text-xs font-bold border border-slate-200 transition flex items-center gap-1 shadow-sm';
    } else if (cockpitAudioMode === 'SPEAKER') {
        cockpitAudioMode = 'EARPIECE';
        btn.innerHTML = `<i data-lucide="phone" class="w-3.5 h-3.5"></i> Handset`;
        btn.className = 'px-2.5 py-1.5 bg-white text-blue-700 rounded-xl text-xs font-bold border border-slate-200 transition flex items-center gap-1 shadow-sm';
    } else {
        cockpitAudioMode = 'HEADSET';
        btn.innerHTML = `<i data-lucide="headphones" class="w-3.5 h-3.5"></i> Earphone`;
        btn.className = 'px-2.5 py-1.5 bg-white text-emerald-700 rounded-xl text-xs font-bold border border-slate-200 transition flex items-center gap-1 shadow-sm';
    }
    lucide.createIcons();
}

// ----------------------------------------------------
// 2.5 SMS TEMPLATE ENGINE & AGENT CONFIGURATION
// ----------------------------------------------------
const DEFAULT_SMS_TEMPLATE_DETAILS = "Dear {NAME}, your overdue payment of Rs. {AMOUNT} is pending. Please clear immediately or contact your loan officer at {AGENT_PHONE}. - DebtFlow Team";
const DEFAULT_SMS_TEMPLATE_BULK = "Urgent: Your account payment is overdue. Please settle your outstanding dues today or call {AGENT_PHONE} to avoid legal escalation. - DebtFlow Team";

function getAgentSmsKey(suffix) {
    const id = currentAgent ? (currentAgent.agent_id || currentAgent.id) : 'default';
    return `debtflow_sms_${id}_${suffix}`;
}

function getAgentSmsTemplates() {
    return {
        details: localStorage.getItem(getAgentSmsKey('details')) || DEFAULT_SMS_TEMPLATE_DETAILS,
        bulk: localStorage.getItem(getAgentSmsKey('bulk')) || DEFAULT_SMS_TEMPLATE_BULK,
        autoSms: localStorage.getItem(getAgentSmsKey('autosms_enabled')) !== 'false'
    };
}

function openSmsTemplateModal() {
    const tmpls = getAgentSmsTemplates();
    document.getElementById('template-detailed-input').value = tmpls.details;
    document.getElementById('template-bulk-input').value = tmpls.bulk;
    renderSmsTemplatePreview();
    document.getElementById('sms-template-modal').classList.remove('hidden');
    lucide.createIcons();
}

function closeSmsTemplateModal() {
    document.getElementById('sms-template-modal').classList.add('hidden');
}

function renderSmsTemplatePreview() {
    const rawDetails = document.getElementById('template-detailed-input').value;
    const rawBulk = document.getElementById('template-bulk-input').value;

    const agentPhone = currentAgent ? (currentAgent.phone || currentAgent.agent_id || '9876543210') : '9876543210';
    const sampleName = (cockpitCases[cockpitIndex] && cockpitCases[cockpitIndex].customer_name) || 'Rajesh Kumar';
    const sampleAmt = (cockpitCases[cockpitIndex] && cockpitCases[cockpitIndex].overdue_amount) ? Number(cockpitCases[cockpitIndex].overdue_amount).toLocaleString() : '15,000';

    const prevDetails = rawDetails
        .replace(/{NAME}/g, sampleName)
        .replace(/{AMOUNT}/g, sampleAmt)
        .replace(/{AGENT_PHONE}/g, agentPhone);

    const prevBulk = rawBulk
        .replace(/{AGENT_PHONE}/g, agentPhone);

    const detEl = document.getElementById('preview-template-detailed');
    if (detEl) detEl.innerText = prevDetails;
    const bulkEl = document.getElementById('preview-template-bulk');
    if (bulkEl) bulkEl.innerText = prevBulk;
}

function saveSmsTemplates() {
    const detailsVal = document.getElementById('template-detailed-input').value.trim();
    const bulkVal = document.getElementById('template-bulk-input').value.trim();

    if (!detailsVal || !bulkVal) {
        alert('Templates cannot be empty.');
        return;
    }

    localStorage.setItem(getAgentSmsKey('details'), detailsVal);
    localStorage.setItem(getAgentSmsKey('bulk'), bulkVal);
    closeSmsTemplateModal();
    alert('SMS Templates saved successfully for your Agent ID!');
}

function resetSmsTemplates() {
    document.getElementById('template-detailed-input').value = DEFAULT_SMS_TEMPLATE_DETAILS;
    document.getElementById('template-bulk-input').value = DEFAULT_SMS_TEMPLATE_BULK;
    renderSmsTemplatePreview();
}

function toggleAutoSmsPref(enabled) {
    localStorage.setItem(getAgentSmsKey('autosms_enabled'), enabled ? 'true' : 'false');
}

// ----------------------------------------------------
// 3. AGENT SELF-ALLOCATION MODAL
// ----------------------------------------------------
function openAgentUploadModal() {
    document.getElementById('agent-upload-modal').classList.remove('hidden');
    lucide.createIcons();
}

function closeAgentUploadModal() {
    document.getElementById('agent-upload-modal').classList.add('hidden');
}

async function handleAgentSelfUpload() {
    const fileInput = document.getElementById('agent-file-input');
    const pasteInput = document.getElementById('agent-paste-numbers').value.trim();

    const agentId = currentAgent ? currentAgent.id : 1;
    let casesToUpload = [];

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        casesToUpload = json.map(r => ({
            customer_name: r.customer_name || r.name || 'Personal Debtor',
            loan_account_no: r.loan_account_no || r.loan_id || `ACC-${Date.now().toString().slice(-4)}`,
            primary_phone: String(r.primary_phone || r.phone || r.mobile || ''),
            overdue_amount: parseFloat(r.overdue_amount || r.overdue || 0) || 0,
            dpd: parseInt(r.dpd || 0) || 0,
            bucket: r.bucket || 'SELF'
        }));
    } else if (pasteInput) {
        const lines = pasteInput.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        casesToUpload = lines.map((line, idx) => ({
            customer_name: `Borrower #${idx + 1}`,
            loan_account_no: `SLF-${Date.now().toString().slice(-4)}-${idx + 1}`,
            primary_phone: line.replace(/\D/g, ''),
            overdue_amount: 15000,
            dpd: 45,
            bucket: 'SELF'
        }));
    } else {
        alert('Please select an Excel/CSV file or paste at least one phone number.');
        return;
    }

    if (casesToUpload.length === 0) {
        alert('No valid cases found.');
        return;
    }

    const btn = document.getElementById('btn-agent-upload-submit');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Loading...`;
    lucide.createIcons();

    try {
        if (!navigator.onLine) {
            // 100% OFFLINE MODE: Load directly into RAM & phone storage (Zero Internet required)
            cockpitCases = casesToUpload;
            localStorage.setItem('debtflow_cached_cases_' + agentId, JSON.stringify(cockpitCases));
            cockpitIndex = 0;
            renderCockpitCase();
            closeAgentUploadModal();
            document.getElementById('agent-file-input').value = '';
            document.getElementById('agent-paste-numbers').value = '';
            alert(`OFFLINE READY: ${casesToUpload.length} leads loaded into phone storage! You can start dialing immediately without internet.`);
            return;
        }

        const res = await fetch('/api/allocations/upload-agent', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_id: agentId, cases: casesToUpload })
        });
        const data = await res.json();
        if (data.error) {
            alert('Upload error: ' + data.error);
        } else {
            alert(`SUCCESS: ${data.message}`);
            closeAgentUploadModal();
            document.getElementById('agent-file-input').value = '';
            document.getElementById('agent-paste-numbers').value = '';
            loadAgentCasesAndStats();
        }
    } catch (e) {
        // Safe offline fallback if network drops midway
        cockpitCases = casesToUpload;
        localStorage.setItem('debtflow_cached_cases_' + agentId, JSON.stringify(cockpitCases));
        cockpitIndex = 0;
        renderCockpitCase();
        closeAgentUploadModal();
        alert(`OFFLINE READY: ${casesToUpload.length} leads saved directly to phone storage. Ready to dial!`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="upload" class="w-4 h-4"></i> Load into My Queue`;
        lucide.createIcons();
    }
}

// ----------------------------------------------------
// 4. INTERFACE 1: SUPER ADMIN CONSOLE LOGIC
// ----------------------------------------------------
function switchAdminTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-tab-${tabId}`);
    if (activeBtn) activeBtn.classList.add('active');

    const sections = ['dashboard', 'agents', 'allocations', 'reports'];
    sections.forEach(sec => {
        const el = document.getElementById(`section-${sec}`);
        if (el) {
            if (sec === tabId) el.classList.remove('hidden');
            else el.classList.add('hidden');
        }
    });

    lucide.createIcons();

    if (tabId === 'dashboard') loadDashboardStats();
    if (tabId === 'agents') loadAgents();
    if (tabId === 'reports') loadReports();
}

async function loadDashboardStats() {
    try {
        const res = await fetch('/api/dashboard/stats');
        const data = await res.json();

        const kpis = data.kpis || {};
        document.getElementById('kpi-total-calls').innerText = (kpis.total_calls_today || 0).toLocaleString();
        document.getElementById('kpi-connected-calls').innerText = (kpis.connected_calls || 0).toLocaleString();
        document.getElementById('kpi-connect-rate').innerText = `${kpis.connect_rate || 0}%`;
        document.getElementById('kpi-ptp-amount').innerText = `₹${(kpis.total_ptp_amount || 0).toLocaleString()}`;
        document.getElementById('kpi-ptp-cases').innerText = `${kpis.total_ptp_cases || 0} accounts`;
        document.getElementById('kpi-online-agents').innerText = kpis.online_agents || 0;
        document.getElementById('kpi-revoked-agents').innerText = kpis.revoked_agents || 0;

        renderDispositionChart(data.dispositions || []);
        renderLeaderboard(data.leaderboard || []);
    } catch (e) {
        console.error('Stats error:', e);
    }
}

function renderDispositionChart(dispositions) {
    const ctx = document.getElementById('dispositionChart');
    if (!ctx) return;

    const hasData = dispositions && dispositions.length > 0;
    const labels = hasData ? dispositions.map(d => d.disposition) : ['No Calls Yet'];
    const counts = hasData ? dispositions.map(d => d.count) : [1];
    const colors = hasData ? ['#10b981', '#f59e0b', '#2563eb', '#64748b', '#ef4444', '#8b5cf6'] : ['#e2e8f0'];

    if (dispositionChart) dispositionChart.destroy();
    dispositionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data: counts, backgroundColor: colors, borderWidth: 2, borderColor: '#ffffff' }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { position: 'bottom', labels: { font: { size: 11, family: 'Inter' } } } },
            cutout: '72%'
        }
    });
}

function renderLeaderboard(leaderboard) {
    const tbody = document.getElementById('leaderboard-table-body');
    if (!tbody) return;

    if (!leaderboard || leaderboard.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400">No calls recorded today.</td></tr>`;
        return;
    }

    tbody.innerHTML = leaderboard.map((row, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
        const talkMins = Math.round((row.total_talk_seconds || 0) / 60);
        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-2.5 px-3">
                    <span class="mr-1.5 font-bold">${medal}</span>
                    <span class="font-bold text-slate-900">${row.agent_code}</span> 
                    <span class="text-slate-500">(${row.full_name})</span>
                </td>
                <td class="py-2.5 px-3 font-mono font-bold text-blue-700">${row.calls_made}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-emerald-700">${row.ptp_count}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-amber-600">₹${(row.ptp_value || 0).toLocaleString()}</td>
                <td class="py-2.5 px-3 text-slate-600 font-mono">${talkMins}m</td>
            </tr>
        `;
    }).join('');
}

async function loadAgents() {
    try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        allAgentsCache = data.agents || [];

        const targetSelect = document.getElementById('target-agent-select');
        if (targetSelect) {
            targetSelect.innerHTML = allAgentsCache
                .filter(a => a.status === 'ACTIVE')
                .map(a => `<option value="${a.id}">${a.agent_code} — ${a.full_name}</option>`)
                .join('');
        }

        renderAgentsTable(allAgentsCache);
    } catch (e) {
        console.error('Agents load error:', e);
    }
}

function filterAgentsList() {
    const query = (document.getElementById('agent-search')?.value || '').toLowerCase().trim();
    if (!query) {
        renderAgentsTable(allAgentsCache);
        return;
    }
    const filtered = allAgentsCache.filter(a => 
        (a.agent_code || '').toLowerCase().includes(query) || 
        (a.full_name || '').toLowerCase().includes(query)
    );
    renderAgentsTable(filtered);
}

function renderAgentsTable(agents) {
    const tbody = document.getElementById('agents-table-body');
    if (!tbody) return;

    if (!agents || agents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400">No agents found. Click '+ Create Agent ID' to provision telecallers.</td></tr>`;
        return;
    }

    tbody.innerHTML = agents.map(a => {
        const isRevoked = a.status === 'REVOKED';
        const statusBadge = isRevoked 
            ? `<span class="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">REVOKED (LOCKED)</span>`
            : `<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">ACTIVE</span>`;

        const deviceText = a.hardware_uuid 
            ? `<div class="font-mono text-[11px] text-slate-700 flex items-center gap-1"><i data-lucide="smartphone" class="w-3.5 h-3.5 text-blue-600"></i> ${a.device_model || 'Bound Device'}</div>`
            : `<span class="text-slate-400 text-[11px] italic">Waiting 1st Login</span>`;

        return `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-3 px-4 font-bold text-slate-900 font-mono">${a.agent_code}</td>
                <td class="py-3 px-4">
                    <div class="text-slate-900 font-semibold">${a.full_name}</div>
                    <div class="text-[11px] text-slate-500 font-mono">${a.phone}</div>
                </td>
                <td class="py-3 px-4">${deviceText}</td>
                <td class="py-3 px-4 font-mono font-bold text-slate-700">${a.assigned_cases || 0}</td>
                <td class="py-3 px-4 font-mono font-bold text-emerald-700">${a.calls_today || 0}</td>
                <td class="py-3 px-4">${statusBadge}</td>
                <td class="py-3 px-4 text-right space-x-1.5">
                    ${isRevoked 
                        ? `<button onclick="toggleKillSwitch(${a.id}, 'ACTIVATE')" class="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-bold shadow-sm transition">Restore Access</button>`
                        : `<button onclick="toggleKillSwitch(${a.id}, 'REVOKE')" class="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[11px] font-bold shadow-sm transition">Kill-Switch</button>`
                    }
                    <button onclick="openChangeAgentPasswordModal(${a.id}, '${a.agent_code}')" class="px-2.5 py-1 bg-white hover:bg-amber-50 hover:text-amber-800 text-slate-700 rounded-lg text-[11px] font-semibold border border-slate-200 transition" title="Change Agent Password">Pass</button>
                    ${a.hardware_uuid ? `<button onclick="resetDevice(${a.id})" class="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-semibold border border-slate-200 transition" title="Clear Phone Lock">Reset Lock</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

async function toggleKillSwitch(agentId, action) {
    if (!confirm(action === 'REVOKE' ? 'Lock this Agent APK immediately?' : 'Restore agent access?')) return;
    try {
        const res = await fetch(`/api/agents/${agentId}/kill-switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        alert(data.message || 'Status updated.');
        loadAgents();
        loadDashboardStats();
    } catch (e) {
        alert('Kill-switch failed: ' + e.message);
    }
}

async function resetDevice(agentId) {
    if (!confirm('Allow this agent to bind to a new Android phone?')) return;
    try {
        const res = await fetch(`/api/agents/${agentId}/reset-device`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Device cleared.');
        loadAgents();
    } catch (e) {
        alert('Reset error: ' + e.message);
    }
}

function openCreateAgentModal() {
    document.getElementById('create-agent-modal').classList.remove('hidden');
}

function closeCreateAgentModal() {
    document.getElementById('create-agent-modal').classList.add('hidden');
}

async function handleCreateAgent(e) {
    e.preventDefault();
    const code = document.getElementById('new-agent-code').value;
    const name = document.getElementById('new-agent-name').value;
    const phone = document.getElementById('new-agent-phone').value;
    const password = document.getElementById('new-agent-password').value;

    try {
        const res = await fetch('/api/agents', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agent_code: code, full_name: name, phone, password })
        });
        const data = await res.json();
        if (data.error) {
            alert('Error: ' + data.error);
            return;
        }
        alert(`SUCCESS: Agent ${code} provisioned! They can now log in using Agent ID '${code}'.`);
        closeCreateAgentModal();
        document.getElementById('create-agent-form').reset();
        loadAgents();
        loadDashboardStats();
    } catch (err) {
        alert('Failed: ' + err.message);
    }
}

// ----------------------------------------------------
// PASSWORD MANAGEMENT (ADMIN & AGENTS)
// ----------------------------------------------------
function openChangeAdminPasswordModal() {
    document.getElementById('change-admin-password-modal').classList.remove('hidden');
    lucide.createIcons();
}

function closeChangeAdminPasswordModal() {
    document.getElementById('change-admin-password-modal').classList.add('hidden');
    document.getElementById('admin-curr-pass').value = '';
    document.getElementById('admin-new-pass').value = '';
}

async function handleChangeAdminPassword(e) {
    e.preventDefault();
    const currPass = document.getElementById('admin-curr-pass').value.trim();
    const newPass = document.getElementById('admin-new-pass').value.trim();

    const btn = document.getElementById('btn-admin-pass-submit');
    btn.disabled = true;
    btn.innerText = 'Saving...';

    try {
        const res = await fetch('/api/admin/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: currPass, new_password: newPass })
        });
        const data = await res.json();
        if (data.error) {
            alert('Error: ' + data.error);
        } else {
            alert('SUCCESS: ' + data.message);
            closeChangeAdminPasswordModal();
        }
    } catch (err) {
        alert('Failed to change admin password: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Save New Password';
    }
}

function openChangeAgentPasswordModal(agentId, agentCode) {
    document.getElementById('agent-pass-target-id').value = agentId;
    document.getElementById('agent-pass-target-code').innerText = agentCode;
    document.getElementById('change-agent-password-modal').classList.remove('hidden');
    lucide.createIcons();
}

function closeChangeAgentPasswordModal() {
    document.getElementById('change-agent-password-modal').classList.add('hidden');
    document.getElementById('agent-new-pass').value = '';
}

async function handleChangeAgentPassword(e) {
    e.preventDefault();
    const agentId = document.getElementById('agent-pass-target-id').value;
    const newPass = document.getElementById('agent-new-pass').value.trim();

    const btn = document.getElementById('btn-agent-pass-submit');
    btn.disabled = true;
    btn.innerText = 'Updating...';

    try {
        const res = await fetch(`/api/agents/${agentId}/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ new_password: newPass })
        });
        const data = await res.json();
        if (data.error) {
            alert('Error: ' + data.error);
        } else {
            alert('SUCCESS: ' + data.message);
            closeChangeAgentPasswordModal();
        }
    } catch (err) {
        alert('Failed to update agent password: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Update Password';
    }
}

// ----------------------------------------------------
// OFFLINE NETWORK STATUS & CALL SYNCING
// ----------------------------------------------------
window.addEventListener('online', () => {
    updateNetworkStatusUI(true);
    syncOfflineCalls();
});

window.addEventListener('offline', () => {
    updateNetworkStatusUI(false);
});

function updateNetworkStatusUI(isOnline) {
    const badge = document.getElementById('agent-network-badge');
    if (!badge) return;

    if (isOnline) {
        badge.className = 'px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold flex items-center gap-1';
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Online';
    } else {
        badge.className = 'px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-300 text-[10px] font-bold flex items-center gap-1';
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-amber-500"></span> Offline (SIM Active)';
    }
}

async function syncOfflineCalls() {
    const offlineLogs = JSON.parse(localStorage.getItem('debtflow_offline_logs') || '[]');
    if (offlineLogs.length === 0 || !currentAgent) return;

    try {
        const res = await fetch('/api/calls/batch-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                agent_id: currentAgent.id,
                logs: offlineLogs
            })
        });
        const data = await res.json();
        if (data.success) {
            console.log(`Synced ${offlineLogs.length} offline calls to Cloudflare D1.`);
            localStorage.removeItem('debtflow_offline_logs');
        }
    } catch (e) {
        console.warn('Sync attempt postponed:', e);
    }
}

// ----------------------------------------------------
// 5. ALLOCATION INGESTION & DISTRIBUTION (ADMIN)
// ----------------------------------------------------
function initDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('excel-file-input');
    const stratSelect = document.getElementById('distribution-strategy');

    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50/50');
    });
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
    });
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
        if (e.dataTransfer.files.length) handleAdminFileSelect(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleAdminFileSelect(e.target.files[0]);
    });

    stratSelect.addEventListener('change', (e) => {
        const wrapper = document.getElementById('specific-agent-wrapper');
        if (e.target.value === 'SPECIFIC') wrapper.classList.remove('hidden');
        else wrapper.classList.add('hidden');
    });
}

function handleAdminFileSelect(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        currentUploadedCases = json;
        document.getElementById('preview-row-count').innerText = json.length.toLocaleString();
        document.getElementById('batch-name').value = file.name.replace(/\.[^/.]+$/, "") + `_${Date.now().toString().slice(-4)}`;
        document.getElementById('upload-settings').classList.remove('hidden');
        lucide.createIcons();
    };
    reader.readAsArrayBuffer(file);
}

async function submitAllocationUpload() {
    if (!currentUploadedCases || currentUploadedCases.length === 0) return;

    const batchName = document.getElementById('batch-name').value;
    const strategy = document.getElementById('distribution-strategy').value;
    const targetAgentId = strategy === 'SPECIFIC' ? document.getElementById('target-agent-select').value : null;

    const btn = document.getElementById('btn-push-allocation');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Writing to Cloudflare D1...`;
    lucide.createIcons();

    try {
        const res = await fetch('/api/allocations/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                batch_name: batchName,
                cases: currentUploadedCases,
                distribution_mode: strategy,
                target_agent_id: targetAgentId
            })
        });

        const data = await res.json();
        if (data.error) {
            alert('Upload error: ' + data.error);
        } else {
            alert(`SUCCESS: ${data.message}`);
            document.getElementById('upload-settings').classList.add('hidden');
            document.getElementById('excel-file-input').value = '';
            currentUploadedCases = [];
            loadAgents();
            loadDashboardStats();
        }
    } catch (err) {
        alert('Upload failed: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> Upload & Assign in Cloudflare D1`;
        lucide.createIcons();
    }
}

// ----------------------------------------------------
// 6. REPORTS & BANK EXPORT
// ----------------------------------------------------
function initDatePickers() {
    const today = new Date().toISOString().slice(0, 10);
    const dateInput = document.getElementById('report-date');
    if (dateInput) {
        dateInput.value = today;
        dateInput.addEventListener('change', () => loadReports());
    }
}

async function loadReports() {
    const date = document.getElementById('report-date')?.value || new Date().toISOString().slice(0, 10);
    try {
        const res = await fetch(`/api/reports/export?date=${date}`);
        const data = await res.json();
        const records = data.records || [];

        const tbody = document.getElementById('report-table-body');
        if (!tbody) return;

        if (records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400">No calls logged on ${date}.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => `
            <tr class="hover:bg-slate-50 transition">
                <td class="py-2.5 px-4 text-slate-500 font-mono text-[11px]">${(r.called_at || '').slice(11, 19)}</td>
                <td class="py-2.5 px-4 font-bold text-slate-900 font-mono">${r.agent_code}</td>
                <td class="py-2.5 px-4 font-mono text-slate-600">${r.loan_account_no}</td>
                <td class="py-2.5 px-4 text-slate-900 font-medium">${r.customer_name}</td>
                <td class="py-2.5 px-4 font-mono text-blue-700 font-bold">${r.dialed_phone}</td>
                <td class="py-2.5 px-4 font-mono text-slate-600">${r.call_duration_seconds}s</td>
                <td class="py-2.5 px-4">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                        r.disposition === 'PTP' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' :
                        r.disposition === 'RNR' ? 'bg-slate-100 text-slate-700 border border-slate-200' :
                        r.disposition === 'WRONG_NUMBER' ? 'bg-rose-50 text-rose-800 border border-rose-200' : 'bg-amber-50 text-amber-800 border border-amber-200'
                    }">${r.disposition}</span>
                </td>
                <td class="py-2.5 px-4 font-mono text-amber-600 font-bold">${r.ptp_amount ? '₹' + Number(r.ptp_amount).toLocaleString() : '-'}</td>
            </tr>
        `).join('');
    } catch (e) {
        console.error('Reports error:', e);
    }
}

function downloadCsvReport() {
    const date = document.getElementById('report-date')?.value || new Date().toISOString().slice(0, 10);
    window.location.href = `/api/reports/export?date=${date}&format=csv`;
}
