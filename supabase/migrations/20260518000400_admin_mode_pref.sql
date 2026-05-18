-- ============================================================================
-- XPL Keyed — admin_mode per-coach preference
-- ============================================================================
-- Per Coach Dashboard Spec/CEO/admin-modes.md section 3: the chosen mode
-- (Focused or Command) is per-user and persistent. Stored on the coaches
-- row so it follows the operator across sessions + devices.
--
-- Default is 'focused' for new coaches per spec section 6: "Initial
-- default for new users: Focused mode. Operators self-select out of it
-- if they want denser."
-- ============================================================================

ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS admin_mode TEXT NOT NULL DEFAULT 'focused'
  CHECK (admin_mode IN ('focused', 'command'));
