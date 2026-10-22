// Cloudflare Pages Function: Agent & Admin Login + Device Binding
export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const body = await request.json();
        const { role, username, password, hardware_uuid, device_model } = body;

        // 1. Super Admin Authentication
        if (role === 'admin') {
            if (!username || !password) {
                return new Response(JSON.stringify({ error: 'Missing username or password' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Default initial bootstrap if DB is brand new
            if (env.DB) {
                const admin = await env.DB.prepare(
                    'SELECT id, username, agency_name FROM admins WHERE username = ? AND password_hash = ?'
                ).bind(username, password).first();

                if (admin) {
                    return new Response(JSON.stringify({
                        success: true,
                        role: 'admin',
                        admin: { id: admin.id, username: admin.username, agency_name: admin.agency_name }
                    }), { headers: { 'Content-Type': 'application/json' } });
                }
            }

            // Fallback default admin credentials for quick setup: admin / admin123
            if (username === 'admin' && password === 'admin123') {
                return new Response(JSON.stringify({
                    success: true,
                    role: 'admin',
                    admin: { id: 1, username: 'admin', agency_name: 'Super Admin HQ' }
                }), { headers: { 'Content-Type': 'application/json' } });
            }

            return new Response(JSON.stringify({ error: 'Invalid admin credentials' }), {
                status: 401,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // 2. Telecalling Agent Authentication & Device Binding
        const agentCode = (body.agent_code || username || '').toUpperCase().trim();
        if (!agentCode || !password) {
            return new Response(JSON.stringify({ error: 'Agent Code and Password required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (env.DB) {
            const agent = await env.DB.prepare(
                'SELECT * FROM agents WHERE agent_code = ?'
            ).bind(agentCode).first();

            if (!agent || agent.password_hash !== password) {
                return new Response(JSON.stringify({ error: 'Invalid Agent Code or Password' }), {
                    status: 401,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // KILL-SWITCH CHECK: Is the agent revoked?
            if (agent.status === 'REVOKED') {
                return new Response(JSON.stringify({
                    error: 'ACCESS REVOKED: Your account has been permanently locked by Super Admin.',
                    code: 'ACCOUNT_REVOKED'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // Hardware binding removed: Agent can log in from any phone
            await env.DB.prepare(
                'UPDATE agents SET last_login = CURRENT_TIMESTAMP, last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(agent.id).run();

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
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        // Demo fallback for local development testing without live DB
        return new Response(JSON.stringify({
            success: true,
            role: 'agent',
            agent: { id: 101, agent_code: agentCode, full_name: 'Test Telecaller', status: 'ACTIVE' }
        }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
