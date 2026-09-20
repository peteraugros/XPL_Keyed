-- VOD review as a delivery mode for a session the family already owns.
--
-- NAMING, read this before adding anything near it. Three different things in
-- this codebase have carried the letters VOD and they do not mean the same:
--
--   curriculum_slots.is_vod_review   DROPPED 2026-09-20 (Phase 5). Meant "Tim
--                                    authored a VOD review as CONTENT". Only an
--                                    admin route ever set it; no family could.
--   vod_uploads                      SURVIVES. The free trial VOD a PROSPECT
--                                    submits before they are a client
--                                    (is_initial_trial_vod).
--   curriculum_slots.delivery_mode   THIS. How a session that is already paid
--                                    for is delivered. A mode, not content.
--
-- Do not resurrect the name is_vod_review for this. A reader who greps it would
-- find a dropped column, a live table and a new flag meaning three things, and
-- would reasonably conclude Phase 5 was reverted.
--
-- Why a MODE and not a new kind of session: the swap changes only how the
-- session happened. mark-outcome already produces the three artifacts a VOD
-- review produces (coach_note, training_routine, parent_summary), so delivery,
-- counting, the cycle, renewal and the parent view are all untouched.

-- Additive and safe to apply ahead of the code: nothing reads these yet, and
-- delivery_mode defaults to the behaviour every existing row already has.

ALTER TABLE public.curriculum_slots
  ADD COLUMN delivery_mode TEXT NOT NULL DEFAULT 'live_call',
  ADD COLUMN vod_review_by TEXT,
  ADD COLUMN vod_review_at TIMESTAMPTZ,
  ADD COLUMN vod_upload_id UUID REFERENCES public.vod_uploads(id) ON DELETE SET NULL;

ALTER TABLE public.curriculum_slots
  ADD CONSTRAINT curriculum_slots_delivery_mode_check
  CHECK (delivery_mode IN ('live_call', 'vod_review'));

-- Who asked for it is recorded exactly when there is something to record. The
-- student's one swap per cycle and Tim deciding a session is better spent on a
-- VOD are different acts, and after the fact they are indistinguishable unless
-- this is written down at the moment it happens.
ALTER TABLE public.curriculum_slots
  ADD CONSTRAINT curriculum_slots_vod_review_by_check
  CHECK (vod_review_by IS NULL OR vod_review_by IN ('student', 'coach'));

ALTER TABLE public.curriculum_slots
  ADD CONSTRAINT curriculum_slots_vod_review_pairing
  CHECK ((delivery_mode = 'vod_review') = (vod_review_by IS NOT NULL));

COMMENT ON COLUMN public.curriculum_slots.delivery_mode IS
  'How this session is delivered. live_call (default) or vod_review. Not content; see the migration header for why the name matters.';
COMMENT ON COLUMN public.curriculum_slots.vod_review_by IS
  'student = the kid used their per cycle swap. coach = Tim decided, which costs the kid nothing.';
COMMENT ON COLUMN public.curriculum_slots.vod_upload_id IS
  'The VOD being reviewed. Nullable on purpose: the kid may swap first and paste later.';

-- The allowance. Per CYCLE rather than per calendar month, because a cycle is
-- the only clock the portal already speaks (skips are "2 of 2 used this
-- cycle") and a second time base is a second thing that can disagree.
ALTER TABLE public.subscriptions
  ADD COLUMN cycle_vod_reviews_used SMALLINT NOT NULL DEFAULT 0;

ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_cycle_vod_reviews_used_check
  CHECK (cycle_vod_reviews_used >= 0);

COMMENT ON COLUMN public.subscriptions.cycle_vod_reviews_used IS
  'Student initiated VOD swaps used this cycle. Reset by provisionNextCycle alongside cycle_skips_used. A coach initiated swap does NOT touch this.';
