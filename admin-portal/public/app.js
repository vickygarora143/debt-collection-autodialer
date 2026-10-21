// DebtFlow Pro — Super Admin Client Logic & Telecaller Engine

let dispositionChart = null;
let currentUploadedCases = [];
let simInterval = null;
let simTimerSeconds = 0;
let isSimCalling = false;
let isSimPaused = false;
let currentSimCaseIndex = 0;
let simAudioMode = 'HEADSET'; // HEADSET | SPEAKER | EARPIECE

// Mock Cases for Simulator
const sampleSimulatorCases = [
    { name: "Rajesh Kumar Sharma", loan: "PL-98241029", phone: "9876543210", amount: 28450, dpd: 64, bucket: "BUCKET 2" },
    { name: "Sunil Anand Patil", loan: "HL-44120931", phone: "9823019283", amount: 64120, dpd: 88, bucket: "BUCKET 3" },
    { name: "Pooja Ramesh Mehra", loan: "CC-11928341", phone: "9711823901", amount: 14200, dpd: 32, bucket: "BUCKET 1" },
    { name: "Deepak Satish Rao", loan: "AL-55102938", phone: "9940182736", amount: 48900, dpd: 71, bucket: "BUCKET 3" },
    { name: "Meena Gurpreet Singh", loan: "PL-88201947", phone: "9818273645", amount: 21300, dpd: 45, bucket: "BUCKET 2" }
];

document.addEventListener('DOMContentLoaded', () => {
    lucide.createIcons();
    initDatePickers();
    loadDashboardStats();
    loadAgents();
    loadReports();
    initDropZone();
    renderSimulatorCase();

    // Auto-refresh stats every 30 seconds
    setInterval(() => {
        loadDashboardStats();
    }, 30000);
});

// Tab Navigation
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
}

// ----------------------------------------------------
// 1. DASHBOARD & RECOVERY SCOREBOARD
// ----------------------------------------------------
async function loadDashboardStats() {
    try {
        const res = await fetch('/api/dashboard/stats');
        const data = await res.json();

        // Update KPIs
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
        console.warn('Dashboard stats fallback:', err);
    }
}

function renderDispositionChart(dispositions) {
    const ctx = document.getElementById('dispositionChart');
    if (!ctx) return;

    const labels = dispositions.map(d => d.disposition);
    const counts = dispositions.map(d => d.count);
    const colors = ['#10b981', '#f59e0b', '#3b82f6', '#64748b', '#ef4444', '#8b5cf6', '#ec4899'];

    if (dispositionChart) dispositionChart.destroy();

    dispositionChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels.length ? labels : ['No Data'],
            datasets: [{
                data: counts.length ? counts : [1],
                backgroundColor: labels.length ? colors.slice(0, labels.length) : ['#334155'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: '#94a3b8', font: { size: 10 } }
                }
            },
            cutout: '70%'
        }
    });
}

function renderLeaderboard(leaderboard) {
    const tbody = document.getElementById('leaderboard-table-body');
    if (!tbody) return;

    if (!leaderboard || leaderboard.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-slate-500">No telecaller calls recorded yet today.</td></tr>`;
        return;
    }

    tbody.innerHTML = leaderboard.map((row, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${index + 1}`;
        const talkMins = Math.round((row.total_talk_seconds || 0) / 60);
        return `
            <tr class="hover:bg-slate-800/40">
                <td class="py-2.5 px-3">
                    <span class="mr-1.5 font-bold">${medal}</span>
                    <span class="font-bold text-white">${row.agent_code}</span> 
                    <span class="text-slate-400">(${row.full_name})</span>
                </td>
                <td class="py-2.5 px-3 font-mono font-bold text-blue-400">${row.calls_made}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-emerald-400">${row.ptp_count}</td>
                <td class="py-2.5 px-3 font-mono font-bold text-amber-400">₹${(row.ptp_value || 0).toLocaleString()}</td>
                <td class="py-2.5 px-3 text-slate-300 font-mono">${talkMins}m</td>
            </tr>
        `;
    }).join('');
}

// ----------------------------------------------------
// 2. AGENTS & KILL-SWITCH HQ
// ----------------------------------------------------
async function loadAgents() {
    try {
        const res = await fetch('/api/agents');
        const data = await res.json();
        const agents = data.agents || [];

        // Update target agent dropdown in Allocations tab
        const targetSelect = document.getElementById('target-agent-select');
        if (targetSelect) {
            targetSelect.innerHTML = agents
                .filter(a => a.status === 'ACTIVE')
                .map(a => `<option value="${a.id}">${a.agent_code} — ${a.full_name}</option>`)
                .join('');
        }

        const tbody = document.getElementById('agents-table-body');
        if (!tbody) return;

        if (agents.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="py-6 text-center text-slate-500">No telecallers provisioned yet. Click '+ Create New Agent ID' to add up to 50 callers.</td></tr>`;
            return;
        }

        tbody.innerHTML = agents.map(a => {
            const isRevoked = a.status === 'REVOKED';
            const statusBadge = isRevoked 
                ? `<span class="px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-bold">REVOKED (LOCKED)</span>`
                : `<span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">ACTIVE</span>`;

            const deviceText = a.hardware_uuid 
                ? `<div class="font-mono text-[11px] text-blue-300 flex items-center gap-1"><i data-lucide="smartphone" class="w-3 h-3 text-blue-400"></i> ${a.device_model || 'Bound Device'} <span class="text-[9px] text-slate-500">(${a.hardware_uuid.slice(0, 8)}...)</span></div>`
                : `<span class="text-slate-500 text-[11px] italic">Not Bound (Waiting 1st Login)</span>`;

            return `
                <tr class="hover:bg-slate-800/40">
                    <td class="py-3 px-4 font-bold text-white font-mono">${a.agent_code}</td>
                    <td class="py-3 px-4">
                        <div class="text-slate-200 font-semibold">${a.full_name}</div>
                        <div class="text-[11px] text-slate-400 font-mono">${a.phone}</div>
                    </td>
                    <td class="py-3 px-4">${deviceText}</td>
                    <td class="py-3 px-4 font-mono font-bold text-slate-300">${a.assigned_cases || 0}</td>
                    <td class="py-3 px-4 font-mono font-bold text-emerald-400">${a.calls_today || 0}</td>
                    <td class="py-3 px-4">${statusBadge}</td>
                    <td class="py-3 px-4 text-right space-x-1.5">
                        ${isRevoked 
                            ? `<button onclick="toggleKillSwitch(${a.id}, 'ACTIVATE')" class="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold transition">Restore</button>`
                            : `<button onclick="toggleKillSwitch(${a.id}, 'REVOKE')" class="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[10px] font-bold transition shadow-sm shadow-rose-600/30">Kill-Switch</button>`
                        }
                        ${a.hardware_uuid ? `<button onclick="resetDevice(${a.id})" class="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-[10px] font-semibold border border-slate-700" title="Clear Phone Lock">Reset Lock</button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        lucide.createIcons();
    } catch (err) {
        console.error('Error loading agents:', err);
    }
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
        alert(data.message || 'Kill-switch status updated.');
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
        alert(data.message || 'Agent provisioned successfully!');
        closeCreateAgentModal();
        document.getElementById('create-agent-form').reset();
        loadAgents();
        loadDashboardStats();
    } catch (err) {
        alert('Failed to create agent: ' + err.message);
    }
}

// ----------------------------------------------------
// 3. ALLOCATION INGESTION & DISTRIBUTION
// ----------------------------------------------------
function initDropZone() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('excel-file-input');
    const stratSelect = document.getElementById('distribution-strategy');

    if (!dropZone || !fileInput) return;

    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500');
    });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('border-blue-500'));
    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500');
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
    btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Distributing to 50 Agents...`;
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
        alert('Failed to upload allocation: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> Push to Agent Android Phones`;
        lucide.createIcons();
    }
}

// ----------------------------------------------------
// 4. TELECALLER SIMULATOR (APK PREVIEW)
// ----------------------------------------------------
function renderSimulatorCase() {
    const item = sampleSimulatorCases[currentSimCaseIndex];
    if (!item) return;

    document.getElementById('sim-case-index').innerText = currentSimCaseIndex + 1;
    document.getElementById('sim-case-total').innerText = sampleSimulatorCases.length;
    document.getElementById('sim-case-name').innerText = item.name;
    document.getElementById('sim-case-loan').innerText = `Loan Acc: ${item.loan}`;
    document.getElementById('sim-case-phone').innerText = `+91 ${item.phone.slice(0, 5)} ${item.phone.slice(5)}`;
    document.getElementById('sim-case-amount').innerText = `₹ ${item.amount.toLocaleString()}`;
    document.getElementById('sim-case-dpd').innerText = `DPD: ${item.dpd} Days`;
    document.getElementById('sim-case-bucket').innerText = item.bucket;

    document.getElementById('sim-call-status-text').innerText = 'Ready to Dial';
    document.getElementById('sim-call-timer').innerText = '00:00';
}

function triggerSimDial() {
    if (isSimCalling) {
        // Disconnect Call
        endSimCall();
        return;
    }

    isSimCalling = true;
    simTimerSeconds = 0;
    const btn = document.getElementById('sim-dial-btn');
    btn.classList.remove('bg-emerald-600', 'hover:bg-emerald-500');
    btn.classList.add('bg-rose-600', 'hover:bg-rose-500');
    btn.innerHTML = `<i data-lucide="phone-off" class="w-4 h-4"></i> End Call`;
    document.getElementById('sim-call-status-text').innerText = `Calling via SIM 1 (${simAudioMode})...`;

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
    btn.classList.remove('bg-rose-600', 'hover:bg-rose-500');
    btn.classList.add('bg-emerald-600', 'hover:bg-emerald-500');
    btn.innerHTML = `<i data-lucide="phone" class="w-4 h-4"></i> Start Auto-Dialing`;
    document.getElementById('sim-call-status-text').innerText = 'Call Ended — Tap Tag Below';
    lucide.createIcons();
}

function logSimCall(disposition) {
    if (isSimCalling) endSimCall();

    const item = sampleSimulatorCases[currentSimCaseIndex];
    document.getElementById('sim-call-status-text').innerText = `Saved: ${disposition}. Next in 3s...`;

    // Advance to next debtor automatically after 3 seconds
    setTimeout(() => {
        if (!isSimPaused) {
            currentSimCaseIndex = (currentSimCaseIndex + 1) % sampleSimulatorCases.length;
            renderSimulatorCase();
            triggerSimDial(); // Auto-dial next debtor!
        }
    }, 2000);
}

function toggleSimPause() {
    isSimPaused = !isSimPaused;
    const btn = document.getElementById('sim-pause-btn');
    if (isSimPaused) {
        btn.classList.add('bg-amber-600', 'text-white');
        btn.innerHTML = `<i data-lucide="play" class="w-4 h-4"></i>`;
        document.getElementById('sim-call-status-text').innerText = 'Auto-Dialer Paused';
    } else {
        btn.classList.remove('bg-amber-600', 'text-white');
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
        btn.classList.replace('text-emerald-400', 'text-amber-400');
    } else if (simAudioMode === 'SPEAKER') {
        simAudioMode = 'EARPIECE';
        btn.innerHTML = `<i data-lucide="phone" class="w-3.5 h-3.5"></i> Handset`;
        btn.classList.replace('text-amber-400', 'text-blue-400');
    } else {
        simAudioMode = 'HEADSET';
        btn.innerHTML = `<i data-lucide="headphones" class="w-3.5 h-3.5"></i> Earphone`;
        btn.classList.replace('text-blue-400', 'text-emerald-400');
    }
    lucide.createIcons();
}

// ----------------------------------------------------
// 5. AUDIT REPORTS & BANK EXPORT
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
            tbody.innerHTML = `<tr><td colspan="8" class="py-6 text-center text-slate-500">No calls logged on ${date}.</td></tr>`;
            return;
        }

        tbody.innerHTML = records.map(r => `
            <tr class="hover:bg-slate-800/40">
                <td class="py-2.5 px-4 text-slate-400 font-mono text-[11px]">${r.called_at.slice(11, 19)}</td>
                <td class="py-2.5 px-4 font-bold text-white font-mono">${r.agent_code}</td>
                <td class="py-2.5 px-4 font-mono text-slate-300">${r.loan_account_no}</td>
                <td class="py-2.5 px-4 text-slate-200 font-medium">${r.customer_name}</td>
                <td class="py-2.5 px-4 font-mono text-blue-400 font-bold">${r.dialed_phone}</td>
                <td class="py-2.5 px-4 font-mono text-slate-300">${r.call_duration_seconds}s</td>
                <td class="py-2.5 px-4">
                    <span class="px-2 py-0.5 rounded text-[10px] font-bold ${
                        r.disposition === 'PTP' ? 'bg-emerald-500/20 text-emerald-400' :
                        r.disposition === 'RNR' ? 'bg-slate-800 text-slate-300' :
                        r.disposition === 'WRONG_NUMBER' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-300'
                    }">${r.disposition}</span>
                </td>
                <td class="py-2.5 px-4 font-mono text-amber-400 font-bold">${r.ptp_amount ? '₹' + Number(r.ptp_amount).toLocaleString() : '-'}</td>
            </tr>
        `).join('');
    } catch (err) {
        console.warn('Reports load fallback:', err);
    }
}

function downloadCsvReport() {
    const date = document.getElementById('report-date')?.value || new Date().toISOString().slice(0, 10);
    window.location.href = `/api/reports/export?date=${date}&format=csv`;
}
