-- ============================================================================
-- XPL Keyed — Development seed
-- ============================================================================
-- Inserts the bare minimum for a working dev environment: Tim's coach row.
-- All other entities (families, players, lessons, etc.) are created through
-- normal application flows; we don't fixture them here.
--
-- This migration is idempotent — safe to run multiple times in dev.
-- DO NOT run this migration in production unless you intend Tim's coach row
-- to be created with these exact values.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Coach: XPL Keyed (Tim)
-- ---------------------------------------------------------------------------
-- auth_user_id is left NULL initially. Tim signs up through the app once,
-- then a separate post-deploy step links his auth.users row:
--   UPDATE coaches SET auth_user_id = '<tim-auth-uid>' WHERE display_name = 'Tim';
INSERT INTO coaches (display_name, stage_name, is_active)
VALUES ('Tim', 'XPL Keyed', TRUE)
ON CONFLICT DO NOTHING;
