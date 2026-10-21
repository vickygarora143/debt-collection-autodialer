// Cloudflare Pages Function: Agent Queue Retrieval for Auto-Dialing
export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const agentId = url.searchParams.get('agent_id');
    const limit = parseInt(url.searchParams.get('limit') || '300');

    if (!agentId) {
        return new Response(JSON.stringify({ error: 'agent_id required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        if (env.DB) {
            // First check if agent is active
            const agent = await env.DB.prepare('SELECT status FROM agents WHERE id = ?').bind(agentId).first();
            if (!agent || agent.status === 'REVOKED') {
                return new Response(JSON.stringify({
                    error: 'Account access has been revoked by Super Admin.',
                    code: 'ACCOUNT_REVOKED'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // Fetch pending and unresolved allocations assigned to this agent
            const { results } = await env.DB.prepare(
                `SELECT 
                    id, customer_name, loan_account_no, primary_phone, alt_phone,
                    overdue_amount, dpd, bucket, status, call_attempts, last_disposition, last_called_at
                 FROM allocations 
                 WHERE assigned_agent_id = ? AND status != 'RESOLVED'
                 ORDER BY 
                    CASE WHEN status = 'PENDING' THEN 1 ELSE 2 END,
                    dpd DESC, 
                    id ASC
                 LIMIT ?`
            ).bind(agentId, limit).all();

            return new Response(JSON.stringify({
                cases: results || [],
                total: (results || []).length
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ cases: [], total: 0 }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
