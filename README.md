# 🚀 Autonomous Job Applying Agent

A production-grade, stealth-enabled autonomous job application agent built specifically for **Manoj Kumar Manne** (Supply Chain Operations, Demand & Inbound Planning, Procurement & Inventory Management), with built-in multi-board support (**Indeed**, **LinkedIn Easy Apply**, **Greenhouse**, and **Lever**).

---

## 🌟 Key Features

1. **Intelligent ATS Screening Engine**:
   - Built directly on top of your resume details (`Manoj_Kumar_Manne_Amazon_R2L_Supply_Chain_Manager_II_ATS_Resume.pdf`).
   - Automatically answers complex screening questions:
     - Experience years per skill (Excel, SQL, Power BI, ERP, SAP, Demand Planning, 3PL, Inventory Management).
     - Legal & Work Authorization (US Citizen/Authorized, No Sponsorship Needed, Background Check, Drug Test, Driver's License).
     - Expected Salary & Notice Period.
     - EEO / Voluntary Self-Identification (Gender, Race/Ethnicity, Veteran, Disability).
     - Custom open-ended responses with tailored impact statements.

2. **Automated Multi-Step Form Submission**:
   - Traverses multi-page application flows (Contact Info ➔ Resume Upload ➔ Screening Questions ➔ EEO ➔ Review ➔ Submit).
   - Automatically attaches your ATS resume (`assets/resume.pdf`).

3. **Stealth & Anti-Bot Protection**:
   - Uses `puppeteer-extra-plugin-stealth` coupled directly with your native Google Chrome installation.
   - Persistent Chrome User Profile (`./data/chrome-profile`): You log in to Indeed/LinkedIn once, and the agent remembers your session forever without triggering Cloudflare blocks or continuous captchas.
   - Natural human typing jitter and mouse curves.

4. **Safety & Human-in-the-Loop Controls**:
   - **Dry-Run Mode**: Fills every field and question right up to the final submit button, captures a high-resolution screenshot for your inspection, and pauses so you never submit unwanted applications.
   - **Keyword Match Scoring**: Dynamically scores job postings against your resume keywords and filters out irrelevant roles (e.g. internships, forklift operators, drivers, unpaid roles).
   - **Company Blacklist**: Avoids companies you specify in `config/search-criteria.json`.
   - **Application Deduplication**: SQLite/JSON ledger prevents applying to the same job or company twice.

5. **Full Web Dashboard & CLI Interface**:
   - **Modern Web Dashboard** (`http://localhost:3000`): Real-time metrics, live terminal log streaming, active browser screenshot preview, editable profile, and application ledger with proof screenshots.
   - **1-Click Windows Launcher**: Simply double-click `start.bat`.

---

## 📁 Repository Structure

```
JOB-/
├── assets/
│   └── resume.pdf                     # Active ATS resume PDF attached during applications
├── config/
│   ├── profile.json                   # Candidate profile, ATS screening Q&A, and cover letter
│   └── search-criteria.json           # Target titles, locations, blacklist, and match score threshold
├── core/
│   ├── browser.js                     # Stealth browser manager using system Google Chrome
│   ├── profile-manager.js             # Q&A inference engine and profile data manager
│   ├── tracker.js                     # Application history, deduplication, and stats
│   ├── matcher.js                     # Job scoring and negative keyword filter
│   └── agent.js                       # Master autonomous orchestrator
├── providers/
│   ├── base-provider.js               # Abstract job board provider
│   ├── indeed-provider.js             # Indeed Easy Apply search & modal traversal
│   ├── linkedin-provider.js           # LinkedIn Easy Apply integration
│   ├── greenhouse-provider.js         # Direct Greenhouse.io ATS form submitter
│   └── lever-provider.js              # Direct Lever.co ATS form submitter
├── ui/
│   ├── server.js                      # Express backend & WebSocket real-time server
│   └── public/
│       ├── index.html                 # Sleek dark-mode Tailwind dashboard
│       ├── app.js                     # Frontend event handler & controls
│       └── style.css                  # Custom animations & styling
├── scripts/
│   └── test-browser.js                # Browser diagnostics & connectivity check
├── start.bat                          # 1-Click launcher for Windows
├── index.js                           # Unified CLI & dashboard entry point
└── package.json                       # Dependencies & npm scripts
```

---

## 🚀 Quick Start Guide

### 1. One-Click Launch (Windows)
Double-click `start.bat` in the project root. This starts the web server and automatically opens your browser to:
👉 **`http://localhost:3000`**

### 2. Manual CLI Launch
```bash
# Start Web Dashboard
npm start

# Run Indeed Agent in Dry-Run mode (fills forms without submitting)
npm run dry-run

# Run Indeed Agent in Live Autopilot mode
npm run agent

# Run against LinkedIn Easy Apply
node index.js --run --board linkedin

# Test Stealth Browser & Indeed Access
npm run test-browser
```

### 3. One-Time Login (Recommended for 100% Anti-Bot Bypass)
To ensure Indeed and LinkedIn never present captchas during automated runs, run:
```bash
node index.js --login
```
This opens the persistent Chrome browser profile. Log into your Indeed and LinkedIn accounts normally. Once signed in, close the window. From then on, the agent runs with your active session!

---

## ⚙️ Customization & Settings

### Candidate Profile (`config/profile.json`)
You can edit your contact details, target salary, and specific answers directly in the Web Dashboard or in `config/profile.json`:
- `workAuthorization`: Set US authorization and sponsorship flags.
- `skillsYearsOfExperience`: Customize experience counts for specific technologies.
- `coverLetter`: Edit the tailored cover letter used for open-ended application textareas.

### Target Roles & Exclusions (`config/search-criteria.json`)
- `targetTitles`: List of job titles to search (e.g. *Supply Chain Manager*, *Demand Planner*, *Inventory Analyst*, *Procurement Specialist*).
- `locations`: Target cities and states (e.g. *Sarasota, FL*, *Tampa, FL*, *Remote*).
- `minimumMatchScore`: Cut-off percentage (default: `60%`).
- `blacklistCompanies`: Add companies you wish to completely skip.
- `negativeKeywords`: Keywords that disqualify a posting (e.g. *internship*, *forklift*, *part-time*).

---

## 🔒 Safety & Best Practices

1. **Always test with Dry-Run mode first**: Verify that the questions are being answered properly and check the screenshot proofs in the Web Dashboard before toggling Autopilot.
2. **Pacing**: The agent automatically inserts random 4–9 second pauses between job applications to mimic natural human behavior and prevent rate limiting.
3. **Daily Limits**: Keep daily applications under 25–40 per board to maintain account health.

---

## 📄 License
MIT © Manoj Kumar Manne
