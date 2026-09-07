// ============================================================================
// build-ics.mjs — generates TWO public calendar feeds:
//
//   availability.ics   OPEN slots only, as "Available", no personal info.
//                      Safe to embed on the planetarium's public website.
//   staff-calendar.ics TENTATIVE + CONFIRMED shows for staff (group/focus/
//                      staffing), with NO contact name or email.
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

const STATUS_LABEL = { open: "Open", tentative: "Tentative", confirmed: "Confirmed" };

function icsEscape(s) { return String(s ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
function icsDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-");
  const [hh, mm] = (timeStr || "00:00").split(":");
  return `${y}${m}${d}T${hh}${mm}00`;
}
function stampUTC() {
  const n = new Date(), p = x => String(x).padStart(2, "0");
  return `${n.getUTCFullYear()}${p(n.getUTCMonth()+1)}${p(n.getUTCDate())}T${p(n.getUTCHours())}${p(n.getUTCMinutes())}${p(n.getUTCSeconds())}Z`;
}

function buildICS(shows, { calName, publicMode }) {
  const stamp = stampUTC();
  const lines = ["BEGIN:VCALENDAR","VERSION:2.0","PRODID:-//Spanel Planetarium//Availability Calendar//EN",
    "CALSCALE:GREGORIAN","METHOD:PUBLISH",`X-WR-CALNAME:${icsEscape(calName)}`,"X-WR-TIMEZONE:local"];
  for (const s of shows) {
    const ev = ["BEGIN:VEVENT", `UID:${s.id}@spanel-planetarium`, `DTSTAMP:${stamp}`,
      `DTSTART:${icsDateTime(s.show_date, s.start_time)}`, `DTEND:${icsDateTime(s.show_date, s.end_time)}`];
    if (publicMode) {
      const summary = s.focus ? `Available — ${s.focus}` : "Available";
      ev.push(`SUMMARY:${icsEscape(summary)}`,
              `DESCRIPTION:${icsEscape("This planetarium show time is available to book.")}`,
              "STATUS:CONFIRMED", "TRANSP:TRANSPARENT");
    } else {
      const title = s.group_name || s.focus || "Planetarium show";
      const summary = `${s.status === "confirmed" ? "" : "(Tentative) "}${title}`;
      const d = [];
      if (s.focus) d.push(`Focus: ${s.focus}`);
      if (s.group_name) d.push(`Group: ${s.group_name}`);
      if (s.group_size) d.push(`Size: ${s.group_size}`);
      d.push(`Status: ${STATUS_LABEL[s.status]}${s.status === "confirmed" ? " (paid)" : " (unpaid)"}`);
      const staff = [s.lead && `Lead: ${s.lead}`, s.driver && `Driver: ${s.driver}`,
                     s.usher1 && `Usher: ${s.usher1}`, s.usher2 && `Usher: ${s.usher2}`].filter(Boolean);
      if (staff.length) d.push(staff.join(" · "));
      // contact_name / contact_email are never fetched or emitted (private).
      ev.push(`SUMMARY:${icsEscape(summary)}`, `DESCRIPTION:${icsEscape(d.join("\n"))}`,
              `STATUS:${s.status === "confirmed" ? "CONFIRMED" : "TENTATIVE"}`);
    }
    ev.push("END:VEVENT");
    lines.push(...ev);
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

async function query(params) {
  const res = await fetch(`${URL}/rest/v1/shows?${params}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
  if (!res.ok) { console.error("Supabase query failed:", res.status, await res.text()); process.exit(1); }
  return res.json();
}

// Availability feed — open slots, minimal columns (no staff, group, or contact).
const availCols = "id,show_date,start_time,end_time,focus";
const availShows = await query(`select=${availCols}&status=eq.open&order=show_date.asc&order=start_time.asc`);
writeFileSync("availability.ics", buildICS(availShows, { calName: "Spanel Planetarium — Availability", publicMode: true }));
console.log(`Wrote availability.ics with ${availShows.length} open slots.`);

// Staff feed — booked shows, staffing columns, NO contact fields.
const staffCols = "id,show_date,start_time,end_time,status,focus,group_name,group_size,lead,driver,usher1,usher2";
const staffShows = await query(`select=${staffCols}&status=in.(tentative,confirmed)&order=show_date.asc&order=start_time.asc`);
writeFileSync("staff-calendar.ics", buildICS(staffShows, { calName: "Spanel Planetarium — Shows", publicMode: false }));
console.log(`Wrote staff-calendar.ics with ${staffShows.length} booked shows.`);
