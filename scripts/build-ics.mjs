// ============================================================================
// build-ics.mjs — generates two public calendar feeds:
//
//   availability.ics   PUBLIC schedule: every timeslot, sanitized.
//                        - open slots      -> "Available"
//                        - booked slots    -> "Reserved"  (NO group/staff/contact)
//                      Safe to embed on the planetarium's public website.
//   staff-calendar.ics TENTATIVE + CONFIRMED shows for staff (group/focus/
//                      staffing), with NO contact name or email. For staff to
//                      subscribe to in their own calendars.
//
// Run by the GitHub Action on a schedule. Reads from Supabase with the SERVICE
// ROLE key (a server-side secret, never shipped to browsers). Node 18+ (global
// fetch); no npm dependencies.
//
// Env vars (set as GitHub Actions secrets):
//   SUPABASE_URL               e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY  Project Settings -> API -> service_role (secret!)
// ============================================================================
import { writeFileSync } from "node:fs";

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

const STATUS_LABEL = { tentative: "Tentative", confirmed: "Confirmed" };

function icsEscape(s) { return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function icsDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-"); const [hh, mm] = (timeStr || "00:00").split(":");
  return `${y}${m}${d}T${hh}${mm}00`;
}
function stampUTC() {
  const n = new Date(), p = x => String(x).padStart(2, "0");
  return `${n.getUTCFullYear()}${p(n.getUTCMonth()+1)}${p(n.getUTCDate())}T${p(n.getUTCHours())}${p(n.getUTCMinutes())}${p(n.getUTCSeconds())}Z`;
}

// events: [{ id, date, start, end, summary, desc, status?, transp? }]
function toICS(calName, events) {
  const stamp = stampUTC();
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Spanel Planetarium//Availability Calendar//EN",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH",`X-WR-CALNAME:${icsEscape(calName)}`,"X-WR-TIMEZONE:local"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT",
      `UID:${e.id}@spanel-planetarium`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(e.date, e.start)}`,
      `DTEND:${icsDateTime(e.date, e.end)}`,
      `SUMMARY:${icsEscape(e.summary)}`,
      `DESCRIPTION:${icsEscape(e.desc || "")}`);
    if (e.status) lines.push(`STATUS:${e.status}`);
    if (e.transp) lines.push(`TRANSP:${e.transp}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

async function query(params) {
  const res = await fetch(`${URL}/rest/v1/shows?${params}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) { console.error("Supabase query failed:", res.status, await res.text()); process.exit(1); }
  return res.json();
}

// ---- PUBLIC feed: open -> "Available", booked -> "Reserved" (sanitized) --------
const openRows = await query("select=id,show_date,start_time,end_time,focus&status=eq.open&order=show_date.asc&order=start_time.asc");
// NOTE: for reserved we deliberately DO NOT fetch group_name/focus/contact — the
// public file must never contain them.
const bookedRows = await query("select=id,show_date,start_time,end_time&status=in.(tentative,confirmed)&order=show_date.asc&order=start_time.asc");

const publicEvents = []
  .concat(openRows.map(s => ({
    id: s.id, date: s.show_date, start: s.start_time, end: s.end_time,
    summary: s.focus ? `Available — ${s.focus}` : "Available",
    desc: "This planetarium show time is available to book.",
    status: "CONFIRMED", transp: "TRANSPARENT"
  })))
  .concat(bookedRows.map(s => ({
    id: s.id, date: s.show_date, start: s.start_time, end: s.end_time,
    summary: "Reserved", desc: "This time is reserved.",
    status: "CONFIRMED", transp: "TRANSPARENT"
  })));
writeFileSync("availability.ics", toICS("Spanel Planetarium — Availability", publicEvents));
console.log(`Wrote availability.ics: ${openRows.length} available + ${bookedRows.length} reserved.`);

// ---- STAFF feed: booked shows with detail, NO contact fields -------------------
const staffCols = "id,show_date,start_time,end_time,status,focus,group_name,group_size,lead,driver,usher1,usher2";
const staffRows = await query(`select=${staffCols}&status=in.(tentative,confirmed)&order=show_date.asc&order=start_time.asc`);
const staffEvents = staffRows.map(s => {
  const title = s.group_name || s.focus || "Planetarium show";
  const d = [];
  if (s.focus) d.push(`Focus: ${s.focus}`);
  if (s.group_name) d.push(`Group: ${s.group_name}`);
  if (s.group_size) d.push(`Size: ${s.group_size}`);
  d.push(`Status: ${STATUS_LABEL[s.status]}${s.status === "confirmed" ? " (paid)" : " (unpaid)"}`);
  const staff = [s.lead && `Lead: ${s.lead}`, s.driver && `Driver: ${s.driver}`,
                 s.usher1 && `Usher: ${s.usher1}`, s.usher2 && `Usher: ${s.usher2}`].filter(Boolean);
  if (staff.length) d.push(staff.join(" · "));
  return {
    id: s.id, date: s.show_date, start: s.start_time, end: s.end_time,
    summary: `${s.status === "confirmed" ? "" : "(Tentative) "}${title}`,
    desc: d.join("\n"),
    status: s.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"
  };
});
writeFileSync("staff-calendar.ics", toICS("Spanel Planetarium — Shows", staffEvents));
console.log(`Wrote staff-calendar.ics with ${staffRows.length} booked shows.`);
