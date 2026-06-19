// ── Supabase config ── replace these two with your project's values
// (Supabase dashboard → Project Settings → API)
const SUPABASE_URL      = "https://ruaioaonbejgbjafozuz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_QFxZOVuw_lWOKopvMGRBQg_9RTj9RNw";

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CORRECT_PIN = "1474";
const SESSION_KEY = "shiftlog_auth";

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
  if (tab === "log")       loadLog();
  if (tab === "dashboard") renderDashboard();
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

  try {
    const { error } = await db.from("shift_log").insert(row);
    if (error) throw error;

    statusEl.textContent = "Entry submitted successfully.";
    statusEl.className = "status-msg success";
    form.reset();
    setDefaults();
  } catch (err) {
    statusEl.textContent = `Submission failed: ${err.message}`;
    statusEl.className = "status-msg error-msg";
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

// ── Log View ──────────────────────────────────────────────

let allEntries = [];   // full dataset
let currentView = [];  // currently filtered rows (used by CSV export)

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
  }));
  return allEntries;
}

async function loadLog() {
  const wrap = document.getElementById("log-table-wrap");
  wrap.innerHTML = "<p class='muted'>Loading entries...</p>";
  try {
    await fetchEntries();
    applyFilters();
  } catch (err) {
    wrap.innerHTML = `<p class='muted' style='color:#dc2626'>Failed to load entries: ${escapeHtml(err.message)}</p>`;
  }
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

  currentView = allEntries.filter(row => {
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

function renderTable(entries) {
  const wrap = document.getElementById("log-table-wrap");

  if (!entries.length) {
    wrap.innerHTML = "<div class='no-results'>No entries match your filters.</div>";
    return;
  }

  const rows = entries.map(r => {
    let followCell;
    if (isOpen(r)) {
      followCell = `<div class="followup-cell">
        <span class="badge badge-open">Open</span>
        <button class="resolve-btn" onclick="openResolveModal(${r.id})">Resolve</button>
      </div>`;
    } else if (isResolved(r)) {
      followCell = `<div class="followup-cell">
        <span class="badge badge-resolved">Resolved</span>
        <span class="resolved-meta">by ${escapeHtml(r.resolvedBy) || "—"}<br>${fmtDate(r.resolvedAt)}</span>
      </div>`;
    } else {
      followCell = `<span class="badge badge-no">No</span>`;
    }

    return `
    <tr>
      <td>${escapeHtml(r.date)}</td>
      <td>${escapeHtml(r.shift)}</td>
      <td>${escapeHtml(r.time)}</td>
      <td>${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.campus)}</td>
      <td><span class="badge badge-${slug(r.eventType)}">${escapeHtml(r.eventType)}</span></td>
      <td style="min-width:340px;max-width:480px;white-space:pre-wrap">${escapeHtml(r.narrative)}</td>
      <td>${followCell}</td>
      <td>${escapeHtml(r.followUpNotes)}</td>
    </tr>`;
  }).join("");

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Shift</th>
          <th>Time</th>
          <th>Name</th>
          <th>Campus</th>
          <th>Event Type</th>
          <th>Narrative</th>
          <th>Follow-Up</th>
          <th>Notes / Assigned To</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
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
  const errEl = document.getElementById("resolve-error");

  if (!name) {
    errEl.textContent = "Please enter your name.";
    errEl.classList.remove("hidden");
    return;
  }

  try {
    const { error } = await db.from("shift_log")
      .update({ resolved: true, resolved_by: name, resolved_at: new Date().toISOString() })
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

// ── CSV export ────────────────────────────────────────────

function exportCsv() {
  if (!currentView.length) { alert("No entries to export."); return; }

  const headers = ["Date","Shift","Time","Name","Campus","Event Type","Narrative",
                   "Follow-Up Needed","Follow-Up Notes/Assigned To","Resolved","Resolved By","Resolved At"];

  const cell = v => `"${String(v ?? "").replace(/"/g, '""')}"`;

  const lines = [headers.join(",")];
  currentView.forEach(r => {
    lines.push([
      r.date, r.shift, r.time, r.name, r.campus, r.eventType, r.narrative,
      r.followUpNeeded, r.followUpNotes,
      r.resolved ? "Yes" : "No", r.resolvedBy, r.resolvedAt ? fmtDate(r.resolvedAt) : ""
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

// ── Dashboard ─────────────────────────────────────────────

const charts = {};

function countBy(entries, key) {
  const out = {};
  entries.forEach(e => { const k = e[key] || "—"; out[k] = (out[k] || 0) + 1; });
  return out;
}

function drawChart(id, type, labels, data, colors) {
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(document.getElementById(id), {
    type,
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0 }],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: type === "doughnut" } },
      scales: type === "bar"
        ? { y: { beginAtZero: true, ticks: { precision: 0 } } }
        : {},
    },
  });
}

async function renderDashboard() {
  try {
    if (!allEntries.length) await fetchEntries();
  } catch (err) {
    document.getElementById("stat-grid").innerHTML =
      `<p class='muted' style='color:#dc2626'>Failed to load: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const total    = allEntries.length;
  const open     = allEntries.filter(isOpen).length;
  const resolved = allEntries.filter(isResolved).length;
  const incidents = allEntries.filter(e => e.eventType === "Incident").length;

  document.getElementById("stat-grid").innerHTML = `
    <div class="stat-card"><div class="stat-value">${total}</div><div class="stat-label">Total Entries</div></div>
    <div class="stat-card ${open ? "alert" : ""}"><div class="stat-value">${open}</div><div class="stat-label">Open Follow-Ups</div></div>
    <div class="stat-card"><div class="stat-value">${resolved}</div><div class="stat-label">Resolved Follow-Ups</div></div>
    <div class="stat-card"><div class="stat-value">${incidents}</div><div class="stat-label">Incidents Logged</div></div>
  `;

  const palette = ["#2563eb","#ea580c","#9333ea","#ca8a04","#16a34a","#dc2626","#0891b2","#64748b"];

  const ev = countBy(allEntries, "eventType");
  drawChart("chart-event", "bar", Object.keys(ev), Object.values(ev), palette);

  const ca = countBy(allEntries, "campus");
  drawChart("chart-campus", "bar", Object.keys(ca), Object.values(ca), palette);

  const none = allEntries.filter(e => e.followUpNeeded === "No").length;
  drawChart("chart-followup", "doughnut",
    ["Open","Resolved","Not needed"], [open, resolved, none],
    ["#dc2626","#16a34a","#cbd5e1"]);

  const sh = countBy(allEntries, "shift");
  drawChart("chart-shift", "bar", Object.keys(sh), Object.values(sh), palette);
}
