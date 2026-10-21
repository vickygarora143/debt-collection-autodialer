// Cloudflare Pages Function: Remote Kill-Switch for Agent APK
export async function onRequestPost(context) {
    const { params, request, env } = context;
    const agentId = params.id;

    try {
        const body = await request.json();
        const { action } = body; // 'REVOKE' or 'ACTIVATE'

        const newStatus = action === 'REVOKE' ? 'REVOKED' : 'ACTIVE';

        if (env.DB) {
            const agent = await env.DB.prepare('SELECT agent_code, full_name, status FROM agents WHERE id = ?').bind(agentId).first();
            if (!agent) {
                return new Response(JSON.stringify({ error: 'Agent not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            await env.DB.prepare('UPDATE agents SET status = ? WHERE id = ?').bind(newStatus, agentId).run();

            // Log action to Super Admin audit trail
            await env.DB.prepare(
                `INSERT INTO audit_logs (action, details, actor) VALUES (?, ?, 'SUPER_ADMIN')`
            ).bind(
                newStatus === 'REVOKED' ? 'KILL_SWITCH_ENGAGED' : 'KILL_SWITCH_RESTORED',
                `Agent ${agent.agent_code} (${agent.full_name}) status set to ${newStatus}`
            ).run();

            return new Response(JSON.stringify({
                success: true,
                status: newStatus,
                message: newStatus === 'REVOKED' 
                    ? `Kill-switch activated for ${agent.agent_code}. Device access revoked immediately.`
                    : `Access restored for ${agent.agent_code}.`
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ success: true, status: newStatus }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
