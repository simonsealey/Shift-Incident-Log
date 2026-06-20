# Shift & Incident Log

A production-ready progressive web app for shift and incident logging at a multi-campus behavioral health facility. Staff submit entries from any device; supervisors review a live, filterable log with AI-powered insights in real time.

[![Live Demo](https://img.shields.io/badge/Live-Demo-2563eb?style=flat-square)](https://simonsealey.github.io/Shift-Incident-Log/)
![Frontend](https://img.shields.io/badge/Frontend-HTML%20%7C%20CSS%20%7C%20Vanilla%20JS-orange?style=flat-square)
![Backend](https://img.shields.io/badge/Backend-Supabase%20%2F%20Postgres-3ecf8e?style=flat-square)
![ML](https://img.shields.io/badge/ML-FastAPI%20%7C%20scikit--learn-ff6f00?style=flat-square)
![Hosting](https://img.shields.io/badge/Hosting-GitHub%20Pages-181717?style=flat-square)
![PWA](https://img.shields.io/badge/PWA-Offline%20Capable-5a2d82?style=flat-square)

> **Note:** Structural prototype — no real client or patient data is used. All sample entries are fictional.

**🔗 Live demo:** https://simonsealey.github.io/Shift-Incident-Log/ &nbsp;|&nbsp; PIN: `1474`

---

## Screenshots

### Submit an entry
![Submit form](assets/02-form.png)

### Review the log (filterable)
![Log view](assets/03-log.png)

### Secure access
![PIN gate](assets/01-pin.png)

---

## Features

### Core

| Feature | Details |
|---|---|
| **PIN-protected access** | Shared staff PIN gate keeps the app off casual/search-engine access |
| **Submit from any device** | Phone, tablet, or desktop — fully responsive layout |
| **Centralized Postgres database** | Hosted on Supabase with Row Level Security; staff can insert and read but never delete |
| **File attachments** | Photos, PDFs, and documents uploaded directly to Supabase Storage and linked to each entry |
| **Filterable log view** | Filter by campus, event type, follow-up status, date range, and full-text search across name, narrative, notes |
| **CSV export** | Download any filtered view as a CSV file |
| **Color-coded badges** | Instant visual scan of event type and follow-up status |
| **Follow-up resolution workflow** | Mark open follow-ups resolved, record who resolved them and what was done; resolution notes appear inline |
| **Shift Handoff tab** | Auto-generates a formatted handoff summary for the next shift — this shift's events plus every open follow-up — filterable by campus, date, and shift; one-click copy or print |

---

### Real-Time & Offline

| Feature | Details |
|---|---|
| **Live log updates** | Supabase Realtime (`postgres_changes`) pushes new entries to all connected clients instantly — no page refresh needed |
| **Real-time toast notifications** | A non-intrusive toast appears when a colleague submits an entry while you're viewing the log |
| **Offline-first PWA** | Service worker pre-caches the app shell so the app loads without a network connection |
| **Offline write queue** | Entries submitted while offline are queued in IndexedDB and synced automatically when connectivity returns; pending entries appear in the log with a "Pending sync" badge |
| **Offline/online status indicator** | Header badge shows when the app is running in offline mode |
| **Installable** | Meets PWA install criteria — "Add to Home Screen" works on iOS and Android |

---

### AI / ML Features

A local FastAPI service (`ml/api.py`) runs three scikit-learn models trained on a synthetic dataset of ~900 labeled shift log entries.

| Feature | How it works |
|---|---|
| **Live severity scoring** | As staff type a narrative (≥ 10 chars), a debounced call to `/predict` returns a **Low / Medium / High** severity pill — updated in real time while writing |
| **Event-type suggestion** | The same call returns the model's top event-type prediction with confidence; shown alongside the severity pill so staff can confirm or override the dropdown |
| **Anomaly detection** | After the log renders, a batch call to `/anomaly-batch` runs each visible narrative through an IsolationForest model; unusual entries surface a **⚠ Unusual** badge without any manual review |
| **AI status indicator** | A persistent badge in the form header shows whether the ML server is Online, Offline, or Checking — staff always know if AI assist is active |

**Models (`ml/artifacts/`):**

| Model | Algorithm | Purpose |
|---|---|---|
| `severity_classifier` | TF-IDF + Logistic Regression | Predicts Low / Medium / High severity |
| `event_type_classifier` | TF-IDF + Logistic Regression | Suggests the most likely event type |
| `anomaly_vectorizer` + `anomaly_detector` | TF-IDF → TruncatedSVD → IsolationForest | Flags narratives that deviate from historical patterns |

---

### Dashboard

An analytics tab renders seven Chart.js charts, all filterable by time period (last 7 days, 30 days, this month, all time, or custom date range):

- Entries by Event Type (doughnut)
- Entries by Campus (doughnut)
- Follow-Up breakdown — open vs. resolved vs. not needed (doughnut)
- Entries by Shift (bar)
- Busiest Day of Week (bar)
- Busiest Time of Day (bar)
- Entries Over Time — daily trend line

Stat cards above the charts summarise total entries, incidents, open follow-ups, and overnight entries for the selected period.

---

### UI / UX

- **Dark mode** — system preference detected automatically; manual toggle persisted in `localStorage`
- **Inter typeface** — consistent with modern product design
- **Mobile card layout** — on small screens the log view switches from a wide table to stacked cards; each card shows the full narrative, event badge, date/shift/time, staff name, campus, and follow-up status without horizontal scrolling
- **Smooth animations** — button lift, focus rings, badge transitions, AI pulse indicator
- **Custom scrollbar** — minimal 6 px track that matches the theme

---

## Fields Logged

| Field | Type |
|---|---|
| Date | Date picker |
| Shift | Dropdown — Day / Evening / Overnight |
| Time | Time picker |
| Staff Name | Text |
| Campus | Dropdown — Main Campus / Phoenix Concept / Stepping Stone |
| Event Type | Dropdown — Incident / Medical / Medications / Behavioral / Maintenance / Visitor / Other |
| Narrative | Free text (AI-assisted) |
| Follow-Up Needed | Dropdown — Yes / No |
| Follow-Up Notes / Assigned To | Text |
| Attachments | File upload — images, PDF, Word, HEIC |

---

## Tech Stack

| Layer | Tool |
|---|---|
| Frontend | HTML5, CSS3 (custom properties, grid, media queries), Vanilla JS (ES2022) |
| Database / Auth | Supabase — hosted Postgres, auto REST API, Realtime, Storage |
| Charts | Chart.js 4 |
| ML API | FastAPI (Python), scikit-learn, joblib, pandas, NumPy |
| PWA | Service Worker (stale-while-revalidate), Web App Manifest, IndexedDB |
| Hosting | GitHub Pages |

---

## ML Service Setup

The AI features require the local FastAPI server to be running.

```bash
# From the project root
cd ml
pip install -r requirements.txt   # fastapi uvicorn scikit-learn pandas numpy joblib

# Train the models (only needed once, or after new data)
python train_severity.py
python train_event_type.py
python train_anomaly.py

# Start the API server
uvicorn api:app --reload --host 0.0.0.0 --port 8000
```

The app auto-detects whether the server is reachable and degrades gracefully (no AI badges, no anomaly scoring) when it is not.

---

## Supabase Setup

### 1. Create a project

1. Go to [supabase.com](https://supabase.com) and sign up (free tier is fine).
2. Click **New project**, name it, and set a database password.
3. Wait ~2 minutes for provisioning.

### 2. Run the SQL migrations

Open **SQL Editor → New query** in the Supabase dashboard and run each file in order:

| File | Purpose |
|---|---|
| `supabase_setup.sql` | Creates the `shift_log` table and RLS policies |
| `supabase_migration.sql` | Adds follow-up resolution columns |
| `supabase_attachments.sql` | Creates the `attachments` table and Storage bucket |

### 3. Enable Realtime

In the Supabase dashboard, go to **Database → Replication** and enable the `shift_log` table.

### 4. Connect the frontend

Open `script.js` and set the two constants at the top:

```js
const SUPABASE_URL      = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "your-anon-public-key";
```

### 5. Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings → Pages → Source: main branch / root**.
3. Your app will be live at `https://<your-username>.github.io/<repo-name>/`.

---

## Security Notes

- The PIN (`1474`) is stored client-side — it's a lightweight access barrier, not authentication. For production, replace with Supabase Auth.
- The Supabase **anon key is designed to be public** — access is governed by Row Level Security policies in `supabase_setup.sql`, not by hiding the key.
- No real patient or client data should ever be entered into this prototype.

---

## Project Context

Built as a portfolio project demonstrating:

- **Full-stack development** — Vanilla JS frontend, Postgres backend, RESTful API integration
- **Real-time systems** — WebSocket-based live updates via Supabase Realtime
- **Machine learning in production** — scikit-learn models served via FastAPI, integrated into a live UI with graceful degradation
- **Progressive Web App** — offline-first architecture with service worker caching and IndexedDB write queue
- **Responsive UI design** — adaptive layouts (table → cards on mobile), dark/light theme, custom design system
- **Healthcare operations tooling** — real-world use case: multi-campus SUD/behavioral health shift management
