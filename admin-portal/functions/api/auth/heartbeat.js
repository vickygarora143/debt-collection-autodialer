// Cloudflare Pages Function: Agent Heartbeat & Active Kill-Switch Enforcer
export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const body = await request.json();
        const { agent_id, hardware_uuid } = body;

        if (!agent_id) {
            return new Response(JSON.stringify({ error: 'agent_id required' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (env.DB) {
            const agent = await env.DB.prepare(
                'SELECT id, status, hardware_uuid FROM agents WHERE id = ?'
            ).bind(agent_id).first();

            if (!agent) {
                return new Response(JSON.stringify({ error: 'Agent not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // ENFORCE KILL-SWITCH:
            if (agent.status === 'REVOKED') {
                return new Response(JSON.stringify({
                    status: 'REVOKED',
                    action: 'WIPE_AND_LOCK',
                    message: 'Your access has been revoked by Super Admin. All local data must be wiped immediately.'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // ENFORCE DEVICE INTEGRITY:
            if (agent.hardware_uuid && hardware_uuid && agent.hardware_uuid !== hardware_uuid) {
                return new Response(JSON.stringify({
                    status: 'UNAUTHORIZED_DEVICE',
                    action: 'LOCK',
                    message: 'Device signature mismatch.'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // Update heartbeat timestamp
            await env.DB.prepare(
                'UPDATE agents SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(agent_id).run();

            return new Response(JSON.stringify({
                status: 'ACTIVE',
                ok: true,
                server_time: new Date().toISOString()
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ status: 'ACTIVE', ok: true }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
