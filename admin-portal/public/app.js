// DebtFlow Pro — Production Client Engine (100% Real Cloudflare D1 Sync)

let dispositionChart = null;
let currentUploadedCases = [];
let simInterval = null;
let simTimerSeconds = 0;
let isSimCalling = false;
let isSimPaused = false;
let activeCasesQueue = [];
let currentSimCaseIndex = 0;
let simAudioMode = 'HEADSET'; // HEADSET | SPEAKER | EARPIECE
let allAgentsCache = [];

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initDatePickers();
    loadDashboardStats();
    loadAgents();
    loadReports();
    initDropZone();

    // Auto-refresh real-time stats every 20 seconds
    setInterval(() => {
        loadDashboardStats();
    }, 20000);
});

// Smooth Tab Navigation
function switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById(`btn-tab-${tabId}`);
    if (activeBtn) activeBtn.classList.add('active');

    const sections = ['dashboard', 'agents', 'allocations', 'simulator', 'reports'];
    sections.forEach(sec => {
        const el = document.getElementById(`section-${sec}`);
        if (el) {
            if (sec === tabId) {
                el.classList.remove('hidden');
            } else {
                el.classList.add('hidden');
            }
        }
    });

    lucide.createIcons();

    if (tabId === 'agents') loadAgents();
    if (tabId === 'dashboard') loadDashboardStats();
    if (tabId === 'simulator') loadSimulatorQueue();
    if (tabId === 'reports') loadReports();
}

// ----------------------------------------------------
// 1. DASHBOARD & RECOVERY SCOREBOARD (REAL D1 DATA)
// ----------------------------------------------------
async function loadDashboardStats() {
    try {
        const res = await fetch('/api/dashboard/stats');
        const data = await res.json();

        // Update real KPIs from D1 database
        const kpis = data.kpis || {};
        document.getElementById('kpi-total-calls').innerText = (kpis.total_calls_today || 0).toLocaleString();
        document.getElementById('kpi-connected-calls').innerText = (kpis.connected_calls || 0).toLocaleString();
        document.getElementById('kpi-connect-rate').innerText = `${kpis.connect_rate || 0}%`;
        document.getElementById('kpi-ptp-amount').innerText = `₹${(kpis.total_ptp_amount || 0).toLocaleString()}`;
        document.getElementById('kpi-ptp-cases').innerText = `${kpis.total_ptp_cases || 0} accounts`;
        document.getElementById('kpi-online-agents').innerText = kpis.online_agents || 0;
        document.getElementById('kpi-revoked-agents').innerText = kpis.revoked_agents || 0;

        // Render Dispositions Chart
        renderDispositionChart(data.dispositions || []);

        // Render Leaderboard
        renderLeaderboard(data.leaderboard || []);
    } catch (err) {
        console.error('Error loading dashboard stats:', err);
    }
}

function renderDispositionChart(dispositions) {
    const ctx = document.getElementById('dispositionChart');
    if (!ctx) return;

    const hasData = dispositions && dispositions.length > 0;
    const labels = hasData ? dispositions.map(d => d.disposition) : ['No Calls Yet'];
    const counts = hasData ? dispositions.map(d => d.count) : [1];
    const colors = hasData 
        ? ['#10b981', '#f59e0b', '#2563eb', '#64748b', '#ef4444', '#8b5cf6', '#ec4899']
        : ['#e2e8f0'];

    if (dispositionChart) dispositionChart.destroy();

    dispositionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: counts,
                backgroundColor: colors.slice(0, labels.length),
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#475569', font: { size: 11, family: 'Inter' }, padding: 12 }
                }
            },
            cutout: '72%'
        }
    });
}

function renderLeaderboard(leaderboard) {
    const tbody = document.getElementById('leaderboard-table-body');
    if (!tbody) return;

    if (!leaderboard || leaderboard.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-400 font-medium">No calls recorded today. Start dialing or assign cases to see live telecaller recovery ranks.</td></tr>`;
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

// ----------------------------------------------------
// 2. AGENTS & KILL-SWITCH HQ (REAL D1 DATABASE)
// ----------------------------------------------------
async function loadAgents() {
    try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        const agents = data.agents || [];
        allAgentsCache = agents;

        // Populate target agent dropdown in Allocations tab
        const targetSelect = document.getElementById('target-agent-select');
        if (targetSelect) {
            targetSelect.innerHTML = agents
                .filter(a => a.status === 'ACTIVE')
                .map(a => `<option value="${a.id}">${a.agent_code} — ${a.full_name}</option>`)
                .join('');
        }

        renderAgentsTable(agents);
    } catch (err) {
        console.error('Error loading agents from D1:', err);
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
        (a.full_name || '').toLowerCase().includes(query) ||
        (a.phone || '').includes(query)
    );
    renderAgentsTable(filtered);
}

function renderAgentsTable(agents) {
    const tbody = document.getElementById('agents-table-body');
    if (!tbody) return;

    if (!agents || agents.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" class="py-8 text-center text-slate-400 font-medium">No agents found in Cloudflare D1. Click '+ Create New Agent ID' to provision telecallers.</td></tr>`;
        return;
    }

    tbody.innerHTML = agents.map(a => {
        const isRevoked = a.status === 'REVOKED';
        const statusBadge = isRevoked 
            ? `<span class="px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[10px] font-bold">REVOKED (LOCKED)</span>`
            : `<span class="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold">ACTIVE</span>`;

        const deviceText = a.hardware_uuid 
            ? `<div class="font-mono text-[11px] text-slate-700 flex items-center gap-1"><i data-lucide="smartphone" class="w-3.5 h-3.5 text-blue-600"></i> ${a.device_model || 'Bound Device'} <span class="text-[10px] text-slate-400">(${a.hardware_uuid.slice(0, 8)}...)</span></div>`
            : `<span class="text-slate-400 text-[11px] italic">Not Bound (Waiting 1st Login)</span>`;

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
                    ${a.hardware_uuid ? `<button onclick="resetDevice(${a.id})" class="px-2.5 py-1 bg-white hover:bg-slate-100 text-slate-700 rounded-lg text-[11px] font-semibold border border-slate-200 transition" title="Clear Phone Lock">Reset Lock</button>` : ''}
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

async function toggleKillSwitch(agentId, action) {
    const confirmMsg = action === 'REVOKE' 
        ? 'ARE YOU SURE? This will immediately terminate this agent session, wipe local leads from their phone, and lock the APK.'
        : 'Restore calling access for this agent?';

    if (!confirm(confirmMsg)) return;

    try {
        const res = await fetch(`/api/agents/${agentId}/kill-switch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action })
        });
        const data = await res.json();
        alert(data.message || 'Kill-switch status updated in Cloudflare D1.');
        loadAgents();
        loadDashboardStats();
    } catch (err) {
        alert('Failed to update kill-switch: ' + err.message);
    }
}

async function resetDevice(agentId) {
    if (!confirm('Allow this agent to bind to a new Android device?')) return;
    try {
        const res = await fetch(`/api/agents/${agentId}/reset-device`, { method: 'POST' });
        const data = await res.json();
        alert(data.message || 'Device lock cleared.');
        loadAgents();
    } catch (err) {
        alert('Failed to reset device lock: ' + err.message);
    }
}

// Modal Helpers
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
        alert(data.message || 'Agent provisioned successfully in D1 database!');
        closeCreateAgentModal();
        document.getElementById('create-agent-form').reset();
        loadAgents();
        loadDashboardStats();
    } catch (err) {
        alert('Failed to create agent: ' + err.message);
    }
}

// ----------------------------------------------------
// 3. ALLOCATION INGESTION & DISTRIBUTION (REAL EXCEL)
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
        if (e.dataTransfer.files.length) handleFileSelect(e.dataTransfer.files[0]);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) handleFileSelect(e.target.files[0]);
    });

    stratSelect.addEventListener('change', (e) => {
        const wrapper = document.getElementById('specific-agent-wrapper');
        if (e.target.value === 'SPECIFIC') {
            wrapper.classList.remove('hidden');
        } else {
            wrapper.classList.add('hidden');
        }
    });
}

function handleFileSelect(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
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
    if (!currentUploadedCases || currentUploadedCases.length === 0) {
        alert('Please select an Excel or CSV file first.');
        return;
    }

    const batchName = document.getElementById('batch-name').value;
    const strategy = document.getElementById('distribution-strategy').value;
    const targetAgentId = strategy === 'SPECIFIC' ? document.getElementById('target-agent-select').value : null;

    const btn = document.getElementById('btn-push-allocation');
    btn.disabled = true;
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Writing cases to Cloudflare D1...`;
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
            loadSimulatorQueue();
        }
    } catch (err) {
        alert('Failed to upload allocation: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> Upload & Assign in Cloudflare D1`;
        lucide.createIcons();
    }
}

// ----------------------------------------------------
// 4. TELECALLER SIMULATOR (LIVE D1 QUEUE)
// ----------------------------------------------------
async function loadSimulatorQueue() {
    try {
        // Find first active agent
        const activeAgent = allAgentsCache.find(a => a.status === 'ACTIVE');
        const agentId = activeAgent ? activeAgent.id : 1;
        const agentCode = activeAgent ? activeAgent.agent_code : 'AGT001';

        document.getElementById('sim-agent-badge').innerText = agentCode;

        const res = await fetch(`/api/allocations/my-cases?agent_id=${agentId}`);
        const data = await res.json();
        const cases = data.cases || [];

        if (cases.length > 0) {
            activeCasesQueue = cases;
            currentSimCaseIndex = 0;
            renderSimulatorCase();
        } else {
            // If no cases in D1 yet, show placeholder waiting for real upload
            activeCasesQueue = [{
                id: 0,
                customer_name: "Upload allocation sheet to start",
                loan_account_no: "N/A",
                primary_phone: "9876543210",
                overdue_amount: 0,
                dpd: 0,
                bucket: "PENDING"
            }];
            currentSimCaseIndex = 0;
            renderSimulatorCase();
        }
    } catch (err) {
        console.error('Error loading simulator queue from D1:', err);
    }
}

function renderSimulatorCase() {
    const item = activeCasesQueue[currentSimCaseIndex];
    if (!item) return;

    document.getElementById('sim-case-index').innerText = currentSimCaseIndex + 1;
    document.getElementById('sim-case-total').innerText = activeCasesQueue.length;
    document.getElementById('sim-case-name').innerText = item.customer_name;
    document.getElementById('sim-case-loan').innerText = `Loan Acc: ${item.loan_account_no}`;
    
    const phone = String(item.primary_phone || '');
    document.getElementById('sim-case-phone').innerText = phone.length >= 10 
        ? `+91 ${phone.slice(0, 5)} ${phone.slice(5)}`
        : phone;

    document.getElementById('sim-case-amount').innerText = `₹ ${Number(item.overdue_amount || 0).toLocaleString()}`;
    document.getElementById('sim-case-dpd').innerText = `DPD: ${item.dpd || 0} Days`;
    document.getElementById('sim-case-bucket').innerText = item.bucket || 'BUCKET 1';

    document.getElementById('sim-call-status-text').innerText = 'Ready to Dial';
    document.getElementById('sim-call-timer').innerText = '00:00';
}

function triggerSimDial() {
    if (isSimCalling) {
        endSimCall();
        return;
    }

    isSimCalling = true;
    simTimerSeconds = 0;
    const btn = document.getElementById('sim-dial-btn');
    btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-700');
    btn.classList.add('bg-rose-600', 'hover:bg-rose-700');
    btn.innerHTML = `<i data-lucide="phone-off" class="w-4 h-4"></i> End Call`;
    document.getElementById('sim-call-status-text').innerText = `Calling SIM 1 (${simAudioMode})...`;

    simInterval = setInterval(() => {
        simTimerSeconds++;
        const mins = String(Math.floor(simTimerSeconds / 60)).padStart(2, '0');
        const secs = String(simTimerSeconds % 60).padStart(2, '0');
        document.getElementById('sim-call-timer').innerText = `${mins}:${secs}`;
    }, 1000);

    lucide.createIcons();
}

function endSimCall() {
    isSimCalling = false;
    clearInterval(simInterval);
    const btn = document.getElementById('sim-dial-btn');
    btn.classList.remove('bg-rose-600', 'hover:bg-rose-700');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-700');
    btn.innerHTML = `<i data-lucide="phone" class="w-4 h-4"></i> Start Auto-Dialing`;
    document.getElementById('sim-call-status-text').innerText = 'Call Ended — Tap Tag Below';
    lucide.createIcons();
}

async function logSimCall(disposition) {
    const callSecs = simTimerSeconds;
    if (isSimCalling) endSimCall();

    const item = activeCasesQueue[currentSimCaseIndex];
    if (item && item.id > 0) {
        const activeAgent = allAgentsCache.find(a => a.status === 'ACTIVE');
        const agentId = activeAgent ? activeAgent.id : 1;

        // Post real call log to Cloudflare D1
        try {
            await fetch('/api/calls/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    allocation_id: item.id,
                    agent_id: agentId,
                    dialed_phone: item.primary_phone,
                    call_duration_seconds: callSecs,
                    disposition: disposition,
                    ptp_amount: disposition === 'PTP' ? item.overdue_amount : null,
                    ptp_date: disposition === 'PTP' ? new Date(Date.now() + 86400000).toISOString().slice(0, 10) : null
                })
            });
            loadDashboardStats();
        } catch (e) {
            console.error('Error logging call to D1:', e);
        }
    }

    document.getElementById('sim-call-status-text').innerText = `Saved: ${disposition}. Next in 3s...`;

    setTimeout(() => {
        if (!isSimPaused && activeCasesQueue.length > 1) {
            currentSimCaseIndex = (currentSimCaseIndex + 1) % activeCasesQueue.length;
            renderSimulatorCase();
            triggerSimDial();
        }
    }, 2500);
}

function toggleSimPause() {
    isSimPaused = !isSimPaused;
    const btn = document.getElementById('sim-pause-btn');
    if (isSimPaused) {
        btn.classList.add('bg-amber-100', 'text-amber-800', 'border-amber-300');
        btn.innerHTML = `<i data-lucide="play" class="w-4 h-4"></i>`;
        document.getElementById('sim-call-status-text').innerText = 'Auto-Dialer Paused';
    } else {
        btn.classList.remove('bg-amber-100', 'text-amber-800', 'border-amber-300');
        btn.innerHTML = `<i data-lucide="pause" class="w-4 h-4"></i>`;
        document.getElementById('sim-call-status-text').innerText = 'Resumed';
    }
    lucide.createIcons();
}

function toggleSimAudio() {
    const btn = document.getElementById('sim-audio-btn');
    if (simAudioMode === 'HEADSET') {
        simAudioMode = 'SPEAKER';
        btn.innerHTML = `<i data-lucide="volume-2" class="w-3.5 h-3.5"></i> Speaker`;
        btn.className = 'px-2.5 py-1 bg-white rounded-lg text-[10px] font-bold text-amber-700 flex items-center gap-1 border border-slate-200 shadow-sm';
    } else if (simAudioMode === 'SPEAKER') {
        simAudioMode = 'EARPIECE';
        btn.innerHTML = `<i data-lucide="phone" class="w-3.5 h-3.5"></i> Handset`;
        btn.className = 'px-2.5 py-1 bg-white rounded-lg text-[10px] font-bold text-blue-700 flex items-center gap-1 border border-slate-200 shadow-sm';
    } else {
        simAudioMode = 'HEADSET';
        btn.innerHTML = `<i data-lucide="headphones" class="w-3.5 h-3.5"></i> Earphone`;
        btn.className = 'px-2.5 py-1 bg-white rounded-lg text-[10px] font-bold text-emerald-700 flex items-center gap-1 border border-slate-200 shadow-sm';
    }
    lucide.createIcons();
}

// ----------------------------------------------------
// 5. AUDIT REPORTS & BANK EXPORT (REAL D1 CALLS)
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
        const res = await fetch(`/api/reports/export?date=${date}&format=json`);
        const data = await res.json();
        const records = data.records || [];

        const tbody = document.getElementById('report-table-body');
        if (!tbody) return;

        if (records.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="py-8 text-center text-slate-400 font-medium">No calls logged in Cloudflare D1 on ${date}.</td></tr>`;
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
    } catch (err) {
        console.error('Error loading reports from D1:', err);
    }
}

function downloadCsvReport() {
    const date = document.getElementById('report-date')?.value || new Date().toISOString().slice(0, 10);
    window.location.href = `/api/reports/export?date=${date}&format=csv`;
}
