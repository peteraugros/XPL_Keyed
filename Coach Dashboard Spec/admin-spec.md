# XPL Keyed Admin Spec v1

The admin UI for Tim, a 14-year-old with ADHD running his first business 
alongside his dad.

This is not a SaaS admin tool. It is a product designed to help Tim become 
the operator he could be, by making it obvious, satisfying, and shame-free 
to do the next right thing.

The work this admin does is real. The responsibility it builds is the point.

---

## 0. Acceptance test

Every screen in this admin must pass one question:

> Does this screen make it obvious, satisfying, and shame-free for Tim to 
> do the next right thing?

Three words doing real work:

**Obvious.** ADHD-friendly clarity. One thing to look at, one thing to do. 
No navigation puzzles. No prioritization decisions.

**Satisfying.** Tim should feel the rep in his body when he finishes a task. 
The gaming aesthetic exists for this — not for branding, for dopamine. 
He has been Pavloved by 5 years of competitive gaming. We use that to make 
work feel good.

**Shame-free.** Tim will forget things, ignore things, let things pile up. 
The admin must never punish him for this. No angry red badges. No counters 
of how many things he is behind on. The thing that is waiting is just there, 
calmly, until he does it.

If a screen does not help Tim do the next right thing in a way that is 
obvious, satisfying, and shame-free, it does not belong in the admin.

---

## 1. Who Tim is, in front of this screen

**14 years old.** Cognitively capable but emotionally young. Long-term 
thinking is still developing. He will not plan a week. He will not maintain 
a system. He will respond to what is in front of him right now.

**ADHD.** Attention is volatile. Five items visible at once equals decision 
paralysis equals close the app. One item visible equals "okay I can do that" 
equals action. He needs an interface that does the prioritization for him.

**Phone-native.** He lives on his phone. The admin competes with Discord, 
Fortnite, TikTok, Snap, iMessage. It must be fast to open, useful in 90 
seconds, and never require uninterrupted focus.

**Time-fragmented.** His real admin windows are roughly: 7-8am, 4-6pm, 
9-10pm. Each window might be 5 minutes. He needs to be able to do at 
least one full thing in any window.

**Learning what work is.** He has never had a job. He has never had clients. 
He has never had to follow through with someone who is depending on him. 
The admin is teaching him these things by structuring how the work flows, 
not by lecturing.

**Dad is right there.** Peter is the legal owner, the back-end operator, 
and Tim's safety net. The admin should make Tim feel like the operator he 
is — but never feel alone. Dad is present without being in the way.

---

## 2. The responsibility curriculum

This is the deepest part of the spec. Everything below ladders back to it.

The admin is teaching Tim four things, none of them by explicit instruction:

**1. Other people are waiting on you, and that matters.**
   - Parents have names, not just emails.
   - When someone has been waiting 14 hours, you see it as a person, 
     not a number.
   - When you reply, the waiting ends. You did that.

**2. Work is a series of small finishable things.**
   - Every task is scoped small enough to finish in one sitting.
   - Finishing feels good. Not finishing is fine — the task is still 
     there tomorrow, no shame.
   - Over weeks, the count of finished tasks becomes evidence that 
     you are someone who follows through.

**3. Your work translates to numbers.**
   - Paying clients, MRR, trials this week — visible but not 
     pressurizing.
   - The numbers move when you do the work. The connection becomes 
     intuitive.
   - Money is a real thing, earned in real exchanges with real people.

**4. Saying no is a skill.**
   - Some kids are not the right fit. You learn to see why.
   - Declining is done with grace, not avoidance.
   - The admin scaffolds the decision so you learn to evaluate, not 
     just to react.

These four learnings emerge from how the work is structured. They are 
never named in the UI. Tim discovers them by doing.

---

## 3. The Tasks abstraction

Tasks are the load-bearing primitive of the entire admin. Everything Tim 
sees on the Home screen is a task. Everything that demands his attention 
is a task. Tasks are how the admin teaches him that work is finishable 
things.

**Tasks are derived, not user-created.** Tim does not make tasks. The 
system makes them by looking at the state of every client and emitting 
the tasks that need a human to do them. Tim cannot forget to add a task, 
because the system never forgets. He cannot procrastinate on creating 
his to-do list, because there is no to-do list to create.

**Tasks are small.** Every task is scoped so Tim can finish it in one 
attention window. Examples:
   - Reply to a parent's message (60 seconds)
   - Send a Discord channel invite (45 seconds)
   - Review a kid's VOD (2-10 minutes, this is the only long one)
   - Make a take-on/not-the-right-fit decision (1-3 minutes with scaffolding)
   - Send a curriculum revision (5-10 minutes)
   - Approve a parent's reschedule request (15 seconds)

If a task takes longer than 10 minutes, it gets broken into sub-tasks. 
Tim should never feel like he opened the app for "5 minutes" and got 
trapped.

**Tasks have one canonical action.** Every task has a single primary 
button. "Reply." "Send invite." "Decide." "Approve." Not a menu of 
choices. One action.

**Tasks come from these sources:**

| Source                              | Task                              |
|-------------------------------------|-----------------------------------|
| Parent or kid sends message         | Reply to {name}                   |
| Kid drops VOD                       | Review {name}'s VOD               |
| Trial reaches Prep 4/4              | Schedule trial with {name}        |
| Calendly invitee.created (paid)     | Send Discord invite to {name}     |
| Trial call ends                     | Make decision for {name}          |
| Parent requests curriculum approval | Approve {name}'s plan             |
| Parent requests reschedule          | Approve {name}'s reschedule       |
| Payment fails after dunning         | Decide on {name}'s subscription   |
| Client goes quiet 7+ days           | Check in on {name}                |
| You hit "Stuck" on something        | (task hidden until Dad responds)  |

**Tasks have a "waiting on" model.** A task only appears in Tim's queue 
if `waiting_on = TIM`. When Tim acts, ownership transfers. The task 
leaves his queue. This is the bedrock concept — section 5 covers it in 
depth.

**Tasks have a calm urgency signal, not a panic one.** A task that has 
been waiting 14 hours looks slightly more present than one waiting 1 
hour, but never aggressive. Never red. Never blinking. The signal is a 
soft growth in visual weight, not an alarm.

**Completing a task is a small celebration.** When Tim taps "done" or 
finishes the action, the task does not just disappear. It animates out 
with a quick acknowledgment — a satisfying check, a soft sound (only if 
sound is enabled), maybe a small XP-style tick. The same loop Fortnite 
uses for kill confirms. Then it is gone. Section 12 covers this.

---

## 4. Home screen: One Thing

The Home screen shows Tim one task at a time.

**Layout (320px wide phone, top to bottom):**

```
┌─────────────────────────────────┐
│ XPL KEYED                       │
│ Tim                             │
├─────────────────────────────────┤
│                                 │
│  Mason's mom is waiting on you  │  ← The one task, large
│                                 │
│  "Hey Tim, just wanted to       │  ← A snippet of context
│   check on what time we're..."  │
│                                 │
│  ┌───────────────────────────┐  │
│  │         Reply             │  │  ← The single action button
│  └───────────────────────────┘  │
│                                 │
├─────────────────────────────────┤
│  3 more waiting       ⌄         │  ← Collapsed, demoted
├─────────────────────────────────┤
│  Next call: Jake, Saturday 2pm  │  ← Single pinned upcoming
├─────────────────────────────────┤
│  ✦ 4 done today                 │  ← Streak/count, quiet
└─────────────────────────────────┘
```

**Why one thing at a time:**

ADHD brains drown in lists. The one-thing pattern is borrowed from 
Streaks, Stoic, and similar habit apps that specifically design for 
attention disorders. It is also borrowed from the game design pattern 
of "objective marker" — your next objective is the bright thing on 
screen, and there is only one at a time.

**When Tim finishes the task,** the screen smoothly transitions to the 
next task. The same one-thing pattern. He never sees a queue of obligations. 
He sees one thing, does it, then sees the next thing, until there is 
nothing.

**When there is nothing to do,** the screen says so warmly:

```
You're caught up.

Go play.
```

That sentence is doing more work than it looks like. "You're caught up" 
acknowledges the work done. "Go play" gives explicit permission to leave. 
For a kid who is figuring out work/life balance, this is the implicit 
message: work happens, work ends, and when it ends you go live your life.

**The collapsed "more waiting" section** is honest but quiet. Tim can tap 
to expand it and see the full queue, but the default is single-focus. The 
list inside the expansion is the same task model — small, action-first, 
calm urgency.

**Next call** gets one pinned card. It is the only future-tense thing on 
the Home screen. The card shows the kid, the time, and a "Coach mode" 
button when it's within 30 minutes of starting. Section 9.

**The "✦ 4 done today" line** is the gentle streak indicator. Not a goal. 
Not a target. Just a tally of the work Tim did. Section 12 covers the 
philosophy here in depth.

---

## 5. The waiting_on model

The single most important schema concept in the entire admin.

Every thread, every client checklist item, every operational event has 
an explicit `waiting_on` field that determines whose action is required 
to move things forward.

**Possible values:**
- `TIM` — Tim needs to do something. Task appears in his queue.
- `PARENT` — parent needs to respond or act. No task for Tim.
- `KID` — kid needs to do something (drop a VOD, join Discord, etc).
- `SYSTEM` — automated process in progress (Stripe webhook, cron job).
- `DAD` — Tim hit the "Stuck" button on this. Dad handles it.

**Transition rules:**

| Event                              | New waiting_on   |
|------------------------------------|------------------|
| Inbound message from parent or kid | TIM              |
| Tim sends a message                | PARENT or KID    |
| Tim hits "Stuck"                   | DAD              |
| Dad replies on Tim's behalf        | PARENT or KID    |
| Kid drops a VOD                    | TIM              |
| Trial scheduled in Calendly        | SYSTEM (auto-progress) |
| Trial call ends                    | TIM (decide)     |
| Tim makes trial decision           | PARENT (sees outcome) |
| Curriculum approval requested      | TIM              |
| Tim approves curriculum            | SYSTEM (auto-send) |
| Automated reminder fires           | unchanged        |

That last row matters. Automated nudges do not change ownership. The 
system pinging Tim about a stale task does not mean the task is no longer 
"on Tim." Ownership is about *who must act for things to move forward*.

**This concept powers:**
- Home queue (only `waiting_on = TIM` tasks appear)
- Stale-client detection (long time in any non-TIM state)
- Response-time metrics (later)
- The "stuck" escape valve (`waiting_on = DAD`)

**Implementation note:** this is a schema change from whatever exists 
today. Every messages table, every checklist item, every state-bearing 
object gets a `waiting_on` field. This should be specified in a small 
backend spec alongside this admin spec — they are co-dependent.

---

## 6. Client lifecycle: state vs progress

Lifecycle state and progress markers are separate concepts.

**Lifecycle state** is one of a small set of canonical phases:

```
TRIAL_PREP        → kid signed up, working toward first call
TRIAL_SCHEDULED   → call on the calendar
TRIAL_DONE        → call happened, decision pending
ACTIVE            → paying client, current cycle
PAST_DUE          → payment failed, in dunning
PENDING_CANCEL    → 3rd credit triggered, ending at period end
CANCELED          → terminal
WAITLIST          → no slot available, offer pending or expired
```

**Progress markers** are checklists within a state:

```
trial_prep_checklist:
  signup:                 ✓
  vod_submitted:          ✓
  prep_questions_answered: ✓
  joined_discord:         _
  trial_scheduled:        _
```

The UI can render "Prep 3/5" by counting completed checklist items, but 
the backend state machine works on the lifecycle state, not the checklist. 
This separation matters because:

- The state transitions are clean and predictable
- Checklist items can be added, removed, or reordered without breaking 
  the state machine
- UI grouping (section 7) works cleanly off state + checklist status
- Tasks (section 3) are derived from incomplete checklist items where 
  `waiting_on = TIM`

**Canonical next actions** are derived, not hardcoded:

- If `state = TRIAL_PREP` and `joined_discord = false` and `waiting_on = TIM`: 
  task is "Send Discord invite to {name}"
- If `state = TRIAL_DONE` and no decision yet: task is 
  "Make decision for {name}"
- If `state = ACTIVE` and unread parent message: task is 
  "Reply to {parent_name}"

Derived tasks update automatically as state and checklist change.

---

## 7. Clients tab: grouped, not filtered

The Clients tab is where Tim looks when he wants to see *everyone*, not 
just *what is waiting on him*.

**Default view is grouped by state, not filtered.**

```
TRIALS READY (2)
  Jake, 14 · waiting on call decision
  Mason, 13 · waiting on call decision

WAITING ON THE KID (3)
  Warren, 14 · hasn't dropped VOD (3 days)
  Eli, 12 · hasn't joined Discord (1 day)
  Noah, 15 · hasn't answered prep (5 hours)

ACTIVE (4)
  Finn, 13 · cycle 3, lesson 2 of 4
  Hayes, 14 · cycle 1, lesson 1 of 4
  Cole, 15 · cycle 2, lesson 3 of 4
  Drew, 12 · cycle 1, lesson 4 of 4 (cycle ends Friday)

NEEDS ATTENTION (1)
  Lucas, 14 · payment failed 2 days ago

QUIET (2)
  Sam, 13 · no message in 12 days
  Riley, 15 · no message in 9 days
```

**Why grouped:**

Tim does not think "show me everyone in TRIAL_PREP." He thinks "who's 
ready, who's stuck, who's solid, who needs me." Groups map to those 
mental buckets. Filters do not.

**Each group has a one-line summary** so Tim can scan in two seconds. 
Each row has the client's name, age, and the most important context for 
that state. Tap to open the client detail.

**Groups that are empty are hidden.** No "ACTIVE (0)" headers. The screen 
shrinks to fit reality.

**The "Quiet" group is important.** Clients who have not had any 
interaction in a while bubble up here, not as a task (Tim is not waiting 
on them) but as awareness. Tim can decide to check in or not. The 
"check in" tap becomes a task: "Send a friendly message to {name}." 
This is how Tim learns that maintaining relationships is part of the 
work, not just reacting to inbound.

---

## 8. Client detail: one client, in context

When Tim taps a client from the Home queue or the Clients list, he sees 
a focused detail view for that one client.

**Header (sticky):**

```
┌─────────────────────────────────┐
│ ← Back                          │
│                                 │
│ Mason, 13                       │
│ Trial Prep · 3/5                │
│                                 │
│ [Send Discord invite]           │  ← Primary action for current state
└─────────────────────────────────┘
```

**Below the header, in priority order:**

1. **Active conversation.** The thread with the most recent activity, 
   inline reply box at the bottom. This is where 80% of Tim's time on 
   this screen goes.

2. **State-specific context.** For Trial Prep: kid's VOD link, prep 
   answers, Discord status, what's next on the checklist. For Active: 
   current cycle progress, next scheduled call, recent VODs.

3. **Reference data (collapsed).** Parent name, parent email, signup 
   date, plan tier. Tim knows his clients. He does not need this 
   screaming at him. Tap to expand if needed.

4. **History (collapsed).** Older messages, past coaching notes, past 
   curriculum plans. Searchable when expanded.

5. **Admin actions (deeply buried).** Cancel subscription, refund, 
   delete client. Behind a "..." menu with confirmation modals.

**Familiarity reduces UI needs.** This is a stated design principle. 
The first time Tim sees a client, the detail view shows more. As Tim 
gets to know them, he interacts with the reference data less, so it 
quietly recedes. We do not need a setting for this — defaults handle it.

---

## 9. Coach Mode

When a call is within 30 minutes or in progress, Tim taps "Coach Mode" 
and enters a focused operational state.

**Coach Mode is a different shell of the same app.** Navigation is 
suppressed. The screen shows only what Tim needs for this specific call.

**Pre-call screen (T-30 to T-0):**

```
┌─────────────────────────────────┐
│ COACHING JAKE                   │
│ Saturday · 2:00pm · in 14 min   │
│                                 │
│ ───────────────────────────────│
│ Before the call, look at:       │  ← Scaffolded prep
│                                 │
│ • Jake's VOD     [open]         │
│ • Prep answers   [open]         │
│ • Last messages  [open]         │
│                                 │
│ ───────────────────────────────│
│                                 │
│ Discord channel: [open]         │  ← One-tap to where call happens
│                                 │
│ ┌───────────────────────────┐   │
│ │     Start call              │   │  ← Marks the call as in-progress
│ └───────────────────────────┘   │
└─────────────────────────────────┘
```

**During the call:**

A simpler screen with the kid's name, an elapsed timer, and a "notes" 
field Tim can dump into. The notes are private to Tim and you. They 
become part of the post-call decision context.

**Post-call screen:**

When Tim taps "End call":

```
┌─────────────────────────────────┐
│ How did that go?                │
│                                 │
│ ───────────────────────────────│
│ Before you decide, think about: │  ← The scaffold
│                                 │
│ • Did Jake show up on time?     │
│ • Did he do his prep?           │
│ • Did it feel like coaching     │
│   or like babysitting?          │
│ • Could you imagine 4 weeks     │
│   with him?                     │
│                                 │
│ ───────────────────────────────│
│                                 │
│ ┌───────────────────────────┐   │
│ │  Take Jake on             │   │
│ └───────────────────────────┘   │
│ ┌───────────────────────────┐   │
│ │  Not the right fit        │   │
│ └───────────────────────────┘   │
│ ┌───────────────────────────┐   │
│ │  Still deciding           │   │
│ └───────────────────────────┘   │
│                                 │
│ ┌───────────────────────────┐   │
│ │  ⚑ Stuck — get Dad        │   │
│ └───────────────────────────┘   │
└─────────────────────────────────┘
```

**The scaffold is the curriculum.** Those four questions are teaching 
Tim how to evaluate a client. Over time the scaffold gets quieter — 
maybe the questions appear smaller, or as a collapsed "think about this" 
section — but it stays available. Tim never has to remember the framework 
because the UI remembers it for him.

**The "Stuck" button is always present.** No shame. No explanation 
required. Tap it and the task transfers to Dad. Section 11.

---

## 10. Decisions and scaffolding

Several moments in the admin require Tim to make a real judgment call. 
Each one gets a scaffold.

**Trial decision (Take on / Not the right fit / Still deciding):**
Scaffolded in Coach Mode (section 9).

**Drafting the 4-week plan:**
Step-by-step flow, one week per screen on mobile. Each week has the 
Fortnite-term + parent-translation pattern from Hard Rule #4 prefilled 
as a template Tim edits. The template itself is the curriculum — Tim is 
learning to translate game skills into real-world skills every time he 
fills one out.

**Replying to a tough parent message:**
If the system detects emotional cues in an inbound message (frustrated 
language, demanding tone, late-night timestamps), the reply UI shows a 
gentle scaffold above the text box:

```
Take a beat. A few things to think about:

• Read the whole message once before replying
• Match their energy down, not up
• If you're not sure, hit Stuck
```

We are not censoring Tim's voice. We are giving him a moment to think 
before he writes. ADHD impulse-replies to angry parents are a real 
failure mode. The scaffold is a speedbump, not a wall.

**Sending a curriculum revision:**
The flow shows what the parent currently has, what Tim is changing, and 
why. Forces a tiny bit of reflection. Teaches Tim that changes need to 
be justified to the people they affect.

**Scaffolds fade over time but never disappear.** A first-week Tim sees 
the full question list. A six-month Tim sees a single line — "Take a 
beat" — that he can tap to expand if he wants. The fading is automatic 
and based on usage count. There is no setting.

---

## 11. The Dad relationship

Peter is the legal owner, the back-end, and the safety net. The admin 
makes this real without making Tim feel watched.

**The "Stuck" button.** Always one tap away from any decision screen, 
any message reply, any operational moment. When Tim taps it:

- The current task transfers to Dad (`waiting_on = DAD`)
- Tim is briefly told "Dad's got it. He'll text you when it's handled."
- The task disappears from Tim's queue
- Dad gets a notification with the full context
- When Dad resolves it, the task either disappears entirely (if Dad 
  handled it directly) or returns to Tim with a note from Dad explaining 
  what to do next

The Stuck button is the most important feature for Tim's emotional safety. 
Without it, his failure mode is avoidance — he doesn't know what to do, 
so he closes the app, for three days, while the situation worsens. With 
it, he has an explicit escape valve that does not feel like failure.

**Automatic Dad CCs on certain events:**

- Any refund issued
- Any cancel decision (Tim's or parent-initiated)
- Any parent complaint or hostile message
- Any payment failure that hits day 6 of dunning
- The "Not the right fit" decision (always — Dad reviews tone of outbound 
  before it sends)
- The 4-week plan, the first time Tim sends one to each parent

Tim does not need to remember to loop Dad in on these. The system does. 
The CC is silent on Tim's side — he sees a small tag on the task 
indicating Dad will also see it, but it's not framed as oversight. It's 
framed as "Dad's CC'd, you're not alone on this."

**The Tim ↔ Dad channel.** A persistent thread in the admin, always 
one tap from anywhere. Used for "hey can you look at this," not for 
oversight conversation. Lightweight — like iMessage between them. Dad 
can post status updates here that show up as small banners ("Dad: I 
handled Lucas's refund, he's good now.").

**What Dad sees in his own admin view:** a much simpler view than Tim's. 
Probably:
- Tim's stuck queue
- Operational alerts (payment failures, Stripe issues)
- Recent activity summary
- A read-only view of Tim's full admin if Dad wants to look

Dad's admin is for paying attention without paying too much attention. 
That spec is its own document — for now, the relevant point is that 
Tim's admin should never feel like a panopticon.

---

## 12. Gamification, carefully

This is the section most likely to go wrong. Gamification can be the 
dopamine hit that helps an ADHD kid actually do the work, or it can 
become a shallow point-collection that hollows out the work itself.

**Guardrails:**

- **The gamification celebrates work done. It does not motivate work 
  to be done.** If Tim is only doing his admin to maintain a streak, 
  the design has failed. The streak is a byproduct of him doing work 
  he chose to do.

- **No leaderboards.** Against whom? Other 14-year-old solo founders? 
  This is not a contest.

- **No levels Tim grinds for.** Levels create grinding, grinding 
  hollows out the work.

- **No achievements that become the point.** "First refund issued!" 
  is gross.

- **No streaks that punish breaks.** If Tim takes a weekend off, the 
  streak does not yell at him. It might quietly reset, or it might 
  show "your longest streak: 14 days" as a fond memory. Not a debt.

**What's actually included:**

- **Small task-completion animation.** Each task that finishes gets a 
  satisfying tick or sweep. Fast, satisfying, gone in 400ms.

- **"+XP" microbursts on task completion.** Small numbers (10, 25, 50 
  depending on task weight). The XP accumulates into a quiet meter on 
  the Home screen. The meter does not unlock anything material. It is 
  just a visual record of work done.

- **A "today" count.** "✦ 4 done today" on the Home screen. Acknowledges 
  the work. Resets quietly at midnight without ceremony.

- **A "this week" summary at week's end.** Saturday morning, a single 
  card: "Last week: 23 tasks done. 6 days you showed up. Nice work, 
  Tim." This is the rep counter. Over time it becomes the literal 
  evidence base for "I am someone who follows through."

- **Sound is optional and off by default.** When on, sounds are short 
  and satisfying. Never alarming.

The rule of thumb is: every gamification element should feel like a 
friendly nod from the app, not a hook trying to keep him engaged. He 
should be able to close the app at any moment and not feel pulled back 
by the gamification itself.

---

## 13. Tone of voice

The admin talks to Tim like a slightly older friend who respects him.

Not childish. Not corporate. Not cool-trying-too-hard. The register is 
real, warm, light.

**Examples:**

| Generic SaaS                 | XPL Keyed admin                   |
|------------------------------|-----------------------------------|
| 1 unread message             | Mason's mom is waiting on you     |
| 0 pending tasks              | You're caught up. Go play.        |
| Save as draft                | Going to think about this one?    |
| 6 days overdue               | Noah's been waiting 6 days        |
| No items found               | Nothing to do right now.          |
| Confirm deletion             | Sure you want to cancel Lucas?    |
| Operation completed          | Done.                             |
| Action required              | (no system label — just the task) |

**Rules:**

- Names, not roles. "Mason's mom," not "Parent." "Jake," not "Client #14."
- Verbs, not nouns. "Reply to Mason's mom," not "Unread message: Mason."
- Honest urgency, not theater. "Been waiting 14 hours" tells the truth. 
  "URGENT!" does not.
- Empty states celebrate. "You're caught up" is a positive event.
- Errors are kind. "That didn't go through. Try again?" not "ERROR 
  500: REQUEST FAILED."
- No marketing voice. The admin is internal. It does not need to sell 
  Tim on anything.

---

## 14. Mobile-first, in practice

The admin is designed for 320px wide. Desktop is a progressive 
enhancement.

**Specific implications:**

- **Single column always.** No multi-card grids on Home or Clients.
- **Tap targets minimum 44x44pt.** Apple HIG floor.
- **Sticky headers** on detail views so the primary action stays 
  reachable.
- **Keyboard-aware reply boxes** that don't push send buttons off-screen 
  on iOS or Android.
- **Long forms become step-by-step flows.** The 4-week plan composer 
  is four sequential screens, not one long scroll.
- **One-handed reachable primary actions.** The main button is in the 
  thumb zone (bottom third of the screen) whenever possible.
- **Fast first paint.** PWA install, cached shell, no waiting on data 
  to render the first useful frame.
- **Resume where you left off.** If Tim opens, taps into a thread, gets 
  interrupted, and comes back 20 minutes later, he lands back on that 
  thread.

**Desktop adds:**

- Wider columns
- Multi-pane views (Clients list on left, detail on right)
- Keyboard shortcuts (j/k to navigate the task queue, etc.)
- Possibly a "command bar" for power users

Desktop is not the target. Desktop is a bonus.

---

## 15. Notifications and Discord

Tim's primary alert channel is Discord DMs from the XPL Keyed Bot. The 
admin does not duplicate this.

**Discord DMs handle:**
- New trial signup
- New VOD submitted
- New message from parent or kid
- 20-min pre-call reminder
- Payment received
- Payment failed
- Parent curriculum approval request
- Anything time-sensitive when Tim might be away from the admin

**The admin handles:**
- Push notifications (PWA) for the same events when Discord is closed 
  or muted
- The full task context when Tim opens the admin after a Discord ping

**Both must be calm.** A Discord ping should never be panic-coded. The 
push notification should never demand. The admin's job is to be the 
calm place where the work gets done, not another source of pressure.

**No notification bell or badge count in the admin itself.** Tim already 
got pinged. The Home screen *is* the notification — the one thing in 
front of him.

---

## 16. Empty states and edge cases

Brief catalog, to be fleshed out in implementation:

**All caught up:**
```
You're caught up.
Go play.
```

**First-time login, no clients:**
```
Nothing here yet. When kids sign up, 
they'll show up here. You'll know.
```

**Failed action (Stripe error, message send failed, etc.):**
```
That didn't go through. Try again?
[Try again]   [Get Dad]
```

The "Get Dad" button is the Stuck button surfaced inline. Failed actions 
are exactly where ADHD avoidance starts — make the escape valve obvious.

**Stale data (Tim hasn't refreshed in a while):**
A small banner at the top: "Pull down to refresh." No forced reload, 
no nagging.

**Conflict resolution (Tim and parent acted on the same thing simultaneously):**
Last-write-wins for v1. Tim sees what happened with a short note 
("The parent already canceled this — no action needed."). Never silent.

**Tim signed in on phone and laptop simultaneously:**
Realtime sync via Supabase. The same message arriving in both places 
appears live. No "this thread is locked" UI — collaboration with himself 
is fine.

---

## 17. State changes: what triggers what

Bridging the admin UI to the existing cron/webhook infrastructure in 
CLAUDE.md. For each lifecycle state transition, define:

- The triggering event (webhook, cron, manual action)
- Whether it requires Tim's confirmation or is automatic
- What task (if any) appears in Tim's queue as a result
- What notification (if any) fires

This is a table to fill in during implementation. A few representative 
rows:

| Triggering event              | Auto? | Task created                | Discord ping? |
|-------------------------------|-------|-----------------------------|---------------|
| Calendly invitee.created (free) | yes | none (parent gets confirm)  | yes (FYI)     |
| Kid drops VOD                 | yes   | Review {name}'s VOD         | yes           |
| Trial reaches Prep 4/4        | yes   | Schedule trial with {name}  | yes           |
| Trial call ends               | yes   | Make decision for {name}    | yes           |
| Tim picks "Take on"           | no    | Draft 4-week plan           | (silent)      |
| Plan sent to parent           | yes   | Awaiting parent approval    | (silent)      |
| Parent approves plan          | yes   | Send Discord invite         | yes           |
| invoice.paid                  | yes   | none (cycle resets)         | yes (FYI)     |
| Payment fails day 1           | yes   | none (dunning auto-fires)   | yes (FYI)     |
| Payment fails day 6           | yes   | Decide on {name}'s sub      | yes (urgent)  |
| Parent reschedule request     | yes   | Approve {name}'s reschedule | yes           |
| Tim hits Stuck                | yes   | (none — moves to Dad)       | (to Dad)      |

The table is exhaustive in v1. Every event that could create a task or 
fire a notification is enumerated. This becomes the contract between 
the admin UI and the backend.

---

## 18. What's deliberately not in scope

To prevent feature creep:

- **AI-assisted reply drafting.** Tim writes his own messages. The 
  voice is his. If we add AI later it should suggest, never replace.

- **Analytics beyond the four Home numbers.** Trends, cohorts, retention 
  curves — all v2 or never.

- **Internal CRM notes** ("this parent is sensitive about pricing," 
  "this kid is a perfectionist"). Tim keeps those in his head or a 
  personal notes app. Adding a CRM layer is a slippery slope into 
  enterprise SaaS shapes.

- **Bulk operations.** No mass-messaging. No batch state changes. 
  Every action is one client at a time. The single-client focus is 
  pedagogical — Tim is learning that each kid is a person.

- **Operator #2 multi-tenancy.** Defer. Note any decision in this spec 
  that would foreclose it later; otherwise build for Tim only.

- **Public API.** No third-party integrations beyond what's already in 
  the stack.

- **Themes, customization, settings sprawl.** Tim does not need to 
  configure his admin. The admin is the admin.

---

## 19. The four learnings, restated as design tests

These are the responsibility-curriculum outcomes from section 2, 
restated as tests we can apply to any feature decision:

**1. "Other people are waiting on you, and that matters."**
   Does this feature show parents and kids as people with names and 
   contexts, not rows in a database?

**2. "Work is a series of small finishable things."**
   Does this feature have a clear end? Does completing it feel like 
   completing something?

**3. "Your work translates to numbers."**
   Are the numbers (paying, MRR, trials) visible without being 
   pressurizing? Does Tim see the connection between his actions and 
   those numbers?

**4. "Saying no is a skill."**
   When Tim has to decline or end something, is the UI scaffolding the 
   judgment? Or just collecting his answer?

If a feature does not contribute to any of these learnings, it had 
better be doing something else important (operational necessity, safety, 
etc.). Otherwise it does not belong.

---

## 20. Open questions for v2

- **Should Tim get a weekly review screen?** A Sunday-night moment where 
  he sees what last week was, what next week looks like? Could be 
  powerful for the responsibility curriculum. Could also be one more 
  thing to ignore. Try it small.

- **Should there be a "Tim's reflections" log?** A place where Tim can 
  jot what's working, what's hard, what he's noticed about himself? 
  Optional, private, not graded. Might become a useful artifact — or 
  might never get used. Build only if Tim asks for it.

- **Should the gamification eventually unlock features for him?** ("After 
  100 tasks completed, you can edit your own marketing copy.") Probably 
  not — feels manipulative — but worth considering as a way to scaffold 
  trust transfer from Dad to Tim over time.

- **Voice input for replies?** ADHD plus typing on a phone equals 
  abandoned half-replies. Voice dictation with quick edit might be a 
  killer feature for the reply task specifically.

- **What does the admin look like when Tim has 30 active clients?** 
  Some of the design decisions here (one-thing Home, no bulk ops) might 
  need to flex. Revisit at 20 clients.

---

## 21. Implementation sequencing

Suggested build order. Each phase is shippable on its own.

**Phase 1: The bones.**
- `waiting_on` schema across messages and checklists
- Lifecycle state machine, separated from checklist progress
- The Tasks derivation logic
- A working Home screen with the one-thing pattern
- A working Clients tab (grouped view)
- A working Client detail (header + active thread + state context)

Replaces the current dashboard. Functional but plain.

**Phase 2: The shell.**
- Coach Mode (pre-call, during, post-call with scaffolded decision)
- The 4-week plan composer (step-by-step flow)
- The "Stuck" button and Dad routing
- Inline scaffolds on reply screens for tough messages

Now Tim has the operational tools for the full client lifecycle.

**Phase 3: The soul.**
- Task completion animations and microbursts
- "Today" and "This week" rep counters
- Empty-state copy and tone-of-voice pass across all screens
- Motion philosophy implementation (section 9 of original outline)
- Sounds (off by default)

Now the admin feels like a place Tim wants to be.

**Phase 4: The polish.**
- Push notifications (PWA)
- Realtime sync polish across devices
- Search across clients
- Settings (the small number that exist)
- Onboarding for Tim's first time

Now it ships.

Each phase is 2-4 weeks of focused work. Total: a quarter, give or take. 
Worth it.

---

## 22. The acceptance test, restated

> Does this screen make it obvious, satisfying, and shame-free for Tim 
> to do the next right thing?

Print this. Tape it above the monitor.

Every PR, every design decision, every "should we add..." conversation — 
this is the question.

If we keep answering yes, we end up with an admin that builds Tim into 
the operator he could be. That outcome is bigger than the business.
