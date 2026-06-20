-- Shift & Incident Log — attachments (photos/documents) setup
-- Run in Supabase → SQL Editor → New query → Run. Safe to re-run.

-- 1. Column to store attachment metadata on each entry
--    (an array of objects: {path, name, type, size}).
alter table shift_log add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 2. Private storage bucket that holds the uploaded files.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

-- 3. Allow the public (anon) role to read / upload / remove files in this bucket.
--    This matches the prototype's anon-key model. With per-user auth these
--    policies would be tightened to authenticated staff only.
drop policy if exists "anon read attachments"   on storage.objects;
drop policy if exists "anon upload attachments" on storage.objects;
drop policy if exists "anon delete attachments" on storage.objects;

create policy "anon read attachments"   on storage.objects
  for select to anon using (bucket_id = 'attachments');
create policy "anon upload attachments" on storage.objects
  for insert to anon with check (bucket_id = 'attachments');
create policy "anon delete attachments" on storage.objects
  for delete to anon using (bucket_id = 'attachments');

-- 4. Refresh the API schema cache so the new column is visible immediately.
notify pgrst, 'reload schema';
