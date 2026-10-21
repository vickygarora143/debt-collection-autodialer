// Cloudflare Pages Function: Reset Hardware Device Binding for an Agent
export async function onRequestPost(context) {
    const { params, env } = context;
    const agentId = params.id;

    try {
        if (env.DB) {
            const agent = await env.DB.prepare('SELECT agent_code, full_name, hardware_uuid FROM agents WHERE id = ?').bind(agentId).first();
            if (!agent) {
                return new Response(JSON.stringify({ error: 'Agent not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            await env.DB.prepare('UPDATE agents SET hardware_uuid = NULL, device_model = NULL WHERE id = ?').bind(agentId).run();

            await env.DB.prepare(
                `INSERT INTO audit_logs (action, details, actor) VALUES ('DEVICE_UNBOUND', ?, 'SUPER_ADMIN')`
            ).bind(`Reset hardware lock for Agent ${agent.agent_code}`).run();

            return new Response(JSON.stringify({
                success: true,
                message: `Hardware lock cleared for ${agent.agent_code}. The agent can now bind to their new phone upon next login.`
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ success: true, message: 'Device reset (mock mode)' }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
