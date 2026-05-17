-- ============================================================================
-- XPL Keyed — Initial schema
-- ============================================================================
-- Captures all design decisions locked in CLAUDE.md.
--
-- Conventions:
--   * UUID primary keys (gen_random_uuid)
--   * snake_case identifiers
--   * CHECK constraints for status fields, not Postgres ENUM types
--     (easier to extend later without ALTER TYPE migrations)
--   * timestamptz everywhere
--   * Audit columns: created_at default NOW(), updated_at trigger-maintained
--
-- Auth coupling:
--   * `parents.auth_user_id` and `players.auth_user_id` FK to auth.users(id)
--   * Kids without their own email get a synthetic auth email; magic links
--     are intercepted at delivery and routed to the parent's email — handled
--     in app code, not in this migration.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pg_cron;         -- scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_trgm;         -- fuzzy admin search


-- ---------------------------------------------------------------------------
-- Generic updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- coaches
-- ---------------------------------------------------------------------------
-- Tim is the only coach for MVP. Schema supports multi-coach for the eventual
-- guest-lecturer build.
CREATE TABLE coaches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id        UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name        TEXT NOT NULL,
  stage_name          TEXT,
  discord_user_id     TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT TRUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_coaches_updated_at BEFORE UPDATE ON coaches
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- families
-- ---------------------------------------------------------------------------
CREATE TABLE families (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_customer_id  TEXT UNIQUE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_families_updated_at BEFORE UPDATE ON families
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- parents
-- ---------------------------------------------------------------------------
CREATE TABLE parents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  auth_user_id        UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email               TEXT NOT NULL,
  first_name          TEXT NOT NULL,
  email_verified_at   TIMESTAMPTZ,                -- COPPA gate for under-13 players
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_parents_family_id ON parents(family_id);
CREATE INDEX idx_parents_email_lower ON parents(LOWER(email));
CREATE TRIGGER trg_parents_updated_at BEFORE UPDATE ON parents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- players (kids)
-- ---------------------------------------------------------------------------
CREATE TABLE players (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id           UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  auth_user_id        UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  first_name          TEXT NOT NULL,
  age                 SMALLINT NOT NULL CHECK (age BETWEEN 8 AND 18),
  fortnite_username   TEXT,
  discord_username    TEXT,
  current_rank        TEXT,
  platform            TEXT,
  hours_per_week      SMALLINT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_players_family_id ON players(family_id);
CREATE TRIGGER trg_players_updated_at BEFORE UPDATE ON players
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- subscriptions (one per player)
-- ---------------------------------------------------------------------------
CREATE TABLE subscriptions (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id                       UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  stripe_subscription_id          TEXT UNIQUE,
  tier                            TEXT NOT NULL CHECK (tier IN ('trial','monthly','single_lesson')),
  status                          TEXT NOT NULL CHECK (status IN (
                                    'trial',          -- free call booked, not yet converted
                                    'active',         -- paying
                                    'past_due',       -- dunning Day 0+
                                    'pending_cancel', -- cancel #3 awaiting confirmation
                                    'canceled',
                                    'declined'        -- Tim declined post-trial
                                  )) DEFAULT 'trial',
  -- Cycle state (per $56 / 4-lesson rhythm)
  cycle_started_at                TIMESTAMPTZ,
  cycle_lessons_delivered         SMALLINT NOT NULL DEFAULT 0 CHECK (cycle_lessons_delivered BETWEEN 0 AND 4),
  cycle_cancels_used              SMALLINT NOT NULL DEFAULT 0 CHECK (cycle_cancels_used BETWEEN 0 AND 3),
  last_cancel_at                  TIMESTAMPTZ,
  -- Dunning state
  past_due_started_at             TIMESTAMPTZ,
  notified_at_day7_dunning        TIMESTAMPTZ,
  -- Pending-cancel state (3rd cancel awaiting confirm)
  pending_cancel_started_at       TIMESTAMPTZ,
  pending_cancel_reminder_3day_at TIMESTAMPTZ,
  pending_cancel_reminder_6day_at TIMESTAMPTZ,
  pending_cancel_auto_confirm_at  TIMESTAMPTZ,       -- T+7d; auto-confirm if no parent action
  notified_at_third_cancel        TIMESTAMPTZ,
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE INDEX idx_subscriptions_past_due
  ON subscriptions(past_due_started_at) WHERE status = 'past_due';
CREATE TRIGGER trg_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- lessons (authored library)
-- ---------------------------------------------------------------------------
CREATE TABLE lessons (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id                   UUID NOT NULL REFERENCES coaches(id),
  title                       TEXT NOT NULL,                  -- internal
  fortnite_label              TEXT NOT NULL,                  -- kid-facing
  parent_label                TEXT NOT NULL,                  -- parent-facing skill
  parent_skill_description    TEXT NOT NULL,                  -- email blurb
  topic                       TEXT NOT NULL CHECK (topic IN (
                                'building','editing','aim','game_sense','mental','tournament_prep'
                              )),
  difficulty_level            TEXT NOT NULL CHECK (difficulty_level IN (
                                'beginner','intermediate','advanced','unreal'
                              )),
  duration_minutes            SMALLINT NOT NULL CHECK (duration_minutes > 0),
  slides                      JSONB NOT NULL,
                              -- [{ position, image_url, audio_url, speaker_notes }, ...]
  parent_talking_points       JSONB NOT NULL,
                              -- [{ category, text }, ...]
                              -- categories: informed_observer, co_conspirator,
                              -- cultural_literacy, good_question, strategic_note
  is_published                BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_lessons_topic ON lessons(topic);
CREATE INDEX idx_lessons_published ON lessons(is_published) WHERE is_published = TRUE;
CREATE TRIGGER trg_lessons_updated_at BEFORE UPDATE ON lessons
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- curricula (4-week plans)
-- ---------------------------------------------------------------------------
CREATE TABLE curricula (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id               UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_by              UUID NOT NULL REFERENCES coaches(id),
  status                  TEXT NOT NULL CHECK (status IN (
                            'pending_approval','active','completed','superseded'
                          )) DEFAULT 'pending_approval',
  approved_at             TIMESTAMPTZ,
  approval_token          TEXT UNIQUE,
  personalization_note    TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_curricula_player ON curricula(player_id);
CREATE UNIQUE INDEX uniq_active_curriculum_per_player
  ON curricula(player_id) WHERE status = 'active';
CREATE TRIGGER trg_curricula_updated_at BEFORE UPDATE ON curricula
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- curriculum_slots (4 per curriculum)
-- ---------------------------------------------------------------------------
CREATE TABLE curriculum_slots (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id               UUID NOT NULL REFERENCES curricula(id) ON DELETE CASCADE,
  week_number                 SMALLINT NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  is_vod_review               BOOLEAN NOT NULL DEFAULT FALSE,
  lesson_id                   UUID REFERENCES lessons(id),
  vod_url                     TEXT,
  vod_talking_points          JSONB,
  delivered_at                TIMESTAMPTZ,
  live_call_event_id          TEXT,                          -- Calendly event id
  live_call_at                TIMESTAMPTZ,
  live_call_completed_at      TIMESTAMPTZ,
  no_show_at                  TIMESTAMPTZ,
  notified_at_20min           TIMESTAMPTZ,                   -- Discord 20-min idempotency
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (curriculum_id, week_number),
  CONSTRAINT lesson_xor_vod CHECK (
    (is_vod_review = FALSE AND lesson_id IS NOT NULL AND vod_url IS NULL) OR
    (is_vod_review = TRUE  AND lesson_id IS NULL     AND vod_url IS NOT NULL)
  )
);
CREATE INDEX idx_curriculum_slots_upcoming_calls
  ON curriculum_slots(live_call_at)
  WHERE live_call_at IS NOT NULL AND live_call_completed_at IS NULL;
CREATE TRIGGER trg_curriculum_slots_updated_at BEFORE UPDATE ON curriculum_slots
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- ---------------------------------------------------------------------------
-- cancellation_events (parent-initiated)
-- ---------------------------------------------------------------------------
-- classification = 'credit' (>24hr) increments cycle_cancels_used.
-- classification = 'forfeit' (<24hr) does NOT touch the cap.
CREATE TABLE cancellation_events (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id             UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  curriculum_slot_id          UUID REFERENCES curriculum_slots(id),
  initiated_via               TEXT NOT NULL CHECK (initiated_via IN ('portal','calendly_link')),
  hours_until_call            NUMERIC,
  classification              TEXT NOT NULL CHECK (classification IN ('credit','forfeit')),
  cycle_cancels_used_after    SMALLINT,
  triggered_pending_cancel    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cancellation_events_subscription
  ON cancellation_events(subscription_id);


-- ---------------------------------------------------------------------------
-- coach_cancels (Tim's bulk + individual)
-- ---------------------------------------------------------------------------
-- Never touch the family's cycle_cancels_used. Tracked separately for audit.
CREATE TABLE coach_cancels (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id                UUID NOT NULL REFERENCES coaches(id),
  curriculum_slot_id      UUID NOT NULL REFERENCES curriculum_slots(id),
  scope                   TEXT NOT NULL CHECK (scope IN ('individual','bulk_day','bulk_week')),
  reason                  TEXT NOT NULL,
  bypassed_24hr_gate      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_coach_cancels_coach ON coach_cancels(coach_id);


-- ---------------------------------------------------------------------------
-- no_shows
-- ---------------------------------------------------------------------------
-- Same mechanics as <24hr cancel (cycle advances, no cap impact).
-- Tracked separately so Tim sees repeat patterns. Can be manually converted
-- to a credit by Tim if legit reason emerges.
CREATE TABLE no_shows (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_slot_id          UUID NOT NULL UNIQUE REFERENCES curriculum_slots(id),
  subscription_id             UUID NOT NULL REFERENCES subscriptions(id),
  converted_to_credit_at      TIMESTAMPTZ,
  conversion_reason           TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_no_shows_subscription ON no_shows(subscription_id);


-- ---------------------------------------------------------------------------
-- waitlist_entries
-- ---------------------------------------------------------------------------
-- One row per kid (not per family). 2-kid family adding both at cap = 2 rows.
CREATE TABLE waitlist_entries (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id                   UUID REFERENCES families(id) ON DELETE SET NULL,
                              -- non-null when an existing family adds a 2nd kid
  parent_email                TEXT NOT NULL,
  parent_first_name           TEXT,
  kid_first_name              TEXT NOT NULL,
  kid_age                     SMALLINT NOT NULL CHECK (kid_age BETWEEN 8 AND 18),
  status                      TEXT NOT NULL CHECK (status IN (
                                'waiting','offered','claimed','expired','removed','converted'
                              )) DEFAULT 'waiting',
  offered_at                  TIMESTAMPTZ,
  offer_token                 TEXT UNIQUE,
  offer_expires_at            TIMESTAMPTZ,
  reminder_24hr_sent_at       TIMESTAMPTZ,
  expired_at                  TIMESTAMPTZ,
  claimed_at                  TIMESTAMPTZ,
  removed_at                  TIMESTAMPTZ,
  removed_reason              TEXT,
  last_freshness_check_at     TIMESTAMPTZ,                   -- 60-day "still interested?"
  freshness_response          TEXT CHECK (freshness_response IN ('yes','stop')),
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_waitlist_status_created ON waitlist_entries(status, created_at);
CREATE INDEX idx_waitlist_offer_expires
  ON waitlist_entries(offer_expires_at) WHERE status = 'offered';


-- ---------------------------------------------------------------------------
-- quest_completions (kid's gamified prep tasks)
-- ---------------------------------------------------------------------------
CREATE TABLE quest_completions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  quest_key       TEXT NOT NULL CHECK (quest_key IN (
                    'signup','drop_vod','answer_questions','join_discord'
                  )),
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  xp_awarded      SMALLINT NOT NULL DEFAULT 25,
  UNIQUE (player_id, quest_key)
);
CREATE INDEX idx_quest_completions_player ON quest_completions(player_id);


-- ---------------------------------------------------------------------------
-- prep_responses (Stage B Q1/Q2/Q3)
-- ---------------------------------------------------------------------------
CREATE TABLE prep_responses (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id           UUID NOT NULL UNIQUE REFERENCES players(id) ON DELETE CASCADE,
  q1_choice           TEXT NOT NULL,
  q1_other_text       TEXT,
  q2_choice           TEXT NOT NULL,
  q2_other_text       TEXT,
  q3_reflection       TEXT NOT NULL,            -- "even one word is fine"
  submitted_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ---------------------------------------------------------------------------
-- vod_uploads
-- ---------------------------------------------------------------------------
CREATE TABLE vod_uploads (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id                   UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  source                      TEXT NOT NULL CHECK (source IN ('paste_url','file_upload')),
  url                         TEXT NOT NULL,
  is_initial_trial_vod        BOOLEAN NOT NULL DEFAULT FALSE,
                              -- the Stage B "wish had gone better" clip
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vod_uploads_player ON vod_uploads(player_id);


-- ---------------------------------------------------------------------------
-- messages (kid <-> Tim; parent has read-only visibility)
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id               UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  sender_role             TEXT NOT NULL CHECK (sender_role IN ('coach','player','bot')),
  sender_id               UUID,
  body                    TEXT NOT NULL,
  read_by_recipient_at    TIMESTAMPTZ,
  read_by_parent_at       TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_messages_player_created ON messages(player_id, created_at DESC);


-- ---------------------------------------------------------------------------
-- notification_log (Discord bot + web push + email audit / idempotency)
-- ---------------------------------------------------------------------------
CREATE TABLE notification_log (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel                     TEXT NOT NULL CHECK (channel IN (
                                'discord_dm','discord_channel','web_push','email'
                              )),
  trigger                     TEXT NOT NULL,
                              -- '20min_reminder','day7_dunning','cancel_third',
                              -- 'offer_email','offer_24hr_reminder','offer_expiry',
                              -- 'approval_email','dunning_day0','dunning_day3', etc.
  recipient_type              TEXT NOT NULL CHECK (recipient_type IN ('coach','parent','player')),
  recipient_id                UUID,
  related_entity_type         TEXT,
                              -- 'curriculum_slot','subscription','cancellation_event',
                              -- 'waitlist_entry','curriculum','no_show', etc.
  related_entity_id           UUID,
  status                      TEXT NOT NULL CHECK (status IN (
                                'queued','sent','failed','skipped'
                              )) DEFAULT 'queued',
  sent_at                     TIMESTAMPTZ,
  error_message               TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notification_log_trigger_entity
  ON notification_log(trigger, related_entity_id);
CREATE INDEX idx_notification_log_status_created
  ON notification_log(status, created_at) WHERE status IN ('queued','failed');
