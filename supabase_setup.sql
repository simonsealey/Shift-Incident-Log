-- Shift & Incident Log — Supabase table setup
-- Run this in the Supabase dashboard → SQL Editor → New query → Run

create table if not exists shift_log (
  id               bigint generated always as identity primary key,
  created_at       timestamptz default now(),
  date             date,
  shift            text,
  time             text,
  staff_name       text,
  campus           text,
  event_type       text,
  narrative        text,
  follow_up_needed text,
  follow_up_notes  text,
  resolved         boolean not null default false,
  resolved_by      text,
  resolved_at      timestamptz,
  resolution_notes text
);

-- Row Level Security: lock the table, then allow the public (anon) key to
-- read, insert, and update. Appropriate for an internal prototype with no
-- real data. With per-user auth, update would be restricted to leads.
alter table shift_log enable row level security;

drop policy if exists "anon can read"   on shift_log;
drop policy if exists "anon can insert" on shift_log;
drop policy if exists "anon can update" on shift_log;

create policy "anon can read"   on shift_log for select to anon using (true);
create policy "anon can insert" on shift_log for insert to anon with check (true);
create policy "anon can update" on shift_log for update to anon using (true) with check (true);
