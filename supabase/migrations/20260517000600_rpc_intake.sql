-- ============================================================================
-- XPL Keyed — rpc.intake() atomic Stage A intake function
-- ============================================================================
-- SECURITY DEFINER function called by /api/intake/submit (server-side, with the
-- service-role key). Atomically creates the family graph for a new client:
--
--   families  ->  parents (linked to auth.users for the parent)
--             ->  players (linked to auth.users for the kid — synthetic email)
--                 -> subscriptions (tier='trial', status='trial')
--                 -> quest_completions (quest_key='signup')
--
-- Two auth.users rows are created in the API route ahead of time (one real
-- email for parent, one synthetic for kid). This function takes their IDs as
-- parameters and only writes to public.* tables — keeping it free of the
-- Supabase auth machinery.
--
-- Under-13 COPPA gate:
--   If p_kid_age < 13, requires a verified row in pending_intake_verifications
--   matching p_intake_id. Otherwise raises 'coppa_verification_required'.
--   On success, marks parents.email_verified_at = NOW() (the magic-link click
--   already proved control of the parent inbox).
--
-- Duplicate parent email:
--   Raises 'parent_email_already_registered'. Existing families adding a
--   second kid go through a separate add-another-kid flow, not this RPC.
--
-- Returns: jsonb with family_id / parent_id / player_id / subscription_id.
-- ============================================================================

CREATE OR REPLACE FUNCTION rpc_intake(
  p_intake_id              UUID,
  p_parent_auth_user_id    UUID,
  p_parent_first_name      TEXT,
  p_parent_email           TEXT,
  p_kid_auth_user_id       UUID,
  p_kid_first_name         TEXT,
  p_kid_age                SMALLINT,
  p_kid_fortnite_username  TEXT,
  p_kid_discord_username   TEXT,
  p_kid_current_rank       TEXT,
  p_kid_platform           TEXT,
  p_kid_hours_per_week     SMALLINT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_family_id        UUID;
  v_parent_id        UUID;
  v_player_id        UUID;
  v_subscription_id  UUID;
  v_email_lower      TEXT := LOWER(p_parent_email);
BEGIN
  IF p_kid_age < 13 THEN
    IF NOT EXISTS (
      SELECT 1 FROM pending_intake_verifications
      WHERE intake_id = p_intake_id
        AND verified_at IS NOT NULL
        AND expires_at > NOW()
        AND LOWER(parent_email) = v_email_lower
    ) THEN
      RAISE EXCEPTION 'coppa_verification_required';
    END IF;
  END IF;

  IF EXISTS (SELECT 1 FROM parents WHERE LOWER(email) = v_email_lower) THEN
    RAISE EXCEPTION 'parent_email_already_registered';
  END IF;

  INSERT INTO families DEFAULT VALUES RETURNING id INTO v_family_id;

  INSERT INTO parents (family_id, auth_user_id, email, first_name, email_verified_at)
  VALUES (
    v_family_id,
    p_parent_auth_user_id,
    p_parent_email,
    p_parent_first_name,
    CASE WHEN p_kid_age < 13 THEN NOW() ELSE NULL END
  )
  RETURNING id INTO v_parent_id;

  INSERT INTO players (
    family_id, auth_user_id, first_name, age,
    fortnite_username, discord_username, current_rank, platform, hours_per_week
  ) VALUES (
    v_family_id, p_kid_auth_user_id, p_kid_first_name, p_kid_age,
    p_kid_fortnite_username, p_kid_discord_username, p_kid_current_rank,
    p_kid_platform, p_kid_hours_per_week
  )
  RETURNING id INTO v_player_id;

  INSERT INTO subscriptions (player_id, tier, status)
  VALUES (v_player_id, 'trial', 'trial')
  RETURNING id INTO v_subscription_id;

  INSERT INTO quest_completions (player_id, quest_key)
  VALUES (v_player_id, 'signup');

  IF p_kid_age < 13 THEN
    DELETE FROM pending_intake_verifications WHERE intake_id = p_intake_id;
  END IF;

  RETURN jsonb_build_object(
    'family_id',       v_family_id,
    'parent_id',       v_parent_id,
    'player_id',       v_player_id,
    'subscription_id', v_subscription_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION rpc_intake(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT, TEXT, SMALLINT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION rpc_intake(
  UUID, UUID, TEXT, TEXT, UUID, TEXT, SMALLINT, TEXT, TEXT, TEXT, TEXT, SMALLINT
) TO service_role;
