-- Welcome task + NEW badge timestamps (Phase 1 of Tim's post-payment
-- workflow per /Users/peteraugros/Desktop/xpl-tim-post-payment-workflow.md).
--
-- welcomed_at: gate for the new_student_welcome derived task. NULL means
-- Tim hasn't acknowledged the conversion yet. Set when Tim taps "I
-- welcomed them" in the Focused Home welcome card.
--
-- coach_seen_at: gate for the NEW badge on /admin/clients. NULL means
-- Tim hasn't opened the client's detail card since the conversion
-- landed. Cleared (stamped) on first card open. The NEW badge also
-- ages out after 48 hours regardless.
--
-- Both columns are NULL-default; existing active subscriptions are
-- treated as already-welcomed (NULL stays NULL = task won't appear for
-- them, since the derived view filters by waiting_on='TIM' which is
-- only set by the post-checkout webhook from this point forward).

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS coach_seen_at TIMESTAMPTZ;
