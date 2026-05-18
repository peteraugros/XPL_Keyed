# XPL Keyed Admin: Command Mode

The XPL Keyed admin ships in two modes. This is one of them.

**Command mode** is the admin for operators who want to see the whole 
picture and decide for themselves. It optimizes for *can I see and move 
through everything efficiently?* It is a power-user surface, not a 
training surface. It assumes the operator knows their pipeline, doesn't 
need scaffolding, and would rather have density and speed than warmth 
and tunneling.

**Focused mode** is the other half. Lives in `admin-spec-focused.md`. 
The two modes share data and infrastructure; they diverge in how the 
operator interacts with it.

This spec defines Command mode as a product with its own design 
integrity. It is not Focused mode with the warmth removed. It has 
different affordances, a different tone, and a different theory of 
what helps the operator get work done.

---

## 0. Acceptance test

Every screen in this admin must pass one question:

> Does this screen let the operator see the whole picture and act on 
> any part of it efficiently?

Three words doing real work:

**Whole picture.** The operator can see what's happening across the 
business without drilling in. Lists, not tunnels. Counts, not single 
items. The dashboard is dense because the operator's head is dense — 
they hold the whole pipeline at once and the UI should reflect that.

**Any part of it.** No fixed priority order. No "the system decided 
this one." The operator scans, finds the thing that matters to them 
right now, and acts on it. Their judgment, not the system's.

**Efficiently.** Keyboard shortcuts. Bulk actions. Search. Filters. 
Sort. The affordances of a power-user tool. Two clicks max to anything; 
one click for the common cases.

If a screen forces the operator into a single-item tunnel or makes them 
wait for the system to tell them what's important, it doesn't belong in 
Command mode.

---

## 1. Who the Command-mode operator is

The mental model is "experienced operator running a small business they 
understand well."

**Concretely:**

- They know their clients by name and state without prompting
- They prefer scanning a list over being told "do this first"
- They batch-process: 20 minutes of replies in one sitting, not one 
  reply at a time across the day
- They want to see the whole pipeline at a glance so they can spot 
  problems before the system flags them
- They are comfortable with keyboard shortcuts and power-user UI patterns
- They get frustrated by interfaces that hide things to "reduce overwhelm"
- They are not learning the work. They know the work. They want to do 
  the work fast.

**Examples of who fits this mode:**

- An adult parent operator running their kid's coaching practice (a 
  future operator-#2 scenario where the parent has business or PM 
  background)
- Peter himself, when he's running Day & Knight operator dashboards or 
  Trinity League admin
- An adult coach who eventually licenses XPL Keyed infrastructure
- Tim in five years, after he's outgrown the scaffolds

**Examples of who does not fit:**

- A first-time operator who feels overwhelmed
- An ADHD operator in a low-energy moment
- Anyone learning what work even is

The two modes coexist precisely because these are different people, or 
the same person at different moments.

---

## 2. Design principles (different from Focused)

**Density over tunnels.** Command mode shows many things at once. The 
operator's job is to scan, not to be led.

**Sort and filter as first-class affordances.** The operator wants to 
slice the data their way. Sort by state, by age, by name, by MRR, by 
last-activity. Filter by anything. The UI provides; the operator decides.

**Keyboard-first.** j/k to move down/up. Enter to open. Esc to close. 
Slash to search. cmd+K for command palette. The mouse works but it's 
slower.

**Bulk actions where appropriate.** Select multiple clients, message 
them all. Select multiple stuck threads, mark them. Select multiple 
overdue VOD reviews, mark "watched in batch." Power users batch.

**Data transparency, not narrative wrap.** Show timestamps, IDs (when 
useful), raw counts, dollar amounts. Don't pre-digest the data into a 
sentence when the operator can read the data faster than the sentence.

**Multiple things visible.** Multi-column on desktop. Inbox + detail. 
Pipeline + filters. Don't artificially restrict information.

**Calm density, not panic density.** This is the harder one. Dense 
admin tools tend to feel stressful (red badges, screaming counts). 
Command mode is dense but visually quiet. Information without alarm.

**No celebrating, no shaming.** Command mode does not high-five the 
operator on task completion. It also does not red-pill them on backlog. 
It just shows reality. The operator brings their own emotional 
relationship to the data.

---

## 3. The Pipeline view (home)

The default landing screen in Command mode is the Pipeline.

```
┌──────────────────────────────────────────────────────────────────┐
│ XPL KEYED                                          [Focused] [Command] │
├──────────────────────────────────────────────────────────────────┤
│ Pipeline · 23 clients                                              │
│                                                                    │
│ ┌───────────┬───────────┬───────────┬───────────┬───────────┐   │
│ │ PREP   3  │ TRIAL  2  │ DECIDING 1 │ ACTIVE  4 │ ATTN    2 │   │
│ ├───────────┼───────────┼───────────┼───────────┼───────────┤   │
│ │ Mason 13  │ Jake 14   │ Eli 12     │ Finn 13   │ Lucas 14  │   │
│ │ vod miss  │ sat 2pm   │ 6d         │ c3 l2/4   │ pd 2d     │   │
│ ├───────────┼───────────┼───────────┼───────────┼───────────┤   │
│ │ Warren 14 │ Noah 15   │            │ Hayes 14  │ Sam 13    │   │
│ │ prep miss │ sun 4pm   │            │ c1 l1/4   │ quiet 12d │   │
│ ├───────────┼───────────┼───────────┼───────────┼───────────┤   │
│ │ Eli 12    │           │            │ Cole 15   │           │   │
│ │ dc miss   │           │            │ c2 l3/4   │           │   │
│ │           │           │            ├───────────┤           │   │
│ │           │           │            │ Drew 12   │           │   │
│ │           │           │            │ c1 l4/4   │           │   │
│ └───────────┴───────────┴───────────┴───────────┴───────────┘   │
│                                                                    │
│ Waiting on you: 4   ·   MRR $224   ·   Trials/wk 3                │
└──────────────────────────────────────────────────────────────────┘
```

**Why a pipeline view:**

The CEO mental model is "where is everyone in the funnel." A horizontal 
pipeline shows that at a glance. Each column is a state, each card is a 
client, the card's content is the most relevant context for that state.

**Each card shows:**

- Name and age
- A two-character status code (vod miss, prep miss, dc miss, c3 l2/4, 
  pd 2d, quiet 12d). The codes are learned in a day and become faster 
  to read than full English.
- Background tint shifts subtly based on age in state (lighter = recent, 
  darker = aging). Never red.

**Click a card → client detail.** Same detail view as Focused mode, 
but with the dense reference panel expanded by default and the chat 
threads collapsed by default. Command operators want data first.

**Click a column header → filtered list view.** "Show me all the 
TRIAL_PREP clients sorted by age." Same data, different shape.

**The bottom strip is the only place numbers live.** Four numbers. 
Quiet. The CEO already knows the big picture; this is reinforcement, 
not announcement.

---

## 4. The Inbox view

Tab from Pipeline. The Inbox is where threads live, batch-processable.

```
┌──────────────────────────────────────────────────────────────────┐
│ Inbox · 6 waiting on you · 4 you sent                            │
├──────────────────────────────────────────────────────────────────┤
│ [filter: all · waiting · sent]  [sort: age · name · state]       │
│                                                                    │
│ ▸ Mason's mom         · trial prep  · 14h     · "Hey Tim, just..."│
│ ▸ Warren's dad        · trial prep  · 8h      · "Can we resched..."│
│ ▸ Eli                 · trial prep  · 4h      · "yo when's the..." │
│ ▸ Lucas's mom         · past due    · 2h      · "I updated my..."  │
│ ▸ Sam's mom           · active      · 1h      · "Hi Tim, quick..." │
│ ▸ Drew                · active      · 22m     · "wp tonight"       │
│ ─────────────────────────────────────────────────────────────────│
│ ◂ You → Cole's mom    · active      · 3h ago  · "Sounds good..."  │
│ ◂ You → Hayes         · active      · 5h ago  · "Did you watch..."│
└──────────────────────────────────────────────────────────────────┘
```

**Inbox is thread-centric, not task-centric.** Focused mode treats 
each unanswered thread as a task. Command mode treats threads as the 
data — the operator decides which to act on.

**Multi-select with checkboxes** (or shift-click). Bulk actions:
- Mark as read without replying
- Snooze for N hours
- Move to a queue (if queues exist)
- Tag (if tags exist — keep this minimal)

**Keyboard:**
- j/k → next/previous thread
- Enter → open thread inline (split view on desktop)
- r → quick reply
- s → snooze
- Esc → back to inbox

**Sent items are visible by default.** Command operators want to see 
their own outbound to remember context. Focused mode hides this; 
Command mode shows it.

**Threads waiting on parent/kid (not Tim) are also visible** with a 
soft filter toggle. "Show me everything in flight, not just my queue." 
This is a CEO move — "where's that conversation I started yesterday?"

---

## 5. The Clients view

Tab from Pipeline. A sortable, filterable list of every client.

```
┌──────────────────────────────────────────────────────────────────┐
│ Clients · 23                                                       │
├──────────────────────────────────────────────────────────────────┤
│ [search: __________]  [filter: state · age · activity]            │
│ [sort: name · state · MRR · last activity · signup date]          │
│                                                                    │
│ Name      · Age · State          · Last activity · MRR · Stuck   │
│ ─────────────────────────────────────────────────────────────────│
│ Cole      · 15  · ACTIVE c2 l3/4 · 3h            · $56  ·        │
│ Drew      · 12  · ACTIVE c1 l4/4 · 22m           · $56  ·        │
│ Eli       · 12  · TRIAL_PREP 3/5 · 4h            · -    ·        │
│ Finn      · 13  · ACTIVE c3 l2/4 · 1d            · $56  ·        │
│ Hayes     · 14  · ACTIVE c1 l1/4 · 5h            · $56  ·        │
│ Jake      · 14  · TRIAL_SCH sat  · 2d            · -    ·        │
│ Lucas     · 14  · PAST_DUE 2d    · 2h            · $0   · ⚑      │
│ Mason     · 13  · TRIAL_PREP 2/5 · 14h           · -    ·        │
│ Noah      · 15  · TRIAL_SCH sun  · 6h            · -    ·        │
│ Sam       · 13  · ACTIVE quiet   · 12d           · $56  ·        │
│ Warren    · 14  · TRIAL_PREP 1/5 · 3d            · -    ·        │
│ ...                                                                │
└──────────────────────────────────────────────────────────────────┘
```

**This is the table the database would render if it had a UI.** That's 
the point. Power users want the data, not the interpretation.

**Sortable on every column.** Click the header to sort.

**Filter chips above the table.** State, age range, activity recency, 
revenue contribution. Click to filter.

**Search by name, Discord username, Fortnite IGN, parent name, parent 
email.** Cmd-K or slash to focus.

**The Stuck column** shows ⚑ for any client with an active stuck event. 
Quick filter: "show me only Stuck clients."

**Click a row → client detail.** Same detail view referenced in Focused 
mode.

**Bulk select for batch operations:** mark a group as quiet-watched, 
export to CSV, tag with a label. Use sparingly — bulk actions on 
clients is risky territory and most operations should still be per-client.

---

## 6. The Money view

A real revenue dashboard, not the four-numbers strip.

```
┌──────────────────────────────────────────────────────────────────┐
│ Money                                                              │
├──────────────────────────────────────────────────────────────────┤
│ MRR        Active   Trials/wk  This month   Next payout           │
│ $224       4 / 12   3          $448         Fri $156              │
│                                                                    │
│ ───────────────────────────────────────────────────────────────  │
│                                                                    │
│ Last 30 days                                                       │
│ ┌──────────────────────────────────────────────────────────────┐│
│ │       ▆▆                                                       ││
│ │     ▆▆▆▆     ▆▆                                                ││
│ │   ▆▆▆▆▆▆   ▆▆▆▆▆▆                                              ││
│ │ ▆▆▆▆▆▆▆▆ ▆▆▆▆▆▆▆▆▆▆                                            ││
│ └──────────────────────────────────────────────────────────────┘│
│                                                                    │
│ Recent transactions                                                │
│ Drew      · $56 cycle 1 invoice paid           · 2h ago           │
│ Hayes     · $56 cycle 1 invoice paid           · 1d ago           │
│ Cole      · $56 cycle 2 invoice paid           · 3d ago           │
│ Lucas     · $56 cycle 1 payment failed        · 2d ago           │
│ Finn      · $56 cycle 3 invoice paid           · 4d ago           │
│                                                                    │
│ Stripe balance: $681   ·   View in Stripe →                        │
└──────────────────────────────────────────────────────────────────┘
```

**MRR, payouts, transactions visible.** This is the operator's 
business. They should see the money clearly.

**Last 30 days bar chart.** Daily revenue. Helps the operator see 
patterns (weekend dips, monthly cycle-end spikes, the trial-to-paying 
curve).

**Transactions list, raw.** Date, client, amount, event type. Click 
through to the Stripe transaction.

**No goals or progress bars.** "MRR target: $500 (44% there)" is a 
Focused-mode flourish. Command mode shows the number; the operator 
brings their own targets.

---

## 7. The Operations view

System-level health and admin tasks.

```
┌──────────────────────────────────────────────────────────────────┐
│ Operations                                                         │
├──────────────────────────────────────────────────────────────────┤
│ System health                                                     │
│   Stripe webhook        · last delivery 4m ago    · ✓             │
│   Calendly webhook      · last delivery 1h ago    · ✓             │
│   Discord bot           · last heartbeat 30s ago  · ✓             │
│   Resend                · 0 bounces today          · ✓             │
│                                                                    │
│ Recent automation                                                 │
│   12:04  cron-sunday-lesson-delivery completed                    │
│   11:47  cron-dunning-parent-reminders fired 0 emails             │
│   10:30  webhook calendly invitee.created · Mason                 │
│   09:15  webhook stripe invoice.paid · Drew                       │
│                                                                    │
│ Failures last 7 days                                              │
│   (none)                                                           │
│                                                                    │
│ Tools                                                              │
│   [Replay webhook]  [Test Discord bot]  [Send test email]         │
│   [Force refresh derived tasks]  [View raw logs]                  │
└──────────────────────────────────────────────────────────────────┘
```

**For Dad / Tim's adult-operator role, not for Tim himself.** Most 
operators won't need this. Command-mode users tend to.

**Health at a glance.** Green checks, last-seen timestamps, no 
ceremony.

**Recent automation log.** What the system did on its own. Useful for 
debugging "why didn't this fire."

**Tools section** for the operator who can actually do something with 
them. Hidden behind a confirm step for destructive actions.

---

## 8. Client detail (Command mode rendering)

When a client is opened from any list view, the detail screen renders 
with Command-mode density:

```
┌──────────────────────────────────────────────────────────────────┐
│ ← Pipeline                                            Mason, 13   │
│                                                                    │
│ STATE: TRIAL_PREP   ·   2/5   ·   waiting on Tim                  │
│ Checklist:  ✓ signup  ✓ vod  _ prep  _ discord  _ schedule        │
│                                                                    │
│ ┌────────────────────────────┬─────────────────────────────────┐│
│ │ DATA                        │ THREAD                            ││
│ │                              │                                   ││
│ │ Parent:  Emily Park          │ Mom 14h:                          ││
│ │   peteraugros+mason@gmail.com│ "Hey Tim, just wanted to check..."││
│ │                              │                                   ││
│ │ Kid:     Mason               │ You 2d:                           ││
│ │   IGN: MasonFN               │ "Looking forward to meeting..."  ││
│ │   Discord: masondc           │                                   ││
│ │   Age: 13                    │ Mom 3d:                           ││
│ │                              │ "Booked the call for Saturday"   ││
│ │ Signup: 4 days ago           │                                   ││
│ │ Source: TikTok comment       │ ┌─────────────────────────────┐ ││
│ │                              │ │ Reply...                     │ ││
│ │ Discord channel: [add]       │ │                               │ ││
│ │ VOD: youtu.be/abc123  [open] │ │                               │ ││
│ │ Prep answers: not yet        │ └─────────────────────────────┘ ││
│ │                              │                                   ││
│ │ Notes: ─                     │                                   ││
│ │ [+ note]                     │                                   ││
│ └────────────────────────────┴─────────────────────────────────┘│
│                                                                    │
│ [Send Discord invite]  [Schedule trial]  [Stuck → Dad]  [...]     │
└──────────────────────────────────────────────────────────────────┘
```

**Two-pane layout on desktop.** Data on left, thread on right.

**Data pane is expanded by default** (opposite of Focused mode). 
Reference data is visible because Command operators want it visible.

**Thread is full-history.** No "expand to see older" — show it all 
with scrolling.

**Action bar at the bottom** has every action available for this state, 
horizontally arranged. Focused mode shows one button; Command mode 
shows all of them.

**Stuck button is still present.** Even Command-mode operators 
occasionally need to escalate to Dad. The escape valve is universal.

**Notes field is private**, operator-added free text. ("Mom is sensitive 
about pricing." "Kid plays controller on PC.") This was deliberately 
excluded from Focused mode to prevent CRM creep. Command mode permits 
it because Command-mode operators want to make their own notes.

---

## 9. Keyboard shortcuts

Command mode is keyboard-first. The full shortcut map:

**Global:**
- `cmd+K` (or `ctrl+K`) — command palette / search
- `/` — focus search field
- `g p` — go to Pipeline
- `g i` — go to Inbox
- `g c` — go to Clients
- `g m` — go to Money
- `g o` — go to Operations
- `?` — show keyboard shortcut overlay
- `cmd+\\` — toggle to Focused mode

**Lists (Inbox, Clients):**
- `j` / `k` — next / previous item
- `Enter` — open item
- `Esc` — close item / back to list
- `x` — toggle selection
- `shift+x` — range select
- `r` — quick reply (in Inbox)
- `s` — snooze (in Inbox)
- `f` — open filter
- `o` — open sort

**Client detail:**
- `r` — focus reply box
- `cmd+Enter` — send reply
- `e` — edit notes
- `1-9` — jump to a specific action button (1 = primary)
- `Esc` — back to list

**The shortcut overlay** is gettable with `?` and lives in Settings 
permanently. Power users will memorize; new users will reference.

---

## 10. The command palette

`cmd+K` opens a fuzzy-search command palette. Power-user staple.

```
┌──────────────────────────────────────────────────────────┐
│ > _                                                       │
├──────────────────────────────────────────────────────────┤
│ ▸ Go to Inbox                                            │
│ ▸ Go to Pipeline                                          │
│ ▸ Search clients                                          │
│ ▸ Find: Mason                                             │
│ ▸ Find: Jake                                              │
│ ▸ Send Discord invite to...                              │
│ ▸ Mark as quiet-watched...                                │
│ ▸ Switch to Focused mode                                  │
│ ▸ Open Stripe dashboard                                   │
│ ▸ Open Calendly                                           │
│ ▸ View keyboard shortcuts                                │
└──────────────────────────────────────────────────────────┘
```

Type to filter. Enter to execute. Esc to close. Fuzzy match on 
everything.

**The palette doubles as navigation and as a quick action launcher.** 
Operators who live in it almost never use the menu.

---

## 11. Tone of voice (different from Focused)

Command mode talks like an operational dashboard, not a friend.

| Focused mode                  | Command mode                  |
|-------------------------------|-------------------------------|
| Mason's mom is waiting on you | Mason · waiting 14h           |
| You're caught up. Go play.    | Inbox empty                   |
| Done.                         | (no message; row disappears)  |
| Nice work this week, Tim.     | (no summary)                  |
| Sure you want to cancel Lucas?| Cancel Lucas's subscription?  |

**Rules:**

- Compact. Names + status, no narrative.
- Honest. Show timestamps, show counts, show dollar amounts.
- No emoji except functional ones (⚑ for flagged, ✓ for done).
- No celebrations on completion.
- No gentle nudges. Information is shown; action is the operator's.
- Errors are direct. "Stripe error: card declined." Not "That didn't 
  go through, try again?"

The tone matches the audience. Adult operators don't need to be 
walked through their own work.

---

## 12. No gamification

Command mode has none of Focused mode's gamification:

- No task-completion animation. The row just disappears.
- No XP. No streaks. No "+25 XP" microbursts.
- No "done today" count on the dashboard.
- No weekly summary card.
- No sound effects.

**Why:** Command-mode operators don't need motivational scaffolding. 
They're doing the work because the work needs doing. Gamification 
would feel patronizing.

If the operator wants to feel rewarded by their progress, the Money 
view shows MRR going up. That's the reward, and it's a real one.

---

## 13. Scaffolds removed

Focused mode has scaffolds on every decision — "before you reply, 
think about..." or "before you decide, consider...". Command mode 
removes these.

**Why:** Command-mode operators have made these decisions before. 
The scaffold becomes friction. They know how to evaluate a trial. 
They know how to reply to an angry parent. They don't want the UI 
to slow them down.

**The decision flow becomes a single screen:**

```
┌──────────────────────────────────────────────────┐
│ Trial decision: Jake, 14                          │
│                                                    │
│ [Take on]  [Not the right fit]  [Still deciding] │
│ [Stuck → Dad]                                     │
└──────────────────────────────────────────────────┘
```

No scaffolding. Three buttons. The escape valve is still there.

**For the 4-week plan,** the editor is a single dense form (not a 
step-by-step flow):

```
┌──────────────────────────────────────────────────────────────────┐
│ 4-week plan: Jake                                                 │
├──────────────────────────────────────────────────────────────────┤
│ Week 1 [vod review]                                               │
│   Fortnite term: ________________________________________________│
│   Parent skill:  ________________________________________________│
│                                                                    │
│ Week 2 [vod review]                                               │
│   Fortnite term: ________________________________________________│
│   Parent skill:  ________________________________________________│
│                                                                    │
│ Week 3 [vod review]                                               │
│   Fortnite term: ________________________________________________│
│   Parent skill:  ________________________________________________│
│                                                                    │
│ Week 4 [vod review]                                               │
│   Fortnite term: ________________________________________________│
│   Parent skill:  ________________________________________________│
│                                                                    │
│ Personalization note (2 sentences):                               │
│ __________________________________________________________________│
│                                                                    │
│ [Save draft]  [Send to parent]                                    │
└──────────────────────────────────────────────────────────────────┘
```

Same fields as Focused mode's step-by-step. One screen. The operator 
fills it out in 5 minutes flat.

**Hard Rule #4 (Fortnite term + parent translation) still applies.** 
The Send button does a check: parent skill cannot contain Fortnite 
jargon. Soft-warns the operator if it might.

---

## 14. Mobile in Command mode

Command mode is desktop-first but must work on mobile.

**Mobile compromises:**

- Pipeline view stacks columns vertically with horizontal scroll between 
  them. Or collapses to a single "state filter" dropdown above a list.
- Inbox is single-column, like Focused mode's, but with the sent-items 
  toggle and sort options exposed.
- Clients view is single-column, sort/filter accessible via a 
  bottom-sheet.
- Client detail collapses to single-column with the data pane and 
  thread pane as tabs.
- Keyboard shortcuts are not applicable on mobile; rely on tap.

**Mode-switching is more important on mobile.** A Command-mode operator 
who picks up their phone in a 90-second window might want to *temporarily* 
flip to Focused mode for that session. The toggle should be easy to 
reach.

---

## 15. The acceptance test, restated

> Does this screen let the operator see the whole picture and act on 
> any part of it efficiently?

If a screen forces a single-item tunnel, hides data the operator wants, 
or wraps the data in narrative the operator didn't ask for — it's 
Focused mode leaking into Command mode. Pull it back.

If a screen shows everything but makes the operator scroll forever, 
ungroup, unfilter, unsort to find what they need — it's failing on 
efficiency. Add affordances.

The good Command mode is the one where an experienced operator opens 
it, scans for 5 seconds, knows what's happening, and acts on the thing 
that matters most to them right now. Not the thing the system picked.

---

## 16. What's deliberately not in scope

To prevent feature creep:

- **AI-powered analytics.** "Your trial-to-paying conversion rate is 
  trending down" insights are out. Show the numbers, let the operator 
  read them.
- **Customizable dashboards.** No drag-and-drop widgets. The five tabs 
  (Pipeline, Inbox, Clients, Money, Operations) are the dashboard.
- **Reporting / export tools.** Stripe and the database export themselves. 
  Don't reinvent.
- **Multi-operator views.** A Command-mode operator might have one 
  business, not five. Multi-operator dashboards are a different product.
- **CRM-style activity tracking.** Notes per client are the limit. No 
  activity feeds, no "X did Y at Z time" logs.
- **Reply templates / canned responses.** Tempting but easily abused. 
  Operators should write their own messages.

---

## 17. Mode-switching behavior

Lives in `admin-modes.md` (see separate spec).

Summary:

- Toggle is per-user, persistent
- Switchable anywhere in the app via a `cmd+\\` shortcut, a settings 
  toggle, or the header switch
- Switching modes preserves context where possible (if you're on 
  Mason's detail page in Focused mode, switching to Command lands you 
  on Mason's detail in Command rendering)
- The two modes share all data; only the rendering differs
- Stuck-button history, scaffold fade state (Focused mode), and 
  keyboard shortcuts (Command mode) all persist per-user across mode 
  switches

---

## 18. Implementation sequencing

Most of Command mode's infrastructure is the same as Focused mode's. 
The data layer, state machine, waiting_on field, lifecycle states, 
derived tasks — all shared. Command mode is a different UI rendering 
of the same data.

**Phase 1 (after Focused mode Phase 1 ships):**
- The mode toggle infrastructure (per `admin-modes.md`)
- Pipeline view (most-visible Command-mode-only screen)
- Inbox view with multi-select
- Clients view with sort and filter

**Phase 2:**
- Money view with bar chart and transaction list
- Client detail Command rendering (two-pane)
- Keyboard shortcuts (j/k navigation, cmd+K palette)

**Phase 3:**
- Operations view
- Notes field on client detail
- Bulk actions on Inbox and Clients

**Phase 4:**
- Polish, perf, mobile compromises
- Per-user persisted preferences

Each phase ships standalone. The two modes coexist throughout.

---

## 19. Open questions

- **Should Tim ever see Command mode?** Probably not by default, but 
  it shouldn't be hidden from him. If he wants to peek, the toggle is 
  there. The risk is that he sees the dense list and either feels 
  inadequate or feels seduced into Command mode before he's ready. 
  Mitigation: don't lock it, but make Focused the default for new 
  users and let usage patterns surface the right time to suggest 
  trying Command.

- **Can Dad have one mode and Tim have the other simultaneously?** 
  Yes. Mode is per-user. Tim defaults to Focused, Dad might default 
  to Command. The Dad admin spec already implies Command-mode 
  affinity.

- **Bulk operations on clients?** Defined as in-scope but use carefully. 
  "Send Discord invite to selected" is reasonable. "Mass-cancel selected 
  subscriptions" is dangerous. Keep destructive bulk actions behind 
  multi-step confirmation.

- **Saved filters / saved views?** A Command-mode operator might 
  want "show me all past-due active clients sorted by MRR" as a saved 
  view. Defer to v2; v1 just has the filter UI without persistence.

- **Multi-window / multi-tab support?** Command-mode operators often 
  have multiple tabs open. Make sure realtime sync handles this 
  cleanly. Already in scope via Supabase realtime; just verify.
