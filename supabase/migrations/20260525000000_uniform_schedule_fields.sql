-- Uniform-schedule acknowledgment: stamped when a parent dismisses the
-- "your sessions are predicted at these times" confirmation card that
-- appears on /portal at the start of each uniform renewal cycle.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS uniform_schedule_acknowledged_at TIMESTAMPTZ;
