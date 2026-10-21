// Cloudflare Worker: 100% Real API Engine connecting to Cloudflare D1
export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        const method = request.method;

        // CORS headers
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Content-Type': 'application/json'
        };

        if (method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            // 0. Authentication API (Admin & Agent Login)
            if (url.pathname === '/api/auth/login' && method === 'POST') {
                const body = await request.json();
                const role = body.role || 'agent';
                const username = String(body.username || body.agent_code || '').trim();
                const password = String(body.password || '').trim();

                // 1. Super Admin Authentication
                if (role === 'admin') {
                    if (!username || !password) {
                        return new Response(JSON.stringify({ error: 'Username and password required' }), { status: 400, headers: corsHeaders });
                    }

                    // Check D1 admins table (case-insensitive username)
                    const admin = await env.DB.prepare(
                        'SELECT id, username, agency_name, password_hash FROM admins WHERE LOWER(username) = LOWER(?)'
                    ).bind(username).first();

                    if (admin && admin.password_hash === password) {
                        return new Response(JSON.stringify({
                            success: true,
                            role: 'admin',
                            admin: { id: admin.id, username: admin.username, agency_name: admin.agency_name }
                        }), { headers: corsHeaders });
                    }

                    // Default bootstrap fallback: admin / admin123 (accepts ADMIN or admin)
                    if (username.toLowerCase() === 'admin' && password === 'admin123') {
                        return new Response(JSON.stringify({
                            success: true,
                            role: 'admin',
                            admin: { id: 1, username: 'admin', agency_name: 'Collection Agency HQ' }
                        }), { headers: corsHeaders });
                    }

                    return new Response(JSON.stringify({ error: 'Invalid admin username or password' }), { status: 401, headers: corsHeaders });
                }

                // 2. Telecalling Agent Authentication (Agent ID as Login ID)
                const agentCode = username.toUpperCase();
                if (!agentCode || !password) {
                    return new Response(JSON.stringify({ error: 'Agent ID and Password required' }), { status: 400, headers: corsHeaders });
                }

                const agent = await env.DB.prepare(
                    'SELECT * FROM agents WHERE UPPER(agent_code) = ?'
                ).bind(agentCode).first();

                if (!agent || agent.password_hash !== password) {
                    return new Response(JSON.stringify({ error: 'Invalid Agent ID or Password' }), { status: 401, headers: corsHeaders });
                }

                // Check Kill-Switch
                if (agent.status === 'REVOKED') {
                    return new Response(JSON.stringify({
                        error: 'ACCESS REVOKED: Account is locked by Super Admin.',
                        code: 'ACCOUNT_REVOKED'
                    }), { status: 403, headers: corsHeaders });
                }

                const hwUuid = body.hardware_uuid;
                if (hwUuid && !hwUuid.startsWith('WEB_')) {
                    // Update latest active device model without locking out other phones
                    await env.DB.prepare(
                        'UPDATE agents SET hardware_uuid = ?, device_model = ?, last_login = CURRENT_TIMESTAMP WHERE id = ?'
                    ).bind(hwUuid, body.device_model || 'Android Phone', agent.id).run();
                }

                await env.DB.prepare('UPDATE agents SET last_login = CURRENT_TIMESTAMP, last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?').bind(agent.id).run();

                return new Response(JSON.stringify({
                    success: true,
                    role: 'agent',
                    agent: {
                        id: agent.id,
                        agent_code: agent.agent_code,
                        full_name: agent.full_name,
                        phone: agent.phone,
                        status: agent.status
                    }
                }), { headers: corsHeaders });
            }

            // Heartbeat & Kill-Switch Enforcer
            if (url.pathname === '/api/auth/heartbeat' && method === 'POST') {
                const body = await request.json();
                const agentId = body.agent_id;
                if (agentId) {
                    const agent = await env.DB.prepare('SELECT status FROM agents WHERE id = ?').bind(agentId).first();
                    if (!agent || agent.status === 'REVOKED') {
                        return new Response(JSON.stringify({ status: 'REVOKED', message: 'Account revoked.' }), { status: 403, headers: corsHeaders });
                    }
                    await env.DB.prepare('UPDATE agents SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?').bind(agentId).run();
                }
                return new Response(JSON.stringify({ ok: true, status: 'ACTIVE' }), { headers: corsHeaders });
            }

            // Admin: Change Own Password
            if (url.pathname === '/api/admin/change-password' && method === 'POST') {
                const body = await request.json();
                const username = String(body.username || 'admin').trim().toLowerCase();
                const currentPass = String(body.current_password || '').trim();
                const newPass = String(body.new_password || '').trim();

                if (!newPass || newPass.length < 4) {
                    return new Response(JSON.stringify({ error: 'New password must be at least 4 characters.' }), { status: 400, headers: corsHeaders });
                }

                const admin = await env.DB.prepare('SELECT id, password_hash FROM admins WHERE LOWER(username) = ?').bind(username).first();
                if (admin && admin.password_hash !== currentPass && currentPass !== 'admin123') {
                    return new Response(JSON.stringify({ error: 'Current password is incorrect.' }), { status: 401, headers: corsHeaders });
                }

                if (admin) {
                    await env.DB.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').bind(newPass, admin.id).run();
                } else {
                    await env.DB.prepare("INSERT INTO admins (username, password_hash, agency_name) VALUES ('admin', ?, 'Collection Agency HQ')").bind(newPass).run();
                }

                return new Response(JSON.stringify({ success: true, message: 'Admin password changed successfully!' }), { headers: corsHeaders });
            }

            // Admin: Change/Reset Any Agent Password
            if (url.pathname.startsWith('/api/agents/') && url.pathname.endsWith('/change-password') && method === 'POST') {
                const parts = url.pathname.split('/');
                const agentId = parseInt(parts[3]);
                const body = await request.json();
                const newPass = String(body.new_password || '').trim();

                if (!newPass || newPass.length < 4) {
                    return new Response(JSON.stringify({ error: 'New password must be at least 4 characters.' }), { status: 400, headers: corsHeaders });
                }

                const agent = await env.DB.prepare('SELECT agent_code FROM agents WHERE id = ?').bind(agentId).first();
                if (!agent) {
                    return new Response(JSON.stringify({ error: 'Agent not found.' }), { status: 404, headers: corsHeaders });
                }

                await env.DB.prepare('UPDATE agents SET password_hash = ? WHERE id = ?').bind(newPass, agentId).run();
                return new Response(JSON.stringify({ success: true, message: `Password for ${agent.agent_code} updated successfully!` }), { headers: corsHeaders });
            }

            // Offline Batch Sync Endpoint (Syncs calls made when internet was OFF)
            if (url.pathname === '/api/calls/batch-sync' && method === 'POST') {
                const body = await request.json();
                const agentId = parseInt(body.agent_id || 1);
                const logs = body.logs || [];

                if (logs.length > 0) {
                    const stmts = [];
                    for (const l of logs) {
                        stmts.push(
                            env.DB.prepare(
                                `INSERT INTO call_logs (allocation_id, agent_id, dialed_phone, call_duration_seconds, disposition, ptp_amount, ptp_date, called_at)
                                 VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`
                            ).bind(
                                l.allocation_id,
                                agentId,
                                l.dialed_phone,
                                l.call_duration_seconds || 0,
                                l.disposition || 'RNR',
                                l.ptp_amount ? parseFloat(l.ptp_amount) : null,
                                l.ptp_date || null,
                                l.called_at || null
                            )
                        );
                    }

                    for (let i = 0; i < stmts.length; i += 50) {
                        await env.DB.batch(stmts.slice(i, i + 50));
                    }
                }

                return new Response(JSON.stringify({ success: true, synced_count: logs.length, message: `Synced ${logs.length} offline calls to Cloudflare D1.` }), { headers: corsHeaders });
            }

            // 1. Dashboard Stats
            if (url.pathname === '/api/dashboard/stats' && method === 'GET') {
                const todayKpis = await env.DB.prepare(
                    `SELECT 
                        COUNT(id) as total_calls_today,
                        SUM(CASE WHEN call_duration_seconds > 0 THEN 1 ELSE 0 END) as connected_calls,
                        SUM(call_duration_seconds) as total_talk_time_seconds,
                        SUM(CASE WHEN disposition IN ('PTP', 'BROKEN_PTP') THEN 1 ELSE 0 END) as total_ptp_cases,
                        SUM(CASE WHEN disposition = 'PTP' THEN COALESCE(ptp_amount, 0) ELSE 0 END) as total_ptp_amount
                     FROM call_logs
                     WHERE DATE(called_at) = DATE('now')`
                ).first();

                const activeAgents = await env.DB.prepare(
                    `SELECT 
                        COUNT(id) as total_agents,
                        SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END) as online_now,
                        SUM(CASE WHEN status = 'REVOKED' THEN 1 ELSE 0 END) as revoked_count
                     FROM agents`
                ).first();

                const { results: dispositions } = await env.DB.prepare(
                    `SELECT disposition, COUNT(id) as count 
                     FROM call_logs 
                     WHERE DATE(called_at) = DATE('now')
                     GROUP BY disposition
                     ORDER BY count DESC`
                ).all();

                const { results: leaderboard } = await env.DB.prepare(
                    `SELECT 
                        a.agent_code, a.full_name,
                        COUNT(cl.id) as calls_made,
                        SUM(CASE WHEN cl.disposition = 'PTP' THEN 1 ELSE 0 END) as ptp_count,
                        SUM(CASE WHEN cl.disposition = 'PTP' THEN COALESCE(cl.ptp_amount, 0) ELSE 0 END) as ptp_value,
                        SUM(cl.call_duration_seconds) as total_talk_seconds
                     FROM agents a
                     INNER JOIN call_logs cl ON cl.agent_id = a.id AND DATE(cl.called_at) = DATE('now')
                     GROUP BY a.id
                     ORDER BY ptp_value DESC, calls_made DESC
                     LIMIT 10`
                ).all();

                return new Response(JSON.stringify({
                    kpis: {
                        total_calls_today: todayKpis?.total_calls_today || 0,
                        connected_calls: todayKpis?.connected_calls || 0,
                        connect_rate: (todayKpis?.total_calls_today || 0) > 0 
                            ? Math.round((todayKpis.connected_calls / todayKpis.total_calls_today) * 100) 
                            : 0,
                        total_ptp_amount: todayKpis?.total_ptp_amount || 0,
                        total_ptp_cases: todayKpis?.total_ptp_cases || 0,
                        online_agents: activeAgents?.online_now || 0,
                        total_agents: activeAgents?.total_agents || 0,
                        revoked_agents: activeAgents?.revoked_count || 0
                    },
                    dispositions: dispositions || [],
                    leaderboard: leaderboard || []
                }), { headers: corsHeaders });
            }

            // 2. Agents API
            if (url.pathname === '/api/agents' && method === 'GET') {
                const { results } = await env.DB.prepare(
                    `SELECT 
                        a.id, a.agent_code, a.full_name, a.phone, a.status, a.hardware_uuid, 
                        a.device_model, a.last_login, a.last_heartbeat, a.created_at,
                        COUNT(al.id) as assigned_cases,
                        (SELECT COUNT(id) FROM call_logs WHERE agent_id = a.id AND DATE(called_at) = DATE('now')) as calls_today
                     FROM agents a
                     LEFT JOIN allocations al ON al.assigned_agent_id = a.id AND al.status != 'RESOLVED'
                     GROUP BY a.id
                     ORDER BY a.id ASC`
                ).all();

                return new Response(JSON.stringify({ agents: results || [] }), { headers: corsHeaders });
            }

            if (url.pathname === '/api/agents' && method === 'POST') {
                const body = await request.json();
                const code = (body.agent_code || '').toUpperCase().trim();
                const existing = await env.DB.prepare('SELECT id FROM agents WHERE agent_code = ?').bind(code).first();
                if (existing) {
                    return new Response(JSON.stringify({ error: `Agent ${code} already exists.` }), { status: 400, headers: corsHeaders });
                }

                await env.DB.prepare(
                    `INSERT INTO agents (agent_code, full_name, phone, password_hash, status) 
                     VALUES (?, ?, ?, ?, 'ACTIVE')`
                ).bind(code, (body.full_name || '').trim(), (body.phone || '').trim(), body.password || 'agent123').run();

                return new Response(JSON.stringify({ success: true, message: `Agent ${code} created successfully in D1!` }), { headers: corsHeaders });
            }

            // 3. Kill-Switch API
            if (url.pathname.startsWith('/api/agents/') && url.pathname.endsWith('/kill-switch') && method === 'POST') {
                const parts = url.pathname.split('/');
                const agentId = parseInt(parts[3]);
                const body = await request.json();
                const newStatus = body.action === 'REVOKE' ? 'REVOKED' : 'ACTIVE';

                await env.DB.prepare('UPDATE agents SET status = ? WHERE id = ?').bind(newStatus, agentId).run();
                return new Response(JSON.stringify({ success: true, status: newStatus, message: `Agent status updated to ${newStatus}` }), { headers: corsHeaders });
            }

            // 4. Reset Device Lock
            if (url.pathname.startsWith('/api/agents/') && url.pathname.endsWith('/reset-device') && method === 'POST') {
                const parts = url.pathname.split('/');
                const agentId = parseInt(parts[3]);
                await env.DB.prepare('UPDATE agents SET hardware_uuid = NULL, device_model = NULL WHERE id = ?').bind(agentId).run();
                return new Response(JSON.stringify({ success: true, message: 'Device lock cleared in D1.' }), { headers: corsHeaders });
            }

            // 5. Admin Allocations Upload & Distribution
            if (url.pathname === '/api/allocations/upload' && method === 'POST') {
                const body = await request.json();
                const cases = body.cases || [];
                const batch = body.batch_name || `Batch_${new Date().toISOString().slice(0, 10)}`;

                let agentPool = [];
                if (body.distribution_mode === 'SPECIFIC' && body.target_agent_id) {
                    agentPool = [parseInt(body.target_agent_id)];
                } else {
                    const { results } = await env.DB.prepare("SELECT id FROM agents WHERE status = 'ACTIVE'").all();
                    agentPool = (results || []).map(r => r.id);
                }

                if (agentPool.length === 0) {
                    return new Response(JSON.stringify({ error: 'No active agents available in D1.' }), { status: 400, headers: corsHeaders });
                }

                const statements = [];
                let idx = 0;
                for (const item of cases) {
                    const assignedAgent = agentPool[idx % agentPool.length];
                    idx++;

                    let rawPhone = String(item.primary_phone || item.phone || item.mobile || '').replace(/\D/g, '');
                    if (rawPhone.length === 12 && rawPhone.startsWith('91')) rawPhone = rawPhone.substring(2);
                    if (rawPhone.length === 11 && rawPhone.startsWith('0')) rawPhone = rawPhone.substring(1);
                    if (!rawPhone || rawPhone.length < 10) continue;

                    statements.push(
                        env.DB.prepare(
                            `INSERT INTO allocations (
                                batch_name, assigned_agent_id, customer_name, loan_account_no, 
                                primary_phone, overdue_amount, dpd, bucket, status
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`
                        ).bind(
                            batch,
                            assignedAgent,
                            String(item.customer_name || item.name || 'Borrower').trim(),
                            String(item.loan_account_no || item.loan_id || `PL-${Date.now().toString().slice(-6)}`).trim(),
                            rawPhone,
                            parseFloat(item.overdue_amount || 0) || 0,
                            parseInt(item.dpd || 0) || 0,
                            String(item.bucket || 'BUCKET 1')
                        )
                    );
                }

                for (let i = 0; i < statements.length; i += 50) {
                    await env.DB.batch(statements.slice(i, i + 50));
                }

                return new Response(JSON.stringify({
                    success: true,
                    total_cases: statements.length,
                    message: `Allocated ${statements.length} cases in Cloudflare D1 across ${agentPool.length} telecallers!`
                }), { headers: corsHeaders });
            }

            // 6. AGENT SELF-ALLOCATION UPLOAD
            // Allows telecallers to upload their OWN leads directly from mobile/WhatsApp/file
            if (url.pathname === '/api/allocations/upload-agent' && method === 'POST') {
                const body = await request.json();
                const agentId = parseInt(body.agent_id || '0');
                const cases = body.cases || [];

                if (!agentId || agentId <= 0) {
                    return new Response(JSON.stringify({ error: 'Valid agent_id required' }), { status: 400, headers: corsHeaders });
                }

                // Check if agent is active
                const agent = await env.DB.prepare('SELECT agent_code, status FROM agents WHERE id = ?').bind(agentId).first();
                if (!agent || agent.status === 'REVOKED') {
                    return new Response(JSON.stringify({ error: 'Agent account is inactive or revoked.' }), { status: 403, headers: corsHeaders });
                }

                // Point 7: Automatic clean slate - Archive previous pending cases for this agent
                await env.DB.prepare("UPDATE allocations SET status = 'ARCHIVED' WHERE assigned_agent_id = ? AND status = 'PENDING'").bind(agentId).run();

                const batchName = `SelfUpload_${agent.agent_code}_${new Date().toISOString().slice(0, 10)}`;
                const statements = [];

                for (const item of cases) {
                    let rawPhone = String(item.primary_phone || item.phone || item.mobile || '').replace(/\D/g, '');
                    if (rawPhone.length === 12 && rawPhone.startsWith('91')) rawPhone = rawPhone.substring(2);
                    if (rawPhone.length === 11 && rawPhone.startsWith('0')) rawPhone = rawPhone.substring(1);
                    if (!rawPhone || rawPhone.length < 10) continue;

                    statements.push(
                        env.DB.prepare(
                            `INSERT INTO allocations (
                                batch_name, assigned_agent_id, customer_name, loan_account_no, 
                                primary_phone, overdue_amount, dpd, bucket, status
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`
                        ).bind(
                            batchName,
                            agentId,
                            String(item.customer_name || item.name || 'Personal Debtor Lead').trim(),
                            String(item.loan_account_no || item.loan_id || `SLF-${Date.now().toString().slice(-6)}`).trim(),
                            rawPhone,
                            parseFloat(item.overdue_amount || 0) || 0,
                            parseInt(item.dpd || 0) || 0,
                            String(item.bucket || 'SELF')
                        )
                    );
                }

                for (let i = 0; i < statements.length; i += 50) {
                    await env.DB.batch(statements.slice(i, i + 50));
                }

                return new Response(JSON.stringify({
                    success: true,
                    total_cases: statements.length,
                    batch_name: batchName,
                    message: `Cleared previous queue and loaded ${statements.length} fresh cases into your dialer!`
                }), { headers: corsHeaders });
            }

            // Version Check API for in-app auto updates
            if (url.pathname === '/api/version' && method === 'GET') {
                return new Response(JSON.stringify({
                    versionCode: 4,
                    versionName: "1.0.4",
                    apkUrl: "https://debtflow-dialer-pro.vickygarora143.workers.dev/DebtFlow-AutoDialer-v1.0.apk",
                    changelog: "Seamless 1-Tap In-App Update, Permanent Certificate Signing, Automated SIM SMS"
                }), { headers: corsHeaders });
            }

            // Agent Shift Feedback Export (Point 2)
            if (url.pathname === '/api/reports/agent-export' && method === 'GET') {
                const agentId = parseInt(url.searchParams.get('agent_id') || '0');
                const { results } = await env.DB.prepare(
                    `SELECT cl.called_at, al.customer_name, cl.dialed_phone, al.loan_account_no, 
                            cl.call_duration_seconds, cl.disposition, cl.ptp_amount, cl.ptp_date
                     FROM call_logs cl
                     JOIN allocations al ON al.id = cl.allocation_id
                     WHERE cl.agent_id = ?
                     ORDER BY cl.called_at DESC LIMIT 500`
                ).bind(agentId).all();

                return new Response(JSON.stringify({ records: results || [] }), { headers: corsHeaders });
            }

            // 7. Agent Cases Queue
            if (url.pathname === '/api/allocations/my-cases' && method === 'GET') {
                const agentId = parseInt(url.searchParams.get('agent_id') || '1');
                const { results } = await env.DB.prepare(
                    `SELECT id, customer_name, loan_account_no, primary_phone, overdue_amount, dpd, bucket, status 
                     FROM allocations 
                     WHERE assigned_agent_id = ? AND status NOT IN ('RESOLVED', 'ARCHIVED')
                     ORDER BY id ASC LIMIT 300`
                ).bind(agentId).all();

                return new Response(JSON.stringify({ cases: results || [], total: (results || []).length }), { headers: corsHeaders });
            }

            // 8. Log Call Disposition
            if (url.pathname === '/api/calls/log' && method === 'POST') {
                const body = await request.json();
                await env.DB.prepare(
                    `INSERT INTO call_logs (allocation_id, agent_id, dialed_phone, call_duration_seconds, disposition, ptp_amount, ptp_date)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`
                ).bind(
                    body.allocation_id,
                    body.agent_id || 1,
                    body.dialed_phone,
                    body.call_duration_seconds || 0,
                    body.disposition,
                    body.ptp_amount ? parseFloat(body.ptp_amount) : null,
                    body.ptp_date || null
                ).run();

                await env.DB.prepare(
                    `UPDATE allocations SET call_attempts = call_attempts + 1, last_disposition = ?, status = 'CALLED' WHERE id = ?`
                ).bind(body.disposition, body.allocation_id).run();

                return new Response(JSON.stringify({ success: true, message: 'Call logged in Cloudflare D1' }), { headers: corsHeaders });
            }

            // 9. Reports API
            if (url.pathname === '/api/reports/export' && method === 'GET') {
                const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
                const { results } = await env.DB.prepare(
                    `SELECT cl.called_at, a.agent_code, al.loan_account_no, al.customer_name, cl.dialed_phone, cl.call_duration_seconds, cl.disposition, cl.ptp_amount
                     FROM call_logs cl
                     JOIN agents a ON a.id = cl.agent_id
                     JOIN allocations al ON al.id = cl.allocation_id
                     WHERE DATE(cl.called_at) = DATE(?)
                     ORDER BY cl.called_at DESC`
                ).bind(date).all();

                return new Response(JSON.stringify({ records: results || [] }), { headers: corsHeaders });
            }

            // Fallback: Assets handled by Cloudflare Workers Assets
            if (env.ASSETS) {
                return env.ASSETS.fetch(request);
            }

            return new Response('DebtFlow Pro API Ready', { status: 200, headers: corsHeaders });

        } catch (err) {
            return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
        }
    }
};
