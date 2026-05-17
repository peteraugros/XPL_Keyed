-- ============================================================================
-- XPL Keyed — Row Level Security
-- ============================================================================
-- Strategy:
--   * RLS enabled on every table; default deny for `anon`.
--   * Coaches see everything (`is_coach()` helper).
--   * Parents and players see only their own family's data
--     (`family_id_for_user()` helper).
--   * Writes that span multiple tables (intake, conversion, cancellation)
--     happen through SECURITY DEFINER server-side functions or API routes,
--     not through direct table grants.
--   * Anonymous waitlist signups go through a dedicated RPC, not through
--     a `to anon` INSERT policy (less surface area).
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies can read across tables
-- without triggering recursive RLS checks)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION is_coach()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM coaches
    WHERE auth_user_id = auth.uid() AND is_active
  );
$$;

CREATE OR REPLACE FUNCTION family_id_for_user()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT family_id FROM parents WHERE auth_user_id = auth.uid()
  UNION ALL
  SELECT family_id FROM players WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION player_id_for_user()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM players WHERE auth_user_id = auth.uid() LIMIT 1;
$$;


-- ---------------------------------------------------------------------------
-- Enable RLS on every table
-- ---------------------------------------------------------------------------
ALTER TABLE coaches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE families             ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents              ENABLE ROW LEVEL SECURITY;
ALTER TABLE players              ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lessons              ENABLE ROW LEVEL SECURITY;
ALTER TABLE curricula            ENABLE ROW LEVEL SECURITY;
ALTER TABLE curriculum_slots     ENABLE ROW LEVEL SECURITY;
ALTER TABLE cancellation_events  ENABLE ROW LEVEL SECURITY;
ALTER TABLE coach_cancels        ENABLE ROW LEVEL SECURITY;
ALTER TABLE no_shows             ENABLE ROW LEVEL SECURITY;
ALTER TABLE waitlist_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE quest_completions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE prep_responses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE vod_uploads          ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_log     ENABLE ROW LEVEL SECURITY;


-- ---------------------------------------------------------------------------
-- coaches
-- ---------------------------------------------------------------------------
-- Tim can read his own row (for his admin profile UI).
-- Parents and players see no coach rows directly (Tim is rendered via display_name
-- pulled server-side; no need to expose the coaches table to families).
CREATE POLICY coaches_self_select ON coaches
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY coaches_self_update ON coaches
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- families
-- ---------------------------------------------------------------------------
CREATE POLICY families_coach_all ON families
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY families_family_select ON families
  FOR SELECT TO authenticated
  USING (id = family_id_for_user());


-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------
CREATE POLICY parents_coach_all ON parents
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

-- Parent reads own row; player reads parent rows in their family
-- (so kid can see "Your parent (Sarah) can see your messages")
CREATE POLICY parents_family_select ON parents
  FOR SELECT TO authenticated
  USING (family_id = family_id_for_user());

-- Parent can update their own first_name (limited self-edit)
CREATE POLICY parents_self_update ON parents
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------
CREATE POLICY players_coach_all ON players
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY players_family_select ON players
  FOR SELECT TO authenticated
  USING (family_id = family_id_for_user());

-- Kid can edit their own profile (rank, hours, etc.); parent edits via server route
CREATE POLICY players_self_update ON players
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
-- Read-only to family; all writes happen server-side (cycle state, Stripe sync).
CREATE POLICY subscriptions_coach_all ON subscriptions
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY subscriptions_family_select ON subscriptions
  FOR SELECT TO authenticated
  USING (
    player_id IN (
      SELECT id FROM players WHERE family_id = family_id_for_user()
    )
  );


-- ---------------------------------------------------------------------------
-- lessons (the authored library)
-- ---------------------------------------------------------------------------
-- Coaches read + write everything.
-- Families read only published lessons that are currently assigned to their
-- player(s). Enforced by joining through curriculum_slots.
CREATE POLICY lessons_coach_all ON lessons
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY lessons_assigned_select ON lessons
  FOR SELECT TO authenticated
  USING (
    is_published = TRUE
    AND id IN (
      SELECT cs.lesson_id
      FROM curriculum_slots cs
      JOIN curricula c ON c.id = cs.curriculum_id
      JOIN players p ON p.id = c.player_id
      WHERE p.family_id = family_id_for_user()
        AND cs.lesson_id IS NOT NULL
    )
  );


-- ---------------------------------------------------------------------------
-- curricula
-- ---------------------------------------------------------------------------
CREATE POLICY curricula_coach_all ON curricula
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY curricula_family_select ON curricula
  FOR SELECT TO authenticated
  USING (
    player_id IN (
      SELECT id FROM players WHERE family_id = family_id_for_user()
    )
  );


-- ---------------------------------------------------------------------------
-- curriculum_slots
-- ---------------------------------------------------------------------------
CREATE POLICY curriculum_slots_coach_all ON curriculum_slots
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY curriculum_slots_family_select ON curriculum_slots
  FOR SELECT TO authenticated
  USING (
    curriculum_id IN (
      SELECT c.id FROM curricula c
      JOIN players p ON p.id = c.player_id
      WHERE p.family_id = family_id_for_user()
    )
  );


-- ---------------------------------------------------------------------------
-- cancellation_events
-- ---------------------------------------------------------------------------
-- Read-only to family (audit trail for "your cancels"); coaches see all.
-- Writes server-side only via cancel-flow function.
CREATE POLICY cancellation_events_coach_all ON cancellation_events
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY cancellation_events_family_select ON cancellation_events
  FOR SELECT TO authenticated
  USING (
    subscription_id IN (
      SELECT s.id FROM subscriptions s
      JOIN players p ON p.id = s.player_id
      WHERE p.family_id = family_id_for_user()
    )
  );


-- ---------------------------------------------------------------------------
-- coach_cancels
-- ---------------------------------------------------------------------------
-- Internal — coaches only. Families see the consequence (lesson cancelled +
-- email with reason) via curriculum_slots + notification, not this table.
CREATE POLICY coach_cancels_coach_all ON coach_cancels
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());


-- ---------------------------------------------------------------------------
-- no_shows
-- ---------------------------------------------------------------------------
CREATE POLICY no_shows_coach_all ON no_shows
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY no_shows_family_select ON no_shows
  FOR SELECT TO authenticated
  USING (
    subscription_id IN (
      SELECT s.id FROM subscriptions s
      JOIN players p ON p.id = s.player_id
      WHERE p.family_id = family_id_for_user()
    )
  );


-- ---------------------------------------------------------------------------
-- waitlist_entries
-- ---------------------------------------------------------------------------
-- Anonymous signup goes through `rpc.waitlist_signup()` (SECURITY DEFINER),
-- not direct INSERT. No `anon` INSERT policy here.
-- Existing families can see their own entries (e.g. add-2nd-kid waitlist).
CREATE POLICY waitlist_coach_all ON waitlist_entries
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY waitlist_family_select ON waitlist_entries
  FOR SELECT TO authenticated
  USING (family_id = family_id_for_user());


-- ---------------------------------------------------------------------------
-- quest_completions, prep_responses, vod_uploads (kid-owned trial-state data)
-- ---------------------------------------------------------------------------
CREATE POLICY quest_completions_coach_all ON quest_completions
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY quest_completions_family_select ON quest_completions
  FOR SELECT TO authenticated
  USING (
    player_id IN (SELECT id FROM players WHERE family_id = family_id_for_user())
  );

CREATE POLICY quest_completions_kid_insert ON quest_completions
  FOR INSERT TO authenticated
  WITH CHECK (player_id = player_id_for_user());


CREATE POLICY prep_responses_coach_all ON prep_responses
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY prep_responses_family_select ON prep_responses
  FOR SELECT TO authenticated
  USING (
    player_id IN (SELECT id FROM players WHERE family_id = family_id_for_user())
  );

CREATE POLICY prep_responses_kid_insert ON prep_responses
  FOR INSERT TO authenticated
  WITH CHECK (player_id = player_id_for_user());


CREATE POLICY vod_uploads_coach_all ON vod_uploads
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY vod_uploads_family_select ON vod_uploads
  FOR SELECT TO authenticated
  USING (
    player_id IN (SELECT id FROM players WHERE family_id = family_id_for_user())
  );

CREATE POLICY vod_uploads_kid_insert ON vod_uploads
  FOR INSERT TO authenticated
  WITH CHECK (player_id = player_id_for_user());


-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------
-- Kid: read + insert on own thread.
-- Parent: read-only on their kids' threads (per trust model).
-- Coach: read + insert everywhere.
CREATE POLICY messages_coach_all ON messages
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());

CREATE POLICY messages_kid_select ON messages
  FOR SELECT TO authenticated
  USING (player_id = player_id_for_user());

CREATE POLICY messages_parent_select ON messages
  FOR SELECT TO authenticated
  USING (
    player_id IN (SELECT id FROM players WHERE family_id = family_id_for_user())
  );

CREATE POLICY messages_kid_insert ON messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_role = 'player'
    AND player_id = player_id_for_user()
  );


-- ---------------------------------------------------------------------------
-- notification_log
-- ---------------------------------------------------------------------------
-- Internal infra. Coaches see everything for debugging. Families never see this
-- table directly; they see the user-visible side effect (email, push, etc.).
CREATE POLICY notification_log_coach_all ON notification_log
  FOR ALL TO authenticated
  USING (is_coach()) WITH CHECK (is_coach());
