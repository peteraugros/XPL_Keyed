-- Phase 2 of the trial conversion + scheduling flow per
-- xpl-trial-conversion-spec.md.
--
-- Adds three new lifecycle states between trial-acceptance and active:
--   ACCEPTED_PENDING_SCHEDULING — Tim approved, curriculum drafted,
--     awaiting parent to start booking the 4 paid-lesson slots.
--   SCHEDULING_IN_PROGRESS — At least one slot booked, less than 4.
--   PENDING_PAYMENT — All 4 slots booked, awaiting Stripe checkout.
--
-- Plus a cycle_anchor_at column on curricula. The first booked slot's
-- start time becomes the anchor; weeks 2..4 are validated against
-- cycle_anchor_at + 7d, +14d, +21d (with a small tolerance window).
--
-- Idempotent: ADD VALUE IF NOT EXISTS for the enum, IF NOT EXISTS for
-- the column.

-- Postgres requires enum value additions to be committed before they're
-- usable. The IF NOT EXISTS clause makes this safe to re-run.
ALTER TYPE lifecycle_state_t ADD VALUE IF NOT EXISTS 'ACCEPTED_PENDING_SCHEDULING';
ALTER TYPE lifecycle_state_t ADD VALUE IF NOT EXISTS 'SCHEDULING_IN_PROGRESS';
ALTER TYPE lifecycle_state_t ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';

-- cycle_anchor_at: set when the parent books slot 1. Used to validate
-- subsequent slots fall in the right week + drive the scheduler UI's
-- "next pending week is X" framing.
ALTER TABLE curricula
  ADD COLUMN IF NOT EXISTS cycle_anchor_at TIMESTAMPTZ;

-- live_call_event_uri on curriculum_slots already exists. live_call_at
-- already exists. No new columns needed there.

-- Index supporting the scheduler's "next pending slot" query:
--   SELECT * FROM curriculum_slots
--   WHERE curriculum_id = $1 AND live_call_at IS NULL
--   ORDER BY week_number ASC LIMIT 1
CREATE INDEX IF NOT EXISTS curriculum_slots_pending_idx
  ON curriculum_slots (curriculum_id, week_number)
  WHERE live_call_at IS NULL;

-- Note: a partial index keyed on the new lifecycle values cannot be
-- created in the same migration that adds those enum values (Postgres
-- 55P04: "unsafe use of new value"). At 1-10 client scale the
-- sequential scan is fine; revisit when volume warrants it.

-- Track abandonment reminder timestamps on subscriptions so the cron
-- jobs don't double-send.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS scheduling_reminder_24h_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduling_reminder_72h_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reminder_6h_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_reminder_12h_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scheduling_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payment_pending_at TIMESTAMPTZ;
