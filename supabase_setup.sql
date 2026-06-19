-- Shift & Incident Log — Supabase table setup
-- Run this in the Supabase dashboard → SQL Editor → New query → Run

create table if not exists shift_log (
  id               bigint generated always as identity primary key,
  created_at       timestamptz default now(),
  date             date,
  shift            text,
  time             text,
  initials         text,
  campus           text,
  event_type       text,
  narrative        text,
  follow_up_needed text,
  follow_up_notes  text
);

-- Row Level Security: lock the table, then allow the public (anon) key
-- to read and insert. Appropriate for an internal prototype with no real data.
alter table shift_log enable row level security;

drop policy if exists "anon can read"   on shift_log;
drop policy if exists "anon can insert" on shift_log;

create policy "anon can read"   on shift_log for select to anon using (true);
create policy "anon can insert" on shift_log for insert to anon with check (true);
