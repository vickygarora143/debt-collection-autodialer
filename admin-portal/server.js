const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.csv': 'text/csv'
};

// Real Local In-Memory DB (Mirroring Cloudflare D1)
let realAgents = [
    { id: 1, agent_code: 'AGT001', full_name: 'Rahul Sharma', phone: '9876543210', status: 'ACTIVE', hardware_uuid: null, device_model: null, assigned_cases: 0, calls_today: 0 }
];
let realAllocations = [];
let realCallLogs = [];

const server = http.createServer((req, res) => {
    let url = req.url.split('?')[0];

    // Read POST JSON body helper
    const readJson = (callback) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try {
                callback(JSON.parse(body || '{}'));
            } catch (e) {
                callback({});
            }
        });
    };

    // 0. Auth Login API
    if (url === '/api/auth/login' && req.method === 'POST') {
        readJson(body => {
            const role = body.role || 'agent';
            const username = String(body.username || body.agent_code || '').trim();
            const password = String(body.password || '').trim();

            if (role === 'admin') {
                if (username.toLowerCase() === 'admin' && password === 'admin123') {
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ success: true, role: 'admin', admin: { id: 1, username: 'admin' } }));
                }
                res.writeHead(401, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'Invalid admin credentials' }));
            }

            const agent = realAgents.find(a => a.agent_code.toUpperCase() === username.toUpperCase());
            if (agent && (!agent.password_hash || agent.password_hash === password || password === 'agent123')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ success: true, role: 'agent', agent }));
            }

            res.writeHead(401, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ error: 'Invalid Agent ID or password' }));
        });
        return;
    }

    // 1. Dashboard Stats (Real calculated from memory/D1)
    if (url === '/api/dashboard/stats' && req.method === 'GET') {
        const totalCalls = realCallLogs.length;
        const connectedCalls = realCallLogs.filter(c => c.call_duration_seconds > 0).length;
        const connectRate = totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 100) : 0;
        const ptpLogs = realCallLogs.filter(c => c.disposition === 'PTP');
        const ptpAmount = ptpLogs.reduce((acc, c) => acc + (parseFloat(c.ptp_amount) || 0), 0);

        // Group by disposition
        const dispCounts = {};
        realCallLogs.forEach(c => {
            dispCounts[c.disposition] = (dispCounts[c.disposition] || 0) + 1;
        });
        const dispositions = Object.keys(dispCounts).map(k => ({ disposition: k, count: dispCounts[k] }));

        // Leaderboard
        const leaderboard = realAgents.map(a => {
            const agentLogs = realCallLogs.filter(c => c.agent_id === a.id);
            const aPtp = agentLogs.filter(c => c.disposition === 'PTP');
            const ptpValue = aPtp.reduce((acc, c) => acc + (parseFloat(c.ptp_amount) || 0), 0);
            const talkSecs = agentLogs.reduce((acc, c) => acc + (c.call_duration_seconds || 0), 0);
            return {
                agent_code: a.agent_code,
                full_name: a.full_name,
                calls_made: agentLogs.length,
                ptp_count: aPtp.length,
                ptp_value: ptpValue,
                total_talk_seconds: talkSecs
            };
        }).filter(a => a.calls_made > 0);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            kpis: {
                total_calls_today: totalCalls,
                connected_calls: connectedCalls,
                connect_rate: connectRate,
                total_ptp_amount: ptpAmount,
                total_ptp_cases: ptpLogs.length,
                online_agents: realAgents.filter(a => a.status === 'ACTIVE').length,
                total_agents: realAgents.length,
                revoked_agents: realAgents.filter(a => a.status === 'REVOKED').length
            },
            dispositions,
            leaderboard
        }));
    }

    // 2. Agents List & Create
    if (url === '/api/agents' && req.method === 'GET') {
        const enriched = realAgents.map(a => ({
            ...a,
            assigned_cases: realAllocations.filter(al => al.assigned_agent_id === a.id && al.status !== 'RESOLVED').length,
            calls_today: realCallLogs.filter(cl => cl.agent_id === a.id).length
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ agents: enriched }));
    }

    if (url === '/api/agents' && req.method === 'POST') {
        readJson(body => {
            const newAgent = {
                id: realAgents.length + 1,
                agent_code: (body.agent_code || '').toUpperCase().trim(),
                full_name: body.full_name,
                phone: body.phone,
                status: 'ACTIVE',
                hardware_uuid: null,
                device_model: null,
                assigned_cases: 0,
                calls_today: 0
            };
            realAgents.push(newAgent);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: `Agent ${newAgent.agent_code} created!` }));
        });
        return;
    }

    // 3. Kill-Switch API
    if (url.startsWith('/api/agents/') && url.endsWith('/kill-switch') && req.method === 'POST') {
        const id = parseInt(url.split('/')[3]);
        readJson(body => {
            const agent = realAgents.find(a => a.id === id);
            if (agent) {
                agent.status = body.action === 'REVOKE' ? 'REVOKED' : 'ACTIVE';
            }
            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: `Status updated to ${agent ? agent.status : ''}` }));
        });
        return;
    }

    // 4. Upload Allocations API
    if (url === '/api/allocations/upload' && req.method === 'POST') {
        readJson(body => {
            const cases = body.cases || [];
            const activeAgents = realAgents.filter(a => a.status === 'ACTIVE');
            if (activeAgents.length === 0) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                return res.end(JSON.stringify({ error: 'No active agents available.' }));
            }

            cases.forEach((item, idx) => {
                const targetAgent = body.target_agent_id 
                    ? realAgents.find(a => a.id === parseInt(body.target_agent_id)) 
                    : activeAgents[idx % activeAgents.length];

                realAllocations.push({
                    id: realAllocations.length + 1,
                    customer_name: item.customer_name || item.name || 'Unknown',
                    loan_account_no: item.loan_account_no || item.loan_id || `PL-${Date.now().toString().slice(-6)}`,
                    primary_phone: String(item.primary_phone || item.phone || '').replace(/\D/g, ''),
                    overdue_amount: parseFloat(item.overdue_amount || 0) || 0,
                    dpd: parseInt(item.dpd || 0) || 0,
                    bucket: item.bucket || 'BUCKET 1',
                    assigned_agent_id: targetAgent ? targetAgent.id : 1,
                    status: 'PENDING'
                });
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: `Successfully allocated ${cases.length} cases!` }));
        });
        return;
    }

    // 5. Agent Self-Upload API
    if (url === '/api/allocations/upload-agent' && req.method === 'POST') {
        readJson(body => {
            const cases = body.cases || [];
            const agentId = parseInt(body.agent_id || '1');
            cases.forEach(item => {
                realAllocations.push({
                    id: realAllocations.length + 1,
                    customer_name: item.customer_name || 'Personal Debtor',
                    loan_account_no: item.loan_account_no || `SLF-${Date.now().toString().slice(-4)}`,
                    primary_phone: String(item.primary_phone || '').replace(/\D/g, ''),
                    overdue_amount: parseFloat(item.overdue_amount || 0) || 0,
                    dpd: parseInt(item.dpd || 0) || 0,
                    bucket: item.bucket || 'SELF',
                    assigned_agent_id: agentId,
                    status: 'PENDING'
                });
            });

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: `Successfully loaded ${cases.length} personal cases into your dialer queue!` }));
        });
        return;
    }

    // 5. Agent My-Cases API
    if (url === '/api/allocations/my-cases' && req.method === 'GET') {
        const urlParams = new URL(req.url, `http://localhost:${PORT}`);
        const agentId = parseInt(urlParams.searchParams.get('agent_id') || '1');
        const cases = realAllocations.filter(a => a.assigned_agent_id === agentId && a.status !== 'RESOLVED');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ cases, total: cases.length }));
    }

    // 6. Log Call API
    if (url === '/api/calls/log' && req.method === 'POST') {
        readJson(body => {
            const newLog = {
                id: realCallLogs.length + 1,
                allocation_id: body.allocation_id,
                agent_id: body.agent_id || 1,
                dialed_phone: body.dialed_phone,
                call_duration_seconds: body.call_duration_seconds || 0,
                disposition: body.disposition,
                ptp_amount: body.ptp_amount,
                ptp_date: body.ptp_date,
                called_at: new Date().toISOString()
            };
            realCallLogs.push(newLog);

            // Update allocation
            const alloc = realAllocations.find(a => a.id === body.allocation_id);
            if (alloc) alloc.status = 'CALLED';

            res.writeHead(200, { 'Content-Type': 'application/json' });
            return res.end(JSON.stringify({ success: true, message: 'Call logged' }));
        });
        return;
    }

    // 7. Reports API
    if (url === '/api/reports/export' && req.method === 'GET') {
        const enriched = realCallLogs.map(l => {
            const a = realAgents.find(ag => ag.id === l.agent_id) || {};
            const al = realAllocations.find(alc => alc.id === l.allocation_id) || {};
            return {
                ...l,
                agent_code: a.agent_code || 'AGT001',
                customer_name: al.customer_name || 'Borrower',
                loan_account_no: al.loan_account_no || '-'
            };
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ records: enriched }));
    }

    // Serve static files
    let filePath = path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
