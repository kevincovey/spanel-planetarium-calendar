-- ============================================================================
-- Spanel Planetarium Availability Calendar — Supabase schema  (SECURE model)
-- ----------------------------------------------------------------------------
-- Run this ONCE in your Supabase project:
--   Supabase dashboard  ->  SQL Editor  ->  New query  ->  paste  ->  Run.
--
-- This SECURE version locks the data down so that ONLY signed-in staff can read
-- or write anything (contact names/emails included). The public / anonymous key
-- that ships in the static site can do NOTHING on its own. See the very bottom
-- for how to switch to a simpler "open" model if you ever want that instead.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. QUARTERS — each 3-month generation window
-- ---------------------------------------------------------------------------
create table if not exists quarters (
    id          uuid primary key default gen_random_uuid(),
    name        text not null,
    start_date  date not null,
    created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. WEEKLY_DEFAULTS — the "typical week": one row per weekday x timeslot
-- ---------------------------------------------------------------------------
create table if not exists weekly_defaults (
    id          uuid primary key default gen_random_uuid(),
    weekday     int  not null,                 -- 0=Sun .. 6=Sat (defaults use 1..5)
    start_time  text not null,                 -- "HH:MM" 24h
    end_time    text not null,
    lead        text default '',
    driver      text default '',
    usher1      text default '',
    usher2      text default '',
    active      boolean not null default true,
    unique (weekday, start_time)
);

-- ---------------------------------------------------------------------------
-- 3. SHOWS — one row per show
--    (contact_name / contact_email are the PRIVATE fields.)
-- ---------------------------------------------------------------------------
create table if not exists shows (
    id            uuid primary key default gen_random_uuid(),
    quarter_id    uuid references quarters(id) on delete set null,
    show_date     date not null,
    start_time    text not null,
    end_time      text not null,
    status        text not null default 'open', -- 'open' | 'tentative' | 'confirmed'
    focus         text default '',
    group_name    text default '',
    group_size    int,
    contact_name  text default '',              -- PRIVATE
    contact_email text default '',              -- PRIVATE
    lead          text default '',
    driver        text default '',
    usher1        text default '',
    usher2        text default '',
    notes         text default '',
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);
create index if not exists shows_date_idx on shows (show_date);
create index if not exists shows_quarter_idx on shows (quarter_id);

-- OPTIONAL hard guard against two shows sharing the exact same date + start time.
-- The app already skips overlapping slots when generating a quarter, so this is a
-- belt-and-suspenders safeguard (e.g. two staff generating at the same instant).
-- Tradeoff: it blocks ONLY identical start times, not partial overlaps, and if a
-- generate batch ever did collide it would fail the whole batch. Enable if you
-- want the database itself to refuse exact duplicates:
--   create unique index if not exists shows_no_dup_start on shows (show_date, start_time);

create or replace function touch_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;
drop trigger if exists shows_touch on shows;
create trigger shows_touch before update on shows
    for each row execute function touch_updated_at();

-- ============================================================================
-- SECURITY  —  authenticated staff only
-- ----------------------------------------------------------------------------
-- Step A: strip the public "anon" role of all table access. The anon key baked
--         into the static site can now do nothing until a user signs in.
-- Step B: give the "authenticated" role (any signed-in user) full access.
-- Step C: enable RLS and add permissive policies scoped to authenticated only.
-- The GitHub Action that builds the public calendar feed uses the SERVICE ROLE
-- key (a server-side secret), which bypasses all of this — so the feed still
-- works without exposing anything to browsers.
-- ============================================================================

-- Step A — block anon completely
revoke all on quarters        from anon;
revoke all on weekly_defaults from anon;
revoke all on shows           from anon;

-- Step B — allow signed-in staff
grant all on quarters        to authenticated;
grant all on weekly_defaults to authenticated;
grant all on shows           to authenticated;

-- Step C — RLS: only authenticated users, and only through the policies below
alter table quarters        enable row level security;
alter table weekly_defaults enable row level security;
alter table shows           enable row level security;

drop policy if exists staff_all on quarters;
drop policy if exists staff_all on weekly_defaults;
drop policy if exists staff_all on shows;

create policy staff_all on quarters        for all to authenticated using (true) with check (true);
create policy staff_all on weekly_defaults for all to authenticated using (true) with check (true);
create policy staff_all on shows           for all to authenticated using (true) with check (true);

-- ============================================================================
-- ADDING STAFF LOGINS
-- There is no public sign-up. YOU create each staff account:
--   Supabase dashboard -> Authentication -> Users -> Add user
--   (set an email + password, or use "Invite" to email them a set-password link).
-- To keep sign-up closed to the public:
--   Authentication -> Providers -> Email -> turn OFF "Enable sign-ups".
-- Anyone you have NOT added simply cannot read or write the data.
-- ============================================================================

-- ============================================================================
-- OPTIONAL — SIMPLE "OPEN" MODEL (NOT recommended given your privacy needs)
-- If you ever want the earlier no-login behavior (anyone with the link can
-- read/write, contact info included), run this instead of Steps A–C above:
--
--   grant all on quarters, weekly_defaults, shows to anon, authenticated;
--   alter table quarters enable row level security;
--   alter table weekly_defaults enable row level security;
--   alter table shows enable row level security;
--   create policy open_all on quarters        for all using (true) with check (true);
--   create policy open_all on weekly_defaults for all using (true) with check (true);
--   create policy open_all on shows           for all using (true) with check (true);
-- ============================================================================
