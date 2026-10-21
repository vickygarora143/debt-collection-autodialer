// Cloudflare Pages Function: Case Allocation Ingestion & Distribution Engine
export async function onRequestPost(context) {
    const { request, env } = context;
    try {
        const body = await request.json();
        const { batch_name, cases, distribution_mode, target_agent_id, active_agent_ids } = body;

        if (!cases || !Array.isArray(cases) || cases.length === 0) {
            return new Response(JSON.stringify({ error: 'No valid cases supplied.' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const batch = batch_name || `Batch_${new Date().toISOString().slice(0, 10)}`;

        if (env.DB) {
            // Determine agent pool
            let agentPool = [];
            if (distribution_mode === 'SPECIFIC' && target_agent_id) {
                agentPool = [parseInt(target_agent_id)];
            } else if (active_agent_ids && active_agent_ids.length > 0) {
                agentPool = active_agent_ids.map(id => parseInt(id));
            } else {
                // Fetch all active agents
                const { results } = await env.DB.prepare("SELECT id FROM agents WHERE status = 'ACTIVE'").all();
                agentPool = (results || []).map(r => r.id);
            }

            if (agentPool.length === 0) {
                return new Response(JSON.stringify({ error: 'No active agents available to assign cases.' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Clean, sanitize, and insert cases with round-robin or targeted distribution
            const statements = [];
            let agentIndex = 0;

            for (const item of cases) {
                const assignedAgent = agentPool[agentIndex % agentPool.length];
                agentIndex++;

                // Sanitize phone number (strip spaces, symbols, leading +91 or 0)
                let rawPhone = String(item.primary_phone || item.phone || item.mobile || '').replace(/\D/g, '');
                if (rawPhone.length === 12 && rawPhone.startsWith('91')) {
                    rawPhone = rawPhone.substring(2);
                } else if (rawPhone.length === 11 && rawPhone.startsWith('0')) {
                    rawPhone = rawPhone.substring(1);
                }

                if (!rawPhone || rawPhone.length < 10) continue; // Skip invalid numbers

                const altPhone = String(item.alt_phone || item.alternate_phone || '').replace(/\D/g, '');
                const overdue = parseFloat(item.overdue_amount || item.overdue || item.pos || 0) || 0;
                const dpd = parseInt(item.dpd || 0) || 0;
                const customer = String(item.customer_name || item.name || 'Unknown Borrower').trim();
                const loanNo = String(item.loan_account_no || item.loan_id || item.account_no || `ACC-${Date.now()}`).trim();
                const bucket = String(item.bucket || (dpd > 90 ? 'B4' : dpd > 60 ? 'B3' : dpd > 30 ? 'B2' : 'B1'));

                statements.push(
                    env.DB.prepare(
                        `INSERT INTO allocations (
                            batch_name, assigned_agent_id, customer_name, loan_account_no, 
                            primary_phone, alt_phone, overdue_amount, dpd, bucket, status
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`
                    ).bind(batch, assignedAgent, customer, loanNo, rawPhone, altPhone, overdue, dpd, bucket)
                );
            }

            // Cloudflare D1 batch execution (chunked to 50 statements per batch to adhere to D1 limits)
            const chunkSize = 50;
            let totalInserted = 0;
            for (let i = 0; i < statements.length; i += chunkSize) {
                const chunk = statements.slice(i, i + chunkSize);
                await env.DB.batch(chunk);
                totalInserted += chunk.length;
            }

            // Audit log
            await env.DB.prepare(
                `INSERT INTO audit_logs (action, details, actor) VALUES ('ALLOCATION_UPLOADED', ?, 'SUPER_ADMIN')`
            ).bind(`Uploaded ${totalInserted} cases under batch '${batch}' distributed across ${agentPool.length} agents`).run();

            return new Response(JSON.stringify({
                success: true,
                batch_name: batch,
                total_cases: totalInserted,
                agents_assigned: agentPool.length,
                message: `Successfully allocated ${totalInserted} cases across ${agentPool.length} telecalling agents!`
            }), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response(JSON.stringify({
            success: true,
            total_cases: cases.length,
            message: 'Cases allocated successfully (mock mode).'
        }), { headers: { 'Content-Type': 'application/json' } });

    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
