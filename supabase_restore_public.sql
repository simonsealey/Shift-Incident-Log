-- Restore public RLS policies (reverting the Supabase Auth attempt)
-- Run in Supabase Dashboard → SQL Editor

-- shift_log
DROP POLICY IF EXISTS "Auth read shift_log"    ON shift_log;
DROP POLICY IF EXISTS "Auth insert shift_log"  ON shift_log;
DROP POLICY IF EXISTS "Admin update shift_log" ON shift_log;

CREATE POLICY "Public read shift_log"
  ON shift_log FOR SELECT USING (true);

CREATE POLICY "Public insert shift_log"
  ON shift_log FOR INSERT WITH CHECK (true);

CREATE POLICY "Public update shift_log"
  ON shift_log FOR UPDATE USING (true);

-- entry_comments
DROP POLICY IF EXISTS "Auth read comments"   ON entry_comments;
DROP POLICY IF EXISTS "Auth insert comments" ON entry_comments;

CREATE POLICY "Public read comments"
  ON entry_comments FOR SELECT USING (true);

CREATE POLICY "Public insert comments"
  ON entry_comments FOR INSERT WITH CHECK (true);
