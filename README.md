# DebtFlow Pro — SIM-Based Collection Auto-Dialer & Super Admin HQ

> **100% Free Tier Architecture** for Debt Collection & Telecalling Agencies.
> Built for **50 Telecallers** handling **10,000–15,000 calls daily** ($0.00/month recurring cost).

---

## ⚡ What This Solves

1. **Eliminates Manual Dialing:** Agents plug in their earphone/headset. The Android APK places direct SIM calls sequentially.
2. **Instant 1-Tap Recovery Tagging:** As soon as the call hangs up, the screen displays **PTP**, **Broken PTP**, **Paid**, **RNR**, **Busy**, or **Wrong Number**.
3. **Super Admin Full Governance & Kill-Switch:**
   - Admin generates Agent IDs and passwords.
   - **Hardware Device Binding:** The APK locks to the agent's physical phone hardware UUID on first login. Sharing the APK or login with friends is automatically blocked.
   - **Remote Kill-Switch:** If an agent leaves or is terminated, Admin clicks **"Kill-Switch"** on the dashboard. The agent's phone is immediately wiped of all debtor contacts and locked.
   - **Anti-Leakage (`FLAG_SECURE`):** Android prevents screenshots and screen recording inside the app.
4. **Cloudflare 100% Free Tier:**
   - Frontend & API: **Cloudflare Pages + Workers** (100,000 free requests/day).
   - Database: **Cloudflare D1** (Serverless SQLite, 5GB storage, 5M reads/day, 100% free).
   - CI/CD: **GitHub Actions** (Compiles Android `.apk` automatically for free).

---

## 📁 Repository Structure

```
debt-collection-autodialer/
├── admin-portal/              # Cloudflare Pages + Super Admin Dashboard
│   ├── functions/api/         # Cloudflare Pages Functions (Serverless backend API)
│   │   ├── auth/              # Login, Heartbeat & Kill-Switch check
│   │   ├── agents/            # Provisioning, Kill-Switch, Reset Device Binding
│   │   ├── allocations/       # Excel/CSV Ingestion & 50-Agent distribution
│   │   ├── calls/             # Call disposition and talk duration logging
│   │   ├── dashboard/         # Real-time recovery scoreboard KPIs
│   │   └── reports/           # Bank audit CSV export
│   ├── public/                # Super Admin UI + Built-in Telecaller Simulator
│   ├── schema.sql             # Cloudflare D1 SQL Schema
│   └── wrangler.toml          # Cloudflare configuration
├── android-app/               # Native Android APK Source Code (Kotlin)
│   ├── app/src/main/
│   │   ├── AndroidManifest.xml # CALL_PHONE, READ_PHONE_STATE, Audio routing
│   │   └── java/com/collection/autodialer/
│   │       ├── MainActivity.kt     # High-contrast telecalling HUD & auto-advance
│   │       ├── TelephonyService.kt # Native SIM dialer & call state listener
│   │       ├── SecurityManager.kt  # Hardware binding, Kill-switch & FLAG_SECURE
│   │       └── ApiClient.kt        # JSON API connector to Cloudflare
├── .github/workflows/
│   └── build-apk.yml          # GitHub Actions Free APK Builder
└── samples/
    └── sample_allocations.csv # Ready-to-use test portfolio file
```

---

## 🚀 Quick Setup Guide (Step-by-Step)

### Step 1: Push Code to Your GitHub Repository
Run these commands in PowerShell or Terminal inside this project folder:
```powershell
git add .
git commit -m "Initial commit: Secure Debt Collection Auto-Dialer & Super Admin HQ"
git branch -M main
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/debt-collection-autodialer.git
git push -u origin main
```

---

### Step 2: Deploy to Cloudflare Pages (100% Free Forever)
1. Log into your free [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. In the left menu, navigate to **Workers & Pages** ➔ **Create Application** ➔ **Pages** ➔ **Connect to Git**.
3. Select your newly pushed GitHub repository: `debt-collection-autodialer`.
4. Build Settings:
   - **Framework preset:** `None`
   - **Build output directory:** `admin-portal/public`
   - **Root directory:** `admin-portal`
5. Click **Save and Deploy**. Cloudflare gives you a free live URL: `https://debtflow-dialer.pages.dev`.

---

### Step 3: Create the Free Cloudflare D1 Database
In your Cloudflare dashboard (or via terminal using Wrangler):
1. Go to **Workers & Pages** ➔ **D1 SQL Database** ➔ **Create Database**.
2. Name it: `debtflow-db`.
3. Open the **Console** tab in Cloudflare D1, copy the contents of `admin-portal/schema.sql`, and click **Execute**.
4. Link this database to your Cloudflare Pages project:
   - Pages Project ➔ **Settings** ➔ **Functions** ➔ **D1 Database Bindings**.
   - Variable name: `DB`
   - Database: `debtflow-db`.

---

### Step 4: Download Your Android APK (Built by GitHub Actions)
1. Go to your GitHub repository page in your browser.
2. Click on the **Actions** tab.
3. You will see the workflow **"Build Android Auto-Dialer APK"** running.
4. Once finished (typically 2–3 minutes), click on the completed run and scroll down to **Artifacts**.
5. Download **`DebtFlow-AutoDialer-APK`** (`app-debug.apk` or `app-release.apk`).
6. Send this APK file to your 50 agents via WhatsApp, Google Drive, or local share!

---

### Step 5: Agency Daily Calling Workflow

1. **Admin Provisions Agents:**
   - Open your Super Admin Dashboard on PC.
   - Go to **50 Agents & Kill-Switch** tab ➔ Click **Create New Agent ID** (e.g. `AGT001`, `AGT002`... up to `AGT050`).
2. **Admin Ingests Allocations:**
   - Go to **Upload & Distribute** tab.
   - Drag & drop your allocation Excel or CSV file.
   - Select **"Equal Split (Round-Robin across 50 active agents)"**.
   - Click **Push to Agent Android Phones**.
3. **Agents Start Calling:**
   - Agent opens the APK on their phone, plugs in their earphones, enters their Agent ID & Password.
   - First login binds their phone hardware permanently.
   - The agent taps **"Start Auto-Dialing"**.
   - Calls dial consecutively via the native SIM. After each call disconnects, the agent taps the disposition (**PTP**, **RNR**, **Busy**) or the app auto-advances to the next debtor!
4. **Terminating / Leaver Agent:**
   - If an agent leaves your agency, Admin clicks **"Kill-Switch"** on their profile in the Super Admin dashboard.
   - The agent's phone is instantly wiped and locked.
