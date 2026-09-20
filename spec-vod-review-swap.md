# VOD review instead of a live call

**Status: SCOPED 2026-09-20. Nothing built. No migration.**

A student can turn one of their four sessions into a VOD review instead of a
live call. Tim can also decide a session should be a VOD review and do it
himself. Parents see that it happened and do not act.

Peter's framing, which decides who gets the button: *"it should be a student
facing action, parents are there only to see, for the sake of transparency.
students should be able to vod review once a month, or tim could decide its
necessary and do it too."*

---

## 1. Why this is worth building, in one paragraph

Today the worst thing that can happen to a session is that it falls inside the
24 hour window. `ActiveCycleManager` says it plainly: *"It's less than 24 hours
before this call, so it can't be moved. The call is the session, so this one is
lost."* It also burns a skip, and the third skip turns off auto renew. So a kid
with a sudden conflict loses a session they paid for AND moves closer to losing
the subscription.

**A VOD review is the humane branch of exactly that moment.** The kid records or
links a VOD, Tim reviews it, and the session is delivered rather than lost. That
is not a convenience feature bolted on the side; it converts the single worst
outcome in the product into a good one.

---

## 2. What already exists (measured 2026-09-20, do not rebuild)

**The student VOD submit is BUILT and SECURE, and has NEVER BEEN USED.**
`vod_uploads` holds **0 rows in production** (checked 2026-09-20), so what
follows is true of the code and untested by any real kid. `POST /api/play/vod` already
takes a pasted URL from the kid on `/play`, resolves the player from the cookie
session, and writes `vod_uploads`. Its RLS policies (`vod_uploads_kid_insert`,
`player_id_for_user()`) mean **a forged `player_id` in the body cannot succeed**.
This is the hard half of a student facing action and it is done.

**The delivery path needs no change at all.** `POST /api/admin/calendar/mark-outcome`
already produces the three artifacts a VOD review would produce: `coach_note`
(the player's vocabulary), `training_routine` (what they do next), and
`parent_summary` (the parent legible line, Hard Rule 4). It sets `delivered_at`
and `cycle_counted_at` and bumps `cycle_sessions_delivered`.

**So the swap changes only HOW the session happened.** Everything downstream is
untouched: delivery, counting, the cycle, renewal eligibility, what the parent
reads on `/portal/progress`. That is the whole reason this is a small build.

**What is NOT there:** any way to mark a session as VOD mode, any allowance or
counter, and any student action beyond the trial paste.

---

## 3. The naming trap, which has already caught this codebase twice

`is_vod_review` was dropped on 2026-09-20 in Phase 5. It meant **Tim authored a
VOD review as content**, and it belonged to the content model that phase
removed. The only writer was an admin route (`toggle-vod`); every student and
parent surface only read it to print a label. **No family could ever trigger it.**

`vod_uploads` survives and means something else again: the **free trial VOD** a
prospect submits before they are a client (`is_initial_trial_vod`). The Phase 5
migration had to call this out explicitly so nobody dropped it by association.

**This feature is a THIRD meaning: a delivery MODE for a session that a family
already owns.** Do not call the new column `is_vod_review`. A reader who greps
that name will find a dropped column, a surviving table and a new flag that all
mean different things, and will conclude Phase 5 was reverted. Suggested:
`delivery_mode` on the slot (`live_call` default, `vod_review`), which reads as
a mode rather than a content type and leaves room for a third mode later.

---

## 4. The shape

```
student on /play  ->  "Use a VOD review for this session"
                      picks which upcoming session
                      pastes the VOD link (the existing flow)
                  ->  slot.delivery_mode = 'vod_review'
                      the Calendly booking is released
                      allowance consumed
Tim in /admin     ->  same switch on any session, no allowance
                  ->  mark-outcome as usual: note, routine, parent summary
parent /portal    ->  sees "VOD review" on that session and the same three
                      artifacts. No button.
```

---

## 5. Decisions that are Peter's, with a recommendation each

**D1. What does "once a month" mean?**
A cycle is 4 sessions, which is about a month but is not a month. Options:
per CYCLE (consistent with skips, which are "2 of 2 used this cycle", and the
only unit the system can already reason about) or per CALENDAR MONTH (matches
the words, needs its own clock, and drifts against the cycle).
*Recommend: once per CYCLE.* The whole portal already speaks in cycles and a
second time base is a second thing that can disagree.

**D2. Does it consume a skip?**
*Recommend: NO.* A skip means the session was lost; a VOD review means it was
delivered another way. Charging a skip would make the humane branch cost the
same as the bad one, and would push a kid toward the third skip that kills auto
renew. The allowance in D1 is what stops it being unlimited.

**D3. Can it be used inside 24 hours?**
*Recommend: YES, and this is the point.* A VOD review needs no slot in Tim's
calendar, so the constraint that makes rescheduling impossible does not apply.
If it is blocked inside 24 hours it does not solve the case it exists for.

**D4. What happens to the Calendly booking?**
The slot carries `live_call_event_id`. Swapping must release it or Tim keeps a
hold on a time nobody will attend. *Needs checking against the Calendly
integration:* whether COS can cancel an event it created, or only stop showing
it.

**D5. Does Tim's override consume the student's allowance?**
*Recommend: NO.* If Tim decides a session is better spent on a VOD, that is a
coaching judgment, and spending the kid's one swap on it would punish them for
his call. Record who initiated it (`vod_review_by`: `student` or `coach`) so the
two are distinguishable afterwards.

**D6. Can it be undone?**
*Recommend: yes, until Tim has delivered.* Before `delivered_at`, switching back
to a live call should restore the allowance. After delivery, no.

**D7. Is one VOD link required to make the swap, or can the kid swap first and
paste later?**
*Recommend: swap first, paste later, with a nudge.* Requiring the link at swap
time means a kid who knows they cannot make Tuesday but has not clipped the VOD
yet cannot act. But then a swapped session with no VOD by its due time is a new
state somebody has to chase, which is the kind of queue this product keeps
deciding not to create.

---

## 6. What it costs

**Schema (one small migration):** `curriculum_slots.delivery_mode`,
`vod_review_by`, and a link from the slot to the `vod_uploads` row.
`subscriptions.cycle_vod_reviews_used` for the allowance. `vod_uploads` needs
`is_initial_trial_vod` to stop being the only kind (it is NOT NULL today).

**Student UI:** an action on `/play` on the session list. The paste flow exists;
it needs to stop hardcoding `is_initial_trial_vod = true` and firing the
`drop_vod` quest for a non trial VOD.

**Coach UI:** a switch on the calendar or client view. Tim's delivery path is
unchanged.

**Parent UI:** a label. No action. Per Peter, transparency only.

**Untouched:** grading, renewal, Stripe, the webhook, `mark-outcome`, dunning.

---

## 7. What would make this the wrong build

- If Tim would rather decide this case by case in the moment, the student facing
  half is ceremony and the whole thing is one admin switch.
- If in practice kids use it to avoid calls rather than to save them, the
  allowance is doing the opposite of its job, and the honest response is to
  measure it for a cycle before widening it.
- **The trial VOD flow has ZERO rows in production.** Not "little used":
  never used. So "a kid will paste a VOD link" is the load bearing assumption
  of this entire feature and there is no evidence for it either way. The
  cheapest way to find out costs no code: ask one current family to paste a VOD
  through the flow that already exists, and watch whether they do.
- If the answer is that kids do not have VODs to hand, this feature is a
  recording problem wearing a scheduling problem's clothes, and the build is a
  capture path rather than a swap.
