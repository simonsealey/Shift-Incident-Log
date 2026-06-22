// ── Supabase config ── replace these two with your project's values
// (Supabase dashboard → Project Settings → API)
const SUPABASE_URL      = "https://ruaioaonbejgbjafozuz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QFxZOVuw_lWOKopvMGRBQg_9RTj9RNw";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CORRECT_PIN = "1474";
const SESSION_KEY = "shiftlog_auth";
const NAME_KEY    = "shiftlog_staff_name";  // remembers the BHT's name per-device
const CAMPUS_KEY  = "shiftlog_campus";      // remembers the last campus per-device
const CACHE_KEY   = "shiftlog_cache";       // last-fetched entries, for offline viewing

const ATTACH_BUCKET = "attachments";        // Supabase Storage bucket for uploaded files
const IDB_NAME      = "shiftlog-offline";   // IndexedDB database for the offline queue
const IDB_STORE     = "pending";

// ML API — FastAPI service running locally (python -m uvicorn api:app in ml/)
// The app degrades gracefully if the API is unreachable.
const ML_API = "http://localhost:8000";

// ── Dark mode ─────────────────────────────────────────────
const THEME_KEY = "shiftlog_theme";

function applyTheme(theme, animate) {
  if (animate) {
    document.body.classList.add("theme-transitioning");
    setTimeout(() => document.body.classList.remove("theme-transitioning"), 300);
  }
  document.documentElement.setAttribute("data-theme", theme);

  const btn = document.getElementById("theme-toggle");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";

  // Keep Chart.js tick/grid colours in sync if the library is loaded
  if (typeof Chart !== "undefined") {
    Chart.defaults.color       = theme === "dark" ? "#94a3b8" : "#64748b";
    Chart.defaults.borderColor = theme === "dark" ? "#334155" : "#dde2ea";
    // Re-render the dashboard if it is currently visible so charts pick up new colours
    const dash = document.getElementById("tab-dashboard");
    if (dash && !dash.classList.contains("hidden")) renderDashboard();
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const next    = current === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next, true);
}

// Restore saved preference (or respect system preference) immediately on load
(function () {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved) {
    applyTheme(saved, false);
  } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    applyTheme("dark", false);
  }
})();

// ── PWA service worker ────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {/* offline support unavailable */});
  });
}

// ── PIN Gate ──────────────────────────────────────────────

function checkPin() {
  const input = document.getElementById("pin-input").value.trim();
  if (input === CORRECT_PIN) {
    sessionStorage.setItem(SESSION_KEY, "true");
    showApp();
  } else {
    document.getElementById("pin-error").classList.remove("hidden");
    document.getElementById("pin-input").value = "";
    document.getElementById("pin-input").focus();
  }
}

function logout() {
  sessionStorage.removeItem(SESSION_KEY);
  document.getElementById("app").classList.add("hidden");
  document.getElementById("pin-gate").classList.remove("hidden");
  document.getElementById("pin-input").value = "";
  document.getElementById("pin-error").classList.add("hidden");
}

function showApp() {
  document.getElementById("pin-gate").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  setDefaults();
  updateNetStatus();
  refreshPending();
  flushQueue();          // sync anything that was logged offline
  subscribeRealtime();   // live updates without refresh
  checkApiHealth();      // show AI status badge on the form
}

// Allow Enter key on PIN input
document.getElementById("pin-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") checkPin();
});

// Auto-unlock if already authenticated this session
if (sessionStorage.getItem(SESSION_KEY) === "true") showApp();

// ── Tabs ──────────────────────────────────────────────────

function switchTab(tab) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.add("hidden"));
  document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
  document.getElementById(`tab-${tab}`).classList.remove("hidden");
  event.target.classList.add("active");
  if (tab === "submit")    checkApiHealth();
  if (tab === "log")       loadLog();
  if (tab === "dashboard") renderDashboard();
  if (tab === "handoff")   initHandoff();
}

// ── Supabase Realtime ─────────────────────────────────────
// Subscribe once after login; re-fetches entries and re-renders live whenever
// any row on shift_log changes (INSERT / UPDATE / DELETE).

let _realtimeChannel = null;

function subscribeRealtime() {
  if (_realtimeChannel) return;
  try {

  _realtimeChannel = db
    .channel("shift_log_live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "shift_log" },
      async (payload) => {
        await fetchEntries();

        // Refresh whichever tab is currently visible
        const logVisible  = !document.getElementById("tab-log").classList.contains("hidden");
        const dashVisible = !document.getElementById("tab-dashboard").classList.contains("hidden");
        const hoVisible   = !document.getElementById("tab-handoff").classList.contains("hidden");

        if (logVisible)  applyFilters();
        if (dashVisible) renderDashboard();
        if (hoVisible)   generateHandoff();

        // Toast notification
        if (payload.eventType === "INSERT") {
          const et = payload.new?.event_type ?? "entry";
          showRealtimeToast(`New ${et} entry added`);
        }
      }
    )
    .subscribe();
  } catch (e) {
    // Realtime not configured for this table — live updates silently disabled.
    _realtimeChannel = null;
  }
}

function showRealtimeToast(msg) {
  const toast = document.getElementById("rt-toast");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

// ── ML Assist Panel ───────────────────────────────────────
// Calls the FastAPI service while the user types the narrative.
// Degrades silently when the API is not running.

let _mlDebounce = null;
let _apiOnline   = false;

// Check the ML API health endpoint and update the status badge.
async function checkApiHealth() {
  const el = document.getElementById("ai-status");
  if (!el) return;
  setAiStatus("checking");
  try {
    const res = await fetch(`${ML_API}/health`, { method: "GET", signal: AbortSignal.timeout(2500) });
    _apiOnline = res.ok;
  } catch {
    _apiOnline = false;
  }
  setAiStatus(_apiOnline ? "online" : "offline");
}

function setAiStatus(state) {
  const el = document.getElementById("ai-status");
  if (!el) return;
  el.className = `ai-status ai-${state}`;
  const textMap = { online: "AI online", offline: "AI offline", checking: "AI checking…" };
  const tipMap  = {
    online:   "AI predictions active",
    offline:  "AI server offline — run: cd ml && uvicorn api:app --reload",
    checking: "Connecting to AI server…",
  };
  el.querySelector(".ai-status-text").textContent = textMap[state] ?? state;
  el.title = tipMap[state] ?? "";
}

document.getElementById("narrative").addEventListener("input", (e) => {
  clearTimeout(_mlDebounce);
  const text = e.target.value.trim();
  if (text.length < 10) { hideMlPanel(); return; }
  // Show loading state immediately while waiting for the API
  showMlLoading();
  _mlDebounce = setTimeout(() => callMlApi(text), 600);
});

// Re-run when the event-type selector changes (severity depends on it)
document.getElementById("event-type").addEventListener("change", () => {
  const text = document.getElementById("narrative").value.trim();
  if (text.length >= 10) callMlApi(text);
});

function showMlLoading() {
  const panel   = document.getElementById("ml-panel");
  const loading = document.getElementById("ml-loading");
  const sevEl   = document.getElementById("ml-sev-pill");
  const evEl    = document.getElementById("ml-ev-chip");
  if (!panel) return;
  if (sevEl)   { sevEl.className = ""; sevEl.innerHTML = ""; }
  if (evEl)    evEl.classList.add("hidden");
  if (loading) loading.classList.remove("hidden");
  panel.classList.remove("hidden");
}

async function callMlApi(narrative) {
  const eventType = document.getElementById("event-type").value || "Other";
  try {
    const res = await fetch(`${ML_API}/predict`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ narrative, event_type: eventType }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return;
    const d = await res.json();
    _apiOnline = true;
    setAiStatus("online");
    showMlPanel(d);
  } catch {
    _apiOnline = false;
    setAiStatus("offline");
    hideMlPanel();
  }
}

function showMlPanel(d) {
  const loading = document.getElementById("ml-loading");
  if (loading) loading.classList.add("hidden");
  const panel = document.getElementById("ml-panel");

  // Severity pill
  const sevEl = document.getElementById("ml-sev-pill");
  if (d.severity) {
    const pct = Math.round(d.severity_confidence * 100);
    sevEl.className = `ml-sev-pill ${d.severity}`;
    sevEl.innerHTML = `${d.severity} <span class="ml-sev-label">${pct}%</span>`;
  } else {
    sevEl.className = "";
    sevEl.innerHTML = "";
  }

  // Event-type suggestion chip
  const evEl = document.getElementById("ml-ev-chip");
  const currentType = document.getElementById("event-type").value;
  if (d.event_suggestion && d.event_confidence > 0.45 && d.event_suggestion !== currentType) {
    const pct = Math.round(d.event_confidence * 100);
    evEl.className = "ml-ev-chip";
    evEl.innerHTML = `Try: <span class="ml-ev-chip-accept">${escapeHtml(d.event_suggestion)}</span> (${pct}%)`;
    evEl.onclick = () => {
      document.getElementById("event-type").value = d.event_suggestion;
      evEl.classList.add("hidden");
      // Re-run with updated event type
      callMlApi(document.getElementById("narrative").value.trim());
    };
    evEl.classList.remove("hidden");
  } else {
    evEl.classList.add("hidden");
  }

  // Anomaly flag
  const anomEl = document.getElementById("ml-anomaly-flag");
  if (d.is_anomaly) {
    anomEl.classList.remove("hidden");
  } else {
    anomEl.classList.add("hidden");
  }

  panel.classList.remove("hidden");
}

function hideMlPanel() {
  document.getElementById("ml-panel")?.classList.add("hidden");
}

// ── Form Submission ───────────────────────────────────────

// Map a "HH:MM" time to its shift.
// Day 05:30–14:29, Evening 14:30–22:29, Overnight 22:30–05:29
function shiftForTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const mins = h * 60 + m;
  if (mins >= 330 && mins < 870)  return "Day";       // 05:30–14:29
  if (mins >= 870 && mins < 1350) return "Evening";   // 14:30–22:29
  return "Overnight";                                 // 22:30–05:29
}

// Pre-fill date, current time, and the matching shift.
function setDefaults() {
  const now = new Date();

  const yyyy = now.getFullYear();
  const mo   = String(now.getMonth() + 1).padStart(2, "0");
  const da   = String(now.getDate()).padStart(2, "0");
  document.getElementById("date").value = `${yyyy}-${mo}-${da}`;

  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const t  = `${hh}:${mm}`;
  document.getElementById("time").value  = t;
  document.getElementById("shift").value = shiftForTime(t);

  // Remember the staff member's name and campus on this device so they don't retype them.
  const savedName = localStorage.getItem(NAME_KEY);
  if (savedName) document.getElementById("staff-name").value = savedName;
  const savedCampus = localStorage.getItem(CAMPUS_KEY);
  if (savedCampus) document.getElementById("campus").value = savedCampus;
}

// Keep the shift in sync if the user edits the time manually.
document.getElementById("time").addEventListener("input", (e) => {
  if (e.target.value) document.getElementById("shift").value = shiftForTime(e.target.value);
});

document.getElementById("entry-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = document.getElementById("submit-btn");
  const statusEl = document.getElementById("form-status");

  btn.disabled = true;
  btn.textContent = "Submitting...";
  statusEl.classList.add("hidden");
  statusEl.className = "status-msg hidden";

  const form = e.target;
  const row = {
    date:             form.date.value,
    shift:            form.shift.value,
    time:             form.time.value,
    staff_name:       form.staffName.value.trim(),
    campus:           form.campus.value,
    event_type:       form.eventType.value,
    narrative:        form.narrative.value.trim(),
    follow_up_needed: form.followUpNeeded.value,
    follow_up_notes:  form.followUpNotes.value.trim(),
  };

  const files = Array.from(document.getElementById("attach-input").files || []);

  // Remember name + campus on this device regardless of how the entry is saved.
  if (row.staff_name) localStorage.setItem(NAME_KEY, row.staff_name);
  if (row.campus)     localStorage.setItem(CAMPUS_KEY, row.campus);

  try {
    if (!navigator.onLine) throw { __offline: true };

    const attachments = await uploadFiles(files);
    const { error } = await db.from("shift_log").insert({ ...row, attachments });
    if (error) throw error;

    statusEl.textContent = files.length
      ? `Entry submitted with ${files.length} attachment${files.length > 1 ? "s" : ""}.`
      : "Entry submitted successfully.";
    statusEl.className = "status-msg success";
    form.reset();
    setDefaults();
    hideMlPanel();
  } catch (err) {
    if (err && (err.__offline || isNetworkError(err))) {
      // No connection — queue the entry (and its files) locally to sync later.
      try {
        await idbAdd({ row, files });
        await refreshPending();
        statusEl.textContent = "Saved offline — this entry will sync automatically when you're back online.";
        statusEl.className = "status-msg success";
        form.reset();
        setDefaults();
      } catch (qerr) {
        statusEl.textContent = `Could not save offline: ${qerr.message}`;
        statusEl.className = "status-msg error-msg";
      }
    } else {
      statusEl.textContent = `Submission failed: ${err.message}`;
      statusEl.className = "status-msg error-msg";
    }
  } finally {
    statusEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Submit Entry";
  }
});

// ── Helpers ───────────────────────────────────────────────

// Escape user-supplied text before inserting into HTML (prevents XSS / broken markup).
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Turn an event type into a safe CSS class suffix, e.g. "General Note" -> "general-note".
function slug(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// True for fetch/connection failures, so we can fall back to the offline queue.
function isNetworkError(err) {
  if (!err) return false;
  if (err.name === "TypeError") return true;            // e.g. "Failed to fetch"
  const m = (err.message || "").toLowerCase();
  return m.includes("failed to fetch") || m.includes("network") || m.includes("load failed");
}

// ── Log View ──────────────────────────────────────────────

let allEntries = [];     // full dataset from the database (or last cached copy)
let currentView = [];    // currently filtered rows (used by CSV export)
let pendingEntries = []; // entries saved offline, awaiting sync

async function fetchEntries() {
  const { data, error } = await db
    .from("shift_log")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  allEntries = (data || []).map(r => ({
    id:             r.id,
    date:           r.date,
    shift:          r.shift,
    time:           r.time,
    name:           r.staff_name,
    campus:         r.campus,
    eventType:      r.event_type,
    narrative:      r.narrative,
    followUpNeeded: r.follow_up_needed,
    followUpNotes:  r.follow_up_notes,
    resolved:       r.resolved,
    resolvedBy:     r.resolved_by,
    resolvedAt:     r.resolved_at,
    resolutionNotes:r.resolution_notes,
    attachments:    r.attachments || [],
    createdAt:      r.created_at,
  }));

  // Cache a snapshot so the log is viewable offline.
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(allEntries)); } catch (e) {/* quota */}
  return allEntries;
}

async function loadLog() {
  const wrap = document.getElementById("log-table-wrap");
  wrap.innerHTML = "<p class='muted'>Loading entries...</p>";

  let note = "";
  try {
    await fetchEntries();
  } catch (err) {
    // Offline or the request failed: fall back to the last cached snapshot.
    const cached = localStorage.getItem(CACHE_KEY);
    allEntries = cached ? JSON.parse(cached) : [];
    note = navigator.onLine
      ? "Couldn't reach the server — showing the last saved copy."
      : "You're offline — showing the last saved copy.";
  }

  pendingEntries = await getPendingAsEntries();

  const statusEl = document.getElementById("log-status");
  if (statusEl) {
    statusEl.textContent = note;
    statusEl.className = note ? "status-msg error-msg" : "status-msg hidden";
  }

  applyFilters();
}

function isOpen(row)     { return row.followUpNeeded === "Yes" && !row.resolved; }
function isResolved(row) { return row.followUpNeeded === "Yes" &&  row.resolved; }

function applyFilters() {
  const search   = document.getElementById("filter-search").value.trim().toLowerCase();
  const campus   = document.getElementById("filter-campus").value;
  const event    = document.getElementById("filter-event").value;
  const followup = document.getElementById("filter-followup").value;
  const dateFrom = document.getElementById("filter-date-from").value;
  const dateTo   = document.getElementById("filter-date-to").value;

  // Pending (offline) entries appear at the top until they sync.
  currentView = pendingEntries.concat(allEntries).filter(row => {
    if (campus && row.campus    !== campus) return false;
    if (event  && row.eventType !== event)  return false;
    if (followup === "open"     && !isOpen(row))     return false;
    if (followup === "resolved" && !isResolved(row)) return false;
    if (followup === "none"     && row.followUpNeeded !== "No") return false;
    if (dateFrom && row.date < dateFrom)    return false;
    if (dateTo   && row.date > dateTo)      return false;
    if (search) {
      const hay = [row.name, row.narrative, row.followUpNotes, row.campus, row.eventType, row.shift]
        .join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  renderTable(currentView);
  updateSummary(currentView);
  scoreAnomalies(currentView);
}

function clearFilters() {
  ["filter-search","filter-campus","filter-event","filter-followup","filter-date-from","filter-date-to"]
    .forEach(id => { document.getElementById(id).value = ""; });
  applyFilters();
}

function updateSummary(entries) {
  const open = entries.filter(isOpen).length;
  const el = document.getElementById("log-summary");
  el.innerHTML = `
    <span class="summary-pill"><span class="count">${entries.length}</span> entries shown</span>
    <span class="summary-pill ${open ? "alert" : "ok"}">
      <span class="count">${open}</span> open follow-up${open === 1 ? "" : "s"}
    </span>
  `;
}

// ── Anomaly scoring ───────────────────────────────────────
// After the log table renders, batch-score visible entries against the
// IsolationForest model and overlay a warning badge on unusual narratives.
// Only scores the most recent 60 entries to keep the API call fast.

async function scoreAnomalies(entries) {
  // Only score real (non-pending) entries that have an id
  const scoreable = entries.filter(e => !e._pending && e.id).slice(0, 60);
  if (!scoreable.length) return;

  try {
    const res = await fetch(`${ML_API}/anomaly-batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        narratives: scoreable.map(e => ({ id: e.id, text: e.narrative })),
      }),
    });
    if (!res.ok) return;
    const results = await res.json();

    results.forEach(({ id, is_anomaly }) => {
      // Update both table and card badges (duplicate-ID-safe via data attribute)
      document.querySelectorAll(`[data-anomaly-id="${id}"]`).forEach(badge => {
        if (is_anomaly) {
          badge.className = "anomaly-badge";
          badge.textContent = "⚠ Unusual";
          badge.title = "This narrative looks unusual compared to historical entries";
        } else {
          badge.className = "hidden";
        }
      });
    });
  } catch {
    // API unavailable — no badges shown, no error surfaced
  }
}

function renderTable(entries) {
  const wrap = document.getElementById("log-table-wrap");

  if (!entries.length) {
    wrap.innerHTML = "<div class='no-results'>No entries match your filters.</div>";
    return;
  }

  // Build follow-up cell/block (shared between table and cards)
  function followHtml(r) {
    if (r._pending) return `<span class="badge badge-pending">Pending sync</span>`;
    if (isOpen(r))  return `<div class="followup-cell">
        <span class="badge badge-open">Open</span>
        <button class="resolve-btn" onclick="openResolveModal(${r.id})">Resolve</button>
      </div>`;
    if (isResolved(r)) return `<div class="followup-cell">
        <span class="badge badge-resolved">Resolved</span>
        <span class="resolved-meta">by ${escapeHtml(r.resolvedBy) || "—"}<br>${fmtDate(r.resolvedAt)}</span>
      </div>`;
    return `<span class="badge badge-no">No</span>`;
  }

  // ── Desktop table (6 cols: When · Who · Type · Follow-Up · Narrative · Files) ──
  const rows = entries.map(r => {
    // Follow-up cell includes notes + resolution so nothing lives off-screen
    const notesRow = r.followUpNotes
      ? `<div class="followup-notes">${escapeHtml(r.followUpNotes)}</div>`
      : "";
    const resolutionRow = isResolved(r) && r.resolutionNotes
      ? `<div class="resolution-note"><strong>Resolution:</strong> ${escapeHtml(r.resolutionNotes)}</div>`
      : "";

    return `
    <tr class="${r._pending ? "row-pending" : ""}" data-id="${r.id ?? ""}">
      <td class="col-when">
        <span class="when-date">${escapeHtml(r.date)}</span>
        <span class="when-meta">${escapeHtml(r.shift)} &middot; ${escapeHtml(r.time)}</span>
      </td>
      <td class="col-who">
        <span class="who-name">${escapeHtml(r.name)}</span>
        <span class="who-campus">${escapeHtml(r.campus)}</span>
      </td>
      <td><span class="badge badge-${slug(r.eventType)}">${escapeHtml(r.eventType)}</span></td>
      <td class="col-followup">
        ${followHtml(r)}
        ${notesRow}
        ${resolutionRow}
      </td>
      <td class="col-narrative">
        ${escapeHtml(r.narrative)}
        <span data-anomaly-id="${r.id}" class="hidden"></span>
      </td>
      <td>${attachmentsCell(r)}</td>
    </tr>`;
  }).join("");

  // ── Mobile cards ───────────────────────────────────────────
  const cards = entries.map(r => {
    const notesHtml = r.followUpNotes
      ? `<div class="log-card-notes"><span class="log-card-notes-label">Notes:</span> ${escapeHtml(r.followUpNotes)}</div>`
      : "";
    const resolutionHtml = isResolved(r) && r.resolutionNotes
      ? `<div class="log-card-notes log-card-resolution"><span class="log-card-notes-label">Resolution:</span> ${escapeHtml(r.resolutionNotes)}</div>`
      : "";
    const filesHtml = attachmentsCell(r)
      ? `<div class="log-card-files">${attachmentsCell(r)}</div>`
      : "";

    return `
    <div class="log-card ${r._pending ? "log-card-pending" : ""}" data-id="${r.id ?? ""}">
      <div class="log-card-top">
        <span class="badge badge-${slug(r.eventType)}">${escapeHtml(r.eventType)}</span>
        <span class="log-card-meta">${escapeHtml(r.date)} &middot; ${escapeHtml(r.shift)} &middot; ${escapeHtml(r.time)}</span>
      </div>
      <div class="log-card-narrative">
        ${escapeHtml(r.narrative)}
        <span data-anomaly-id="${r.id}" class="hidden"></span>
      </div>
      <div class="log-card-footer">
        <span class="log-card-who">${escapeHtml(r.name)} &middot; ${escapeHtml(r.campus)}</span>
        <div class="log-card-followup">${followHtml(r)}</div>
      </div>
      ${notesHtml}
      ${resolutionHtml}
      ${filesHtml}
    </div>`;
  }).join("");

  wrap.innerHTML = `
    <div class="log-table-desktop">
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Type</th>
            <th>Follow-Up</th>
            <th>Narrative</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="log-cards-mobile">${cards}</div>
  `;
}

// ── Resolve follow-up ─────────────────────────────────────

let pendingResolveId = null;

function openResolveModal(id) {
  pendingResolveId = id;
  const entry = allEntries.find(e => e.id === id);
  document.getElementById("resolve-context").textContent =
    entry ? `${entry.eventType} · ${entry.campus} · ${fmtDate(entry.date)}` : "";
  const nameInput = document.getElementById("resolve-name");
  nameInput.value = localStorage.getItem("shiftlog_resolver") || "";
  document.getElementById("resolve-notes").value = entry && entry.resolutionNotes ? entry.resolutionNotes : "";
  document.getElementById("resolve-error").classList.add("hidden");
  document.getElementById("resolve-modal").classList.remove("hidden");
  nameInput.focus();
}

function closeResolveModal() {
  pendingResolveId = null;
  document.getElementById("resolve-modal").classList.add("hidden");
}

async function confirmResolve() {
  const name = document.getElementById("resolve-name").value.trim();
  const notes = document.getElementById("resolve-notes").value.trim();
  const errEl = document.getElementById("resolve-error");

  if (!name) {
    errEl.textContent = "Please enter your name.";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    const { error } = await db.from("shift_log")
      .update({ resolved: true, resolved_by: name, resolved_at: new Date().toISOString(), resolution_notes: notes })
      .eq("id", pendingResolveId);
    if (error) throw error;

    localStorage.setItem("shiftlog_resolver", name);
    closeResolveModal();
    await loadLog();
  } catch (err) {
    errEl.textContent = `Could not resolve: ${err.message}`;
    errEl.classList.remove("hidden");
  }
}

// ── Attachments (photos / documents) ──────────────────────

// Upload each File to Supabase Storage; return metadata to store on the row.
async function uploadFiles(files) {
  if (!files || !files.length) return [];
  const folder = crypto.randomUUID ? crypto.randomUUID()
    : String(Date.now()) + Math.random().toString(36).slice(2);
  const out = [];
  for (const f of files) {
    const safe = (f.name || "file").replace(/[^\w.\-]+/g, "_");
    const path = `${folder}/${Date.now()}_${safe}`;
    const { error } = await db.storage.from(ATTACH_BUCKET).upload(path, f, {
      contentType: f.type || undefined,
      upsert: false,
    });
    if (error) throw error;
    out.push({ path, name: f.name, type: f.type || "", size: f.size || 0 });
  }
  return out;
}

// Build the table cell that lists an entry's attachments.
function attachmentsCell(r) {
  if (r._pending) {
    const n = (r._files && r._files.length) || 0;
    return n ? `<span class="attach-pending">${n} file${n > 1 ? "s" : ""} (pending)</span>` : "";
  }
  const list = r.attachments || [];
  if (!list.length) return "";
  return `<div class="attach-list">` + list.map((a, i) => {
    const name  = a.name || "file";
    const label = name.length > 20 ? name.slice(0, 18) + "…" : name;
    return `<button class="attach-chip" title="${escapeHtml(name)}" onclick="openAttachment(${r.id}, ${i})">📎 ${escapeHtml(label)}</button>`;
  }).join("") + `</div>`;
}

// Open a private file via a short-lived signed URL.
async function openAttachment(id, idx) {
  const entry = allEntries.find(e => String(e.id) === String(id));
  if (!entry || !entry.attachments || !entry.attachments[idx]) return;
  try {
    const { data, error } = await db.storage
      .from(ATTACH_BUCKET)
      .createSignedUrl(entry.attachments[idx].path, 120);
    if (error) throw error;
    window.open(data.signedUrl, "_blank", "noopener");
  } catch (err) {
    alert("Could not open attachment: " + err.message);
  }
}

// ── CSV export ────────────────────────────────────────────

function exportCsv() {
  if (!currentView.length) { alert("No entries to export."); return; }

  const headers = ["Date","Shift","Time","Name","Campus","Event Type","Narrative",
                   "Follow-Up Needed","Follow-Up Notes/Assigned To","Resolved","Resolved By","Resolved At","Resolution Notes","Attachments"];

  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lines = [headers.join(",")];
  currentView.forEach(r => {
    const attachNames = (r.attachments || []).map(a => a.name).join("; ");
    lines.push([
      r.date, r.shift, r.time, r.name, r.campus, r.eventType, r.narrative,
      r.followUpNeeded, r.followUpNotes,
      r.resolved ? "Yes" : "No", r.resolvedBy, r.resolvedAt ? fmtDate(r.resolvedAt) : "", r.resolutionNotes,
      attachNames
    ].map(cell).join(","));
  });

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `shift-log-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Offline queue & sync ──────────────────────────────────
// Entries logged without a connection are stored in IndexedDB (with their
// files) and pushed to Supabase when the connection returns.

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const dbi = req.result;
      if (!dbi.objectStoreNames.contains(IDB_STORE)) {
        dbi.createObjectStore(IDB_STORE, { keyPath: "key", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbAdd(value) {
  return idbOpen().then(dbi => new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).add({ value, ts: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbGetAll() {
  return idbOpen().then(dbi => new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, "readonly");
    const out = [];
    tx.objectStore(IDB_STORE).openCursor().onsuccess = (e) => {
      const cur = e.target.result;
      if (cur) { out.push({ key: cur.key, value: cur.value.value }); cur.continue(); }
      else resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  }));
}

function idbDelete(key) {
  return idbOpen().then(dbi => new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  }));
}

function idbCount() {
  return idbOpen().then(dbi => new Promise((resolve, reject) => {
    const tx = dbi.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).count();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })).catch(() => 0);
}

// Map queued records into the same shape the log table renders.
async function getPendingAsEntries() {
  let items = [];
  try { items = await idbGetAll(); } catch (e) { items = []; }
  return items.map(it => {
    const r = (it.value && it.value.row) || {};
    return {
      id: "pending-" + it.key,
      _pending: true,
      _files: (it.value && it.value.files) || [],
      date: r.date, shift: r.shift, time: r.time,
      name: r.staff_name, campus: r.campus, eventType: r.event_type,
      narrative: r.narrative, followUpNeeded: r.follow_up_needed,
      followUpNotes: r.follow_up_notes,
      resolved: false, attachments: [],
    };
  });
}

// Show "Offline" in the header when there's no connection.
function updateNetStatus() {
  const el = document.getElementById("net-status");
  if (el) el.classList.toggle("hidden", navigator.onLine);
}

// Show "N pending sync" in the header.
async function refreshPending() {
  const n = await idbCount();
  const badge = document.getElementById("pending-badge");
  if (!badge) return;
  badge.textContent = `${n} pending sync`;
  badge.classList.toggle("hidden", n === 0);
}

// Push queued entries to Supabase. Stops on the first failure and retries later.
let syncing = false;
async function flushQueue() {
  if (syncing || !navigator.onLine) return;
  syncing = true;
  let synced = 0;
  try {
    const items = await idbGetAll();
    for (const it of items) {
      try {
        const attachments = await uploadFiles(it.value.files || []);
        const { error } = await db.from("shift_log").insert({ ...it.value.row, attachments });
        if (error) throw error;
        await idbDelete(it.key);
        synced++;
      } catch (e) {
        break;   // leave this and the rest queued for the next attempt
      }
    }
  } finally {
    syncing = false;
    await refreshPending();
    const logVisible = !document.getElementById("tab-log").classList.contains("hidden");
    if (synced > 0 && logVisible) loadLog();
  }
}

// React to connectivity changes.
window.addEventListener("online", () => { updateNetStatus(); flushQueue(); });
window.addEventListener("offline", updateNetStatus);

// ── Shift handoff summary ─────────────────────────────────

let lastHandoffText = "";

function fmtFullDate(s) {
  const d = parseLocalDate(s);
  if (!d) return s || "";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

// Rough age of an open follow-up, for triage ("3d open", "5h open").
function ageLabel(entry) {
  const base = entry.createdAt ? new Date(entry.createdAt) : parseLocalDate(entry.date);
  if (!base || isNaN(base)) return "";
  const ms = Date.now() - base.getTime();
  if (ms < 0) return "new";
  const days = Math.floor(ms / 86400000);
  if (days >= 1) return `${days}d open`;
  return `${Math.max(1, Math.floor(ms / 3600000))}h open`;
}

async function initHandoff() {
  const dateEl = document.getElementById("ho-date");
  if (!dateEl.value) {
    const now = new Date();
    dateEl.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const t = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    document.getElementById("ho-shift").value = shiftForTime(t);
  }
  const byEl = document.getElementById("ho-by");
  if (!byEl.value) byEl.value = localStorage.getItem(NAME_KEY) || localStorage.getItem("shiftlog_resolver") || "";

  try {
    if (!allEntries.length) await fetchEntries();
  } catch (e) {
    const cached = localStorage.getItem(CACHE_KEY);
    allEntries = cached ? JSON.parse(cached) : [];
  }
  generateHandoff();
}

function generateHandoff() {
  const out = document.getElementById("handoff-output");
  if (!out) return;

  const campus = document.getElementById("ho-campus").value;
  const date   = document.getElementById("ho-date").value;
  const shift  = document.getElementById("ho-shift").value;
  const by     = document.getElementById("ho-by").value.trim();

  if (!date) {
    out.innerHTML = `<p class="handoff-empty">Pick a date to generate the summary.</p>`;
    lastHandoffText = "";
    return;
  }

  const inScope = (e) => !campus || e.campus === campus;
  const shiftEntries = allEntries
    .filter(e => e.date === date && e.shift === shift && inScope(e))
    .sort((a, b) => (a.time || "").localeCompare(b.time || ""));
  const openItems = allEntries
    .filter(e => isOpen(e) && inScope(e))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));   // oldest first = most urgent

  const byType    = countBy(shiftEntries, "eventType");
  const incidents = byType["Incident"] || 0;
  const medical   = byType["Medical"] || 0;
  const behavioral = byType["Behavioral"] || 0;
  const campusLabel = campus || "All Campuses";
  const generatedAt = new Date().toLocaleString();

  // On-screen HTML report.
  const statHtml = `
    <div class="ho-stats">
      <span class="ho-stat"><b>${shiftEntries.length}</b> entries this shift</span>
      <span class="ho-stat ${incidents ? "alert" : ""}"><b>${incidents}</b> incident${incidents === 1 ? "" : "s"}</span>
      <span class="ho-stat"><b>${medical}</b> medical</span>
      <span class="ho-stat ${openItems.length ? "alert" : ""}"><b>${openItems.length}</b> open follow-up${openItems.length === 1 ? "" : "s"}</span>
    </div>`;

  const openHtml = openItems.length
    ? `<ol class="ho-list">` + openItems.map(e => `
        <li class="ho-item">
          <div class="ho-item-head">${escapeHtml(e.eventType)} — ${escapeHtml(e.campus)} <span class="ho-meta">· ${escapeHtml(fmtDate(e.date))} · ${escapeHtml(e.name) || "—"} · <span class="ho-age">${ageLabel(e)}</span></span></div>
          <div class="ho-item-action"><b>Action:</b> ${escapeHtml(e.followUpNotes) || "—"}</div>
          <div class="ho-item-note">${escapeHtml(e.narrative)}</div>
        </li>`).join("") + `</ol>`
    : `<p class="ho-none">No open follow-ups — nothing outstanding.</p>`;

  const shiftHtml = shiftEntries.length
    ? `<ul class="ho-list">` + shiftEntries.map(e => {
        const status = isOpen(e) ? "Follow-up OPEN" : isResolved(e) ? "Follow-up resolved" : "No follow-up";
        return `
        <li class="ho-item">
          <div class="ho-item-head">${escapeHtml(e.time)} · ${escapeHtml(e.eventType)} · ${escapeHtml(e.campus)} <span class="ho-meta">· ${escapeHtml(e.name) || "—"}</span></div>
          <div class="ho-item-note">${escapeHtml(e.narrative)}</div>
          <div class="ho-item-action"><b>${status}</b></div>
        </li>`;
      }).join("") + `</ul>`
    : `<p class="ho-none">No entries were logged for this shift.</p>`;

  out.innerHTML = `
    <div class="ho-report">
      <div class="ho-title">Shift Handoff — ${escapeHtml(campusLabel)}</div>
      <div class="ho-sub">${escapeHtml(fmtFullDate(date))} · ${escapeHtml(shift)} shift · Prepared by ${escapeHtml(by) || "—"} · Generated ${escapeHtml(generatedAt)}</div>
      ${statHtml}
      <div class="ho-section">
        <h4>Open follow-ups requiring attention (${openItems.length})</h4>
        ${openHtml}
      </div>
      <div class="ho-section">
        <h4>Entries this shift (${shiftEntries.length})</h4>
        ${shiftHtml}
      </div>
    </div>`;

  // Plain-text version for copy / print.
  const L = [];
  L.push("SHIFT HANDOFF SUMMARY");
  L.push(`${campusLabel} — ${fmtFullDate(date)} — ${shift} shift`);
  L.push(`Prepared by: ${by || "—"}`);
  L.push(`Generated: ${generatedAt}`);
  L.push("");
  L.push("SNAPSHOT");
  L.push(`- Entries this shift: ${shiftEntries.length}`);
  L.push(`- Incidents: ${incidents}   Medical: ${medical}   Behavioral: ${behavioral}`);
  L.push(`- Open follow-ups (all dates): ${openItems.length}`);
  L.push("");
  L.push(`OPEN FOLLOW-UPS REQUIRING ATTENTION (${openItems.length})`);
  if (openItems.length) {
    openItems.forEach((e, i) => {
      L.push(`${i + 1}. ${fmtDate(e.date)} · ${e.campus} · ${e.eventType} (${ageLabel(e)}, logged by ${e.name || "—"})`);
      L.push(`   Action: ${e.followUpNotes || "—"}`);
      L.push(`   Note: ${e.narrative}`);
    });
  } else {
    L.push("None outstanding.");
  }
  L.push("");
  L.push(`ENTRIES THIS SHIFT (${shiftEntries.length})`);
  if (shiftEntries.length) {
    shiftEntries.forEach(e => {
      const status = isOpen(e) ? "Follow-up OPEN" : isResolved(e) ? "Follow-up resolved" : "No follow-up";
      L.push(`- ${e.time} · ${e.eventType} · ${e.campus} · ${e.name || "—"}`);
      L.push(`  ${e.narrative}`);
      L.push(`  ${status}`);
    });
  } else {
    L.push("No entries were logged for this shift.");
  }
  lastHandoffText = L.join("\n");
}

async function copyHandoff() {
  if (!lastHandoffText) { alert("Generate a summary first."); return; }
  try {
    await navigator.clipboard.writeText(lastHandoffText);
    const btn = window.event && window.event.target;
    if (btn) { const o = btn.textContent; btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = o; }, 1500); }
  } catch (e) {
    alert("Copy failed — you can select the summary text manually.");
  }
}

function printHandoff() {
  if (!lastHandoffText) { alert("Generate a summary first."); return; }
  const w = window.open("", "_blank");
  if (!w) { alert("Allow pop-ups to print the summary."); return; }
  w.document.write(`<pre style="font:13px/1.6 -apple-system,Segoe UI,Roboto,sans-serif;white-space:pre-wrap;padding:24px;margin:0">${escapeHtml(lastHandoffText)}</pre>`);
  w.document.title = "Shift Handoff Summary";
  w.document.close();
  w.focus();
  w.print();
}

// ── Dashboard ─────────────────────────────────────────────

const charts = {};

function countBy(entries, key) {
  const out = {};
  entries.forEach(e => { const k = e[key] || "—"; out[k] = (out[k] || 0) + 1; });
  return out;
}

function drawChart(id, type, labels, data, colors) {
  if (charts[id]) charts[id].destroy();
  const isLine = type === "line";
  charts[id] = new Chart(document.getElementById(id), {
    type,
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: isLine ? "rgba(37,99,235,.12)" : colors,
        borderColor:     isLine ? "#2563eb" : undefined,
        borderWidth:     isLine ? 2 : 0,
        fill:            isLine,
        tension:         isLine ? 0.3 : 0,
        pointRadius:     isLine ? 2 : undefined,
        pointBackgroundColor: isLine ? "#2563eb" : undefined,
      }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: type === "doughnut" } },
      scales: (type === "bar" || isLine)
        ? { y: { beginAtZero: true, ticks: { precision: 0 } } }
        : {},
    },
  });
}

// Parse a "YYYY-MM-DD" string as a LOCAL date (avoids the UTC off-by-one).
function parseLocalDate(s) {
  if (!s) return null;
  const [y, m, d] = String(s).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

// Counts of entries per weekday, Monday-first.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function weekdayCounts(entries) {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  entries.forEach(e => {
    const d = parseLocalDate(e.date);
    if (d) counts[(d.getDay() + 6) % 7]++;   // getDay: 0=Sun -> Mon-first index
  });
  return counts;
}

// Counts of entries per hour (0-23) from the "HH:MM" time field.
const HOUR_LABELS = Array.from({ length: 24 }, (_, h) => (h % 12 || 12) + (h < 12 ? "a" : "p"));
function hourCounts(entries) {
  const counts = new Array(24).fill(0);
  entries.forEach(e => {
    const h = e.time ? parseInt(e.time.split(":")[0], 10) : NaN;
    if (!isNaN(h) && h >= 0 && h < 24) counts[h]++;
  });
  return counts;
}
function formatHour(h) {
  const ampm = h < 12 ? "AM" : "PM";
  return `${h % 12 || 12} ${ampm}`;
}

// Index of the largest value, or -1 if every bucket is empty.
function peakIndex(arr) {
  const max = Math.max(...arr);
  return max > 0 ? arr.indexOf(max) : -1;
}

// Format a Date as a local "YYYY-MM-DD" key.
function localKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Daily entry counts across [from, to] inclusive (continuous series, capped at 90 days).
function dailyTrendRange(entries, from, to) {
  const byDate = {};
  entries.forEach(e => { if (e.date) byDate[e.date] = (byDate[e.date] || 0) + 1; });

  let start = from ? new Date(from) : null;
  let end   = to   ? new Date(to)   : new Date();
  if (!start) {
    const dates = entries.map(e => parseLocalDate(e.date)).filter(Boolean).sort((a, b) => a - b);
    start = dates.length ? new Date(dates[0]) : new Date();
  }
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);

  const DAY = 86400000, MAX_DAYS = 90;
  let days = Math.round((end - start) / DAY) + 1;
  if (days > MAX_DAYS) { start = new Date(end.getTime() - (MAX_DAYS - 1) * DAY); days = MAX_DAYS; }
  if (days < 1) days = 1;

  const labels = [], data = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i);
    labels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
    data.push(byDate[localKey(d)] || 0);
  }
  return { labels, data };
}

// Count-based metrics shown on the stat cards.
function metrics(entries) {
  return {
    total:     entries.length,
    open:      entries.filter(isOpen).length,
    resolved:  entries.filter(isResolved).length,
    incidents: entries.filter(e => e.eventType === "Incident").length,
  };
}

// Keep entries whose date falls within [from, to]; either bound may be null (unbounded).
function entriesInRange(entries, from, to) {
  if (!from && !to) return entries.slice();
  return entries.filter(e => {
    const d = parseLocalDate(e.date);
    if (!d) return false;
    if (from && d < from) return false;
    if (to && d > to)     return false;
    return true;
  });
}

// Resolve the dashboard's selected period into current + previous date ranges.
function getDashRange() {
  const sel = document.getElementById("dash-range").value;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let from = null, to = null, label = "", title = "";

  if (sel === "all") {
    return { from: null, to: null, prevFrom: null, prevTo: null, label: "", title: "all time" };
  } else if (sel === "custom") {
    const f = document.getElementById("dash-from").value;
    const t = document.getElementById("dash-to").value;
    from = f ? parseLocalDate(f) : null;
    to   = t ? parseLocalDate(t) : new Date(today);
    label = "vs prev period";
    title = (from ? from.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "start")
          + " – " + to.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } else if (sel === "month") {
    from = new Date(today.getFullYear(), today.getMonth(), 1);
    to   = new Date(today);
    label = "vs prev period";
    title = "this month";
  } else {
    const n = parseInt(sel, 10);   // 7 or 30
    to   = new Date(today);
    from = new Date(today); from.setDate(today.getDate() - (n - 1));
    label = n === 7 ? "vs last week" : `vs prev ${n} days`;
    title = `last ${n} days`;
  }

  let prevFrom = null, prevTo = null;
  if (from && to) {
    const DAY = 86400000;
    const lenDays = Math.round((to - from) / DAY) + 1;
    prevTo   = new Date(from.getTime() - DAY);
    prevFrom = new Date(prevTo.getTime() - (lenDays - 1) * DAY);
    prevFrom.setHours(0, 0, 0, 0); prevTo.setHours(0, 0, 0, 0);
  }
  return { from, to, prevFrom, prevTo, label, title };
}

// Small ▲/▼ badge comparing a metric to the previous period.
// good = "up" | "down" sets the green/red sense; omit for neutral coloring.
function deltaBadge(cur, prev, label, good) {
  if (!label) return "";
  const diff = cur - prev;
  let cls = "flat";
  if (diff !== 0 && good) cls = ((diff > 0 && good === "up") || (diff < 0 && good === "down")) ? "good" : "bad";
  else if (diff !== 0)    cls = "neutral";
  const arrow = diff > 0 ? "▲" : diff < 0 ? "▼" : "▬";
  const sign  = diff > 0 ? "+" : "";
  return `<div class="stat-delta ${cls}">${arrow} ${sign}${diff}<span class="stat-delta-label"> ${label}</span></div>`;
}

// Dashboard filter controls.
function onDashRangeChange() {
  const custom = document.getElementById("dash-range").value === "custom";
  ["dash-from", "dash-dash", "dash-to"].forEach(id =>
    document.getElementById(id).classList.toggle("hidden", !custom));
  renderDashboard();
}
function onDashCustom() {
  document.getElementById("dash-range").value = "custom";
  ["dash-from", "dash-dash", "dash-to"].forEach(id =>
    document.getElementById(id).classList.remove("hidden"));
  renderDashboard();
}

// Average time between submission and resolution, in ms (null if none resolved).
function avgResolutionMs(entries) {
  const rows = entries.filter(e => e.resolved && e.resolvedAt && e.createdAt);
  if (!rows.length) return null;
  const sum = rows.reduce((s, e) => s + Math.max(0, new Date(e.resolvedAt) - new Date(e.createdAt)), 0);
  return sum / rows.length;
}
function fmtDuration(ms) {
  if (ms == null) return "—";
  const hrs = ms / 3600000;
  if (hrs < 1)  return `${Math.round(ms / 60000)} min`;
  if (hrs < 24) return `${Math.round(hrs * 10) / 10} hr`;
  return `${Math.round(hrs / 24 * 10) / 10} days`;
}

async function renderDashboard() {
  try {
    if (!allEntries.length) await fetchEntries();
  } catch (err) {
    document.getElementById("stat-grid").innerHTML =
      `<p class='muted' style='color:#dc2626'>Failed to load: ${escapeHtml(err.message)}</p>`;
    return;
  }

  // Scope every stat and chart to the selected period, and compare to the
  // previous equal-length period for the delta badges.
  const { from, to, prevFrom, prevTo, label, title } = getDashRange();
  const cur  = entriesInRange(allEntries, from, to);
  const prev = entriesInRange(allEntries, prevFrom, prevTo);
  const m = metrics(cur);
  const p = metrics(prev);

  const wd = weekdayCounts(cur);
  const hc = hourCounts(cur);
  const wdPeak = peakIndex(wd);
  const hcPeak = peakIndex(hc);
  const busiestDay = wdPeak >= 0 ? WEEKDAYS[wdPeak] : "—";
  const peakTime   = hcPeak >= 0 ? formatHour(hcPeak) : "—";
  const avgResStr  = fmtDuration(avgResolutionMs(cur));

  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card"><div class="stat-value">${m.total}</div><div class="stat-label">Total Entries</div>${deltaBadge(m.total, p.total, label)}</div>
    <div class="stat-card ${m.open ? "alert" : ""}"><div class="stat-value">${m.open}</div><div class="stat-label">Open Follow-Ups</div>${deltaBadge(m.open, p.open, label, "down")}</div>
    <div class="stat-card"><div class="stat-value">${m.resolved}</div><div class="stat-label">Resolved Follow-Ups</div>${deltaBadge(m.resolved, p.resolved, label, "up")}</div>
    <div class="stat-card"><div class="stat-value">${m.incidents}</div><div class="stat-label">Incidents Logged</div>${deltaBadge(m.incidents, p.incidents, label, "down")}</div>
    <div class="stat-card"><div class="stat-value">${busiestDay}</div><div class="stat-label">Busiest Day</div></div>
    <div class="stat-card"><div class="stat-value">${peakTime}</div><div class="stat-label">Peak Time</div></div>
    <div class="stat-card"><div class="stat-value">${avgResStr}</div><div class="stat-label">Avg. Resolution Time</div></div>
  `;

  const palette = ["#2563eb","#ea580c","#9333ea","#ca8a04","#16a34a","#dc2626","#0891b2","#64748b"];

  const ev = countBy(cur, "eventType");
  drawChart("chart-event", "bar", Object.keys(ev), Object.values(ev), palette);

  const ca = countBy(cur, "campus");
  drawChart("chart-campus", "bar", Object.keys(ca), Object.values(ca), palette);

  const none = cur.filter(e => e.followUpNeeded === "No").length;
  drawChart("chart-followup", "doughnut",
    ["Open","Resolved","Not needed"], [m.open, m.resolved, none],
    ["#dc2626","#16a34a","#cbd5e1"]);

  const sh = countBy(cur, "shift");
  drawChart("chart-shift", "bar", Object.keys(sh), Object.values(sh), palette);

  drawChart("chart-weekday", "bar", WEEKDAYS, wd, "#2563eb");
  drawChart("chart-hour", "bar", HOUR_LABELS, hc, "#0891b2");

  document.getElementById("trend-title").textContent = `Entries Over Time (${title})`;
  const trend = dailyTrendRange(cur, from, to);
  drawChart("chart-trend", "line", trend.labels, trend.data);
}
