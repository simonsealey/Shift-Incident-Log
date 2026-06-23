-- Per-user auth with roles
-- Run in Supabase Dashboard → SQL Editor
-- Requires Email Auth to be enabled: Authentication → Providers → Email

-- ── 1. Profiles table ────────────────────────────────────────────────────────
-- One row per auth user — stores display name and role.
CREATE TABLE IF NOT EXISTS profiles (
  id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('staff', 'admin')),
  campus     TEXT,          -- preferred campus, pre-fills the form
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Every signed-in user can read all profiles (needed for comment author lookups)
CREATE POLICY "Auth users read profiles"
  ON profiles FOR SELECT
  USING (auth.role() = 'authenticated');

-- Users can only update their own row
CREATE POLICY "Users update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id);

-- ── 2. Auto-create a profile when a new user signs up ────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'staff'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE handle_new_user();

-- ── 3. Lock shift_log to authenticated users ──────────────────────────────────
-- Drop the old public policies first (names may differ — adjust if needed)
DROP POLICY IF EXISTS "Allow public read"           ON shift_log;
DROP POLICY IF EXISTS "Allow public insert"         ON shift_log;
DROP POLICY IF EXISTS "Allow public update"         ON shift_log;
DROP POLICY IF EXISTS "Public read"                 ON shift_log;
DROP POLICY IF EXISTS "Public insert"               ON shift_log;
DROP POLICY IF EXISTS "Enable read access for all"  ON shift_log;
DROP POLICY IF EXISTS "Enable insert for all"       ON shift_log;

-- Any signed-in user can read
CREATE POLICY "Auth read shift_log"
  ON shift_log FOR SELECT
  USING (auth.role() = 'authenticated');

-- Any signed-in user can insert
CREATE POLICY "Auth insert shift_log"
  ON shift_log FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- Only admins can update (resolving follow-ups)
CREATE POLICY "Admin update shift_log"
  ON shift_log FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── 4. Lock entry_comments to authenticated users ────────────────────────────
DROP POLICY IF EXISTS "Public read comments"  ON entry_comments;
DROP POLICY IF EXISTS "Public insert comments" ON entry_comments;

CREATE POLICY "Auth read comments"
  ON entry_comments FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Auth insert comments"
  ON entry_comments FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

-- ── 5. How to create users ───────────────────────────────────────────────────
-- Create accounts in: Supabase dashboard → Authentication → Users → Invite user
-- Then set their display name and role:
--
--   UPDATE profiles
--   SET full_name = 'Jane Smith', role = 'admin'   -- or 'staff'
--   WHERE id = (SELECT id FROM auth.users WHERE email = 'jane@example.com');
