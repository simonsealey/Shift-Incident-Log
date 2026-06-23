-- Comment threads on log entries
-- Run in Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS entry_comments (
  id          BIGSERIAL PRIMARY KEY,
  entry_id    BIGINT NOT NULL REFERENCES shift_log(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL CHECK (char_length(trim(author_name)) > 0),
  body        TEXT NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE entry_comments ENABLE ROW LEVEL SECURITY;

-- Staff can read all comments
CREATE POLICY "Public read comments"
  ON entry_comments FOR SELECT USING (true);

-- Staff can post comments (name is required by the CHECK constraint above)
CREATE POLICY "Public insert comments"
  ON entry_comments FOR INSERT WITH CHECK (true);
