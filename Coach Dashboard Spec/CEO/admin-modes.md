# XPL Keyed Admin Modes

The XPL Keyed admin ships in two modes. This is the meta-spec for how 
they coexist.

**Focused mode** (`admin-spec-focused.md`) — one thing at a time, 
scaffolded decisions, warm tone, designed for Tim and operators who 
want the system to think for them.

**Command mode** (`admin-spec-command.md`) — full pipeline visible, 
keyboard-first, dense, designed for experienced operators who want 
to think for themselves.

This document defines the toggle, the persistence, and the boundaries 
between modes.

---

## 1. Principle

Neither mode is "the real one." Neither mode is "the advanced one." 
They are two valid operator mindsets for two valid moments.

The toggle exists because:

1. Different operators have different brains. ADHD-novice vs. experienced-PM 
   are genuinely different mental models, and forcing one into the other's 
   UI is bad design.

2. The same operator may want different modes at different moments. A 
   high-energy morning may want Command; a low-energy evening may want 
   Focused.

3. Operators graduate over time, but not always in the same direction. 
   Tim may live in Focused mode forever. Dad may live in Command mode 
   forever. Some operator-#2 might start in Command and slide toward 
   Focused on tired days.

The toggle treats the operator as an adult who knows what they need 
right now.

---

## 2. The toggle UI

**Top-right header,** always visible:

```
┌────────────────────────────────────────────────┐
│ XPL KEYED              [Focused] [Command]    │
└────────────────────────────────────────────────┘
```

The current mode is highlighted. Tap the other to switch. No confirmation, 
no friction. The switch is instant.

**Keyboard shortcut:** `cmd+\\` (or `ctrl+\\`) toggles modes from anywhere 
in the app.

**Command palette:** "Switch to Focused mode" / "Switch to Command mode" 
are first-class palette items.

---

## 3. Persistence

The chosen mode is per-user and persistent.

- Tim's preference is stored on Tim's user record.
- Dad's preference is stored on Dad's user record.
- Persists across devices.
- Persists across sessions.
- Initial default for new users: **Focused mode.** Operators self-select 
  out of it if they want denser.

Mode preference is not exposed in any social or comparative way. There's 
no "Tim is in Focused mode" badge on his profile. It's a private setting.

---

## 4. Context preservation across switches

When the operator switches modes, the app preserves context as much 
as possible.

**Same screen:** If on Client Detail for Mason in Focused mode, switching 
to Command lands on Client Detail for Mason in Command rendering. The 
URL doesn't change, the data doesn't reload, the rendering does.

**Sibling screens:** Focused-mode Home is Command-mode Pipeline. Focused 
Clients-tab is Command Clients-tab. Map equivalents:

| Focused mode             | Command mode             |
|--------------------------|--------------------------|
| Home (one-thing)         | Pipeline                 |
| Clients (grouped)        | Clients (list)           |
| Coach Mode               | Coach Mode (shared)      |
| Client Detail            | Client Detail (denser)   |
| Money (glance)           | Money (full)             |
| (no equivalent)          | Operations               |
| Tim ↔ Dad channel        | Tim ↔ Dad channel (shared)|

**Coach Mode is shared.** Both modes route to the same Coach Mode 
screen because the operational task (running a call) is the same. The 
scaffolds in post-call decision are present in Focused-mode entry, 
removed in Command-mode entry — that's the one difference.

**Stuck button is universal.** Both modes have it. The flow is identical.

---

## 5. Shared infrastructure

The two modes share:

- All data (Supabase tables, lifecycle state, waiting_on, checklists, 
  threads, payments)
- All authentication and authorization
- All real-time sync
- All notifications (Discord DMs, PWA push)
- All operational backend (crons, webhooks, Stripe Connect)
- Stuck-button routing
- Client detail data structure
- Message thread infrastructure

The modes diverge in:

- Home/Pipeline rendering
- Clients list rendering (grouped vs. sortable table)
- Client detail rendering (single-pane vs. two-pane)
- Inbox (Focused has no separate Inbox; Command has full Inbox tab)
- Money view (Focused has glance; Command has full dashboard)
- Operations view (Focused doesn't expose; Command has full tab)
- Scaffolds on decisions (Focused includes; Command removes)
- Gamification (Focused has it; Command doesn't)
- Tone of voice (Focused warm; Command compact)
- Keyboard shortcuts (Focused minimal; Command extensive)

---

## 6. Onboarding suggestion

First-time operators land in Focused mode by default. After a threshold 
of usage (say, 30 days of regular activity, or 100 completed tasks), 
the app may surface a one-time suggestion:

```
You've been busy. Want to try Command mode?

It shows everything at once — your whole pipeline, all 
messages, all clients — for operators who want to scan 
and decide instead of being walked through.

[Try Command mode]   [Stay in Focused]   [Ask later]
```

The suggestion appears once. If dismissed, it doesn't reappear. If 
tried, the operator can switch back any time.

This onboarding nudge is the only place the app suggests Command mode. 
After that, it's the operator's choice.

**For Tim specifically,** this nudge should probably be suppressed for 
at least 6 months. The responsibility curriculum in Focused mode is 
the point of the product for him; suggesting he leave it early defeats 
the purpose. Dad can override via settings if Tim eventually wants to 
try Command.

---

## 7. What does NOT change with mode

- Stuck history is shared.
- Notification preferences are shared (Discord pings, push notifications).
- Client data, lifecycle state, messages, checklists — all shared.
- The Tim ↔ Dad channel is shared.
- Coach Mode is shared (with minor scaffold difference noted above).
- All write actions write to the same data (sending a message in Focused 
  mode is the same as sending in Command mode).

This matters because operators may switch mid-task. If Tim is mid-reply 
in Focused mode and switches to Command, the draft should not be lost. 
If Dad is mid-decision in Command mode and switches to Focused, the 
state should follow.

---

## 8. Per-mode preferences

Some preferences are mode-specific:

**Focused mode preferences:**
- Scaffold fade level (auto-progresses based on usage, but settable)
- Sound on/off
- Animation intensity

**Command mode preferences:**
- Keyboard shortcuts enabled (default on, can disable)
- Default sort order on Clients view
- Default columns shown on Clients view
- Bulk action confirmation thresholds

These persist per-user per-mode. Switching modes loads the right 
preferences for the destination mode.

---

## 9. Mobile considerations

On mobile, Command mode loses some of its density advantages and 
gains some friction (no keyboard shortcuts). Two implications:

1. The default for a new operator on mobile might still be Focused. 
   Mobile-first design heavily favors Focused. Command mode on mobile 
   is for the operator who insists.

2. **Per-device default suggestion:** an operator who is Command on 
   desktop might want Focused on mobile. v2 feature; out of scope for 
   v1, but worth noting. For now, mode is global per user.

---

## 10. Visual indicators

The current mode is visible in two places:

1. The header toggle (always visible)
2. The app's overall visual register — Focused mode has the warmer, 
   gaming-aesthetic feel; Command mode is more muted, more grayscale, 
   more "control panel."

An operator can tell which mode they're in within 1 second of looking 
at the screen.

**The Stripe-balance, dollar signs, MRR display** is one of the most 
reliable visual differentiators. Focused mode shows MRR as a single 
quiet line; Command mode has a Money tab with bar charts. The presence 
or absence of those affordances signals which mode is active.

---

## 11. Edge cases

**Operator switches mode mid-flow.** Drafts preserved. State preserved. 
URL preserved where possible.

**Operator A is in Focused, Operator B is in Command, both viewing the 
same client.** Each sees their own rendering. Writes are real-time 
synced across both views.

**Operator switches mode and the destination mode has a screen that 
doesn't exist in the source mode.** Land on the closest equivalent. 
Example: switching from Command Operations to Focused — Focused has 
no Operations tab. Land on Focused Home.

**First-time switch.** Brief tooltip on the destination mode for the 
first 5 seconds: "This is Command mode. Everything is visible. Press 
? for shortcuts." Then disappears, never shown again.

---

## 12. Implementation notes

**Architecturally, modes are a top-level rendering switch.** Both modes 
share routes, components, data layer, and state. The difference is in 
which components render at the top level for each route.

Pattern:

```
app/
  components/
    focused/        # Focused-mode rendering components
    command/        # Command-mode rendering components
    shared/         # Components used in both
  routes/
    /              # Home/Pipeline (renders focused or command)
    /clients       # Renders focused or command list
    /clients/:id   # Renders focused or command detail
    /money         # Renders focused or command money view
    /coach/:id     # Shared Coach Mode
    /operations    # Command-only
```

State (the user's mode preference) lives in a single context provider 
near the app root and is consumed by route components.

The toggle dispatches a state change, persists to the user record, and 
re-renders the active route in the new mode.

No client-side reload. No flash. Just a re-render.

---

## 13. The acceptance test

> When an operator switches modes, do they trust that the same data is 
> still there, that their work is preserved, and that the new mode 
> respects their reasons for switching?

If switching modes ever feels like losing context, losing work, or 
being judged — the design has failed.

The good version is the one where the toggle feels like flipping between 
two pairs of glasses. Same world, different way of seeing it. Pick 
whichever helps you work right now.
