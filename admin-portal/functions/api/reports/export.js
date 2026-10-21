// Cloudflare Pages Function: Export Audited Call & Disposition Reports
export async function onRequestGet(context) {
    const { request, env } = context;
    const url = new URL(request.url);
    const date = url.searchParams.get('date') || new Date().toISOString().slice(0, 10);
    const format = url.searchParams.get('format') || 'csv';

    try {
        if (env.DB) {
            const { results } = await env.DB.prepare(
                `SELECT 
                    cl.called_at,
                    a.agent_code,
                    a.full_name as agent_name,
                    al.loan_account_no,
                    al.customer_name,
                    cl.dialed_phone,
                    al.overdue_amount,
                    al.dpd,
                    cl.call_duration_seconds,
                    cl.disposition,
                    cl.ptp_amount,
                    cl.ptp_date,
                    cl.agent_remarks,
                    cl.sim_slot
                 FROM call_logs cl
                 JOIN agents a ON a.id = cl.agent_id
                 JOIN allocations al ON al.id = cl.allocation_id
                 WHERE DATE(cl.called_at) = DATE(?)
                 ORDER BY cl.called_at DESC`
            ).bind(date).all();

            if (format === 'csv') {
                const headers = [
                    'Timestamp', 'Agent ID', 'Agent Name', 'Loan Account No', 
                    'Customer Name', 'Dialed Phone', 'Overdue Amount', 'DPD', 
                    'Call Duration (Sec)', 'Disposition', 'PTP Amount', 'PTP Date', 'Remarks', 'SIM'
                ];
                let csvRows = [headers.join(',')];

                for (const r of (results || [])) {
                    csvRows.push([
                        `"${r.called_at}"`,
                        `"${r.agent_code}"`,
                        `"${r.agent_name.replace(/"/g, '""')}"`,
                        `"${r.loan_account_no}"`,
                        `"${r.customer_name.replace(/"/g, '""')}"`,
                        `"${r.dialed_phone}"`,
                        r.overdue_amount || 0,
                        r.dpd || 0,
                        r.call_duration_seconds || 0,
                        `"${r.disposition}"`,
                        r.ptp_amount || '',
                        `"${r.ptp_date || ''}"`,
                        `"${(r.agent_remarks || '').replace(/"/g, '""')}"`,
                        r.sim_slot || 1
                    ].join(','));
                }

                return new Response(csvRows.join('\n'), {
                    headers: {
                        'Content-Type': 'text/csv; charset=utf-8',
                        'Content-Disposition': `attachment; filename="call_report_${date}.csv"`
                    }
                });
            }

            return new Response(JSON.stringify({ date, records: results || [] }), {
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response('Timestamp,Agent ID,Agent Name,Loan Account No,Customer Name,Dialed Phone,Call Duration (Sec),Disposition\n', {
            headers: { 'Content-Type': 'text/csv' }
        });
    } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
