/* =========================================================================
   Spanel Planetarium — Availability Calendar
   Static app. Backends: LocalBackend (localStorage) | CloudBackend (Supabase).
   Cloud mode supports Supabase Auth: with the SECURE schema, only signed-in
   staff can read/write. A sanitized .ics feed omits contact name/email.
   ========================================================================= */
"use strict";

/* ---------------------------- constants --------------------------------- */
const STATUSES = ["open", "tentative", "confirmed"];
const STATUS_LABEL = { open: "Open", tentative: "Tentative", confirmed: "Confirmed" };
const STATUS_GLYPH = { open: "○", tentative: "◐", confirmed: "●" };
const STATUS_COLOR = { open: "#8792ab", tentative: "#e6a417", confirmed: "#2f9e5f" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAYS_LONG = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const MONTH_ABBR = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const STANDARD_SLOTS = ["10:00", "11:00", "12:00", "13:00", "14:00"];
const STANDARD_WEEKDAYS = [1, 2, 3, 4, 5];
const CAL_MONTHS = 4; // show current month + next three

/* ---------------------------- date helpers ------------------------------ */
function ymd(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; }
function parseYMD(s) { const [y,m,d] = s.split("-").map(Number); return new Date(y, m-1, d, 12); }
function addMonths(d, n) { return new Date(d.getFullYear(), d.getMonth()+n, d.getDate(), 12); }
function addDays(d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()+n, 12); }
function monthStart(d) { return new Date(d.getFullYear(), d.getMonth(), 1, 12); }
function todayYMD() { return ymd(new Date()); }
function fmtTime(hhmm) {
  if (!hhmm) return "";
  let [h, m] = hhmm.split(":").map(Number);
  const ap = h < 12 ? "a" : "p"; let h12 = h % 12; if (h12 === 0) h12 = 12;
  return m ? `${h12}:${String(m).padStart(2,"0")}${ap}` : `${h12}${ap}`;
}
function addHour(hhmm) { let [h,m] = hhmm.split(":").map(Number); h=(h+1)%24; return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}`; }
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function uuid() { return (crypto.randomUUID && crypto.randomUUID()) || ("id-"+Math.random().toString(36).slice(2)+Date.now()); }

/* ========================================================================
   BACKENDS
   ======================================================================== */
class LocalBackend {
  constructor() { this.kind = "local"; }
  _get(k, dflt) { try { return JSON.parse(localStorage.getItem("spanel_"+k)) ?? dflt; } catch { return dflt; } }
  _set(k, v) { localStorage.setItem("spanel_"+k, JSON.stringify(v)); }
  async getQuarters() { return this._get("quarters", []); }
  async insertQuarter(q) { const qs=this._get("quarters",[]); q.id=uuid(); q.created_at=new Date().toISOString(); qs.push(q); this._set("quarters",qs); return q; }
  async deleteQuarter(id) { this._set("quarters", this._get("quarters",[]).filter(q=>q.id!==id)); }
  async getDefaults() { return this._get("defaults", []); }
  async replaceDefaults(rows) { rows.forEach(r=>{ if(!r.id) r.id=uuid(); }); this._set("defaults", rows); return rows; }
  async getShows() { return this._get("shows", []); }
  async insertShow(s) { const rows=this._get("shows",[]); s.id=uuid(); rows.push(s); this._set("shows",rows); return s; }
  async insertShows(list) { const rows=this._get("shows",[]); list.forEach(s=>{ s.id=uuid(); rows.push(s); }); this._set("shows",rows); return list; }
  async updateShow(s) { const rows=this._get("shows",[]); const i=rows.findIndex(r=>r.id===s.id); if(i>=0) rows[i]=s; this._set("shows",rows); return s; }
  async deleteShow(id) { this._set("shows", this._get("shows",[]).filter(r=>r.id!==id)); }
}

class CloudBackend {
  constructor(url, key) { this.kind = "cloud"; this.sb = window.supabase.createClient(url, key); }
  async _q(p) { const { data, error } = await p; if (error) throw error; return data; }
  async getQuarters() { return this._q(this.sb.from("quarters").select("*").order("start_date",{ascending:true})); }
  async insertQuarter(q) { const r=await this._q(this.sb.from("quarters").insert(q).select()); return r[0]; }
  async deleteQuarter(id) { await this._q(this.sb.from("quarters").delete().eq("id",id)); }
  async getDefaults() { return this._q(this.sb.from("weekly_defaults").select("*").order("weekday").order("start_time")); }
  async replaceDefaults(rows) {
    await this._q(this.sb.from("weekly_defaults").delete().neq("id","00000000-0000-0000-0000-000000000000"));
    const clean = rows.map(({id, ...r}) => r);
    if (clean.length) return this._q(this.sb.from("weekly_defaults").insert(clean).select());
    return [];
  }
  async getShows() {
    // Supabase returns at most ~1000 rows per request; page through so the
    // calendar, dashboard, history, and the generate-overlap check see EVERY show.
    const pageSize = 1000; let from = 0, all = [];
    while (true) {
      const data = await this._q(this.sb.from("shows").select("*").order("show_date").order("start_time").range(from, from + pageSize - 1));
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
    }
    return all;
  }
  async insertShow(s) { const {id, ...row}=s; const r=await this._q(this.sb.from("shows").insert(row).select()); return r[0]; }
  async insertShows(list) { const clean=list.map(({id, ...r})=>r); return this._q(this.sb.from("shows").insert(clean).select()); }
  async updateShow(s) { const {id, created_at, updated_at, ...row}=s; const r=await this._q(this.sb.from("shows").update(row).eq("id",id).select()); return r[0]; }
  async deleteShow(id) { await this._q(this.sb.from("shows").delete().eq("id",id)); }
}

/* ========================================================================
   STATE
   ======================================================================== */
const App = {
  backend: null, quarters: [], currentQuarter: null, defaults: [], shows: [],
  editing: null, editStatus: "open",
  calAnchor: monthStart(new Date()),   // first month shown on the calendar
  session: null,                        // Supabase auth session (cloud only)
};

/* ---------------------------- credentials ------------------------------- */
function savedCreds() {
  const baked = window.SPANEL_CONFIG;
  if (baked && baked.SUPABASE_URL && !baked.SUPABASE_URL.includes("YOUR-PROJECT"))
    return { url: baked.SUPABASE_URL, key: baked.SUPABASE_ANON_KEY, source: "config.js" };
  const url = localStorage.getItem("spanel_sb_url"), key = localStorage.getItem("spanel_sb_key");
  if (url && key) return { url, key, source: "browser" };
  return null;
}
function isAuthError(e) {
  const m = ((e && (e.message || e.hint || e.code)) || "").toString().toLowerCase();
  return m.includes("permission denied") || m.includes("jwt") || m.includes("not authorized") ||
         m.includes("row-level") || (e && (e.code === "42501" || e.status === 401));
}

/* ---------------------------- connection -------------------------------- */
async function connect() {
  const creds = savedCreds();
  if (creds && window.supabase) {
    App.backend = new CloudBackend(creds.url, creds.key);
    App._credSource = creds.source;
    try { const { data } = await App.backend.sb.auth.getSession(); App.session = data.session || null; }
    catch { App.session = null; }
    setConnBadge(true, creds.source);
    return "cloud";
  }
  App.backend = new LocalBackend();
  App.session = null;
  setConnBadge(false);
  return "local";
}

function setConnBadge(cloud, source) {
  const b = document.getElementById("connBadge"), t = document.getElementById("connText");
  if (cloud) { b.className = "conn-badge conn-cloud"; t.textContent = App.session ? "Cloud · signed in" : "Cloud"; }
  else { b.className = "conn-badge conn-local"; t.textContent = "Local demo"; }
  const line = document.getElementById("connStatusLine");
  if (line) line.textContent = cloud
    ? (App.session ? `Connected to Supabase (via ${source}), signed in as ${App.session.user.email}. Data is shared live with all signed-in staff.`
                   : `Connected to Supabase (via ${source}). Sign in to view and edit the schedule.`)
    : "Not connected. Local demo mode — data lives only in this browser. Connect Supabase below to share across staff.";
  renderAuthArea(cloud);
}

function renderAuthArea(cloud) {
  const area = document.getElementById("authArea");
  const who = document.getElementById("authWho");
  const inBtn = document.getElementById("authSignInBtn");
  const outBtn = document.getElementById("authSignOutBtn");
  area.hidden = !cloud;
  if (!cloud) return;
  if (App.session) {
    who.hidden = false; who.textContent = App.session.user.email;
    inBtn.hidden = true; outBtn.hidden = false;
  } else {
    who.hidden = true; inBtn.hidden = false; outBtn.hidden = true;
  }
}

/* ========================================================================
   AUTH
   ======================================================================== */
function showLogin(msg) {
  const err = document.getElementById("loginError");
  if (msg) { err.hidden = false; err.textContent = msg; } else { err.hidden = true; }
  document.getElementById("loginBackdrop").classList.add("open");
  setTimeout(() => document.getElementById("loginEmail").focus(), 50);
}
function hideLogin() { document.getElementById("loginBackdrop").classList.remove("open"); }

async function doSignIn() {
  const email = document.getElementById("loginEmail").value.trim();
  const pass = document.getElementById("loginPass").value;
  if (!email || !pass) { showLogin("Enter your email and password."); return; }
  try {
    const { data, error } = await App.backend.sb.auth.signInWithPassword({ email, password: pass });
    if (error) throw error;
    App.session = data.session;
    hideLogin();
    document.getElementById("loginPass").value = "";
    await boot();
    toast("Signed in.");
  } catch (e) { showLogin(e.message || "Sign-in failed."); }
}
async function doSignOut() {
  try { await App.backend.sb.auth.signOut(); } catch {}
  App.session = null;
  toast("Signed out.");
  await boot();
}

/* ========================================================================
   DATA LOADING
   ======================================================================== */
async function loadAll() {
  App.quarters = await App.backend.getQuarters();
  App.defaults = await App.backend.getDefaults();
  App.shows = await App.backend.getShows();

  if (App.defaults.length === 0) {
    App.defaults = buildStandardDefaults();
    await App.backend.replaceDefaults(App.defaults);
    App.defaults = await App.backend.getDefaults();
  }
  if (App.quarters.length === 0) {
    const startMonth = monthStart(new Date());
    await App.backend.insertQuarter({ name: `${MONTH_NAMES[startMonth.getMonth()]} ${startMonth.getFullYear()}`, start_date: ymd(startMonth) });
    App.quarters = await App.backend.getQuarters();
  }
  App.currentQuarter = App.quarters[App.quarters.length - 1];
}
function buildStandardDefaults() {
  const rows = [];
  for (const wd of STANDARD_WEEKDAYS) for (const st of STANDARD_SLOTS)
    rows.push({ weekday: wd, start_time: st, end_time: addHour(st), lead:"", driver:"", usher1:"", usher2:"", active:true });
  return rows;
}

function quarterWindow(q) { const start = parseYMD(q.start_date); return { start, end: addDays(addMonths(start,3),-1) }; }

/* ========================================================================
   CALENDAR (4-month rolling)
   ======================================================================== */
function showsByDate() {
  const map = {};
  for (const s of App.shows) (map[s.show_date] ||= []).push(s);
  for (const k in map) map[k].sort((a,b)=>(a.start_time||"").localeCompare(b.start_time||""));
  return map;
}
function renderCalendar() {
  const host = document.getElementById("calMonths");
  const anchor = App.calAnchor;
  const last = addMonths(anchor, CAL_MONTHS - 1);
  document.getElementById("calRange").textContent =
    `${MONTH_ABBR[anchor.getMonth()]} ${anchor.getFullYear()} – ${MONTH_ABBR[last.getMonth()]} ${last.getFullYear()}`;

  const byDate = showsByDate();
  const today = todayYMD();
  let html = "";
  for (let mo = 0; mo < CAL_MONTHS; mo++) {
    const monthDate = addMonths(anchor, mo);
    const year = monthDate.getFullYear(), month = monthDate.getMonth();
    html += `<div class="month"><h3>${MONTH_NAMES[month]} ${year}</h3><table class="cal"><thead><tr>`;
    html += WEEKDAYS.map(w=>`<th>${w}</th>`).join("") + `</tr></thead><tbody>`;
    const first = new Date(year, month, 1, 12);
    const startCol = first.getDay();
    const daysInMonth = new Date(year, month+1, 0).getDate();
    let cell = 0;
    for (let week = 0; week < 6; week++) {
      let anyReal = false, row = "<tr>";
      for (let dow = 0; dow < 7; dow++) {
        const dayNum = cell - startCol + 1;
        if (dayNum < 1 || dayNum > daysInMonth) { row += `<td class="blank"></td>`; }
        else {
          anyReal = true;
          const date = new Date(year, month, dayNum, 12), ds = ymd(date);
          const isWknd = dow === 0 || dow === 6;
          const list = byDate[ds] || [];
          let chips = ""; const MAXC = 4;
          list.slice(0, MAXC).forEach(s => {
            const label = s.group_name || s.focus || STATUS_LABEL[s.status] + " slot";
            chips += `<span class="chip ${s.status}" data-id="${s.id}" title="${esc(fmtTime(s.start_time))} ${esc(label)}">` +
                     `<span class="glyph">${STATUS_GLYPH[s.status]}</span> ${esc(fmtTime(s.start_time))} ${esc(label)}</span>`;
          });
          if (list.length > MAXC) chips += `<span class="more">+${list.length - MAXC} more…</span>`;
          row += `<td class="${ds===today?"today":""}" data-date="${ds}"><div class="daynum ${isWknd?"wknd":""}">${dayNum}</div>${chips}</td>`;
        }
        cell++;
      }
      row += "</tr>";
      if (anyReal) html += row;
    }
    html += `</tbody></table></div>`;
  }
  host.innerHTML = html;
  host.querySelectorAll(".chip").forEach(el => el.addEventListener("click", e => { e.stopPropagation(); openEditor(App.shows.find(s=>s.id===el.dataset.id)); }));
  host.querySelectorAll("td[data-date]").forEach(el => el.addEventListener("click", () => openEditor(null, el.dataset.date)));
}

/* ========================================================================
   SHOWS TABLE
   ======================================================================== */
function filteredShows() {
  const from = document.getElementById("showFrom").value;
  const to = document.getElementById("showTo").value;
  const st = document.getElementById("showStatusFilter").value;
  return App.shows.filter(s => (!from||s.show_date>=from) && (!to||s.show_date<=to) && (!st||s.status===st))
    .sort((a,b)=>(a.show_date+a.start_time).localeCompare(b.show_date+b.start_time));
}
function renderShows() {
  const rows = filteredShows();
  const wrap = document.getElementById("showsTableWrap");
  if (rows.length === 0) { wrap.innerHTML = `<div class="empty-state"><div class="big">🌌</div>No shows in this range.<br>Use <b>+ Add show</b> or generate a quarter in Setup.</div>`; return; }
  const cols = ["Status","Date","Start","End","Focus","Group","Size","Contact","Email","Lead","Driver","Usher 1","Usher 2",""];
  let html = `<table class="grid"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead><tbody>`;
  for (const s of rows) {
    html += `<tr class="status-${s.status}" data-id="${s.id}">` +
      `<td><span class="badge ${s.status}">${STATUS_LABEL[s.status]}</span></td>` +
      `<td>${esc(s.show_date)}</td><td>${esc(fmtTime(s.start_time))}</td><td>${esc(fmtTime(s.end_time))}</td>` +
      `<td>${esc(s.focus)}</td><td>${esc(s.group_name)}</td><td>${esc(s.group_size ?? "")}</td>` +
      `<td>${esc(s.contact_name)}</td><td>${esc(s.contact_email)}</td>` +
      `<td>${esc(s.lead)}</td><td>${esc(s.driver)}</td><td>${esc(s.usher1)}</td><td>${esc(s.usher2)}</td>` +
      `<td><button class="btn small" data-edit="${s.id}">Edit</button></td></tr>`;
  }
  html += "</tbody></table>";
  wrap.innerHTML = html;
  wrap.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEditor(App.shows.find(s=>s.id===b.dataset.edit))));
}

/* ========================================================================
   DASHBOARD
   ======================================================================== */
function dashRange() {
  return { from: document.getElementById("dashFrom").value, to: document.getElementById("dashTo").value };
}
function dashShows() {
  const { from, to } = dashRange();
  return App.shows.filter(s => (!from||s.show_date>=from) && (!to||s.show_date<=to));
}
function bar(label, value, max, color, sub) {
  const pct = max > 0 ? Math.max(2, Math.round(value / max * 100)) : 0;
  return `<div class="barrow" title="${esc(label)}: ${value}">` +
    `<div class="barlabel">${esc(label)}</div>` +
    `<div class="bartrack"><div class="barfill" style="width:${pct}%;background:${color}"></div></div>` +
    `<div class="barval">${value}${sub?`<span class="barsub"> ${esc(sub)}</span>`:""}</div></div>`;
}
function renderDashboard() {
  const rows = dashShows();
  const booked = rows.filter(s => s.status === "tentative" || s.status === "confirmed");
  const confirmed = rows.filter(s => s.status === "confirmed");
  const tentative = rows.filter(s => s.status === "tentative");
  const open = rows.filter(s => s.status === "open");
  const sumSize = arr => arr.reduce((t,s)=> t + (Number(s.group_size)||0), 0);
  const attendees = sumSize(booked), confAtt = sumSize(confirmed);
  const sized = booked.filter(s => Number(s.group_size) > 0);
  const avg = sized.length ? Math.round(attendees / sized.length) : 0;

  const tiles = [
    { label: "Booked shows", value: booked.length, hint: "tentative + confirmed" },
    { label: "Confirmed", value: confirmed.length, color: STATUS_COLOR.confirmed },
    { label: "Tentative", value: tentative.length, color: STATUS_COLOR.tentative },
    { label: "Total attendees", value: attendees.toLocaleString(), hint: `${confAtt.toLocaleString()} confirmed` },
    { label: "Avg group size", value: avg, hint: `${sized.length} sized shows` },
    { label: "Open slots", value: open.length, color: STATUS_COLOR.open },
  ];
  document.getElementById("dashStats").innerHTML = tiles.map(t =>
    `<div class="stat"><div class="stat-num" ${t.color?`style="color:${t.color}"`:""}>${t.value}</div>` +
    `<div class="stat-label">${esc(t.label)}</div>${t.hint?`<div class="stat-hint">${esc(t.hint)}</div>`:""}</div>`).join("");

  // By month (booked)
  const byMonth = {};
  booked.forEach(s => { const k = s.show_date.slice(0,7); byMonth[k] = (byMonth[k]||0)+1; });
  const monthKeys = Object.keys(byMonth).sort();
  const maxM = Math.max(1, ...Object.values(byMonth));
  document.getElementById("dashByMonth").innerHTML = monthKeys.length
    ? monthKeys.map(k => { const [y,m]=k.split("-"); return bar(`${MONTH_ABBR[+m-1]} ${y}`, byMonth[k], maxM, "var(--brand-2)"); }).join("")
    : `<p class="hint">No booked shows in range.</p>`;

  // By status
  const stCounts = { open: open.length, tentative: tentative.length, confirmed: confirmed.length };
  const maxS = Math.max(1, ...Object.values(stCounts));
  document.getElementById("dashByStatus").innerHTML =
    STATUSES.map(st => bar(STATUS_LABEL[st], stCounts[st], maxS, STATUS_COLOR[st])).join("");

  // Presenter load (booked, by lead)
  const byLead = {};
  booked.forEach(s => { const k = (s.lead||"").trim() || "— unassigned —"; byLead[k] = (byLead[k]||0)+1; });
  const leadKeys = Object.keys(byLead).sort((a,b)=>byLead[b]-byLead[a]).slice(0, 10);
  const maxL = Math.max(1, ...leadKeys.map(k=>byLead[k]));
  document.getElementById("dashByPresenter").innerHTML = leadKeys.length
    ? leadKeys.map(k => bar(k, byLead[k], maxL, "var(--brand)")).join("")
    : `<p class="hint">No booked shows in range.</p>`;
}
function setDashPreset(preset) {
  const now = new Date();
  let from = "", to = "";
  if (preset === "quarter" && App.currentQuarter) { const w = quarterWindow(App.currentQuarter); from = ymd(w.start); to = ymd(w.end); }
  else if (preset === "ytd") { from = `${now.getFullYear()}-01-01`; to = todayYMD(); }
  else if (preset === "year") { from = `${now.getFullYear()}-01-01`; to = `${now.getFullYear()}-12-31`; }
  else if (preset === "all") { from = ""; to = ""; }
  document.getElementById("dashFrom").value = from;
  document.getElementById("dashTo").value = to;
  renderDashboard();
}

/* ========================================================================
   WEEKLY DEFAULTS
   ======================================================================== */
function renderDefaults() {
  const wrap = document.getElementById("defaultsTableWrap");
  const rows = [...App.defaults].sort((a,b)=>a.weekday-b.weekday || a.start_time.localeCompare(b.start_time));
  const cols = ["Weekday","Start","End","Lead","Driver","Usher 1","Usher 2","Active",""];
  let html = `<table class="grid"><thead><tr>${cols.map(c=>`<th>${c}</th>`).join("")}</tr></thead><tbody>`;
  rows.forEach((r,i) => {
    html += `<tr data-i="${i}">` +
      `<td><select data-f="weekday">${WEEKDAYS_LONG.map((w,wi)=>`<option value="${wi}" ${wi===r.weekday?"selected":""}>${w}</option>`).join("")}</select></td>` +
      `<td><input type="time" data-f="start_time" value="${esc(r.start_time)}" style="width:110px"></td>` +
      `<td><input type="time" data-f="end_time" value="${esc(r.end_time)}" style="width:110px"></td>` +
      `<td><input type="text" data-f="lead" value="${esc(r.lead)}" style="width:120px"></td>` +
      `<td><input type="text" data-f="driver" value="${esc(r.driver)}" style="width:120px"></td>` +
      `<td><input type="text" data-f="usher1" value="${esc(r.usher1)}" style="width:110px"></td>` +
      `<td><input type="text" data-f="usher2" value="${esc(r.usher2)}" style="width:110px"></td>` +
      `<td style="text-align:center"><input type="checkbox" data-f="active" ${r.active?"checked":""}></td>` +
      `<td><button class="btn small danger" data-del="${i}">✕</button></td></tr>`;
  });
  html += "</tbody></table>";
  wrap.innerHTML = html;
  App._defaultsView = rows;
  wrap.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    App._defaultsView.splice(Number(b.dataset.del),1); App.defaults = App._defaultsView; renderDefaults();
  }));
}
function collectDefaultsFromDOM() {
  const rows = [];
  document.querySelectorAll("#defaultsTableWrap tbody tr").forEach(tr => {
    const g = f => tr.querySelector(`[data-f="${f}"]`);
    rows.push({ weekday:Number(g("weekday").value), start_time:g("start_time").value||"10:00", end_time:g("end_time").value||"11:00",
      lead:g("lead").value, driver:g("driver").value, usher1:g("usher1").value, usher2:g("usher2").value, active:g("active").checked });
  });
  return rows;
}

/* ========================================================================
   QUARTERS (setup)
   ======================================================================== */
function renderQuarterTargets() {
  const sel = document.getElementById("qTargetSelect");
  sel.innerHTML = App.quarters.map(q => `<option value="${q.id}">${esc(q.name)} — ${esc(q.start_date)}</option>`).join("");
  if (App.currentQuarter) sel.value = App.currentQuarter.id;
}
function renderQuartersList() {
  const host = document.getElementById("quartersList");
  if (!App.quarters.length) { host.innerHTML = `<p class="hint">No quarters yet.</p>`; return; }
  host.innerHTML = `<div class="table-wrap"><table class="grid" style="min-width:auto"><thead><tr>
    <th>Name</th><th>Start</th><th>Window</th><th>Shows</th><th></th></tr></thead><tbody>` +
    App.quarters.map(q => {
      const { start, end } = quarterWindow(q);
      const count = App.shows.filter(s => s.show_date>=ymd(start) && s.show_date<=ymd(end)).length;
      return `<tr><td>${esc(q.name)}</td><td>${esc(q.start_date)}</td><td>${ymd(start)} → ${ymd(end)}</td><td>${count}</td>` +
        `<td><button class="btn small danger" data-delq="${q.id}">Delete</button></td></tr>`;
    }).join("") + `</tbody></table></div>`;
  host.querySelectorAll("[data-delq]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("Delete this quarter? (Shows already generated are kept in history.)")) return;
    await App.backend.deleteQuarter(b.dataset.delq);
    App.quarters = await App.backend.getQuarters();
    App.currentQuarter = App.quarters[App.quarters.length-1] || null;
    refreshAll();
  }));
}

/* ========================================================================
   GENERATE QUARTER
   ======================================================================== */
async function generateQuarter() {
  const q = App.currentQuarter;
  if (!q) { toast("Create a quarter first."); return; }
  const activeDefaults = App.defaults.filter(d => d.active);
  if (!activeDefaults.length) { toast("No active weekly-default slots to generate from."); return; }
  const { start, end } = quarterWindow(q);
  // Index every existing show by date so we can check for time-range OVERLAP,
  // not just an identical start time — a slot is skipped if anything already
  // occupies any part of its time on that day (whatever its status).
  const byDate = {};
  for (const s of App.shows) (byDate[s.show_date] ||= []).push(s);
  const overlaps = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;   // [a1,a2) vs [b1,b2)
  const toCreate = [];
  let skipped = 0;
  for (let d = new Date(start); d <= end; d = addDays(d,1)) {
    const wd = d.getDay(), ds = ymd(d);
    for (const def of activeDefaults) {
      if (def.weekday !== wd) continue;
      const dayShows = byDate[ds] || [];
      const clash = dayShows.some(s =>
        overlaps(def.start_time, def.end_time || def.start_time, s.start_time, s.end_time || s.start_time));
      if (clash) { skipped++; continue; }
      toCreate.push({ quarter_id:q.id, show_date:ds, start_time:def.start_time, end_time:def.end_time, status:"open",
        focus:"", group_name:"", group_size:null, contact_name:"", contact_email:"",
        lead:def.lead||"", driver:def.driver||"", usher1:def.usher1||"", usher2:def.usher2||"", notes:"" });
    }
  }
  if (!toCreate.length) {
    toast(skipped ? `Nothing added — all ${skipped} matching slots already have a show.` : "No slots to add in this window.");
    return;
  }
  const msg = `Generate ${toCreate.length} open show-slots for "${q.name}" (${ymd(start)} → ${ymd(end)})?` +
    (skipped ? `\n\n${skipped} slot(s) were skipped because a show already exists at that time.` : "");
  if (!confirm(msg)) return;
  await App.backend.insertShows(toCreate);
  App.shows = await App.backend.getShows();
  refreshAll();
  toast(`Added ${toCreate.length} slots to ${q.name}${skipped ? `, skipped ${skipped} already booked` : ""}.`);
}

/* ========================================================================
   MODAL EDITOR
   ======================================================================== */
function setEditStatus(v) {
  App.editStatus = v;
  document.querySelectorAll("#mStatus button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.v===v)));
}
function openEditor(show, presetDate) {
  App.editing = show ? { ...show } : null;
  const g = id => document.getElementById(id);
  document.getElementById("modalTitle").textContent = show ? "Edit show" : "New show";
  document.getElementById("mDeleteBtn").style.display = show ? "" : "none";
  const s = show || { show_date: presetDate || todayYMD(), start_time:"10:00", end_time:"11:00", status:"tentative" };
  setEditStatus(s.status || "tentative");
  g("mDate").value=s.show_date||todayYMD(); g("mStart").value=s.start_time||""; g("mEnd").value=s.end_time||"";
  g("mFocus").value=s.focus||""; g("mGroup").value=s.group_name||""; g("mSize").value=s.group_size??"";
  g("mContact").value=s.contact_name||""; g("mEmail").value=s.contact_email||"";
  g("mLead").value=s.lead||""; g("mDriver").value=s.driver||""; g("mUsher1").value=s.usher1||""; g("mUsher2").value=s.usher2||"";
  g("mNotes").value=s.notes||"";
  document.getElementById("modalBackdrop").classList.add("open");
}
function closeEditor() { document.getElementById("modalBackdrop").classList.remove("open"); App.editing = null; }
async function saveEditor() {
  const g = id => document.getElementById(id).value;
  const date = g("mDate"); if (!date) { toast("A show date is required."); return; }
  const rec = { quarter_id: App.currentQuarter ? App.currentQuarter.id : null, show_date:date,
    start_time:g("mStart")||"10:00", end_time:g("mEnd")||"11:00", status:App.editStatus, focus:g("mFocus"),
    group_name:g("mGroup"), group_size: g("mSize")===""?null:Number(g("mSize")),
    contact_name:g("mContact"), contact_email:g("mEmail"), lead:g("mLead"), driver:g("mDriver"),
    usher1:g("mUsher1"), usher2:g("mUsher2"), notes:g("mNotes") };
  try {
    if (App.editing && App.editing.id) { rec.id = App.editing.id; await App.backend.updateShow(rec); }
    else { await App.backend.insertShow(rec); }
    App.shows = await App.backend.getShows();
    closeEditor(); refreshAll(); toast("Saved.");
  } catch (e) { console.error(e); if (isAuthError(e)) { showLogin("Please sign in to make changes."); } else toast("Save failed: "+(e.message||e)); }
}
async function deleteEditor() {
  if (!App.editing || !App.editing.id) return;
  if (!confirm("Delete this show?")) return;
  try { await App.backend.deleteShow(App.editing.id); App.shows = await App.backend.getShows(); closeEditor(); refreshAll(); toast("Deleted."); }
  catch (e) { if (isAuthError(e)) showLogin("Please sign in to make changes."); else toast("Delete failed: "+(e.message||e)); }
}

/* ========================================================================
   .ics  (sanitized — no contact name/email)
   ======================================================================== */
function icsEscape(s) { return String(s ?? "").replace(/\\/g,"\\\\").replace(/;/g,"\\;").replace(/,/g,"\\,").replace(/\n/g,"\\n"); }
function icsDateTime(dateStr, timeStr) {
  const [y,m,d] = dateStr.split("-"); const [hh,mm] = (timeStr||"00:00").split(":");
  return `${y}${m}${d}T${hh}${mm}00`;
}
function icsStamp() {
  const n = new Date(), p = x => String(x).padStart(2,"0");
  return `${n.getUTCFullYear()}${p(n.getUTCMonth()+1)}${p(n.getUTCDate())}T${p(n.getUTCHours())}${p(n.getUTCMinutes())}${p(n.getUTCSeconds())}Z`;
}
// Build an .ics. opts = { statuses:Set, calName, publicMode }.
//  • publicMode (availability feed): open slots as "Available" — NO group, staff,
//    or contact info; marked free/transparent so it doesn't block subscribers' time.
//  • otherwise (staff feed): booked shows with group/size/focus/staffing, but
//    NEVER contact name/email (those are private).
function buildICS(shows, opts) {
  const { statuses, calName, publicMode } = opts;
  const stamp = icsStamp();
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Spanel Planetarium//Availability Calendar//EN",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH",`X-WR-CALNAME:${icsEscape(calName)}`,"X-WR-TIMEZONE:local"];
  for (const s of shows) {
    if (!statuses.has(s.status)) continue;
    const ev = ["BEGIN:VEVENT", `UID:${s.id}@spanel-planetarium`, `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(s.show_date, s.start_time)}`, `DTEND:${icsDateTime(s.show_date, s.end_time)}`];
    if (publicMode) {
      const isOpen = s.status === "open";
      const summary = isOpen ? (s.focus ? `Available — ${s.focus}` : "Available") : "Reserved";
      const desc = isOpen ? "This planetarium show time is available to book." : "This time is reserved.";
      ev.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(desc)}`, "STATUS:CONFIRMED", "TRANSP:TRANSPARENT");
    } else {
      const title = s.group_name || s.focus || "Planetarium show";
      const summary = `${s.status==="confirmed"?"":"(Tentative) "}${title}`;
      const d = [];
      if (s.focus) d.push(`Focus: ${s.focus}`);
      if (s.group_name) d.push(`Group: ${s.group_name}`);
      if (s.group_size) d.push(`Size: ${s.group_size}`);
      d.push(`Status: ${STATUS_LABEL[s.status]}${s.status==="confirmed"?" (paid)":" (unpaid)"}`);
      const staff = [s.lead && `Lead: ${s.lead}`, s.driver && `Driver: ${s.driver}`,
                     s.usher1 && `Usher: ${s.usher1}`, s.usher2 && `Usher: ${s.usher2}`].filter(Boolean);
      if (staff.length) d.push(staff.join(" · "));
      ev.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(d.join("\n"))}`,
              `STATUS:${s.status==="confirmed"?"CONFIRMED":"TENTATIVE"}`);
    }
    ev.push("END:VEVENT");
    lines.push(...ev);
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}
function download(name, text) {
  const blob = new Blob([text], { type: "text/calendar" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
function downloadAvailabilityICS() {
  download(`spanel-availability-${todayYMD()}.ics`,
    buildICS(App.shows, { statuses: new Set(["open", "tentative", "confirmed"]), calName: "Spanel Planetarium — Availability", publicMode: true }));
  toast("Availability feed downloaded (available + reserved, no personal info).");
}
function downloadStaffICS() {
  download(`spanel-staff-${todayYMD()}.ics`,
    buildICS(App.shows, { statuses: new Set(["tentative","confirmed"]), calName: "Spanel Planetarium — Shows", publicMode: false }));
  toast("Staff feed downloaded (booked shows, no contact info).");
}

/* ========================================================================
   CSV EXPORT
   ======================================================================== */
function exportCSV() {
  const rows = filteredShows();
  const cols = ["show_date","start_time","end_time","status","focus","group_name","group_size","contact_name","contact_email","lead","driver","usher1","usher2","notes"];
  const head = ["Date","Start","End","Status","Focus","Group","Size","Contact","Email","Lead","Driver","Usher1","Usher2","Notes"];
  const csv = [head.join(",")].concat(rows.map(r => cols.map(c => { let v=String(r[c]??"").replace(/"/g,'""'); return /[",\n]/.test(v)?`"${v}"`:v; }).join(","))).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `spanel-shows-${todayYMD()}.csv`; a.click(); URL.revokeObjectURL(a.href);
}

/* ========================================================================
   REFRESH / TABS / TOAST
   ======================================================================== */
function refreshAll() {
  renderCalendar(); renderShows(); renderDefaults(); renderQuartersList(); renderQuarterTargets();
  if (document.getElementById("view-dashboard").classList.contains("active")) renderDashboard();
}
function switchTab(name) {
  document.querySelectorAll("nav.tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab===name));
  document.querySelectorAll(".view").forEach(v => v.classList.toggle("active", v.id==="view-"+name));
  if (name === "dashboard") renderDashboard();
}
let toastTimer;
function toast(msg) { const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(toastTimer); toastTimer=setTimeout(()=>t.classList.remove("show"),2600); }

/* ========================================================================
   WIRE UP
   ======================================================================== */
function wire() {
  document.querySelectorAll("nav.tabs button").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));
  document.getElementById("connBadge").addEventListener("click", () => switchTab("setup"));

  // calendar nav
  document.getElementById("calPrev").addEventListener("click", () => { App.calAnchor = addMonths(App.calAnchor,-1); renderCalendar(); });
  document.getElementById("calNext").addEventListener("click", () => { App.calAnchor = addMonths(App.calAnchor, 1); renderCalendar(); });
  document.getElementById("calToday").addEventListener("click", () => { App.calAnchor = monthStart(new Date()); renderCalendar(); });
  document.getElementById("calAddBtn").addEventListener("click", () => openEditor(null));
  document.getElementById("calIcsAvail").addEventListener("click", downloadAvailabilityICS);
  document.getElementById("calIcsStaff").addEventListener("click", downloadStaffICS);

  // dashboard
  ["dashFrom","dashTo"].forEach(id => document.getElementById(id).addEventListener("change", renderDashboard));
  document.getElementById("dashPresets").addEventListener("click", e => { const p=e.target.dataset.preset; if (p) setDashPreset(p); });

  // shows
  document.getElementById("showAddBtn").addEventListener("click", () => openEditor(null));
  ["showFrom","showTo","showStatusFilter"].forEach(id => document.getElementById(id).addEventListener("change", renderShows));
  document.getElementById("showExportBtn").addEventListener("click", exportCSV);

  // defaults
  document.getElementById("defSaveBtn").addEventListener("click", async () => {
    App.defaults = collectDefaultsFromDOM();
    try { await App.backend.replaceDefaults(App.defaults); App.defaults = await App.backend.getDefaults(); renderDefaults(); toast("Weekly defaults saved."); }
    catch (e) { if (isAuthError(e)) showLogin("Please sign in to make changes."); else toast("Save failed: "+(e.message||e)); }
  });
  document.getElementById("defAddRowBtn").addEventListener("click", () => {
    App.defaults = collectDefaultsFromDOM();
    App.defaults.push({ weekday:1, start_time:"15:00", end_time:"16:00", lead:"", driver:"", usher1:"", usher2:"", active:true });
    renderDefaults();
  });
  document.getElementById("defResetBtn").addEventListener("click", () => {
    if (!confirm("Replace the weekly-defaults table with the standard week (10a–2p, Mon–Fri)?")) return;
    App.defaults = buildStandardDefaults(); renderDefaults();
  });

  // quarters
  document.getElementById("qAddBtn").addEventListener("click", async () => {
    const name = document.getElementById("qName").value.trim();
    const start = document.getElementById("qStart").value;
    if (!name || !start) { toast("Enter a name and start date."); return; }
    try {
      await App.backend.insertQuarter({ name, start_date: start });
      App.quarters = await App.backend.getQuarters();
      App.currentQuarter = App.quarters[App.quarters.length-1];
      document.getElementById("qName").value=""; document.getElementById("qStart").value="";
      refreshAll(); toast("Quarter created.");
    } catch (e) { if (isAuthError(e)) showLogin("Please sign in to make changes."); else toast("Failed: "+(e.message||e)); }
  });
  document.getElementById("qTargetSelect").addEventListener("change", e => { App.currentQuarter = App.quarters.find(q=>q.id===e.target.value); });
  document.getElementById("qGenerateBtn").addEventListener("click", generateQuarter);

  // modal
  document.querySelectorAll("#mStatus button").forEach(b => b.addEventListener("click", () => setEditStatus(b.dataset.v)));
  document.getElementById("mSaveBtn").addEventListener("click", saveEditor);
  document.getElementById("mCancelBtn").addEventListener("click", closeEditor);
  document.getElementById("mDeleteBtn").addEventListener("click", deleteEditor);
  document.getElementById("modalBackdrop").addEventListener("click", e => { if (e.target.id==="modalBackdrop") closeEditor(); });
  document.addEventListener("keydown", e => { if (e.key==="Escape") { closeEditor(); } });

  // auth
  document.getElementById("authSignInBtn").addEventListener("click", () => showLogin());
  document.getElementById("authSignOutBtn").addEventListener("click", doSignOut);
  document.getElementById("loginBtn").addEventListener("click", doSignIn);
  document.getElementById("loginPass").addEventListener("keydown", e => { if (e.key==="Enter") doSignIn(); });
  document.getElementById("loginDemoBtn").addEventListener("click", async () => {
    localStorage.removeItem("spanel_sb_url"); localStorage.removeItem("spanel_sb_key");
    hideLogin(); await boot(); toast("Using local demo mode.");
  });

  // setup: connect / disconnect
  const creds = savedCreds();
  if (creds && creds.source === "browser") { document.getElementById("cfgUrl").value = creds.url; document.getElementById("cfgKey").value = creds.key; }
  document.getElementById("cfgConnectBtn").addEventListener("click", async () => {
    const url = document.getElementById("cfgUrl").value.trim(), key = document.getElementById("cfgKey").value.trim();
    if (!url || !key) { toast("Enter both the URL and the anon key."); return; }
    localStorage.setItem("spanel_sb_url", url); localStorage.setItem("spanel_sb_key", key);
    await boot(); toast("Connected to Supabase.");
  });
  document.getElementById("cfgClearBtn").addEventListener("click", async () => {
    localStorage.removeItem("spanel_sb_url"); localStorage.removeItem("spanel_sb_key");
    await boot(); toast("Disconnected — using local demo.");
  });

  // danger zone
  document.getElementById("pushLocalBtn").addEventListener("click", pushLocalToCloud);
  document.getElementById("wipeLocalBtn").addEventListener("click", () => {
    if (!confirm("Clear ALL local demo data (quarters, defaults, shows) in this browser?")) return;
    ["spanel_quarters","spanel_defaults","spanel_shows"].forEach(k => localStorage.removeItem(k));
    boot(); toast("Local demo data cleared.");
  });
}

async function pushLocalToCloud() {
  if (!App.backend || App.backend.kind !== "cloud") { toast("Connect Supabase first (Setup)."); return; }
  if (!App.session) { showLogin("Sign in first to push data to the cloud."); return; }
  const local = new LocalBackend();
  const lq = await local.getQuarters(), ld = await local.getDefaults(), ls = await local.getShows();
  if (!lq.length && !ls.length) { toast("No local demo data to push."); return; }
  if (!confirm(`Push ${lq.length} quarters, ${ld.length} defaults, ${ls.length} shows to the cloud?`)) return;
  try {
    if (ld.length) await App.backend.replaceDefaults(ld);
    const idMap = {};
    for (const q of lq) { const nq = await App.backend.insertQuarter({ name:q.name, start_date:q.start_date }); idMap[q.id]=nq.id; }
    const shows = ls.map(({id, quarter_id, created_at, updated_at, ...r}) => ({ ...r, quarter_id: idMap[quarter_id]||null }));
    if (shows.length) await App.backend.insertShows(shows);
    await boot(); toast("Pushed local data to the cloud.");
  } catch (e) { console.error(e); if (isAuthError(e)) showLogin("Please sign in first."); else toast("Push failed: "+(e.message||e)); }
}

/* ========================================================================
   BOOT
   ======================================================================== */
async function boot() {
  const mode = await connect();
  if (mode === "cloud" && !App.session) {
    // Secure schema blocks anon; prompt sign-in. (Open schema will still load below.)
    try { await loadAll(); }
    catch (e) {
      if (isAuthError(e)) { showLogin(); return; }
      console.error(e); toast("Load error: "+(e.message||e)); return;
    }
  } else {
    try { await loadAll(); }
    catch (e) {
      if (isAuthError(e)) { showLogin(); return; }
      console.error(e); toast("Load error: "+(e.message||e)); return;
    }
  }
  setConnBadge(mode === "cloud", App._credSource);
  if (App.currentQuarter) {
    const { start, end } = quarterWindow(App.currentQuarter);
    document.getElementById("showFrom").value = ymd(start);
    document.getElementById("showTo").value = ymd(end);
  }
  App.calAnchor = monthStart(new Date());
  setDashPresetSilent();
  refreshAll();
}
function setDashPresetSilent() {
  if (App.currentQuarter) { const w = quarterWindow(App.currentQuarter); document.getElementById("dashFrom").value = ymd(w.start); document.getElementById("dashTo").value = ymd(w.end); }
}

window.addEventListener("DOMContentLoaded", async () => {
  wire();
  try { await boot(); } catch (e) { console.error(e); toast("Startup error: "+(e.message||e)); }
});
