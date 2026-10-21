// Cloudflare Pages Function: List and Create Agents
export async function onRequestGet(context) {
    const { env } = context;
    try {
        if (env.DB) {
            const { results } = await env.DB.prepare(
                `SELECT 
                    a.id, a.agent_code, a.full_name, a.phone, a.status, a.hardware_uuid, 
                    a.device_model, a.last_login, a.last_heartbeat, a.created_at,
                    COUNT(al.id) as assigned_cases,
                    SUM(CASE WHEN al.status = 'RESOLVED' THEN 1 ELSE 0 END) as resolved_cases,
                    (SELECT COUNT(id) FROM call_logs WHERE agent_id = a.id AND DATE(called_at) = DATE('now')) as calls_today
                 FROM agents a
                 LEFT JOIN allocations al ON al.assigned_agent_id = a.id
                 GROUP BY a.id
                 ORDER BY a.id ASC`
            ).all();

            return new Response(JSON.stringify({ agents: results || [] }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(JSON.stringify({ agents: [] }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const body = await request.json();
        const { agent_code, full_name, phone, password } = body;

        if (!agent_code || !full_name || !phone || !password) {
            return new Response(JSON.stringify({ error: 'All fields (Agent Code, Full Name, Phone, Password) are required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const cleanCode = agent_code.trim().toUpperCase();

        if (env.DB) {
            // Check if agent code already exists
            const existing = await env.DB.prepare('SELECT id FROM agents WHERE agent_code = ?').bind(cleanCode).first();
            if (existing) {
                return new Response(JSON.stringify({ error: `Agent code ${cleanCode} already exists.` }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            const result = await env.DB.prepare(
                `INSERT INTO agents (agent_code, full_name, phone, password_hash, status) 
                 VALUES (?, ?, ?, ?, 'ACTIVE')`
            ).bind(cleanCode, full_name.trim(), phone.trim(), password).run();

            // Log to audit log
            await env.DB.prepare(
                `INSERT INTO audit_logs (action, details, actor) VALUES ('AGENT_CREATED', ?, 'SUPER_ADMIN')`
            ).bind(`Created Agent ID: ${cleanCode} (${full_name})`).run();

            return new Response(JSON.stringify({
                success: true,
                message: `Agent ${cleanCode} created successfully!`,
                agent_id: result.meta.last_row_id
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ success: true, message: 'Agent created (mock mode)' }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
