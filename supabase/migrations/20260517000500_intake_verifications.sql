-- ============================================================================
-- XPL Keyed — Pending intake verifications (COPPA gate for under-13 kids)
-- ============================================================================
-- During Stage A intake, if the kid's age is <13 the form pauses at the
-- L1 -> L2 boundary and asks the parent to confirm via a magic-link email
-- before any further data is entered. Token state lives here.
--
-- Flow:
--   1. Kid enters age <13 at Level 1.
--   2. Inline parent gate collects parent_first_name + parent_email.
--   3. Client calls POST /api/intake/request-verification with a
--      client-generated intake_id (UUID) + the parent fields.
--   4. Server creates a row here (token = 32-byte hex), emails parent the
--      verification link.
--   5. Parent clicks /intake/verify?t=<token> -> server sets verified_at,
--      redirects to /intake?verified=<intake_id>.
--   6. Intake page reads ?verified=<intake_id>, matches against localStorage,
--      unlocks Level 2.
--   7. At final submit, rpc.intake() validates the pending row is verified
--      before creating the family/parents/players records.
--
-- RLS is enabled with no policies. Access is exclusively through
-- SECURITY DEFINER routes (the API handlers run with the service-role key).
-- ============================================================================

CREATE TABLE pending_intake_verifications (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id           UUID NOT NULL UNIQUE,
  parent_first_name   TEXT NOT NULL,
  parent_email        TEXT NOT NULL,
  token               TEXT NOT NULL UNIQUE,
  verified_at         TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_pending_intake_verifications_email_lower
  ON pending_intake_verifications(LOWER(parent_email));

CREATE INDEX idx_pending_intake_verifications_expires
  ON pending_intake_verifications(expires_at)
  WHERE verified_at IS NULL;

ALTER TABLE pending_intake_verifications ENABLE ROW LEVEL SECURITY;
-- No policies: deny-all for anon and authenticated. Service-role bypasses RLS.
