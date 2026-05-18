# XPL Keyed Backend Spec: waiting_on and lifecycle state

Companion to `admin-spec.md`. Defines the schema changes and transition 
rules required to support the admin redesign.

This spec is small but load-bearing. The admin UI's Tasks abstraction, 
Home queue, stale-client detection, and Stuck-button flow all depend on 
the concepts defined here. Build this first; admin features ladder on 
top.

---

## 1. The `waiting_on` field

A new field added to every state-bearing object in the system.

**Definition:**

```sql
waiting_on  enum  NOT NULL
            values: 'TIM' | 'PARENT' | 'KID' | 'SYSTEM' | 'DAD'
```

**Applied to these tables (at minimum):**

- `messages` — every thread has a `waiting_on` reflecting whose turn it 
  is to act.
- `trial_prep_checklists` — each checklist item has a `waiting_on` 
  reflecting who needs to complete it.
- `curricula` — each curriculum proposal has a `waiting_on` reflecting 
  approval state.
- `cancellation_events` — each cancel/reschedule request has a 
  `waiting_on` reflecting who needs to respond.
- `subscriptions` — when past_due, dunning_state has a `waiting_on` 
  reflecting whose action moves it forward.

Any new state-bearing object added later should adopt this field as a 
default.

---

## 2. Transition rules

The `waiting_on` value changes only on these explicit triggers. Nothing 
else mutates it.

**Messages:**

| Event                              | New waiting_on          |
|------------------------------------|-------------------------|
| Inbound message from parent        | TIM                     |
| Inbound message from kid           | TIM                     |
| Tim sends a message to parent      | PARENT                  |
| Tim sends a message to kid         | KID                     |
| Tim hits "Stuck" on this thread    | DAD                     |
| Dad sends a message on Tim's behalf| PARENT or KID (per recipient) |
| Dad returns the thread to Tim      | TIM                     |
| Automated reminder sent            | unchanged               |

**Checklists:**

| Event                              | New waiting_on (on item) |
|------------------------------------|--------------------------|
| Item created                       | initial assignment per item |
| Kid completes a kid-side item      | TIM (for verification) or SYSTEM (auto-pass) |
| Parent completes a parent-side item| TIM (for verification) or SYSTEM (auto-pass) |
| Tim verifies an item               | (item moves to complete; no longer waiting) |
| Tim hits "Stuck" on an item        | DAD                      |

**Trial decisions:**

| Event                              | New waiting_on (on trial) |
|------------------------------------|---------------------------|
| Trial call ends                    | TIM                       |
| Tim picks "Take on"                | TIM (now drafting plan)   |
| Tim sends plan to parent           | PARENT                    |
| Parent approves plan               | SYSTEM (Stripe setup)     |
| Tim picks "Not the right fit"      | SYSTEM (auto-send decline)|
| Tim picks "Still deciding"         | TIM (parked, no task)     |
| Tim hits "Stuck"                   | DAD                       |

**Dunning:**

| Event                              | New waiting_on (on sub)   |
|------------------------------------|---------------------------|
| Stripe payment fails (day 1)       | SYSTEM (cron handles)     |
| Dunning day 3 reminder fires       | unchanged                 |
| Dunning day 6 reminder fires       | TIM (decision time)       |
| Tim messages parent re: payment    | PARENT                    |
| Parent updates card                | SYSTEM (Stripe retries)   |
| Tim cancels the subscription       | SYSTEM (final)            |
| Tim hits "Stuck"                   | DAD                       |

**Reschedule / cancel requests (Calendly):**

| Event                              | New waiting_on            |
|------------------------------------|---------------------------|
| Parent cancels via Calendly        | TIM (review credit/forfeit) |
| Tim approves credit                | SYSTEM (apply to cycle)   |
| 3rd credit triggers pending_cancel | PARENT (confirm/undo)     |

---

## 3. The `DAD` value: routing and resolution

When `waiting_on = DAD`:

1. The task disappears from Tim's Home queue.
2. A notification is sent to Peter via Discord DM (`dmTim` helper, 
   addressed to Dad's ID).
3. The task appears in Dad's admin view (separate spec).
4. The full context (message thread, client info, recent state) is 
   bundled and visible to Dad.
5. Dad has three resolution paths:
   - **Handle directly.** Dad replies, makes the decision, etc. Object's 
     `waiting_on` transitions to wherever it should next go (PARENT, 
     KID, SYSTEM). Tim sees a small banner in his admin: "Dad handled 
     this. {summary}."
   - **Return to Tim with guidance.** Dad sends a note via the 
     Tim ↔ Dad channel, marks the task as "back to Tim." Object's 
     `waiting_on` transitions back to TIM. Tim's next view of the task 
     includes Dad's note.
   - **Mark resolved / no action needed.** Some Stuck-button taps are 
     panic, not legitimate escalation. Dad can mark "no action needed" 
     and return the task to Tim. Object's `waiting_on` transitions back 
     to TIM. The Stuck history is kept so patterns can be noticed over 
     time.

**No silent reassignments.** Tim should always know when a task came 
back from Dad and why.

---

## 4. Lifecycle state machine

Separate from `waiting_on`. State is *where the client is in their 
journey*; `waiting_on` is *whose turn it is right now*.

**States:**

```
TRIAL_PREP       → kid signed up, working toward first call
TRIAL_SCHEDULED  → trial call on the calendar
TRIAL_DONE       → trial call happened, decision pending
ACTIVE           → paying client, current cycle
PAST_DUE         → payment failed, in dunning
PENDING_CANCEL   → 3rd credit triggered, ending at period end
CANCELED         → terminal
WAITLIST         → no slot available, offer pending or expired
```

**Transition triggers (state changes only, not `waiting_on`):**

| From            | To              | Trigger                            |
|-----------------|-----------------|------------------------------------|
| (new)           | TRIAL_PREP      | Intake form submitted              |
| (new)           | WAITLIST        | Intake submitted, slots full       |
| WAITLIST        | TRIAL_PREP      | Slot opens, parent accepts offer   |
| TRIAL_PREP      | TRIAL_SCHEDULED | Calendly invitee.created (paid)    |
| TRIAL_SCHEDULED | TRIAL_DONE      | Calendly event end time passes     |
| TRIAL_SCHEDULED | TRIAL_PREP      | Calendly invitee.canceled          |
| TRIAL_DONE      | ACTIVE          | Tim picks "Take on" + plan sent + parent approves + Stripe activates |
| TRIAL_DONE      | (deleted)       | Tim picks "Not the right fit"     |
| ACTIVE          | PAST_DUE        | Stripe invoice.payment_failed      |
| PAST_DUE        | ACTIVE          | Stripe invoice.paid (recovery)     |
| ACTIVE          | PENDING_CANCEL  | 3rd cancel credit used in a cycle  |
| PENDING_CANCEL  | ACTIVE          | Parent confirms "undo cancel"      |
| PENDING_CANCEL  | CANCELED        | Period end reached                 |
| PAST_DUE        | CANCELED        | Tim manually cancels after day 6   |
| ACTIVE          | CANCELED        | Tim manually cancels at parent request |

**One-way and reversible:**

Most transitions are one-way. Reversible transitions (TRIAL_SCHEDULED → 
TRIAL_PREP, PAST_DUE → ACTIVE, PENDING_CANCEL → ACTIVE) are explicitly 
allowed because they reflect real-world reality (cancels happen, payments 
recover, parents change their mind).

`CANCELED` is terminal. Reopening a canceled client creates a new 
client record (with history preserved if useful).

---

## 5. Progress markers (checklists)

Distinct from lifecycle state. Used to drive UI granularity and task 
derivation within a state.

**Trial prep checklist:**

```
trial_prep_checklist:
  signup:                  bool  default: false (set true on intake)
  vod_submitted:           bool  default: false
  prep_questions_answered: bool  default: false
  joined_discord:          bool  default: false
  trial_scheduled:         bool  default: false
```

When all five are true, the lifecycle state can transition out of 
TRIAL_PREP — but the transition is gated on `trial_scheduled = true` 
specifically (Calendly webhook fires the transition).

**Active client checklist (per cycle):**

```
cycle_checklist:
  cycle_number:            int
  lessons_delivered:       int   (0-4)
  cancels_used:            int   (0-3)
  vods_reviewed_this_cycle: int
```

This is operational state for the active cycle, not a checklist Tim 
acts on directly. Used by the admin UI to render "cycle 2, lesson 3 of 
4" type summaries.

**UI presentation:**

The admin UI can render "Prep 3/5" by counting true values in the 
trial_prep_checklist. The state machine itself does not care about the 
count — only about the lifecycle state.

---

## 6. Derived tasks query

The Home queue is a query that joins state + waiting_on + checklist 
status:

```
SELECT task_type, client_id, client_name, age_in_state, source_object_id
FROM derived_tasks_view
WHERE waiting_on = 'TIM'
ORDER BY priority_score DESC, age_in_state DESC
LIMIT 1  -- for the "one thing" Home screen
```

`derived_tasks_view` is a database view (or materialized view if 
performance demands) that emits one row per actionable task by 
inspecting:

- All `messages` where `waiting_on = TIM` (one task per thread)
- All `trial_prep_checklist` items where `waiting_on = TIM` and not 
  complete
- All trials in `TRIAL_DONE` state with no decision yet
- All `curricula` where `waiting_on = TIM`
- All `cancellation_events` where `waiting_on = TIM`
- All `subscriptions` where `waiting_on = TIM` (dunning day 6+)
- All clients in `ACTIVE` state with `last_message_at` > 7 days ago 
  (quiet clients — surfaces a "check in" task)

`priority_score` is a simple computed field for ordering when Tim 
expands "more waiting." Suggested weights:

- Tough parent message (detected): 100
- Payment failure day 6+: 90
- Trial decision pending: 80
- Inbound message (parent): 60
- Inbound message (kid): 50
- VOD to review: 40
- Send Discord invite: 30
- Approve curriculum: 30
- Approve reschedule: 20
- Quiet client (check in): 10

Adjust with feedback. The single highest-priority task is what shows 
on Home.

---

## 7. Stuck history

Every Stuck-button tap creates a row in a `stuck_events` table:

```sql
stuck_events:
  id              uuid
  tim_user_id     uuid
  object_type     text   -- 'message_thread', 'trial_decision', etc.
  object_id       uuid
  reason          text   -- optional, Tim can add a note or leave blank
  created_at      timestamp
  resolved_by     uuid?  -- Dad's user_id when resolved
  resolved_at     timestamp?
  resolution_type enum   -- 'handled_directly' | 'returned_to_tim' | 'no_action_needed'
  resolution_note text?  -- Dad's note to Tim, if any
```

This table is the source of truth for:

- The Tim ↔ Dad relationship's actual activity
- Patterns over time (Tim Stucks on payment decisions repeatedly? 
  Pattern worth noticing.)
- Eventually, a v2 weekly review for Dad showing where Tim needed help

Stuck history is never shown to Tim as a count or score. It's 
operational data for Dad's view and longitudinal awareness.

---

## 8. Notification triggers

For each state transition and task creation, an entry in the 
notification_log table fires:

```sql
notification_log:
  id              uuid
  user_id         uuid     -- Tim or Dad
  channel         enum     -- 'discord_dm' | 'push' | 'email'
  event_type      text
  payload         jsonb
  sent_at         timestamp?
  delivery_status enum     -- 'queued' | 'sent' | 'failed'
```

This table already exists per CLAUDE.md notes. The admin spec adds these 
event types:

- `task_created` (any new task for Tim)
- `stuck_routed_to_dad`
- `dad_handled_stuck`
- `dad_returned_stuck_to_tim`
- `trial_decision_pending` (after call ends)
- `quiet_client_threshold_reached` (7+ days no activity)

Each event has a Discord DM template and (where appropriate) a PWA push 
template. Templates are dash-free per Hard Rule #8.

---

## 9. Schema migrations needed

Concrete list of database migrations required:

1. **Add `waiting_on` to existing tables.** Migration adds the enum 
   column with a sensible default (likely 'SYSTEM' for existing rows, 
   then a backfill script computes the actual value based on current 
   state).

2. **Create `trial_prep_checklist` table** (if it doesn't exist as 
   such). May currently be denormalized into the client/trial record. 
   Normalize so each checklist item is queryable.

3. **Create `stuck_events` table.**

4. **Create `derived_tasks_view`.** Begin as a regular view; promote 
   to materialized view if query performance demands it. Refresh 
   triggers on writes to source tables.

5. **Backfill `waiting_on` values** for existing clients and threads. 
   One-time script. Logic:
   - Inbound message with no Tim reply after → `waiting_on = TIM`
   - Outbound Tim message with no reply → `waiting_on = PARENT` or `KID`
   - Trial in TRIAL_DONE with no decision → `waiting_on = TIM`
   - Checklist items: compute per item

6. **Add indexes** on `(waiting_on, updated_at)` for fast Home queue 
   queries.

---

## 10. Order of implementation

Suggested order, smallest blast radius first:

1. Add `waiting_on` column to `messages` (default SYSTEM, no behavior 
   changes yet).
2. Backfill `waiting_on` for messages based on last-actor logic.
3. Update message-send and message-receive code paths to set 
   `waiting_on` on write.
4. Build the `derived_tasks_view` against just messages (rest comes 
   later).
5. Build a barebones Home screen that queries the view and shows the 
   top task.
6. Add `waiting_on` to checklists.
7. Add `waiting_on` to other tables.
8. Build full derived tasks view.
9. Add `stuck_events` table and Stuck-button flow.
10. Migrate lifecycle state machine to separate from checklist progress.

Each step is independently shippable. The admin UI can ship Phase 1 
(per admin-spec.md section 21) against just messages-based tasks, then 
gain richness as the rest of the schema catches up.

---

## 11. What's out of scope

To prevent this spec from becoming the architecture for everything:

- Frontend UI design (covered in admin-spec.md)
- Discord bot behaviors (covered in existing CLAUDE.md sections)
- Stripe integration (covered in existing CLAUDE.md sections)
- Calendly webhook handler (covered in existing CLAUDE.md sections, 
  this spec only adds the state-transition effects)
- Dad's admin view (its own spec)
- Multi-tenant support (deferred until operator #2)

---

## 12. Open questions

- **Should `waiting_on` be a denormalized field on each table, or a 
  separate `ownership` table joined on?** Default: denormalized for 
  query simplicity. Revisit if multiple objects can have multiple 
  simultaneous owners (probably never).

- **How does `waiting_on` interact with no-show or ghosting?** A parent 
  who never responds to "your card failed" eventually needs the 
  subscription canceled. The cron handles the lifecycle transition 
  (PAST_DUE → CANCELED) but `waiting_on` might want a "stale" sub-state. 
  Or just: if `waiting_on = PARENT` for 14+ days, surface to Tim as a 
  "quiet" task. Lean toward the latter — simpler.

- **Bulk Stuck?** Can Tim hit Stuck on multiple things at once? 
  Probably not — one at a time, per the no-bulk-operations principle 
  in admin-spec.md section 18.

- **Stuck timeout?** If Dad doesn't respond in 24 hours, does the task 
  return to Tim automatically? Probably not — Dad is a person, life 
  happens. Better to surface long-pending Stucks to Dad's view 
  prominently than to bounce them back to Tim and create a loop.
