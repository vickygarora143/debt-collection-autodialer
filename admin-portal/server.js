const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 5000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.csv': 'text/csv'
};

const server = http.createServer((req, res) => {
    let url = req.url.split('?')[0];

    // Mock API responses for local testing
    if (url === '/api/dashboard/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
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
            ]
        }));
    }

    if (url === '/api/agents') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({
            agents: [
                { id: 1, agent_code: 'AGT001', full_name: 'Rahul Sharma', phone: '9876543210', status: 'ACTIVE', hardware_uuid: 'a4f910e928ab9821', device_model: 'Samsung Galaxy M31', assigned_cases: 250, calls_today: 265 },
                { id: 2, agent_code: 'AGT002', full_name: 'Sneha Kulkarni', phone: '9823019283', status: 'ACTIVE', hardware_uuid: 'b98218ae87123901', device_model: 'Redmi Note 12', assigned_cases: 240, calls_today: 230 },
                { id: 3, agent_code: 'AGT003', full_name: 'Karan Mehra', phone: '9711823901', status: 'REVOKED', hardware_uuid: 'ff92817361284910', device_model: 'Realme 9 Pro', assigned_cases: 0, calls_today: 0 }
            ]
        }));
    }

    // Serve static files
    let filePath = path.join(PUBLIC_DIR, url === '/' ? 'index.html' : url);
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'text/plain';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('File not found');
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content);
        }
    });
});

server.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
});
