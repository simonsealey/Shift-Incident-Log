-- Shift & Incident Log — migration for follow-up resolution
-- Safe to run on an existing project. Run in Supabase → SQL Editor → Run.

-- 1. Rename initials → staff_name (only if it hasn't been done already)
do $$
begin
  if exists (
        select 1 from information_schema.columns
        where table_name = 'shift_log' and column_name = 'initials'
      )
     and not exists (
        select 1 from information_schema.columns
        where table_name = 'shift_log' and column_name = 'staff_name'
      )
  then
    alter table shift_log rename column initials to staff_name;
  end if;
end $$;

-- 2. Add follow-up resolution tracking
alter table shift_log add column if not exists resolved     boolean not null default false;
alter table shift_log add column if not exists resolved_by  text;
alter table shift_log add column if not exists resolved_at  timestamptz;

-- 3. Allow the public (anon) role to update rows (needed to resolve follow-ups).
--    With per-user auth this would be restricted to leads; fine for the prototype.
drop policy if exists "anon can update" on shift_log;
create policy "anon can update" on shift_log for update to anon using (true) with check (true);

-- 4. Refresh the API schema cache so new columns are visible immediately
notify pgrst, 'reload schema';
