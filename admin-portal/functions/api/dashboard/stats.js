// Cloudflare Pages Function: Live Recovery Analytics & Dashboard KPIs
export async function onRequestGet(context) {
    const { env } = context;
    try {
        if (env.DB) {
            // 1. Core KPIs for Today
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

            // 2. Active Agents Count (Heartbeat within last 5 minutes)
            const activeAgents = await env.DB.prepare(
                `SELECT 
                    COUNT(id) as total_agents,
                    SUM(CASE WHEN status = 'ACTIVE' AND datetime(last_heartbeat) >= datetime('now', '-5 minutes') THEN 1 ELSE 0 END) as online_now,
                    SUM(CASE WHEN status = 'REVOKED' THEN 1 ELSE 0 END) as revoked_count
                 FROM agents`
            ).first();

            // 3. Disposition Breakdown Today
            const { results: dispositions } = await env.DB.prepare(
                `SELECT disposition, COUNT(id) as count 
                 FROM call_logs 
                 WHERE DATE(called_at) = DATE('now')
                 GROUP BY disposition
                 ORDER BY count DESC`
            ).all();

            // 4. Top Telecallers Leaderboard Today
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

            // 5. Overall Portfolio Status
            const portfolio = await env.DB.prepare(
                `SELECT 
                    COUNT(id) as total_cases,
                    SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending_cases,
                    SUM(CASE WHEN status = 'CALLED' THEN 1 ELSE 0 END) as called_cases,
                    SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved_cases,
                    SUM(overdue_amount) as total_overdue_pool
                 FROM allocations`
            ).first();

            return new Response(JSON.stringify({
                kpis: {
                    total_calls_today: todayKpis.total_calls_today || 0,
                    connected_calls: todayKpis.connected_calls || 0,
                    connect_rate: todayKpis.total_calls_today > 0 
                        ? Math.round((todayKpis.connected_calls / todayKpis.total_calls_today) * 100) 
                        : 0,
                    total_talk_time_minutes: Math.round((todayKpis.total_talk_time_seconds || 0) / 60),
                    total_ptp_cases: todayKpis.total_ptp_cases || 0,
                    total_ptp_amount: todayKpis.total_ptp_amount || 0,
                    online_agents: activeAgents.online_now || 0,
                    total_agents: activeAgents.total_agents || 0,
                    revoked_agents: activeAgents.revoked_count || 0,
                },
                dispositions: dispositions || [],
                leaderboard: leaderboard || [],
                portfolio: portfolio || {}
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        // Mock data for development preview
        return new Response(JSON.stringify({
            kpis: {
                total_calls_today: 1420,
                connected_calls: 864,
                connect_rate: 61,
                total_talk_time_minutes: 1820,
                total_ptp_cases: 148,
                total_ptp_amount: 874000,
                online_agents: 42,
                total_agents: 50,
                revoked_agents: 1,
            },
            dispositions: [
                { disposition: 'RNR', count: 480 },
                { disposition: 'PTP', count: 148 },
                { disposition: 'BUSY', count: 210 },
                { disposition: 'SWITCHED_OFF', count: 190 },
                { disposition: 'WRONG_NUMBER', count: 65 },
                { disposition: 'DISPUTE', count: 22 },
                { disposition: 'PAID_ONLINE', count: 18 }
            ],
            leaderboard: [
                { agent_code: 'AGT001', full_name: 'Rahul Sharma', calls_made: 265, ptp_count: 24, ptp_value: 142000, total_talk_seconds: 4800 },
                { agent_code: 'AGT004', full_name: 'Priya Patel', calls_made: 240, ptp_count: 21, ptp_value: 118000, total_talk_seconds: 4200 },
                { agent_code: 'AGT012', full_name: 'Amit Verma', calls_made: 220, ptp_count: 18, ptp_value: 95000, total_talk_seconds: 3900 }
            ],
            portfolio: {
                total_cases: 12500,
                pending_cases: 8200,
                called_cases: 3800,
                resolved_cases: 500,
                total_overdue_pool: 42500000
            }
        }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
