-- ============================================================================
-- XPL Keyed — waiting_on + lifecycle_state foundation
-- ============================================================================
-- Backend foundation for the admin rebuild per
-- `Coach Dashboard Spec/backend-spec.md`.
--
-- Adds two enum-typed columns to the data layer:
--   * `waiting_on` — whose turn it is right now (TIM | PARENT | KID | SYSTEM | DAD)
--   * `lifecycle_state` — where the client is in their journey
--     (TRIAL_PREP | TRIAL_SCHEDULED | TRIAL_DONE | ACTIVE | PAST_DUE |
--      PENDING_CANCEL | CANCELED | WAITLIST)
--
-- Plus the `stuck_events` table for the Stuck-button flow (per spec
-- section 7). View `derived_tasks_view` (a join over waiting_on='TIM'
-- sources) is created in a separate migration to keep this one focused
-- on schema.
--
-- waiting_on is denormalized onto each state-bearing table (per spec
-- section 12 open question — denormalized chosen for query simplicity).
--
-- All migrations idempotent: ENUM creation uses DO blocks, ADD COLUMN
-- uses IF NOT EXISTS, backfills use WHERE clauses against existing data.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Enum types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE waiting_on_t AS ENUM ('TIM', 'PARENT', 'KID', 'SYSTEM', 'DAD');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE lifecycle_state_t AS ENUM (
    'TRIAL_PREP',
    'TRIAL_SCHEDULED',
    'TRIAL_DONE',
    'ACTIVE',
    'PAST_DUE',
    'PENDING_CANCEL',
    'CANCELED',
    'WAITLIST'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;


-- ---------------------------------------------------------------------------
-- waiting_on on state-bearing tables
-- ---------------------------------------------------------------------------
-- Default is SYSTEM so existing rows get a sane initial value; backfill
-- below computes the actual current value where derivable.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS waiting_on waiting_on_t NOT NULL DEFAULT 'SYSTEM';

ALTER TABLE curricula
  ADD COLUMN IF NOT EXISTS waiting_on waiting_on_t NOT NULL DEFAULT 'SYSTEM';

ALTER TABLE cancellation_events
  ADD COLUMN IF NOT EXISTS waiting_on waiting_on_t NOT NULL DEFAULT 'SYSTEM';

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS waiting_on waiting_on_t NOT NULL DEFAULT 'SYSTEM';


-- ---------------------------------------------------------------------------
-- lifecycle_state on subscriptions
-- ---------------------------------------------------------------------------
-- subscriptions.status stays as the Stripe-flavored field (active /
-- past_due / pending_cancel / canceled / trial / declined). lifecycle_state
-- is the journey-flavored field per the backend spec — separable concerns.
-- Default to TRIAL_PREP because new rows are created at intake submit time.
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS lifecycle_state lifecycle_state_t NOT NULL DEFAULT 'TRIAL_PREP';


-- ---------------------------------------------------------------------------
-- Backfill: waiting_on on messages (per spec section 9 step 5)
-- ---------------------------------------------------------------------------
-- The latest message per thread determines whose turn it is:
--   * If the latest message was sent by the player → waiting on TIM
--   * If the latest message was sent by the coach  → waiting on KID
--   * If the latest message was sent by the bot    → leave SYSTEM
--
-- We apply this only to the latest message per player_id (older messages
-- in the thread keep the SYSTEM default; they're not actionable anyway,
-- only the latest matters for the Home queue per spec section 6).
WITH latest AS (
  SELECT DISTINCT ON (player_id) id, sender_role
  FROM messages
  ORDER BY player_id, created_at DESC
)
UPDATE messages m
SET waiting_on =
  CASE latest.sender_role
    WHEN 'player' THEN 'TIM'::waiting_on_t
    WHEN 'coach'  THEN 'KID'::waiting_on_t
    ELSE 'SYSTEM'::waiting_on_t
  END
FROM latest
WHERE m.id = latest.id;


-- ---------------------------------------------------------------------------
-- Backfill: waiting_on on curricula
-- ---------------------------------------------------------------------------
--   pending_approval → PARENT (parent needs to approve)
--   active           → SYSTEM (cron handles Sunday delivery)
--   completed        → SYSTEM
--   superseded       → SYSTEM
UPDATE curricula
SET waiting_on = CASE status
  WHEN 'pending_approval' THEN 'PARENT'::waiting_on_t
  ELSE 'SYSTEM'::waiting_on_t
END
WHERE waiting_on = 'SYSTEM';


-- ---------------------------------------------------------------------------
-- Backfill: waiting_on on subscriptions
-- ---------------------------------------------------------------------------
--   trial          → TIM   (trial decision pending after the call)
--   active         → SYSTEM
--   past_due       → SYSTEM (cron drives until day 6; spec then flips to TIM)
--   pending_cancel → PARENT (parent confirms or undoes)
--   canceled       → SYSTEM
--   declined       → SYSTEM
UPDATE subscriptions
SET waiting_on = CASE status
  WHEN 'trial'          THEN 'TIM'::waiting_on_t
  WHEN 'pending_cancel' THEN 'PARENT'::waiting_on_t
  ELSE 'SYSTEM'::waiting_on_t
END
WHERE waiting_on = 'SYSTEM';


-- ---------------------------------------------------------------------------
-- Backfill: waiting_on on cancellation_events
-- ---------------------------------------------------------------------------
-- New cancellation events default to waiting on TIM (he reviews credit
-- vs forfeit). Once Tim approves the credit, the row's waiting_on
-- transitions to SYSTEM. Backfill: assume all existing rows have been
-- handled already (the field didn't exist; the events ran to completion).
UPDATE cancellation_events
SET waiting_on = 'SYSTEM'::waiting_on_t
WHERE waiting_on = 'SYSTEM';  -- no-op but documents intent


-- ---------------------------------------------------------------------------
-- Backfill: lifecycle_state on subscriptions
-- ---------------------------------------------------------------------------
-- Map current subscriptions.status -> lifecycle_state. The trial substages
-- (TRIAL_PREP / TRIAL_SCHEDULED / TRIAL_DONE) all map to TRIAL_PREP for
-- now because we don't yet store the Calendly event timestamp on
-- subscriptions. Once that's wired, the Calendly invitee.created webhook
-- transitions TRIAL_PREP → TRIAL_SCHEDULED, and a daily cron transitions
-- TRIAL_SCHEDULED → TRIAL_DONE when the event end time passes.
UPDATE subscriptions
SET lifecycle_state = CASE status
  WHEN 'trial'          THEN 'TRIAL_PREP'::lifecycle_state_t
  WHEN 'active'         THEN 'ACTIVE'::lifecycle_state_t
  WHEN 'past_due'       THEN 'PAST_DUE'::lifecycle_state_t
  WHEN 'pending_cancel' THEN 'PENDING_CANCEL'::lifecycle_state_t
  WHEN 'canceled'       THEN 'CANCELED'::lifecycle_state_t
  WHEN 'declined'       THEN 'CANCELED'::lifecycle_state_t
  ELSE 'TRIAL_PREP'::lifecycle_state_t
END;


-- ---------------------------------------------------------------------------
-- Indexes for Home queue queries (per spec section 9 step 6)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_waiting_on_updated
  ON messages(waiting_on, created_at DESC)
  WHERE waiting_on = 'TIM';

CREATE INDEX IF NOT EXISTS idx_curricula_waiting_on
  ON curricula(waiting_on, updated_at DESC)
  WHERE waiting_on = 'TIM';

CREATE INDEX IF NOT EXISTS idx_subscriptions_waiting_on
  ON subscriptions(waiting_on, updated_at DESC)
  WHERE waiting_on = 'TIM';

CREATE INDEX IF NOT EXISTS idx_cancellation_events_waiting_on
  ON cancellation_events(waiting_on, created_at DESC)
  WHERE waiting_on = 'TIM';
