-- Cloudflare D1 Database Schema for Debt Collection Auto-Dialer
-- 100% Free Serverless SQLite Database on Cloudflare

-- 1. Super Admin Table
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    agency_name TEXT NOT NULL DEFAULT 'Recovery Agency',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. Agents Table (With Hardware Binding & Remote Kill-Switch)
CREATE TABLE IF NOT EXISTS agents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_code TEXT UNIQUE NOT NULL,       -- e.g. AGT001, AGT002
    full_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE' or 'REVOKED' (Kill-switch)
    hardware_uuid TEXT,                   -- Android Device Hardware ID (Locked on 1st login)
    device_model TEXT,                    -- e.g. "Samsung SM-M315F"
    registered_sim TEXT,                  -- Optional phone SIM identifier
    last_login DATETIME,
    last_heartbeat DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. Allocations Table (Leads / Debtors)
CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_name TEXT NOT NULL,
    assigned_agent_id INTEGER,
    customer_name TEXT NOT NULL,
    loan_account_no TEXT NOT NULL,
    primary_phone TEXT NOT NULL,
    alt_phone TEXT,
    overdue_amount REAL NOT NULL DEFAULT 0,
    dpd INTEGER NOT NULL DEFAULT 0,       -- Days Past Due
    bucket TEXT,                          -- e.g. B1, B2, B3, Written-off
    status TEXT NOT NULL DEFAULT 'PENDING',-- PENDING, CALLED, RESOLVED, ESCALATED
    call_attempts INTEGER DEFAULT 0,
    last_disposition TEXT,
    last_called_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(assigned_agent_id) REFERENCES agents(id) ON DELETE SET NULL
);

-- 4. Call Logs Table (Every single call attempt)
CREATE TABLE IF NOT EXISTS call_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    allocation_id INTEGER NOT NULL,
    agent_id INTEGER NOT NULL,
    dialed_phone TEXT NOT NULL,
    call_duration_seconds INTEGER NOT NULL DEFAULT 0,
    disposition TEXT NOT NULL,            -- PTP, BROKEN_PTP, RNR, BUSY, SWITCHED_OFF, WRONG_NUMBER, DISPUTE, THIRD_PARTY, CALLBACK
    ptp_amount REAL,
    ptp_date TEXT,
    agent_remarks TEXT,
    sim_slot INTEGER DEFAULT 1,
    called_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(allocation_id) REFERENCES allocations(id) ON DELETE CASCADE,
    FOREIGN KEY(agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

-- 5. System Audit Logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,                 -- KILL_SWITCH_TRIGGERED, ALLOCATION_UPLOADED, AGENT_CREATED
    details TEXT,
    actor TEXT NOT NULL DEFAULT 'ADMIN',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for lightning fast queries across 50,000+ rows
CREATE INDEX IF NOT EXISTS idx_allocations_agent ON allocations(assigned_agent_id);
CREATE INDEX IF NOT EXISTS idx_allocations_status ON allocations(status);
CREATE INDEX IF NOT EXISTS idx_call_logs_agent ON call_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_call_logs_disposition ON call_logs(disposition);
CREATE INDEX IF NOT EXISTS idx_call_logs_date ON call_logs(called_at);
