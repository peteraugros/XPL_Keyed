-- task_dismissals
-- ----------------
-- Operator clears a task from the queue WITHOUT resolving the underlying
-- state. Distinct from completion: a completed task is something the
-- operator acted on (replied, decided, took on, refunded, etc.) and the
-- waiting_on / lifecycle_state flips naturally. A DISMISSED task is one
-- the operator decided is "not needed right now" — the source row is
-- unchanged but the task vanishes from /admin's Focused Home + expanded
-- stack.
--
-- Dismissals are revocable. The `restored_at` column lets us restore a
-- previously-dismissed task back to the queue (e.g., audit caught Tim
-- dismissed a real message; we restore so it gets a real response).
-- The partial unique index allows dismiss -> restore -> re-dismiss.
--
-- App-side filter, not view-side. The /admin page LEFT JOINs this
-- table when reading derived_tasks_view and drops any task with an
-- active dismissal. Keeps derived_tasks_view itself untouched and
-- means future view migrations don't have to thread a wrapper.

CREATE TABLE IF NOT EXISTS task_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type TEXT NOT NULL,
  source_object_id UUID NOT NULL,
  dismissed_by UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismiss_reason TEXT,
  restored_at TIMESTAMPTZ,
  restored_by UUID REFERENCES coaches(id) ON DELETE SET NULL
);

-- Only one ACTIVE dismissal per (task_type, source_object_id). Past
-- (restored) dismissals stay as audit history.
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_dismissals_one_active
  ON task_dismissals (task_type, source_object_id)
  WHERE restored_at IS NULL;

-- Coach-level lookup of "what have I dismissed recently" (for an
-- optional restore UI later).
CREATE INDEX IF NOT EXISTS idx_task_dismissals_recent
  ON task_dismissals (dismissed_by, dismissed_at DESC)
  WHERE restored_at IS NULL;

ALTER TABLE task_dismissals ENABLE ROW LEVEL SECURITY;

-- Coach can read + write their own dismissals. We use the existing
-- is_coach() helper from the initial RLS migration; no per-coach
-- scoping needed at the n=1 instance scale.
CREATE POLICY task_dismissals_coach_all
  ON task_dismissals
  FOR ALL
  USING (is_coach())
  WITH CHECK (is_coach());
