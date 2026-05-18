# XPL Keyed Dad Admin Spec

The admin UI for Peter (Dad), companion to Tim's admin (`admin-spec.md`).

This admin is small. It exists to let Dad pay attention without paying 
too much attention, handle the things Tim escalates, and intervene when 
operational reality requires an adult.

It is deliberately not a control panel. Tim is the operator. Dad is the 
safety net.

---

## 0. Design principle

Dad's admin is for one of three modes, in order of frequency:

**1. Resolve a Stuck.** Tim hit the button. Dad handles it.

**2. Glance.** Dad opens the admin once or twice a day to confirm 
things are fine. Most of the time, they are.

**3. Operate.** A real operational issue (Stripe failure, parent 
complaint reaching legal-risk territory, a kid safety concern) needs 
Dad's hands.

Everything in the design serves these three modes. Anything that would 
let Dad start backseat-driving Tim's day-to-day decisions is out.

---

## 1. Who Peter is, in front of this screen

**Tim's dad first.** Wants Tim to succeed and grow. Wants to be there 
without being on top.

**Legal/financial owner.** Stripe account is his. Domain is his. If 
anything goes legally sideways, he's the one in the room with a lawyer.

**Solo developer.** Building Day & Knight, MD Today, EOC Library, Trinity 
League rollout, this. Time is not abundant.

**Phone first, but desktop is real.** Unlike Tim, Dad does some of his 
admin work at a laptop. The Dad admin should be mobile-friendly but 
desktop-capable.

**Not Tim's manager.** This matters. The admin should help Dad feel 
informed and useful without giving him the affordances to micromanage. 
Read-only by default for most things; intervention requires explicit 
intent.

---

## 2. Home screen

Dad opens the admin and sees, in order:

**1. Stuck queue.** Tasks Tim escalated. Top of the screen, action-first.

```
┌─────────────────────────────────┐
│ STUCK (2)                       │
├─────────────────────────────────┤
│ Lucas's mom is upset            │
│ "I'm really frustrated that..."  │
│ 14 min ago                       │
│ [Handle]                         │
├─────────────────────────────────┤
│ Refund request from Eli's parent │
│ 2 hours ago                      │
│ [Handle]                         │
└─────────────────────────────────┘
```

Each Stuck shows enough context for Dad to know what he's about to 
handle without opening it. Tap "Handle" to enter the full thread / 
decision context (section 4).

**2. Operational alerts.** Things the system flagged for Dad regardless 
of Tim. Examples:

```
┌─────────────────────────────────┐
│ ALERTS                          │
├─────────────────────────────────┤
│ ⚠ Stripe webhook failed 3 times │
│   in last hour                  │
├─────────────────────────────────┤
│ ⚠ Discord bot last seen 6 hours│
│   ago, expected heartbeat       │
└─────────────────────────────────┘
```

These are system-level concerns Tim doesn't need to know about and 
can't fix. Dad handles them quietly.

**3. Activity summary.** A glance card showing Tim's recent activity 
without exposing the details that would feel surveillance-y.

```
┌─────────────────────────────────┐
│ TIM TODAY                       │
├─────────────────────────────────┤
│ 6 tasks done                    │
│ 1 trial decision made           │
│ Last seen 2 hours ago           │
└─────────────────────────────────┘
```

The point is: "Tim is showing up." Not: "here's everything Tim did."

**4. Business glance.** Same four numbers Tim sees on his admin, plus 
a couple Dad cares about more:

```
┌─────────────────────────────────┐
│ BUSINESS                        │
├─────────────────────────────────┤
│ Paying: 4 / 12                  │
│ Trials this week: 3             │
│ MRR: $224                       │
│ Stripe balance: $681            │
│ Next payout: Friday             │
└─────────────────────────────────┘
```

Dad's view adds Stripe balance and next payout because those are 
financial-operator concerns. Tim doesn't need them on his Home.

**Tim ↔ Dad channel sits below this** as a small persistent banner. 
Recent message, tap to open.

---

## 3. The Stuck flow (Dad side)

When Tim hits Stuck, Dad gets:

1. A Discord DM with context: "Tim is stuck on {what}. Tap to handle."
2. The Stuck appears in Dad's Home queue.

When Dad opens a Stuck, he sees:

**Full context bundle:**

- The triggering object (the message thread, the trial, the decision, etc.)
- Recent related history (last few messages, current state, what Tim 
  was trying to do)
- Tim's optional note ("Mason's mom is mad and I don't know what to 
  say")
- A "Tim's pattern" line if there are similar past Stucks: "Tim has 
  hit Stuck on payment-related decisions 3 times in the last month."

**Three resolution paths:**

```
┌─────────────────────────────────┐
│ [Handle this directly]          │
│   You reply / decide. Tim sees  │
│   a summary banner.             │
├─────────────────────────────────┤
│ [Send back to Tim with a note]  │
│   You write guidance. Tim       │
│   handles it with your input.   │
├─────────────────────────────────┤
│ [Mark as no action needed]      │
│   Sometimes Stuck is panic.     │
│   Returns to Tim quietly.       │
└─────────────────────────────────┘
```

**Handle directly:**

Dad acts on the object — replies to the message, makes the decision, 
issues the refund, whatever. The system marks the Stuck resolved, 
captures what Dad did, and shows Tim a banner next time he opens his 
admin: "Dad handled Lucas's mom's complaint. The situation is calm."

**Send back to Tim with a note:**

Dad writes a short note to Tim in the Tim ↔ Dad channel: "Hey, here's 
how I'd approach this. Match her tone down. Apologize for the wait 
without over-apologizing. Offer a small make-good. You've got this." 
The task returns to Tim's queue with the note attached.

**No action needed:**

Sometimes Tim hits Stuck because he's overwhelmed, not because the 
situation actually needs Dad. Dad can mark it that way without judgment 
and the task returns to Tim's queue with no note, no fanfare, no shame.

**Dad's tone in the Tim ↔ Dad channel is calibrated.** Brief, warm, 
trusting. Not "let me explain everything." Not "next time, try X." 
Just the guidance Tim needs to do this one thing well. Over time Tim 
generalizes from the patterns.

---

## 4. Read-only view of Tim's admin

Dad can see everything Tim sees, but mostly should not.

**Access pattern:**

A "View as Tim" link in Dad's admin. Opens a read-only mirror of Tim's 
current admin state.

**What Dad sees in this mode:**

Exactly what Tim sees. The Home one-thing. The Clients groups. The 
Client details. The threads.

**What Dad cannot do in this mode:**

Reply to messages as Tim. Make decisions as Tim. Take any action on 
Tim's behalf. (Those are surfaced through the Stuck flow, where Dad's 
identity is explicit.)

**Why read-only:**

Dad acting as Tim would corrupt the trust model. A parent who thinks 
they got a reply from Tim and actually got one from Dad is being 
deceived in a small but real way. Dad's interventions should always be 
visible as Dad's.

**Why Dad has it at all:**

Occasional moments — Tim is on a tournament weekend, a parent escalates, 
Dad needs to see what's going on. The visibility is for understanding, 
not for action.

---

## 5. Operational tools

Things Dad does that Tim doesn't.

**Stripe:**

- View recent payouts
- Issue refunds (which automatically CC Tim with a brief explanation)
- See failed payments and dunning state across all clients
- Configure Stripe-side settings (this is rare; mostly hands-off)

**Discord bot health:**

- See last heartbeat
- See recent message-send failures
- Re-auth or restart the bot if needed

**Calendly:**

- See webhook delivery status
- Manually trigger a webhook replay if one failed

**Resend (email):**

- See bounce/complaint rates
- See recent deliveries

These tools are gated behind a "..." menu or a dedicated "Operations" 
tab. They're not on Home because Dad shouldn't be checking them 
constantly. They exist for when something is actively broken.

---

## 6. Patterns and longitudinal view

A small section that helps Dad notice trends without surveilling Tim 
day-to-day.

**Weekly Tim summary (Sundays):**

```
┌─────────────────────────────────┐
│ THIS WEEK                       │
├─────────────────────────────────┤
│ 23 tasks completed              │
│ 6 days with activity            │
│ 2 Stucks (1 payment, 1 reply)   │
│ 1 trial taken on (Jake)         │
│ 0 trials declined                │
│ Median reply time: 3 hours      │
└─────────────────────────────────┘
```

This is the rep counter for Dad. Lets him see Tim showing up over time. 
The Stuck pattern row is useful for noticing where Tim consistently 
needs help — that's where Dad might mentor proactively or where the 
admin's scaffolds need to improve.

**Pattern notices (occasional):**

The admin can surface gentle pattern notices when they emerge:

```
You've handled 4 payment-related Stucks in the last 3 weeks. 
Worth a conversation with Tim about how he wants to approach 
dunning?
```

These appear rarely. They're suggestions, not alerts. Dad can act on 
them or ignore them.

---

## 7. Boundaries: what the Dad admin does NOT do

This section is doctrinal. Resist scope creep into these areas.

**No real-time tracking of Tim.** Dad does not see what screen Tim is 
on. No "Tim is currently typing." No "Tim has been in Coach Mode for 
22 minutes." Activity is summarized after the fact, not surveilled in 
the moment.

**No "approve before sending" workflow for Tim's messages.** With one 
exception: the "Not the right fit" outbound (per admin-spec.md section 
11) and the first 4-week plan to each parent. Everything else, Tim 
sends without Dad's approval. The trust model breaks otherwise.

**No "edit Tim's draft" affordance.** Tim writes his own messages. If 
Dad wants to suggest different language, he does it through the 
Tim ↔ Dad channel as a conversation, not by editing Tim's work.

**No grades, scores, evaluations.** No "Tim's reply quality this week: 
B+." This is not a managed-employee dashboard. This is a dad watching 
his son grow into work.

**No automated alerts about Tim's behavior.** No "Tim hasn't done a 
task in 3 days, you should check in." If Tim is going quiet, Dad will 
notice through the natural rhythm of the home life, not through a 
notification.

**No revenue split visibility for Tim.** Tim sees MRR. The fact that 
30% comes back to Dad for the XPLeague tuition reimbursement is a 
private family arrangement that doesn't need to be in the admin. Dad 
can see his cut in Stripe.

---

## 8. Mobile and desktop

Dad uses both.

**Mobile (320px+):** Same single-column layout as Tim's admin. The 
Stuck queue is the focal point. Everything else is glanceable.

**Desktop:** A wider layout makes sense for the Operations tab 
(Stripe-style tables of recent payouts, failed webhooks). The Stuck 
flow and Home stay similar to mobile — wider but not denser.

Dad's admin is desktop-capable in a way Tim's isn't. Dad genuinely 
sometimes opens a laptop to deal with Stripe or look at a long parent 
thread. Tim almost never will.

---

## 9. Notifications

Dad gets pinged via Discord DM (using the same bot, addressed to Dad's 
ID) for:

- **Tim hits Stuck** (high priority, fast notification)
- **System operational alerts** (Stripe failure, bot down, webhook 
  failing)
- **Outbound messages requiring Dad CC** (per admin-spec.md section 11)
- **Weekly summary** (Sunday morning)

Dad does NOT get pinged for:

- Tim doing normal admin work (this is just Tim doing his job)
- New trial signups (Tim handles)
- Routine payments (no human attention needed)
- Tim's task completions (none of Dad's business)

The principle: Dad's phone vibrating means something needs Dad. Not 
"FYI Tim sent a message." Otherwise Dad becomes the notification 
backstop and the system creates the surveillance dynamic the design 
is trying to avoid.

---

## 10. Tone

Dad's admin talks to Dad like a competent operations system, not a 
chatty assistant.

| Tim admin                     | Dad admin                       |
|-------------------------------|--------------------------------|
| Mason's mom is waiting on you | Stuck: Mason's mom escalation  |
| You're caught up. Go play.    | No active Stucks               |
| Done.                         | Resolved.                      |
| Nice work this week, Tim.     | Tim: 23 tasks done this week.  |

Functional. Direct. No gamification on Dad's side. Dad is not learning 
work, he is doing work.

---

## 11. Privacy boundary: what Tim sees of Dad

The reverse question: how visible is Dad's activity to Tim?

**Tim sees:**

- Tim ↔ Dad channel messages from Dad
- "Dad handled this" banners on tasks Dad resolved through Stuck
- "Dad's reviewing this" tags on tasks awaiting Dad CC
- Dad-issued refunds and cancellations appear in the client's history 
  (transparency matters)

**Tim does not see:**

- Dad's operational dashboard
- Dad's Stripe activity beyond what affects specific clients
- Pattern-notice content Dad receives
- Weekly summary Dad receives about Tim's activity

This asymmetry is intentional. Tim should know Dad is there and 
involved. Tim doesn't need to see Dad watching him.

---

## 12. Implementation sequencing

Suggested build order. Mostly follows Tim's admin phasing — Dad's 
admin is light enough to slot in alongside.

**Phase 1 (alongside Tim's admin Phase 1):**
- Stuck-routing infrastructure (per backend-spec.md)
- A minimal Dad Home with Stuck queue
- A minimal "View as Tim" read-only mode

**Phase 2 (alongside Tim's admin Phase 2):**
- Operational alerts (Stripe, Discord bot health)
- The Tim ↔ Dad channel UI on Dad's side
- The three Stuck resolution paths fully implemented

**Phase 3 (alongside Tim's admin Phase 3):**
- Activity summary card on Home
- Business glance card with Stripe balance
- Weekly Tim summary

**Phase 4 (alongside Tim's admin Phase 4):**
- Operations tab with full Stripe/Discord/Calendly/Resend visibility
- Pattern notices
- Polish

The bulk of Dad's admin is implementation of patterns already defined 
in `admin-spec.md` and `backend-spec.md`. The novel work is the Stuck 
flow UI and the operational tools tab.

---

## 13. Open questions

- **Should Dad's admin be a separate URL/route, or a role-based view 
  within the same app?** Default: same app, role-gated. Dad's user 
  account has a `role = 'dad'` flag and the app renders the right 
  view. Simpler than maintaining two builds.

- **What happens to Dad's admin if Peter eventually exits the day-to-day 
  and Tim is fully solo?** Probably it just goes dormant — Stucks never 
  fire because Tim outgrew them. The "View as Tim" still works for 
  occasional check-ins. Defer this question to the actual moment.

- **Multi-Dad case (you and Cassidy)?** If Tim's mom should also be in 
  the loop for certain things, this might need a "guardians" model 
  rather than a single Dad. Defer until/unless that's actually wanted.

- **Vacation mode?** If Dad is unreachable for a week, do Stucks pile 
  up, or get auto-resolved back to Tim? Probably pile up. Dad can set 
  an "out of office" message in the Tim ↔ Dad channel and Tim adjusts 
  expectations. No automation needed for v1.

---

## 14. The acceptance test, restated

> Does Dad's admin help Peter be the safety net Tim needs without 
> becoming the boss Tim doesn't need?

Every feature should answer this. If a feature could plausibly turn 
Dad into Tim's manager rather than Tim's dad, it doesn't belong.

The good version of this admin is the one where Tim feels like the 
operator and Dad feels like the trusted senior partner. Not employer 
and employee. Not parent and supervised child. Partners with different 
roles.

That's the outcome to design for.
