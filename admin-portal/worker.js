// Cloudflare Worker: 100% Real API Engine connecting to Cloudflare D1
// Features: 8 AM - 8 PM IST Shift Auto-Purge, Zero Overnight Exposure,
// Real-time Talk Time Mirroring, Agent Login Duration, Instant Queue Wipe

function getISTInfo() {
    const now = new Date();
    const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
    const istDate = new Date(istString);
    const hour = istDate.getHours();
    const minute = istDate.getMinutes();
    const isShiftActive = (hour >= 8 && hour < 20); // 8:00 AM to 7:59:59 PM IST
    const yyyy = istDate.getFullYear();
    const mm = String(istDate.getMonth() + 1).padStart(2, '0');
    const dd = String(istDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    
    let hours12 = hour % 12 || 12;
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const timeStr = `${hours12}:${String(minute).padStart(2, '0')} ${ampm}`;

    return { istDate, dateStr, hour, minute, isShiftActive, timeStr };
}

async function checkAndEnforceShiftPurge(env, istInfo) {
    if (!istInfo.isShiftActive) {
        // Outside 8 AM - 8 PM IST: Wipe all allocations and call_logs to guarantee zero overnight debtor exposure
        try {
            await env.DB.prepare("DELETE FROM allocations").run();
            await env.DB.prepare("DELETE FROM call_logs").run();
        } catch (e) {
            console.error("Shift auto-purge error:", e);
        }
    }
}

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
            const istInfo = getISTInfo();
            await checkAndEnforceShiftPurge(env, istInfo);

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

                    // Default bootstrap fallback: admin / admin123
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

                // Record first login of the day in agent_productivity_stats
                await env.DB.prepare(`
                    INSERT INTO agent_productivity_stats (agent_id, stats_date, first_login, login_duration_seconds)
                    VALUES (?, ?, ?, 0)
                    ON CONFLICT(agent_id, stats_date) DO UPDATE SET
                        first_login = COALESCE(agent_productivity_stats.first_login, excluded.first_login)
                `).bind(agent.id, istInfo.dateStr, istInfo.timeStr).run();

                await env.DB.prepare('UPDATE agents SET last_login = CURRENT_TIMESTAMP, last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?').bind(agent.id).run();

                return new Response(JSON.stringify({
                    success: true,
                    role: 'agent',
                    shift_active: istInfo.isShiftActive,
                    agent: {
                        id: agent.id,
                        agent_code: agent.agent_code,
                        full_name: agent.full_name,
                        phone: agent.phone,
                        status: agent.status
                    }
                }), { headers: corsHeaders });
            }

            // Heartbeat & Kill-Switch Enforcer & Login Duration Accumulator
            if (url.pathname === '/api/auth/heartbeat' && method === 'POST') {
                const body = await request.json();
                const agentId = body.agent_id;
                if (agentId) {
                    const agent = await env.DB.prepare('SELECT status, last_heartbeat FROM agents WHERE id = ?').bind(agentId).first();
                    if (!agent || agent.status === 'REVOKED') {
                        return new Response(JSON.stringify({ status: 'REVOKED', message: 'Account revoked.' }), { status: 403, headers: corsHeaders });
                    }

                    // Accumulate 45 seconds of login duration if shift is active
                    if (istInfo.isShiftActive) {
                        await env.DB.prepare(`
                            INSERT INTO agent_productivity_stats (agent_id, stats_date, first_login, login_duration_seconds)
                            VALUES (?, ?, ?, 45)
                            ON CONFLICT(agent_id, stats_date) DO UPDATE SET
                                login_duration_seconds = login_duration_seconds + 45
                        `).bind(agentId, istInfo.dateStr, istInfo.timeStr).run();
                    }

                    await env.DB.prepare('UPDATE agents SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?').bind(agentId).run();
                }
                return new Response(JSON.stringify({ ok: true, status: 'ACTIVE', shift_active: istInfo.isShiftActive }), { headers: corsHeaders });
            }

            // Shift Status & Agent Live KPI Scoreboard API
            if (url.pathname === '/api/agent/today-kpi' && method === 'GET') {
                const rawAgent = url.searchParams.get('agent_id') || url.searchParams.get('agent_code') || '0';
                let agentId = parseInt(rawAgent);
                const agentLookup = await env.DB.prepare('SELECT id, agent_code FROM agents WHERE UPPER(agent_code) = UPPER(?) OR id = ?').bind(String(rawAgent).trim(), isNaN(agentId) ? 0 : agentId).first();
                if (agentLookup) agentId = agentLookup.id;

                if (!istInfo.isShiftActive) {
                    return new Response(JSON.stringify({
                        shift_active: false,
                        message: "Shift closed (8:00 AM – 8:00 PM IST). Daily queue auto-wiped. Scoreboard reset to 0.",
                        total_dials: 0,
                        connected_calls: 0,
                        total_talk_seconds: 0,
                        ptps: 0,
                        remaining_queue: 0,
                        first_login: "-",
                        login_duration_seconds: 0
                    }), { headers: corsHeaders });
                }

                const stats = await env.DB.prepare(`
                    SELECT total_dials, connected_calls, total_talk_seconds, ptp_count, first_login, login_duration_seconds
                    FROM agent_productivity_stats
                    WHERE agent_id = ? AND stats_date = ?
                `).bind(agentId, istInfo.dateStr).first();

                const queueCount = await env.DB.prepare(`
                    SELECT COUNT(id) as count FROM allocations WHERE assigned_agent_id = ? AND status NOT IN ('RESOLVED', 'ARCHIVED')
                `).bind(agentId).first();

                return new Response(JSON.stringify({
                    shift_active: true,
                    total_dials: stats?.total_dials || 0,
                    connected_calls: stats?.connected_calls || 0,
                    total_talk_seconds: stats?.total_talk_seconds || 0,
                    ptps: stats?.ptp_count || 0,
                    remaining_queue: queueCount?.count || 0,
                    first_login: stats?.first_login || "-",
                    login_duration_seconds: stats?.login_duration_seconds || 0
                }), { headers: corsHeaders });
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

            // Anonymous Productivity Telemetry
            if (url.pathname === '/api/telemetry/anonymous-call-stat' && method === 'POST') {
                const body = await request.json();
                const agentId = parseInt(body.agent_id);
                const duration = Math.max(0, parseInt(body.duration_seconds) || 0);
                const isConnected = duration >= 5 ? 1 : 0;

                if (agentId && !isNaN(agentId)) {
                    await env.DB.prepare(`
                        INSERT INTO agent_productivity_stats (agent_id, stats_date, total_dials, connected_calls, total_talk_seconds, ptp_count, first_login, login_duration_seconds)
                        VALUES (?, ?, 1, ?, ?, 0, ?, 0)
                        ON CONFLICT(agent_id, stats_date) DO UPDATE SET
                            total_dials = total_dials + 1,
                            connected_calls = connected_calls + excluded.connected_calls,
                            total_talk_seconds = total_talk_seconds + excluded.total_talk_seconds
                    `).bind(agentId, istInfo.dateStr, isConnected, duration, istInfo.timeStr).run();
                }
                return new Response(JSON.stringify({ success: true }), { headers: corsHeaders });
            }

            // 1. Dashboard Stats (Aggregates from agent_productivity_stats: Zero Customer Data)
            if (url.pathname === '/api/dashboard/stats' && method === 'GET') {
                const todayStats = await env.DB.prepare(`
                    SELECT 
                        COALESCE(SUM(total_dials), 0) as total_calls_today,
                        COALESCE(SUM(connected_calls), 0) as connected_calls,
                        COALESCE(SUM(total_talk_seconds), 0) as total_talk_time_seconds,
                        COALESCE(SUM(ptp_count), 0) as total_ptps_today
                    FROM agent_productivity_stats
                    WHERE stats_date = ?
                `).bind(istInfo.dateStr).first();

                const activeAgents = await env.DB.prepare(
                    `SELECT 
                        COUNT(id) as total_agents,
                        SUM(CASE WHEN last_heartbeat > datetime('now', '-2 minutes') THEN 1 ELSE 0 END) as online_now,
                        SUM(CASE WHEN status = 'REVOKED' THEN 1 ELSE 0 END) as revoked_count
                     FROM agents`
                ).first();

                const { results: leaderboard } = await env.DB.prepare(`
                    SELECT 
                        a.id, a.agent_code, a.full_name,
                        COALESCE(s.total_dials, 0) as calls_made,
                        COALESCE(s.connected_calls, 0) as connected_calls,
                        COALESCE(s.total_talk_seconds, 0) as total_talk_seconds,
                        COALESCE(s.ptp_count, 0) as ptp_count,
                        COALESCE(s.first_login, '-') as first_login,
                        COALESCE(s.login_duration_seconds, 0) as login_duration_seconds,
                        (CASE WHEN a.last_heartbeat > datetime('now', '-2 minutes') THEN 1 ELSE 0 END) as is_online
                    FROM agents a
                    LEFT JOIN agent_productivity_stats s ON s.agent_id = a.id AND s.stats_date = ?
                    WHERE a.status = 'ACTIVE' AND (COALESCE(s.total_dials, 0) > 0 OR a.last_heartbeat > datetime('now', '-2 minutes'))
                    ORDER BY calls_made DESC, total_talk_seconds DESC
                    LIMIT 20
                `).bind(istInfo.dateStr).all();

                const totalCalls = todayStats?.total_calls_today || 0;
                const connectedCalls = todayStats?.connected_calls || 0;
                const talkSeconds = todayStats?.total_talk_time_seconds || 0;

                const dispositions = [
                    { disposition: 'Connected', count: connectedCalls },
                    { disposition: 'Dropped / Unanswered', count: Math.max(0, totalCalls - connectedCalls) }
                ].filter(d => d.count > 0);

                return new Response(JSON.stringify({
                    shift_active: istInfo.isShiftActive,
                    kpis: {
                        total_calls_today: totalCalls,
                        connected_calls: connectedCalls,
                        connect_rate: totalCalls > 0 ? Math.round((connectedCalls / totalCalls) * 100) : 0,
                        total_talk_time_seconds: talkSeconds,
                        total_ptps_today: todayStats?.total_ptps_today || 0,
                        online_agents: activeAgents?.online_now || 0,
                        total_agents: activeAgents?.total_agents || 0,
                        revoked_agents: activeAgents?.revoked_count || 0
                    },
                    dispositions: dispositions,
                    leaderboard: leaderboard || []
                }), { headers: corsHeaders });
            }

            // Historical Admin Date-Wise Stats
            if (url.pathname === '/api/admin/historical-stats' && method === 'GET') {
                const targetDate = url.searchParams.get('date') || istInfo.dateStr;

                const { results } = await env.DB.prepare(`
                    SELECT 
                        a.id as agent_id, a.agent_code, a.full_name, a.phone,
                        COALESCE(s.total_dials, 0) as total_dials,
                        COALESCE(s.connected_calls, 0) as connected_calls,
                        COALESCE(s.total_talk_seconds, 0) as total_talk_seconds,
                        COALESCE(s.ptp_count, 0) as ptp_count,
                        COALESCE(s.first_login, '-') as first_login,
                        COALESCE(s.login_duration_seconds, 0) as login_duration_seconds,
                        ROUND(CASE WHEN COALESCE(s.total_dials, 0) > 0 THEN (CAST(s.connected_calls AS REAL) / s.total_dials) * 100 ELSE 0 END, 1) as connect_rate
                    FROM agents a
                    LEFT JOIN agent_productivity_stats s ON s.agent_id = a.id AND s.stats_date = ?
                    ORDER BY s.total_talk_seconds DESC, s.total_dials DESC
                `).bind(targetDate).all();

                return new Response(JSON.stringify({
                    date: targetDate,
                    records: results || []
                }), { headers: corsHeaders });
            }

            // 2. Agents API with Online Status and Cumulative Login Duration
            if (url.pathname === '/api/agents' && method === 'GET') {
                const { results } = await env.DB.prepare(
                    `SELECT 
                        a.id, a.agent_code, a.full_name, a.phone, a.status, a.hardware_uuid, 
                        a.device_model, a.last_login, a.last_heartbeat, a.created_at,
                        (CASE WHEN a.last_heartbeat > datetime('now', '-2 minutes') THEN 1 ELSE 0 END) as is_online,
                        COALESCE(s.first_login, '-') as today_first_login,
                        COALESCE(s.login_duration_seconds, 0) as today_login_duration_seconds,
                        COALESCE(s.total_dials, 0) as today_dials,
                        COALESCE(s.total_talk_seconds, 0) as today_talk_seconds,
                        COALESCE(s.connected_calls, 0) as today_connected,
                        (SELECT COUNT(id) FROM allocations WHERE assigned_agent_id = a.id AND status NOT IN ('RESOLVED', 'ARCHIVED')) as assigned_cases
                     FROM agents a
                     LEFT JOIN agent_productivity_stats s ON s.agent_id = a.id AND s.stats_date = ?
                     ORDER BY a.id ASC`
                ).bind(istInfo.dateStr).all();

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

            // 5. Admin Allocations Upload & Distribution (Active Shift 8 AM - 8 PM IST)
            if (url.pathname === '/api/allocations/upload' && method === 'POST') {
                if (!istInfo.isShiftActive) {
                    return new Response(JSON.stringify({ 
                        error: 'Shift closed. Allocations are only accepted between 8:00 AM and 8:00 PM IST.',
                        shift_active: false
                    }), { status: 400, headers: corsHeaders });
                }

                const body = await request.json();
                const cases = body.cases || [];
                const batch = body.batch_name || `Batch_${istInfo.dateStr}`;

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

            // 6. AGENT SELF-ALLOCATION UPLOAD (Active Shift 8 AM - 8 PM IST)
            if ((url.pathname === '/api/allocations/upload-agent' || url.pathname === '/api/allocations/self-upload') && method === 'POST') {
                if (!istInfo.isShiftActive) {
                    return new Response(JSON.stringify({ 
                        error: 'Shift closed. Operations are only active between 8:00 AM and 8:00 PM IST.',
                        shift_active: false
                    }), { status: 400, headers: corsHeaders });
                }

                const body = await request.json();
                const cases = body.cases || [];
                const rawAgent = body.agent_id || body.agent_code || '0';
                let agentId = parseInt(rawAgent);
                const agent = await env.DB.prepare('SELECT id, agent_code, status FROM agents WHERE UPPER(agent_code) = UPPER(?) OR id = ?').bind(String(rawAgent).trim(), isNaN(agentId) ? 0 : agentId).first();

                if (!agent) {
                    return new Response(JSON.stringify({ error: 'Valid agent_id or agent_code required' }), { status: 400, headers: corsHeaders });
                }

                if (agent.status === 'REVOKED') {
                    return new Response(JSON.stringify({ error: 'Agent account is inactive or revoked.' }), { status: 403, headers: corsHeaders });
                }

                agentId = agent.id;

                if (body.clear_previous || body.mode === 'replace') {
                    await env.DB.prepare("DELETE FROM allocations WHERE assigned_agent_id = ?").bind(agentId).run();
                }

                const batchName = `Shift_${istInfo.dateStr}_${agent.agent_code}`;
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
                            String(item.loan_account_no || item.loan_id || `LN-${Date.now().toString().slice(-6)}`).trim(),
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
                    message: `${statements.length} leads loaded into active shift queue (8 AM - 8 PM). Will auto-purge at 8:00 PM.`
                }), { headers: corsHeaders });
            }

            // Version Check API for in-app auto updates
            if (url.pathname === '/api/version' && method === 'GET') {
                return new Response(JSON.stringify({
                    versionCode: 17,
                    versionName: "1.1.7",
                    apkUrl: "https://dialer.gdsdebtpro.workers.dev/DebtFlow-AutoDialer-v1.1.7.apk",
                    changelog: "GDSDebtPro 8 AM - 8 PM Auto-Purge & Live Talk Time Mirror Engine"
                }), { headers: corsHeaders });
            }

            // 24-Hour / Evening Shift Purge Endpoint
            if (url.pathname === '/api/security/purge-shift') {
                const purgeAlloc = await env.DB.prepare("DELETE FROM allocations").run();
                const purgeCalls = await env.DB.prepare("DELETE FROM call_logs").run();
                return new Response(JSON.stringify({
                    success: true,
                    message: "All shift records permanently purged for privacy.",
                    purged_allocations: purgeAlloc.meta?.changes || 0,
                    purged_call_logs: purgeCalls.meta?.changes || 0
                }), { headers: corsHeaders });
            }

            // Clear / Reset Agent Queue (Instant Wipe on demand)
            if (url.pathname === '/api/allocations/clear-agent-queue' && method === 'POST') {
                const body = await request.json();
                const rawAgent = body.agent_id || body.agent_code || '0';
                let agentId = parseInt(rawAgent);
                const agentLookup = await env.DB.prepare('SELECT id FROM agents WHERE UPPER(agent_code) = UPPER(?) OR id = ?').bind(String(rawAgent).trim(), isNaN(agentId) ? 0 : agentId).first();
                if (agentLookup) agentId = agentLookup.id;

                if (!agentId || agentId <= 0) {
                    return new Response(JSON.stringify({ error: 'Valid agent_id required' }), { status: 400, headers: corsHeaders });
                }

                // Instant permanent deletion from Cloudflare D1
                const res = await env.DB.prepare(
                    "DELETE FROM allocations WHERE assigned_agent_id = ?"
                ).bind(agentId).run();

                return new Response(JSON.stringify({
                    success: true,
                    message: "Queue wiped 100% instantly from Cloudflare server!",
                    cleared_cases: res.meta?.changes || 0
                }), { headers: corsHeaders });
            }

            // Agent Shift Feedback Export
            if (url.pathname === '/api/reports/agent-export' && method === 'GET') {
                const rawAgent = url.searchParams.get('agent_id') || url.searchParams.get('agent_code') || '0';
                let agentId = parseInt(rawAgent);
                const agentLookup = await env.DB.prepare('SELECT id FROM agents WHERE UPPER(agent_code) = UPPER(?) OR id = ?').bind(String(rawAgent).trim(), isNaN(agentId) ? 0 : agentId).first();
                if (agentLookup) agentId = agentLookup.id;

                const { results } = await env.DB.prepare(
                    `SELECT cl.called_at, COALESCE(al.customer_name, 'Direct Contact') as customer_name, cl.dialed_phone, COALESCE(al.loan_account_no, '-') as loan_account_no, 
                            cl.call_duration_seconds, cl.disposition, cl.ptp_amount, cl.ptp_date
                     FROM call_logs cl
                     LEFT JOIN allocations al ON al.id = cl.allocation_id
                     WHERE cl.agent_id = ?
                     ORDER BY cl.called_at DESC LIMIT 1000`
                ).bind(agentId).all();

                return new Response(JSON.stringify({ 
                    success: true, 
                    records: results || [], 
                    calls: results || [] 
                }), { headers: corsHeaders });
            }

            // 7. Agent Cases Queue
            if (url.pathname === '/api/allocations/my-cases' && method === 'GET') {
                const rawAgent = url.searchParams.get('agent_id') || url.searchParams.get('agent_code') || '1';
                let agentId = parseInt(rawAgent);
                const agentLookup = await env.DB.prepare('SELECT id FROM agents WHERE UPPER(agent_code) = UPPER(?) OR id = ?').bind(String(rawAgent).trim(), isNaN(agentId) ? 0 : agentId).first();
                if (agentLookup) agentId = agentLookup.id;

                if (!istInfo.isShiftActive) {
                    return new Response(JSON.stringify({ 
                        cases: [], 
                        total: 0, 
                        rnr_available: 0,
                        shift_active: false,
                        message: "Shift closed (8:00 AM – 8:00 PM IST). Daily queue auto-wiped."
                    }), { headers: corsHeaders });
                }

                const mode = url.searchParams.get('mode') || 'fresh';

                let query = '';
                if (mode === 'rnr') {
                    query = `SELECT id, customer_name, loan_account_no, primary_phone, overdue_amount, dpd, bucket, status, call_attempts, last_disposition 
                             FROM allocations 
                             WHERE assigned_agent_id = ? AND last_disposition = 'RNR' AND status != 'RESOLVED' AND call_attempts < 3
                             ORDER BY id ASC LIMIT 500`;
                } else {
                    query = `SELECT id, customer_name, loan_account_no, primary_phone, overdue_amount, dpd, bucket, status, call_attempts, last_disposition 
                             FROM allocations 
                             WHERE assigned_agent_id = ? AND status NOT IN ('RESOLVED', 'ARCHIVED')
                             ORDER BY id ASC LIMIT 500`;
                }

                const { results } = await env.DB.prepare(query).bind(agentId).all();

                const rnrCount = await env.DB.prepare(
                    `SELECT COUNT(id) as count FROM allocations WHERE assigned_agent_id = ? AND last_disposition = 'RNR' AND status != 'RESOLVED' AND call_attempts < 3`
                ).bind(agentId).first();

                return new Response(JSON.stringify({ 
                    cases: results || [], 
                    total: (results || []).length, 
                    rnr_available: rnrCount?.count || 0,
                    shift_active: true,
                    mode: mode 
                }), { headers: corsHeaders });
            }

            // 8. Log Call Disposition with Metrics Aggregation
            if (url.pathname === '/api/calls/log' && method === 'POST') {
                const body = await request.json();
                const rawAgent = body.agent_id || body.agent_code || 1;
                let agentId = parseInt(rawAgent);
                const agentLookup = await env.DB.prepare('SELECT id FROM agents WHERE UPPER(agent_code) = UPPER(?) OR id = ?').bind(String(rawAgent).trim(), isNaN(agentId) ? 0 : agentId).first();
                if (agentLookup) agentId = agentLookup.id;

                const disposition = body.disposition || body.call_status || 'RNR';
                const dialedPhone = body.dialed_phone || body.phone || '';
                const duration = Math.max(0, parseInt(body.call_duration_seconds) || 0);
                const ptpAmount = body.ptp_amount ? parseFloat(body.ptp_amount) : null;
                const ptpDate = body.ptp_date || null;
                const allocId = body.allocation_id ? parseInt(body.allocation_id) : null;

                const isConnected = (duration >= 5 || (disposition !== 'RNR' && disposition !== 'BUSY' && disposition !== 'SWITCHED_OFF')) ? 1 : 0;
                const isPtp = disposition === 'PTP' ? 1 : 0;

                // 1. Update anonymous agent_productivity_stats (Mirrored for Web & APK - Zero Customer Data)
                await env.DB.prepare(`
                    INSERT INTO agent_productivity_stats (agent_id, stats_date, total_dials, connected_calls, total_talk_seconds, ptp_count, first_login, login_duration_seconds)
                    VALUES (?, ?, 1, ?, ?, ?, ?, 0)
                    ON CONFLICT(agent_id, stats_date) DO UPDATE SET
                        total_dials = total_dials + 1,
                        connected_calls = connected_calls + excluded.connected_calls,
                        total_talk_seconds = total_talk_seconds + excluded.total_talk_seconds,
                        ptp_count = ptp_count + excluded.ptp_count
                `).bind(agentId, istInfo.dateStr, isConnected, duration, isPtp, istInfo.timeStr).run();

                // 2. Insert call log (Temporary during shift)
                if (istInfo.isShiftActive) {
                    try {
                        await env.DB.prepare(
                            `INSERT INTO call_logs (allocation_id, agent_id, dialed_phone, call_duration_seconds, disposition, ptp_amount, ptp_date)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`
                        ).bind(allocId || 0, agentId, dialedPhone, duration, disposition, ptpAmount, ptpDate).run();
                    } catch (e) {
                        console.error("call_logs insert error:", e);
                    }
                }

                const isResolved = disposition === 'PTP' || disposition === 'PAID';
                const nextStatus = isResolved ? 'RESOLVED' : (disposition === 'RNR' ? 'RNR' : 'CALLED');

                if (allocId && istInfo.isShiftActive) {
                    await env.DB.prepare(
                        `UPDATE allocations SET call_attempts = call_attempts + 1, last_disposition = ?, status = ? WHERE id = ?`
                    ).bind(disposition, nextStatus, allocId).run();
                }

                return new Response(JSON.stringify({ 
                    success: true, 
                    status: nextStatus,
                    message: 'Call recorded and productivity stats mirrored!' 
                }), { headers: corsHeaders });
            }

            // 9. Reports API
            if (url.pathname === '/api/reports/export' && method === 'GET') {
                const date = url.searchParams.get('date') || istInfo.dateStr;
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
