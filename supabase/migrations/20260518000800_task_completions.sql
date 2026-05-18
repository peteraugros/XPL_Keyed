-- ============================================================================
-- XPL Keyed — task_completions audit log + waiting_on->non-TIM triggers
-- ============================================================================
-- Captures every time a task leaves Tim's queue (waiting_on transitions
-- from 'TIM' to anything else). Used to power:
--   * The "✦ X done today" streak counter on Focused Home
--   * Future Tim-today / Tim-this-week summaries on Dad's admin
--   * Long-term pattern analysis (Tim's average daily throughput, etc.)
--
-- The row is written by an AFTER UPDATE trigger on every table that has
-- a waiting_on column. The trigger captures the source table + row id
-- so we can join back if needed. coach_id defaults to the single active
-- coach (Tim) for MVP; multi-coach attribution comes later via a
-- per-session var or auth.uid() lookup.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS task_completions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id      UUID REFERENCES coaches(id) ON DELETE SET NULL,
  source_table  TEXT NOT NULL,
  source_id     UUID NOT NULL,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_completions_coach_completed
  ON task_completions(coach_id, completed_at DESC);

CREATE INDEX IF NOT EXISTS idx_task_completions_source
  ON task_completions(source_table, source_id);


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE task_completions ENABLE ROW LEVEL SECURITY;

-- Coach can read all rows (Tim sees his streak; Dad sees Tim's activity).
CREATE POLICY task_completions_coach_select ON task_completions
  FOR SELECT TO authenticated
  USING (is_coach());

-- Writes happen via the trigger as the postgres role (bypasses RLS), so
-- no INSERT policy is needed. Defensive: an explicit deny for client
-- writes isn't required because RLS is deny-by-default with no policy.


-- ---------------------------------------------------------------------------
-- Trigger function
-- ---------------------------------------------------------------------------
-- Fires AFTER UPDATE on any waiting_on-bearing table. When the row's
-- waiting_on transitions from 'TIM' to anything else, log a row.
-- coach_id defaults to the oldest active coach (Tim) — fine for
-- single-coach MVP.
CREATE OR REPLACE FUNCTION log_task_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.waiting_on IS NOT DISTINCT FROM 'TIM'::waiting_on_t
     AND NEW.waiting_on IS DISTINCT FROM 'TIM'::waiting_on_t
  THEN
    INSERT INTO task_completions (coach_id, source_table, source_id)
    SELECT id, TG_TABLE_NAME, NEW.id
    FROM coaches
    WHERE is_active
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- Attach triggers to each waiting_on-bearing table
-- ---------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_messages_task_completion ON messages;
CREATE TRIGGER trg_messages_task_completion
  AFTER UPDATE OF waiting_on ON messages
  FOR EACH ROW EXECUTE FUNCTION log_task_completion();

DROP TRIGGER IF EXISTS trg_subscriptions_task_completion ON subscriptions;
CREATE TRIGGER trg_subscriptions_task_completion
  AFTER UPDATE OF waiting_on ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION log_task_completion();

DROP TRIGGER IF EXISTS trg_curricula_task_completion ON curricula;
CREATE TRIGGER trg_curricula_task_completion
  AFTER UPDATE OF waiting_on ON curricula
  FOR EACH ROW EXECUTE FUNCTION log_task_completion();

DROP TRIGGER IF EXISTS trg_cancellation_events_task_completion ON cancellation_events;
CREATE TRIGGER trg_cancellation_events_task_completion
  AFTER UPDATE OF waiting_on ON cancellation_events
  FOR EACH ROW EXECUTE FUNCTION log_task_completion();


-- Note: we also want completions written when a message is INSERTed with
-- waiting_on='KID' / 'PARENT' / etc. (i.e., Tim sent a reply). The trigger
-- above only fires on UPDATE. Adding a parallel INSERT trigger would
-- double-count if we ever UPDATE inserted rows, so we instead rely on
-- application-side writes for new messages — the /api/admin/message
-- endpoint inserts a NEW message row with waiting_on='KID', which is
-- semantically a completion for Tim. We log that via a one-off INSERT
-- into task_completions in the route handler, OR via a smarter trigger
-- below that watches NEW.waiting_on != 'TIM' on INSERT.

CREATE OR REPLACE FUNCTION log_task_completion_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only count message INSERTs from the coach (sender_role='coach' for
  -- messages, or a status that implies coach action for other tables).
  -- For messages: a new coach-sent message means Tim just replied — that
  -- IS a completion of his "reply" task.
  IF TG_TABLE_NAME = 'messages' AND NEW.sender_role = 'coach' THEN
    INSERT INTO task_completions (coach_id, source_table, source_id)
    SELECT id, 'messages', NEW.id
    FROM coaches
    WHERE is_active
    ORDER BY created_at ASC
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_insert_completion ON messages;
CREATE TRIGGER trg_messages_insert_completion
  AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION log_task_completion_on_insert();
