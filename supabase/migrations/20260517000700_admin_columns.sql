-- ============================================================================
-- XPL Keyed — Admin support columns
-- ============================================================================
-- Two columns the admin surface (/admin) and coach login flow both need.
--
--  1. coaches.email — magic-link sign in resolves a coach by email. Mirror
--     of the parents/players auth_user_id linkage: Tim's coach row lives
--     here; auth_user_id stays NULL until first sign-in, at which point
--     the /admin page auto-links it (coaches.email = auth.users.email AND
--     coaches.auth_user_id IS NULL → write).
--
--  2. players.discord_channel_url — Tim manually creates a per-client
--     private channel in his coaching server (Hard rule #3) and pastes
--     the invite URL into admin. Stored on the player row so the parent
--     and player views can surface it post-conversion. RLS already
--     covered by the existing players_coach_all (write) and
--     players_family_select (read) policies.
--
-- Idempotent: safe to run twice against the same database. The ADD COLUMN
-- and CREATE INDEX use IF NOT EXISTS; the NOT NULL flip is guarded by a
-- pre-check.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- coaches.email
-- ---------------------------------------------------------------------------
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS email TEXT;

-- Backfill: Tim is the only seeded coach. Use the canonical from-address.
-- Peter: override to your own gmail for local testing (so magic links land
-- somewhere you actually read), then revert before production.
UPDATE coaches
SET email = 'tim@xplkeyed.com'
WHERE email IS NULL AND display_name = 'Tim';

-- Generic fallback for any other coach rows that might exist in non-dev
-- environments (none today, defensive).
UPDATE coaches
SET email = LOWER(REPLACE(display_name, ' ', '.')) || '@xplkeyed.com'
WHERE email IS NULL;

-- Flip to NOT NULL only if every row now has an email (defensive against
-- re-runs and empty tables).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM coaches WHERE email IS NULL) THEN
    ALTER TABLE coaches ALTER COLUMN email SET NOT NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_coaches_email_lower ON coaches(LOWER(email));


-- ---------------------------------------------------------------------------
-- players.discord_channel_url
-- ---------------------------------------------------------------------------
ALTER TABLE players ADD COLUMN IF NOT EXISTS discord_channel_url TEXT;
