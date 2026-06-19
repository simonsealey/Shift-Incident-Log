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
  setDefaultDate();
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
  if (tab === "log") loadLog();
}

// ── Form Submission ───────────────────────────────────────

function setDefaultDate() {
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("date").value = today;
}

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
    initials:         form.initials.value.trim().toUpperCase(),
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
    setDefaultDate();
  } catch (err) {
    statusEl.textContent = `Submission failed: ${err.message}`;
    statusEl.className = "status-msg error-msg";
  } finally {
    statusEl.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = "Submit Entry";
  }
});

// ── Log View ──────────────────────────────────────────────

let allEntries = [];

async function loadLog() {
  const wrap = document.getElementById("log-table-wrap");
  wrap.innerHTML = "<p class='muted'>Loading entries...</p>";

  try {
    const { data, error } = await db
      .from("shift_log")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;

    allEntries = (data || []).map(r => ({
      date:           r.date,
      shift:          r.shift,
      time:           r.time,
      initials:       r.initials,
      campus:         r.campus,
      eventType:      r.event_type,
      narrative:      r.narrative,
      followUpNeeded: r.follow_up_needed,
      followUpNotes:  r.follow_up_notes,
    }));
    renderTable(allEntries);
  } catch (err) {
    wrap.innerHTML = `<p class='muted' style='color:#dc2626'>Failed to load entries: ${err.message}</p>`;
  }
}

function applyFilters() {
  const campus   = document.getElementById("filter-campus").value;
  const event    = document.getElementById("filter-event").value;
  const followup = document.getElementById("filter-followup").value;
  const dateFrom = document.getElementById("filter-date-from").value;
  const dateTo   = document.getElementById("filter-date-to").value;

  const filtered = allEntries.filter(row => {
    if (campus   && row.campus    !== campus)   return false;
    if (event    && row.eventType !== event)    return false;
    if (followup && row.followUpNeeded !== followup) return false;
    if (dateFrom && row.date < dateFrom)        return false;
    if (dateTo   && row.date > dateTo)          return false;
    return true;
  });

  renderTable(filtered);
}

function clearFilters() {
  ["filter-campus","filter-event","filter-followup","filter-date-from","filter-date-to"]
    .forEach(id => { document.getElementById(id).value = ""; });
  renderTable(allEntries);
}

function renderTable(entries) {
  const wrap = document.getElementById("log-table-wrap");

  if (!entries.length) {
    wrap.innerHTML = "<div class='no-results'>No entries match your filters.</div>";
    return;
  }

  const rows = entries.map(r => `
    <tr>
      <td>${r.date || ""}</td>
      <td>${r.shift || ""}</td>
      <td>${r.time || ""}</td>
      <td>${r.initials || ""}</td>
      <td>${r.campus || ""}</td>
      <td><span class="badge badge-${(r.eventType||"").toLowerCase()}">${r.eventType || ""}</span></td>
      <td style="min-width:340px;max-width:480px">${r.narrative || ""}</td>
      <td><span class="badge ${r.followUpNeeded === "Yes" ? "badge-yes" : "badge-no"}">${r.followUpNeeded || ""}</span></td>
      <td>${r.followUpNotes || ""}</td>
    </tr>
  `).join("");

  wrap.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Shift</th>
          <th>Time</th>
          <th>Initials</th>
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
