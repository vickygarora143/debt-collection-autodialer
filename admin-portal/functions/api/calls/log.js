// Cloudflare Pages Function: Log Call Outcome & Telecaller Disposition
export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const body = await request.json();
        const {
            allocation_id,
            agent_id,
            dialed_phone,
            call_duration_seconds,
            disposition,
            ptp_amount,
            ptp_date,
            agent_remarks,
            sim_slot
        } = body;

        if (!allocation_id || !agent_id || !dialed_phone || !disposition) {
            return new Response(JSON.stringify({ error: 'Missing required call log fields' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        if (env.DB) {
            // Check agent status
            const agent = await env.DB.prepare('SELECT status FROM agents WHERE id = ?').bind(agent_id).first();
            if (!agent || agent.status === 'REVOKED') {
                return new Response(JSON.stringify({
                    error: 'Account access is revoked.',
                    code: 'ACCOUNT_REVOKED'
                }), { status: 403, headers: { 'Content-Type': 'application/json' } });
            }

            // 1. Insert into call_logs
            const insertResult = await env.DB.prepare(
                `INSERT INTO call_logs (
                    allocation_id, agent_id, dialed_phone, call_duration_seconds,
                    disposition, ptp_amount, ptp_date, agent_remarks, sim_slot
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            ).bind(
                allocation_id,
                agent_id,
                dialed_phone,
                call_duration_seconds || 0,
                disposition,
                ptp_amount ? parseFloat(ptp_amount) : null,
                ptp_date || null,
                agent_remarks || '',
                sim_slot || 1
            ).run();

            // 2. Update allocation status
            let allocationStatus = 'CALLED';
            if (disposition === 'PAID_ONLINE' || disposition === 'RESOLVED') {
                allocationStatus = 'RESOLVED';
            } else if (disposition === 'DISPUTE') {
                allocationStatus = 'ESCALATED';
            }

            await env.DB.prepare(
                `UPDATE allocations 
                 SET call_attempts = call_attempts + 1,
                     last_disposition = ?,
                     last_called_at = CURRENT_TIMESTAMP,
                     status = ?
                 WHERE id = ?`
            ).bind(disposition, allocationStatus, allocation_id).run();

            // 3. Update agent heartbeat
            await env.DB.prepare(
                'UPDATE agents SET last_heartbeat = CURRENT_TIMESTAMP WHERE id = ?'
            ).bind(agent_id).run();

            return new Response(JSON.stringify({
                success: true,
                call_log_id: insertResult.meta.last_row_id,
                message: `Call outcome '${disposition}' recorded successfully.`
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({ success: true, message: 'Call logged (mock mode)' }), {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
