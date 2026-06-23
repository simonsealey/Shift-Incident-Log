-- Add AI-predicted severity column to shift_log
-- Run this in Supabase Dashboard → SQL Editor

ALTER TABLE shift_log
  ADD COLUMN IF NOT EXISTS severity TEXT
    CHECK (severity IN ('Low', 'Medium', 'High'))
    DEFAULT NULL;

COMMENT ON COLUMN shift_log.severity IS
  'AI-predicted severity (Low / Medium / High) captured at submission time. NULL if AI server was offline.';
