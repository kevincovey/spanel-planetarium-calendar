# Spanel Planetarium — Availability Calendar

A small web app for scheduling planetarium shows. **One row per show**, multiple
shows per day, per‑show color coding, a generated quarter of open slots from a
"typical week," full contact/staffing details, an admin **dashboard**, and a
private **subscribable calendar feed**.

It is a **static site** (plain HTML/CSS/JS — no build step) backed by a free
**Supabase** database, so every signed‑in staff member sees the same live schedule.

---

## Files

| File | What it is |
|------|-----------|
| `index.html` · `app.js` · `styles.css` | The app |
| `schema.sql` | Run once in Supabase to create tables + **security rules** |
| `config.example.js` | Optional — bake your Supabase keys into the site |
| `scripts/build-ics.mjs` | Builds the public sanitized calendar feed |
| `.github/workflows/calendar.yml` | Rebuilds the feed on a schedule |
| `README.md` | This file |

## The tabs

- **📅 Calendar** — a rolling **4‑month** grid (current month + next three; use
  ◀ ▶ / **Today**). Each show is a colored chip:
  `○` gray **Open** · `◐` amber **Tentative (unpaid)** · `●` green **Confirmed (paid)**.
  Click a chip to edit; click an empty day to add. **⬇ Calendar file (.ics)** downloads
  a sanitized snapshot.
- **📊 Dashboard** — usage stats for any date range (presets: current quarter, YTD,
  this year, all time): booked shows, confirmed/tentative counts, total & confirmed
  **attendees**, average group size, open slots, plus shows‑by‑month, by‑status, and
  presenter‑load charts.
- **📋 Shows** — the one‑row‑per‑show table with a date + status filter (this is also
  your **history** view) and **Export CSV**.
- **🗓️ Weekly Defaults** — your "typical week": timeslots × weekdays and the default
  staff. This is what **Generate Quarter** flows from.
- **⚙️ Setup & Sharing** — quarters, cloud connection/sign‑in, and the feed.

---

## Try it now (no setup)

Open `index.html` in a browser (or serve the folder). It starts in **Local demo**
mode — data stays in that one browser. Click **Generate quarter from weekly
defaults**, edit shows, explore. Switch to shared cloud mode when ready.

---

## One‑time setup: the shared, private database (Supabase)

1. Create a free project at **supabase.com**.
2. **SQL Editor → New query** → paste all of `schema.sql` → **Run**. This creates
   the tables **and locks them down** (see *Security* below).
3. **Authentication → Users → Add user** — create one login per staff member
   (email + password, or **Invite** to email them a set‑password link). To keep the
   public out, **Authentication → Providers → Email → turn off "Enable sign‑ups."**
4. **Project Settings → API** — copy the **Project URL** and the **anon public** key.
5. In the app: **⚙️ Setup & Sharing → Cloud sync**, paste both, **Connect**, then
   **Sign in** with a staff account.

> Prefer staff auto‑connected? Copy `config.example.js` to `config.js`, paste the
> URL + anon key, commit it. (They still sign in individually.)

---

## Security & privacy — how it actually works

**Short version:** with `schema.sql` as shipped, **only staff accounts you create can
read or write anything** — contact names and emails included. The public site cannot
read the data on its own. The one public artifact is the calendar feed, which is
deliberately stripped of contact info.

Details:

- **The keys in a static site are public — that's expected.** A static page has no
  server, so the **anon** key it ships is visible to anyone. Supabase is built for
  this: the anon key does **nothing** unless the database's rules allow it.
- **Row Level Security (RLS) + role grants** are what enforce access. `schema.sql`:
  - **revokes all access from the `anon` (public) role**, so the anon key alone can't
    read or write; and
  - **grants access only to `authenticated`** (signed‑in) users, via policies scoped
    to that role.
  So an unauthenticated visitor gets *nothing* — not even show times, and certainly
  not contact details. **Contact name/email are only ever visible to signed‑in staff.**
- **Can we limit edits to certain users?** Yes — that's exactly this model. Only the
  accounts you add under Authentication can read or write; everyone else is locked
  out. There's no public sign‑up (you turn it off in step 3), so "certain
  authenticated users" = "the staff you invited."
- **Want tiers later** (e.g. some staff read‑only, or a public read‑only view that
  hides contacts)? That's a policy change — ask and I'll extend `schema.sql` (e.g. a
  `viewer` vs `editor` role, or a contact‑free public view). The current build keeps
  it simple: signed‑in = full access, everyone else = none.
- **The feed uses a server‑side secret, not the public key.** The GitHub Action reads
  the database with the **service_role** key, which lives only in GitHub Actions
  secrets (never in the browser), and writes out only non‑private fields.

---

## Subscribable calendar feeds (Google / Outlook)

The app publishes **two** feeds for two different audiences:

| Feed | File | Contents | Audience |
|------|------|----------|----------|
| **Availability** | `availability.ics` | **Open slots only**, shown as "Available". No group, staff, or contact info. | **Public** — embed on the planetarium website so visitors see bookable times. |
| **Staff** | `staff-calendar.ics` | **Tentative + confirmed** shows: group, size, focus, staffing. **No contact name/email.** | **Staff** — subscribe to know when they're needed in the dome. |

**One‑time files:** on the Calendar tab, **⬇ Availability .ics** and **⬇ Staff .ics**
download snapshots.

**Live subscription (recommended):**

1. In your GitHub repo: **Settings → Secrets and variables → Actions → New repository
   secret**, add:
   - `SUPABASE_URL` — your project URL
   - `SUPABASE_SERVICE_ROLE_KEY` — **Supabase → Project Settings → API → service_role**
     (keep this secret; never commit it).
2. The included workflow (`.github/workflows/calendar.yml`) runs hourly (and on demand
   from the **Actions** tab) and commits both `availability.ics` and
   `staff-calendar.ics` to the repo.
3. Subscribe to `https://YOURNAME.github.io/REPO/staff-calendar.ics` (staff) or
   `https://YOURNAME.github.io/REPO/availability.ics` (public):
   - **Google Calendar:** Other calendars → **+** → **From URL** → paste → Add.
   - **Outlook:** Add calendar → **Subscribe from web** → paste → Import.

**Embedding availability on the website:** the simplest route is to subscribe
`availability.ics` into a Google Calendar, then use that calendar's **Settings →
Integrate calendar → Embed code** `<iframe>` on your site. (An `.ics` URL is a data
feed, not an embeddable widget on its own — Google/Outlook do the rendering.)

*Notes:* calendar apps refresh subscriptions every few hours to daily — that's
normal. Both feeds live at public GitHub Pages URLs, so treat the staff feed's group
names accordingly; it still contains **no contact details**. Want the staff feed
private (behind login) instead of a public URL? That needs a small server component —
ask and I'll wire it up.

---

## Embedding a calendar on your website (Drupal, etc.)

An `.ics` file is calendar *data*, not a web page, so it can't be iframed directly.
The included **`embed.html`** renders a feed as a real month/agenda calendar you
*can* iframe. It reads a feed via a query parameter:

- `?cal=availability` — open slots ("10am - Available"), for the public site
- `?cal=staff` — booked shows, colored by confirmed/tentative
- `?cal=both` — **both feeds overlaid, with checkboxes so the viewer can toggle
  each on/off** (blue = available, green = confirmed, amber = tentative)
- add `&view=list` for an agenda list instead of a month grid

⚠️ **Privacy:** the checkboxes only appear for `cal=both` (or `cal=staff`), and
the staff layer shows group names. Use `cal=availability` on public pages — it
shows only open times with **no way for a visitor to reveal bookings**. Reserve
`cal=both`/`cal=staff` for staff/internal pages.

**Drupal:** on a Basic/Full‑HTML page, add a Block or Custom HTML and paste an
`<iframe>`. (In Drupal's editor, use the **Source/`<>`** view so it doesn't strip
the tag; or allow `<iframe>` in the text format's allowed‑tags.)

Public availability calendar:
```html
<iframe src="https://kevincovey.github.io/spanel-planetarium-calendar/embed.html?cal=availability"
        style="width:100%;height:720px;border:0;" loading="lazy"
        title="Planetarium availability"></iframe>
```

Staff calendar (⚠️ shows group names — only put this on a staff/internal page):
```html
<iframe src="https://kevincovey.github.io/spanel-planetarium-calendar/embed.html?cal=staff"
        style="width:100%;height:720px;border:0;" loading="lazy"
        title="Planetarium staff calendar"></iframe>
```

Combined view with viewer toggles (⚠️ staff/internal pages only):
```html
<iframe src="https://kevincovey.github.io/spanel-planetarium-calendar/embed.html?cal=both"
        style="width:100%;height:760px;border:0;" loading="lazy"
        title="Planetarium calendar"></iframe>
```

The embed refreshes whenever the feeds rebuild (hourly). Neither embed contains
contact names or emails.

## Publish the app on GitHub Pages

```bash
cd spanel-planetarium-calendar
git init
git add .
git commit -m "Spanel Planetarium availability calendar"
git branch -M main
git remote add origin https://github.com/YOURNAME/spanel-planetarium-calendar.git
git push -u origin main
```

Then **repo Settings → Pages → Source: Deploy from a branch → `main` / root → Save**.
After ~1 minute you get `https://YOURNAME.github.io/spanel-planetarium-calendar/`.
Share it with staff; everyone signs in to the same Supabase project.

---

## Day‑to‑day workflow

1. **Set your typical week** once in **Weekly Defaults** (presenter/driver/ushers per
   10a/11a/12p/1p/2p slot). Save.
2. **Start a quarter:** Setup → name + first date → **Create quarter** → **Generate
   quarter from weekly defaults** → every weekday slot becomes an **Open** show.
3. **A booking comes in:** click that slot, fill group/size/focus/contact, set
   **Tentative** (amber).
4. **They pay:** flip to **Confirmed** (green).
5. **One‑off / after‑hours:** click any empty day or **+ Add show**.
6. **New season:** create another quarter and generate again; old quarters stay in
   history (Shows tab / Dashboard "all time").

---

## Notes

- **Times** stored 24‑hour, shown as 10a / 2p. Default shows are one hour.
- **Status = paid?** "Confirmed" = paid, "Tentative" = requested/unpaid — this single
  field drives the calendar colors and the feed.
- **Weekends** are shown but have no default slots; add shows there manually.
- **Contact fields are marked "private"** in the editor as a reminder that they never
  leave the authenticated app (not in the feed, not to the public).
