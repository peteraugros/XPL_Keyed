-- Phase 1 of the content-to-coaching simplification (2026-09-19).
--
-- The product is no longer "Tim authors a lesson and we deliver it." It is:
--
--     call  ->  coach_note (advice)  ->  training_routine  ->  next call
--
-- This migration is ADDITIVE ONLY. Nothing is dropped, nothing is renamed,
-- no existing column changes meaning, and no live code reads these columns
-- yet. It is safe to apply ahead of the deploy.
--
-- Three groups of columns, and the third is the one that is easy to
-- misread as bookkeeping when it is actually the billing guarantee.
--
-- ---------------------------------------------------------------------------
-- 1. training_routine  — what the player does between calls
-- ---------------------------------------------------------------------------
-- Deliberately a TEXT column on the slot, NOT a new table. The routine
-- belongs to one coaching session the same way coach_note does; it has no
-- independent lifecycle, is never shared between players, and is never
-- queried across rows. It mirrors the existing coach_note / coach_note_at
-- pair exactly so there is one shape to learn, not two.
--
-- If a routine ever needs structure (per-drill checkboxes, completion
-- tracking, reuse across players) that is the signal to normalise it. Until
-- then a second table would be the lesson library growing back under a new
-- name.

ALTER TABLE curriculum_slots
  ADD COLUMN IF NOT EXISTS training_routine     TEXT,
  ADD COLUMN IF NOT EXISTS training_routine_at  TIMESTAMPTZ;


-- ---------------------------------------------------------------------------
-- 2. parent_summary  — Hard rule #4 survives the lesson library
-- ---------------------------------------------------------------------------
-- Hard rule #4 requires that parent-facing content lead with the real-world
-- skill, with any Fortnite term in italicised parens. Until now the only
-- storage for that translation was lessons.parent_label +
-- lessons.parent_skill_description, which the Sunday email read. Those go
-- away with the lesson library, so the obligation would have gone with them.
--
-- coach_note and training_routine are written for the PLAYER and use the
-- game's vocabulary freely. parent_summary is the parent-legible line. One
-- column, written in the same submission, so the rule stays mechanically
-- satisfiable rather than depending on how Tim happens to word a note.

ALTER TABLE curriculum_slots
  ADD COLUMN IF NOT EXISTS parent_summary     TEXT,
  ADD COLUMN IF NOT EXISTS parent_summary_at  TIMESTAMPTZ;


-- ---------------------------------------------------------------------------
-- 3. cycle_counted_at  — exactly-once billing advance
-- ---------------------------------------------------------------------------
-- THIS IS THE LOAD-BEARING ONE. $56 buys 4 sessions, and
-- cron-auto-renew-detection fires the next charge on
-- subscriptions.cycle_lessons_delivered = 4.
--
-- Today that counter has five writers, and two of them are the content
-- delivery path (cron-sunday-lesson-delivery, deliver-week-one) which this
-- project removes. Afterwards a COMPLETED CALL is the only thing that
-- advances the cycle, which makes the increment in mark-outcome the single
-- point of failure for revenue.
--
-- It was not safe enough to carry that weight:
--   * the increment's error was discarded (`await ...update()`, no check),
--     so a failed write marked the call done and silently did not bill;
--   * it was not idempotent, so a retry could advance the cycle twice.
--
-- Stamping the slot when its session has been counted makes the advance
-- exactly-once and repairable: the counter can be re-advanced after a
-- failure without risking a double count, because the marker (not the
-- outcome fields) is what says whether this session was already counted.
--
-- Same shape as the idempotency markers already used throughout this
-- schema (notified_at_20min, push_outcome_pending_sent_at,
-- notified_at_dunning_day3, reminder_24hr_sent_at).
--
-- NOT backfilled. Existing slots are left NULL on purpose: prod holds 0
-- curriculum_slots, so there is no history to reconcile, and a blanket
-- backfill would assert something about sessions nobody delivered.

ALTER TABLE curriculum_slots
  ADD COLUMN IF NOT EXISTS cycle_counted_at TIMESTAMPTZ;

-- Partial index: the only query is "has this slot been counted yet", always
-- against a single slot id, so this exists to keep the guard cheap rather
-- than to serve a scan.
CREATE INDEX IF NOT EXISTS idx_curriculum_slots_uncounted
  ON curriculum_slots (id)
  WHERE cycle_counted_at IS NULL;
