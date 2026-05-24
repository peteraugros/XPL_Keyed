-- Web push subscription storage + idempotency column for the call-outcome push.
--
-- push_subscriptions stores PushSubscription objects (endpoint + VAPID keys)
-- per coach browser/device. One coach can have multiple subscriptions (phone,
-- laptop, etc). Expired subscriptions (410 from the push gateway) are pruned
-- automatically by sendPushToCoach().
--
-- push_outcome_pending_sent_at on curriculum_slots prevents the
-- cron-call-outcome-push function from sending the same "how did the call go?"
-- push more than once per slot.

CREATE TABLE push_subscriptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id      UUID NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL,
  p256dh        TEXT NOT NULL,
  auth          TEXT NOT NULL,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coach_id, endpoint)
);

CREATE TRIGGER trg_push_subscriptions_updated_at
  BEFORE UPDATE ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Coach can read/write their own subscriptions only.
CREATE POLICY "push_subscriptions_coach_all"
  ON push_subscriptions FOR ALL TO authenticated
  USING  (coach_id IN (SELECT id FROM coaches WHERE auth_user_id = auth.uid()))
  WITH CHECK (coach_id IN (SELECT id FROM coaches WHERE auth_user_id = auth.uid()));

-- Idempotency: one "how did the call go?" push per slot.
ALTER TABLE curriculum_slots
  ADD COLUMN IF NOT EXISTS push_outcome_pending_sent_at TIMESTAMPTZ;
