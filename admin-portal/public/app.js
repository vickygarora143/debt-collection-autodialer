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

function renderCockpitCase() {
    if (cockpitCases.length === 0) {
        document.getElementById('cockpit-case-name').innerText = "Queue Empty! Import leads above";
        document.getElementById('cockpit-case-loan').innerText = "Loan Acc: -";
        document.getElementById('cockpit-case-phone').innerText = "-";
        document.getElementById('cockpit-case-amount').innerText = "₹ 0";
        document.getElementById('cockpit-case-dpd').innerText = "DPD: 0 Days";
        document.getElementById('cockpit-case-bucket').innerText = "DONE";
        document.getElementById('cockpit-call-status-text').innerText = "Ready";
        document.getElementById('cockpit-call-timer').innerText = "00:00";
        return;
    }

    const item = cockpitCases[cockpitIndex];
    document.getElementById('cockpit-case-name').innerText = item.customer_name;
    document.getElementById('cockpit-case-loan').innerText = `Loan Acc: ${item.loan_account_no}`;
    
    const phone = String(item.primary_phone || '');
    document.getElementById('cockpit-case-phone').innerText = phone.length >= 10
        ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
        : phone;

    document.getElementById('cockpit-case-amount').innerText = `₹ ${Number(item.overdue_amount || 0).toLocaleString()}`;
    document.getElementById('cockpit-case-dpd').innerText = `DPD: ${item.dpd || 0} Days`;
    document.getElementById('cockpit-case-bucket').innerText = item.bucket || 'BUCKET 1';

    document.getElementById('cockpit-call-status-text').innerText = "Ready to Dial";
    document.getElementById('cockpit-call-timer').innerText = "00:00";
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

    cockpitCalling = true;
    cockpitTimerSecs = 0;
    const btn = document.getElementById('cockpit-dial-btn');
    btn.classList.replace('bg-emerald-600', 'bg-rose-600');
    btn.classList.replace('hover:bg-emerald-700', 'hover:bg-rose-700');
    btn.innerHTML = `<i data-lucide="phone-off" class="w-5 h-5"></i> End Call`;
    document.getElementById('cockpit-call-status-text').innerText = `Calling SIM 1 (${cockpitAudioMode})...`;

    cockpitInterval = setInterval(() => {
        cockpitTimerSecs++;
        const mins = String(Math.floor(cockpitTimerSecs / 60)).padStart(2, '0');
        const secs = String(cockpitTimerSecs % 60).padStart(2, '0');
        document.getElementById('cockpit-call-timer').innerText = `${mins}:${secs}`;
    }, 1000);

    lucide.createIcons();
}

function endCockpitCall() {
    cockpitCalling = false;
    clearInterval(cockpitInterval);
    const btn = document.getElementById('cockpit-dial-btn');
    btn.classList.replace('bg-rose-600', 'bg-emerald-600');
    btn.classList.replace('hover:bg-rose-700', 'hover:bg-emerald-700');
    btn.innerHTML = `<i data-lucide="phone" class="w-5 h-5"></i> Start Auto-Dialing`;
    document.getElementById('cockpit-call-status-text').innerText = 'Call Ended — Tap 1-Touch Tag';
    lucide.createIcons();
}

async function logCockpitCall(disposition) {
    const duration = cockpitTimerSecs;
    if (cockpitCalling) endCockpitCall();

    const item = cockpitCases[cockpitIndex];
    if (item && item.id > 0 && currentAgent) {
        const logPayload = {
            allocation_id: item.id,
            agent_id: currentAgent.id,
            dialed_phone: item.primary_phone,
            call_duration_seconds: duration,
            disposition: disposition,
            ptp_amount: disposition === 'PTP' ? item.overdue_amount : null,
            ptp_date: disposition === 'PTP' ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : null,
            called_at: new Date().toISOString()
        };

        if (navigator.onLine) {
            try {
                await fetch('/api/calls/log', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(logPayload)
                });
            } catch (e) {
                saveOfflineLog(logPayload);
            }
        } else {
            saveOfflineLog(logPayload);
        }
    }

    document.getElementById('cockpit-call-status-text').innerText = `Tagged: ${disposition}. Next in 3s...`;

    setTimeout(() => {
        if (!cockpitPaused && cockpitCases.length > 0) {
            cockpitIndex = (cockpitIndex + 1) % cockpitCases.length;
            renderCockpitCase();
            triggerCockpitDial();
        }
    }, 2500);
}

function saveOfflineLog(log) {
    const logs = JSON.parse(localStorage.getItem('debtflow_offline_logs') || '[]');
    logs.push(log);
    localStorage.setItem('debtflow_offline_logs', JSON.stringify(logs));
    console.log('Saved call outcome offline. Total queued for sync:', logs.length);
}

function toggleCockpitPause() {
    cockpitPaused = !cockpitPaused;
    const btn = document.getElementById('cockpit-pause-btn');
    if (cockpitPaused) {
        btn.classList.add('bg-amber-100', 'text-amber-800');
        btn.innerHTML = `<i data-lucide="play" class="w-5 h-5"></i>`;
        document.getElementById('cockpit-call-status-text').innerText = 'Auto-Dial Paused';
    } else {
        btn.classList.remove('bg-amber-100', 'text-amber-800');
        btn.innerHTML = `<i data-lucide="pause" class="w-5 h-5"></i>`;
        document.getElementById('cockpit-call-status-text').innerText = 'Resumed';
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
        alert('Failed to upload cases: ' + e.message);
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
