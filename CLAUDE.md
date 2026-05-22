# XPL Keyed — Project Context

This file is loaded into any Claude session working in this directory. It captures everything we've decided in the design conversation so far. Read it end-to-end before suggesting changes — many decisions are deliberate and have a "why" behind them.

## Table of contents

**Spec (read first, locked decisions):**
- [What this is](#what-this-is) · [Roles](#roles) · [Current state](#current-state) · [Stack (target)](#stack-target)
- [Hard rules (do not violate)](#hard-rules-do-not-violate)
- **Locked product decisions:** [Account & trust](#account--trust-model) · [Multi-kid](#multi-kid-families) · [Capacity & waitlist](#capacity--waitlist) · [Intake (Stage A)](#intake--stage-a-booking-the-free-call) · [Trial portal kid view](#post-booking-portal-trial-state--kid-view) · [Stage B prep](#stage-b-prep-quest-content) · [Trial portal parent view](#post-booking-portal-trial-state--parent-view) · [Admin trial window](#tims-admin-during-the-trial-window) · [Stage C conversion](#stage-c--the-conversion-moment-post-free-call) · [Cancellation: skip model](#cancellation-policy-skips--reschedules-unified-model) · [Lifecycle states](#lifecycle-states-locked) · [Coach cancellations](#coach-cancellations-tims-side) · [Dunning](#dunning--failed-payment) · [Parent comms](#parent-communication-every-email-tim-sends) · [Notifications](#notifications-tims-side) · [Lesson library schema](#lesson-library-schema) · [Design system & PWA](#design-system--pwa)
- [Long-term thesis (operator-pair, acquirer pitch)](#long-term-thesis-build-prove-sell) · [Pressure tests](#pressure-tests-before-operator-2)

**What's true right now:**
- [What's NOT built (known gaps)](#whats-not-built-known-gaps-in-built-reality) — read this BEFORE assuming a feature works
- [Project layout](#project-layout) — file map + every shipped surface
- [Next session pickup](#next-session-pickup) — open TODOs, setup blockers, deployment plan

**Reference:**
- [Admin spec set](#admin-spec-set-the-canonical-four) — the four-doc spec for the rebuilt admin (Focused / Command / modes / backend)
- [Memory files](#memory-files-user-level-auto-loaded-across-sessions)

---

## What this is

**XPL Keyed** is a Fortnite coaching business run by **Tim** (stage name "XPL Keyed"), a 14-year-old Unreal-ranked tournament player who has been competing since Chapter 2 Season 2 (2020). Tim sells personalized async-first coaching: weekly lessons with voiceover, plus a 30-minute Discord call. Pricing on the marketing site: free intro call · $14 single lesson · $56/mo for 4 lessons.

**This repo's job** is to be the backend + client portal + admin tool that runs the business — currently in the design conversation phase, no backend code written yet.

---

## Roles

- **Peter** is the developer, deployer, codebase owner, and admin. Comfortable with JS/TS, React, SQL.
- **Tim** is the end user of the admin UI we build. He manages clients, lessons, messages, sees revenue. Tim should never need to touch code, deployment, or dev tooling.
- **Clients** are families: a player (kid, age 8–18) and a parent. Parent pays.

---

## Current state

- Marketing site is ported into `src/app/page.tsx` (Server Component) with `src/components/MarketingClient.tsx` (Client Component) attaching the hamburger toggle, scroll-reveal IntersectionObserver, and count-up timer. Inline CSS from the original static design lives in `src/app/globals.css` under the same class names. Original `index.html` is archived at `archive/index.html` for parity reference; do not edit it further.
- Next.js 15 + Supabase scaffold is in place — see "Project files" below. `npm install` and `npm run dev` are working; dev server runs on localhost:3000 or next available port.
- Database schema, RLS policies, dev seed, and pg_cron jobs are written as Supabase migrations in `supabase/migrations/` (5 files total including `20260517000400_dunning_reminder_columns.sql` added for the cron functions below). Not yet applied to any environment (requires Docker for `npm run db:start`).
- **All 7 cron Edge Functions are written** under `supabase/functions/`: the original `cron-twenty-min-pre-call-reminder` plus 6 new ones added 2026-05-17 (`day7-dunning-ping`, `dunning-parent-reminders`, `pending-cancel-lifecycle`, `waitlist-offer-lifecycle`, `waitlist-freshness-check`, `sunday-lesson-delivery`). Shared helpers live in `supabase/functions/_shared/` (`discord.ts` with `dmTim` + `sendChannelMessage`; `resend.ts` with `sendEmail` + `brandedEmailHtml` template). Functions are functional stubs at the same fidelity as the existing example: real DB queries, real outbound calls, real idempotency markers, placeholder email/Discord copy (dash-free per Hard rule #8). All await `app_config` rows + env vars at deploy time before they do anything.
- No auth, payments, or live functionality is wired up. Stripe layer is the next coding task; the Sunday lesson delivery cron has a flagged TODO for the cycle-completion billing trigger that pairs with it.
- Scaffold has 4 pre-existing typecheck errors deferred for later (Stripe API version literal, service worker types, Supabase cookie callback typings). Not blocking marketing-site work; will be cleared when each corresponding build phase begins.

---

## Stack (target)

- **Next.js 15 (App Router) + TypeScript** — frontend + API routes; ships as a PWA (manifest + service worker + web push) for all three roles (Tim, kid, parent)
- **Supabase** — auth, Postgres, file storage, edge functions/cron
- **Stripe** — payments, subscriptions, customer portal (use **Stripe Elements embedded**, not redirect-to-Checkout, for the conversion screen)
- **Calendly** — booking, webhook → DB sync
- **Resend** — transactional email
- **Discord** — coaching server with one private channel per kid; outbound notifications via the XPL Keyed Bot (Discord REST API, no persistent gateway)
- **Railway** — hosting (chosen over Vercel because Peter already pays for Railway, and Vercel Hobby tier is non-commercial use only per ToS while Pro is $20/mo). Next.js 15 builds via Railway's Nixpacks auto-detection (`npm run build` + `npm start`); no `railway.json` or `nixpacks.toml` required. `middleware.ts` runs as Node (not edge); no 4.5MB route-handler body limit so lesson-asset uploads work without the signed-URL workaround Vercel would force.

**Scale target:** 1–10 active clients in the first 6 months. MVP can be simple; manual fallbacks OK.

---

## Hard rules (do not violate)

1. **No photo of Tim, ever.** Peter was explicit. Don't suggest a headshot, avatar, or photo of Tim anywhere in the UI.
2. **Tim's age (14) is a marketing asset, not a liability.** Lean into it: "same generation, same vocabulary, same frustrations." Parents prefer a 14-year-old who actually plays competitively to a 40-year-old who "gets it." Never frame Tim's age defensively.
3. **Calls happen on Discord, not phone.** Username collected at intake, never phone number. No DMs between Tim and any kid — coaching server with private per-client channels only.
4. **Parent-facing Fortnite terms must translate to real-world skills.** Anywhere parent-facing content uses a Fortnite term, the parent-facing skill comes first, with the Fortnite term in italicized parens so the kid can still verify with Tim. Example: "Defensive building under pressure — trains spatial planning and multi-step execution. *(Fortnite term: tunneling.)*" Generic Fortnite jargon in parent emails is a launch blocker.
5. **No fabricated citations.** Any specific study, statistic, or scholarship number in marketing copy must be verified against the primary source before it goes live. See `parent-upsell-copy.md` for the current draft with `[VERIFY]` flags.
6. **Don't over-build the editor.** Lessons are web-native (slides as JSON + per-slide audio MP3s), not .pptx files. During MVP, Tim makes lessons in Google Slides + records audio in QuickTime. The custom in-browser editor is phase 2, after MVP has revenue.
7. **Mobile-first across all surfaces.** Every page — marketing, kid portal, parent dashboard, Tim's admin — must work on a 320px wide phone. Design tokens (fonts, colors, breakpoints, rarity palette) are inherited from `archive/index.html` (now codified in `src/app/globals.css` + `tailwind.config.ts`). See Design system & PWA below.
8. **No dash characters in any user-facing copy.** No em dashes (—), no en dashes (–), no hyphens (-) anywhere a parent, kid, or visitor sees rendered text: marketing pages, transactional emails, push notifications, in-app UI labels, error messages, parent-facing translation strings. Replace with periods, commas, "to", spaces, or closed compounds (e.g., "Unreal-ranked" → "Unreal ranked", "Mid-Week" → "Midweek", "30-min" → "30 min", "Mon–Tue" → "Mon to Tue", " — " → ". " or ", "). Exempt: code identifiers (CSS class names, HTML IDs, file names), URL slugs, internal dev docs (CLAUDE.md, code comments, decision memories). Memory: `feedback_no_dashes_in_user_facing_copy.md`.

---

## Locked product decisions

### Account & trust model

- **Heavy parent trust signals.**
  - Parent has read-only access to ALL messages between kid and Tim. Kid sees a visible "Parent can read this" indicator — no hidden chat.
  - Parent CC'd on every session reminder and post-session note.
  - All Discord interaction happens in a dedicated coaching server with a private channel per client. Parent is invited as observer. No DMs ever.
  - Every coaching call is recorded (Tim records locally, uploads after — simpler than running a Craig-style bot). Parent can stream/download from portal.
- **Curriculum approval is monthly, not per-lesson.**
  - Parent approves a 4-week curriculum plan once. Tim can swap individual lessons within an approved curriculum without re-approval.
  - Why monthly: per-lesson approval breaks Tim's weekly rhythm if parent goes quiet; monthly satisfies oversight without weekly friction.
- **Separate linked parent + player accounts under one family record.**
  - One Family / Client Account holds the Stripe customer. Each Player Profile under that Family has its **own subscription** (one $56/mo subscription per kid — see Multi-kid families below).
  - Parent Profile: own login, billing, cancel, approval queue, message audit, call recordings.
  - Player Profile: own login, XP bar / lesson progress / messages with Tim.
  - Kid can log in independently; parent has full read access plus exclusive billing access.
- **Login for kids without their own email** (especially under 13): magic links go to the parent's email. Parent forwards/shares with kid or clicks for them. Long session persistence (30 days) so kid doesn't have to re-trigger constantly.
- **COPPA (age <13):** intake auto-detects age <13 and gates everything on a parent-email verification BEFORE any kid data is collected. For 13+, parent email is required but no verification gate.

### Multi-kid families

A Family / Client Account can have 1+ Player Profiles. The data model supports multi-kid from day one — actual multi-kid families aren't expected pre-MVP, but the schema is built so the first one doesn't force a migration.

- **One subscription per kid**, not per family. Each Player Profile has its own $56/mo Stripe subscription tied to the Family's `stripe_customer_id`. Each kid has their own 4-lesson cycle, own `cycle_cancels_used`, own curriculum, own cancellation history. Cycles drift independently as each kid takes their own breaks.
- **Same price per kid: $56/mo. No sibling discount.** Tim does fully separate work per kid (separate curriculum, separate PowerPoints, separate live calls); pricing reflects that. Revisit only if/when a real sibling situation surfaces a strong reason to change it.
- **12-cap counts by kid, not by family.** A 2-kid family occupies 2 of Tim's 12 slots, books 2 separate free calls, and is taken on with 2 separate "Take [name] on" clicks. Marketing-site count stays a count of kids.
- **One private Discord channel per kid.** Jake's channel is Jake's, Mia's is Mia's. Parent is invited to both as observer (per the trust model: no DMs, all interaction in dedicated channels). Siblings don't see each other's coaching content — a kid would hate that, and the trust posture says each kid gets their own private space with Tim.
- **Parent dashboard** shows a kid selector — single login, single billing surface, one tab per Player Profile. Each kid's quest log, lesson library, message thread, and cycle state are kept separate per kid.
- **Adding a second kid:** an existing-parent doesn't redo the full intake. From the parent dashboard, **[Add another kid]** opens an abbreviated form (kid's first name, age, Fortnite username, Discord username, current rank, platform) → books a separate free call → enters Stage A trial flow. Same Stage C "Take on" conversion path from there.
- **Cap-aware second-kid flow:** if a parent tries to add a kid while Tim is at 12, the **[Add another kid]** CTA flips to **[Join waitlist for (Kid's name)]** — same waitlist mechanic as new families. FIFO regardless of existing-customer status; Tim can manually skip if he wants.

### Capacity & waitlist

**The cap**

- **Hard cap: 12 concurrent paying kids** (not families — see Multi-kid families above). Tim's bandwidth limit. Surfaced as an authentic scarcity signal on the marketing site ("Limited to 12 students. X spots open.") — auto-updated from DB so Tim never has to manually flip a "we're full" banner.
- **Counted toward the 12:**
  - Active paying subscriptions — YES
  - Pending-conversion ("Take Jake on" clicked, Stripe charge in flight) — YES
  - **Waitlist offer pending** (offer email sent, 48hr link still valid) — YES; the slot is reserved while the family decides, preventing parallel offers
  - **Trial-from-waitlist** (waitlist family claimed offer, trial call booked) — YES; they're filling the just-vacated slot
  - Trial-booked from general intake (i.e. while intake was open) — NO; these trials only exist with cap headroom. If cap fills before Tim gets to them, he declines or invites them to the waitlist at "Take on" time.
- **At 12, the intake CTA becomes "Join waitlist."** Form collects parent email + kid's first name + age. No Calendly booking, no payment, no account created — just a notify-when-open signal.
- **Cap enforcement on "Take on" click:** if accepting would exceed 12, Tim sees: *"You're at capacity. Decline a current client first, or send this family the waitlist invite."*
- **Tim's admin counter** prominent on his dashboard: `8/12 paying · 1 pending · 3 trials this week · 4 on waitlist (oldest 23 days)`.

**Joining the waitlist**

- **Confirmation email at signup:** *"You're on the waitlist for [Kid's first name]'s coaching slot. Tim's capped at 12 students. We'll email you the moment a spot opens, and you'll have 48 hours to book your free call. Reply STOP to be removed."*
- **No position number in any waitlist email** — avoids ranking anxiety (a "#15" tells a family to give up).
- **No portal/dashboard for waitlist families** — they don't have accounts yet. All communication is email.

**When a spot opens**

Trigger: voluntary cancel, dunning auto-end, Tim declines a current client, or cancel-#3 auto-confirm.

- Next-in-line family is emailed a unique free-call booking link, valid **48 hours**. 3-email sequence:
  1. **Hour 0 — Offer:** *"A spot opened. Book your free call → [link]. Valid for 48 hours."*
  2. **Hour 24 — Reminder if unclicked:** *"The spot we offered you yesterday is still open, but it goes to the next family tomorrow."*
  3. **Hour 48 — Expiry if unclicked:** *"We've passed the spot to the next family. You're still on the list for the next opening."*
- If claimed: family enters Stage A trial flow as normal. They occupy the slot through their trial (counts as trial-from-waitlist).
- If Tim declines them post-trial: slot reopens, next waitlist family gets the offer.

**Periodic list freshening**

- Every 60 days: *"Still interested in coaching for [Kid's first name]? Reply YES to stay on the list, STOP to be removed."*
- Quiet removal after 14 days of no response — keeps the list from rotting with ghost families.

**Tim's controls**

- Manual remove from waitlist (bad contact info, family reached out separately, etc.)
- **No reorder, no skip controls for MVP.** Strict FIFO. If priority handling matters later, add it.

### Intake — Stage A (booking the free call)

- **Fields:** kid's first name, age, Fortnite username, Discord username, current rank, platform, parent's name, parent's email. That's it.
- **UX is game-like.** 4-level flow with rarity colors (uncommon green → rare blue → epic red → legendary orange), XP bar that fills between levels, "+25 XP" floats on completion, level-up sound (muted by default with toggle).
- **Level 1 — Player Profile** (uncommon green): kid's first name, age, Fortnite username, Discord username.
- **Level 2 — Skill Check** (rare blue): current rank, platform, hours/week.
- **Level 3 — Parent Contact** (epic red): parent's name + email. Under-13 → verification gate appears here.
- **Level 4 — Schedule Call** (legendary orange): Calendly embed.
- **On submit:** confetti, "Achievement Unlocked: Free Trial Booked," magic-link emails to kid + parent, Stage B prep work goes live in the portal.
- **Account is created at booking, in `trial` state until first payment.**
- **Save progress between steps** (auto-save to localStorage). Mobile-first — each level is one screen.
- **Primary form-filler is the parent**, but kid questions addressed in second person ("What's *your* Discord username?") — assumes kid + parent at the kitchen table.

### Post-booking portal (trial state — kid view)

- Greets the kid by first name, shows live countdown timer to the free call (matches existing marketing-site countdown style).
- "Join Discord call →" button is grayed until 15 min before the call.
- **Quest Log** replaces the standard "post-booking email with prep questions":
  1. Sign up (auto-completed at booking, +25 XP)
  2. Drop a VOD — *"Paste a clip from a recent ranked game you wish had gone better. Tim watches before the call."* (+25 XP)
  3. Answer 3 quick questions (~2 min) (+25 XP) — see "Stage B prep quest content" below for the questions
  4. Join Tim's Discord (+25 XP)
- Locked sections visible but grayed: Lesson Library, Message Tim.
- Footer: plain-text reminder "Your parent (Sarah) can see your messages and quests."
- Sound effects muted by default with toggle in nav.

**Why quest log over email:** keeps the kid engaged in the 3–7 day gap between booking and call, Tim doesn't have to chase email replies, Tim's admin shows prep readiness at a glance per client. The *"wish had gone better"* VOD phrasing is deliberate — anchors the kid on a specific moment of frustration, which is exactly what Tim wants to coach on.

A single welcome email still goes out (to deliver the magic link), but the prep work lives in the portal.

### Stage B prep quest content

Three questions, ~2 min total. Tap-card single-select for Q1 and Q2, free text for Q3. Tone is professional in writing — the live call is where Tim and the kid get real with each other.

**Q1 — What's the most frustrating thing about your game right now?** *Tap one. Selecting "Something else" opens a 1-sentence text box.*
- I lose fights I should win
- My building or edits are too slow
- I keep getting third-partied
- I tilt and start playing worse
- I'm stuck at the same rank
- I watch streamers but I can't actually do what they do
- Something else

**Q2 — Where are you trying to get to?** *Tap one. Selecting "Something else" opens a 1-sentence text box.*
- Just stop dying so fast
- Beat my friends consistently
- Hit Unreal
- Top 10K in a Cash Cup
- Make it to FNCS (Fortnite Champion Series)
- Win prize money in comp
- Something else

**Q3 — Watch your clip one more time. What should have happened differently?** *Free text, 1–3 sentences.* Subtext: *"Even one word is fine — Tim just wants to see how you watch your gameplay."*

- **Quest order is enforced:** Q3 unlocks only after the VOD-drop quest is complete, so the clip exists for the kid to rewatch. Quest 3 (Answer 3 quick questions) cannot start until Quest 2 (Drop a VOD) is done.
- **What Tim gets:**
  - **Q1** surfaces the kid's own diagnosis — sets the call's opening topic.
  - **Q2** surfaces aspiration level and realistic ceiling. "Hit Unreal" vs "beat my friends" needs different framing in the call.
  - **Q3** surfaces self-awareness depth. Combined with the actual VOD, Tim can see whether the kid's diagnosis matches reality. A one-word answer from an 8yo is still signal; a 14yo who blames teammates / lag / RNG needs a different opening conversation than one who says "I should not have pushed."

### Post-booking portal (trial state — parent view)

Calm and informational, NOT gamified (parent isn't a player).

Sections:
- Free call scheduled card (date, "Add to calendar," "Reschedule" via Calendly).
- Mirror of the kid's prep checklist with "Nudge by email" buttons per incomplete quest (templated email to the kid, doesn't involve Tim).
- "What to expect" — 30 min on Discord voice, Tim watches the VOD beforehand, no charge unless they subscribe after, $56/mo for 4 lessons, 24hr-cancel = full credit, all Discord in private channel with parent access.
- "Your controls" panel — Billing / Call recordings / Message audit (all visible but empty in trial state) + Cancel trial link. Empty state intentionally shows what *will* be there so it feels familiar when it fills in.
- "Questions before the call? Email Tim: …"

### Tim's admin during the trial window

- Upcoming Calls list with prep-completion indicator per client (e.g., "Prep: 3/4").
- New Trial cards pinned at top with one-click "Create Discord channel" + "Message parent" buttons. (Tim manually creates the channel in his server and pastes the invite URL into admin — no Discord bot integration for MVP.)
- Active Clients list + Revenue MTD.

### Stage C — the conversion moment (post free call)

- **Tim-initiated.** After the call, Tim's admin gives him three options on the kid's card:
  1. Take Jake on — opens curriculum drafter
  2. Not the right fit — sends kind decline + recommends free creators (e.g. Mero, Reet, Pandvil)
  3. Still deciding — talk to parent first
- **"Take Jake on" requires Tim to draft a 4-week curriculum** (picks 4 lesson topics, optional VOD checkbox per week) + write a 2-sentence personalized note. **Why:** the conversion email becomes "here's the 4-week plan I have in mind for Jake — subscribe to lock it in," not just "subscribe please." Personalizes the pitch + satisfies curriculum approval upfront.
- **Parent's conversion email** uses the parent-translation rule: each week shows the real-world skill it builds with the Fortnite term in italicized parens. Single CTA: "Approve plan & subscribe" → `/curriculum/[token]` landing page → Stripe Checkout. Cancellation policy stated plainly.
- **Conversion screen** at `/curriculum/[token]` renders the 4 weeks + Tim's personalization note + billing terms, single "Approve plan and subscribe" button → Stripe-hosted Checkout in `payment` mode (one-time $56). Tier is fixed at MONTHLY $56 (no SINGLE LESSON $14 path in MVP). Hosted Checkout chosen over embedded Stripe Elements for first-cut speed; swap is a one-endpoint refactor when polish time comes.
- **Payment architecture (locked):** **one-time `PaymentIntent`s against a saved card. NO Stripe Subscription object.** First cycle uses `checkout.session.create({mode:'payment', payment_intent_data:{setup_future_usage:'off_session'}})` so the card is saved on the Customer. From cycle 2+ the `cron-auto-renew-detection` Edge Function fires `stripe.paymentIntents.create({customer, payment_method, off_session:true, confirm:true, amount: 5600})` against the family's default saved card. **Reason this beats a Stripe Subscription:** the billing cycle is "$56 every 4 lessons delivered," not "every 30 days." Stripe's recurring engine is calendar-driven; ours is delivery-driven. Cron-fired PaymentIntents let us pause cleanly during dunning + coach cancels + parent skips without fighting Stripe's billing rhythm. The trade-off is we own the renewal trigger and idempotency (`subscriptions.renewal_pi_id` is set the moment the PI fires, cleared by webhook on settle either way; double-fire protected).
- **Cycle definition:** `cycle_started_at` + `cycle_lessons_delivered` (0–4) + `cycle_skips_used` (0–10 sanity bound). When `cycle_lessons_delivered=4` AND `auto_renew_enabled=TRUE`, the auto-renew cron fires the next $56 PI. The `payment_intent.succeeded` webhook calls `provisionNextCycle()` which marks the old curriculum `completed`, lays down the new curriculum + 4 slots (library-driven, see "Library-driven auto-renew" in Done), and resets counters. Failure routes to `lifecycle_state='PAST_DUE'` (see Lifecycle states below).
- **Kid's portal during this window:**
  - Awaiting Tim's decision: quest log shows "Tim is reviewing your session. Check back soon."
  - Conversion approved: big "ACHIEVEMENT UNLOCKED · LEVEL 2 · ACTIVE PLAYER" moment with confetti, trial badge replaced, first lesson countdown to Sunday appears, 4-week curriculum visible.
  - Conversion declined: graceful "thanks for trying" screen with Tim's recommended free creators. Account stays open.

### Cancellation policy: skips + reschedules (unified model)

The MVP shipped a unified "skip" model. There is no separate "credit" surface, no `cycle_cancels_used` counter, and no immediate-end-subscription path on the 3rd cancel. Replaces an older 2-credit / 3rd-cancel-ends design that never shipped.

- **Two cancel paths, both reconciled through the same backend:**
  1. Parent dashboard `/portal/sessions` → per-slot **[Reschedule]** button → modal with state A (>=24hr, free reschedule) or state B (<24hr, forfeit).
  2. Native Calendly cancel/reschedule link in booking confirmation emails → webhook handler classifies same way.
  - **Calendly's cancel/reschedule window must be opened to 0hr on the paid-lessons event type** so all cancels reach our webhook. Our backend governs the 24hr rule, not Calendly. (Intro-call event type is free with no cycle math; its cancel window doesn't matter.)
- **State A (>=24hr ahead, free reschedule):** parent picks a new time in the Calendly embed inside the reschedule modal. New `live_call_at` + `live_call_event_id` written. Cadence preserved if new time is within 168hr of original; if >168hr, **consumes one skip** (cycle pushed forward).
- **State B (<24hr ahead, forfeit):** call is cancelled in Calendly via REST + slot's `live_call_event_id` sentinel-marked (`cancelled:<original>`). `cycle_lessons_delivered` advances (kid keeps materials), **`cycle_skips_used+1`**.
- **No-shows** mark `curriculum_slots.no_show_at`, default to charge-as-skip (`cycle_skips_used+1, cycle_lessons_delivered+1`), tracked separately in the `call_outcome_pending` Focused Home task so Tim sees patterns. Tim can flip a no-show to courtesy pass (no skip charge, cycle pauses one week) from `/admin/calendar` if a legitimate reason surfaces.
- **Skip allowance: 2 per 4-lesson cycle. 3rd skip triggers `auto_renew_enabled=FALSE`.** Subscription **completes the current cycle to lesson 4 normally**; auto-renew cron then transitions to `canceled` instead of charging the next $56. No immediate-end-subscription confirmation flow — parent can re-enable auto-renew any time from `/portal/billing` while the cycle is still running. Cap resets each cycle.
- **Grace recovery:** when a future cycle runs with `cycle_skips_used=0`, `auto_renew_enabled` flips back to TRUE silently. Parents who had one bad month get a clean reset without ever having to ask.
- **Reschedules do NOT count toward the cap** (free reschedule branch). Same-week reschedules preserve cadence. Cancel-after-reschedule consumes a skip.
- **Coach-initiated cancels** (Tim) live in `coach_cancels` table, never touch `cycle_skips_used`. Three locked reasons: `sick / out_of_control / need_to_reschedule`. Two surfaces: proactive from `/admin/calendar` (24hr gate enforced) + reactive from the post-call outcome panel (no gate, emergency path). Parent gets a "pick a new time" email pointing at the Calendly embed in `/portal/sessions` — no lesson lost.
- **Backend state on the subscription row (locked):**
  - `cycle_started_at TIMESTAMPTZ` — anchor for the current 4-lesson window
  - `cycle_lessons_delivered SMALLINT 0..4` — Sunday cron + outcome marking advance this
  - `cycle_skips_used SMALLINT 0..10` (sanity bound) — parent cancels + no-shows charge here
  - `cycle_timezone TEXT` — frozen at cycle creation, all cadence math runs in this tz
  - `auto_renew_enabled BOOLEAN` — flips FALSE at skip #3; flips TRUE on grace recovery
  - `auto_renew_off_acknowledged_at TIMESTAMPTZ` — Tim's "got it" stamp on the Focused Home awareness card
  - `renewal_pi_id TEXT` — set the moment the cron fires the renewal PaymentIntent; cleared by Stripe webhook on settle (idempotency)
- **Tim's admin** shows running state per client: `Cycle: 3/4 · Skips: 1/2 · Auto renew on/off`. No Discord DM bot — operator notifications surface in-app on Focused Home only (see `feedback_no_discord_dms.md`).

### Lifecycle states (locked)

Operationally load-bearing. Every subscription has a `lifecycle_state` enum value distinct from the Stripe-flavored `status` field. State drives Home queue task surfacing, cron eligibility, and parent portal branching.

- `TRIAL_PREP` — intake complete, free call NOT yet booked or no `trial_call_at` recorded.
- `TRIAL_SCHEDULED` — free call booked via Calendly. Set by `invitee.created` webhook.
- `TRIAL_DONE` — `trial_call_at < NOW() - 30min`. Surfaces as `trial_decision` task on Tim's Focused Home (view does the lazy transition; no cron flip needed).
- `ACCEPTED_PENDING_SCHEDULING` — Tim took kid on. Parent has 4 slots to reserve.
- `SCHEDULING_IN_PROGRESS` — parent has reserved at least one slot but not all four.
- `PENDING_PAYMENT` — all 4 slots reserved, Stripe Checkout session created. 24hr window before slots release.
- `ACTIVE` — first cycle paid + first lesson delivered (or any subsequent active cycle).
- `PAST_DUE` — auto-renew PaymentIntent failed. Cycle freezes (no Sunday delivery, no charge to skip counter). Stripe Smart Retries don't apply here since we're not using Stripe's recurring billing; the `cron-day7-dunning-ping` + `cron-dunning-parent-reminders` crons drive the timeline.
- `PENDING_CANCEL` — legacy state retained for the `pending_cancel` workflow (used during the early-cancel-confirmation flow that the skip model superseded; still appears on a small number of rows from pre-rewrite data).
- `CANCELED` — terminal. Either auto-renew off + cycle completed, or 14 days dunning with no payment, or coach declined at Stage C.

**Distinct from `status`:** `status` is the Stripe-flavored field (`trial / active / past_due / canceled / declined`). `lifecycle_state` is the operational truth — what surface the parent sees, what task Tim sees, what cron is eligible. They're kept in sync by the Stripe webhook + Calendly webhook + outcome marking endpoints. When they disagree, `lifecycle_state` is canonical.

**`waiting_on` enum** (separate from lifecycle): `TIM / PARENT / KID / SYSTEM / DAD`. Denormalized onto `messages`, `subscriptions`, `curricula`, `cancellation_events`. Drives the Home queue. `DAD` is set by the Stuck button; the Dad admin's resolution flow flips it back to TIM, KID, PARENT, or SYSTEM.

### Coach cancellations (Tim's side)

Tim cancels for Christmas, July 4th, tournaments, illness. Two surfaces, both producing the same outcome for families.

- **Bulk: [Credit day] / [Credit week]** buttons in Tim's admin Calendar tab.
  - Day or Week picker, defaults to next eligible date.
  - Reason: dropdown + custom text. Options: Christmas break · Thanksgiving · July 4th · Spring break · Tim sick · Family emergency · Travel · Tournament · Other (custom).
  - **24hr gate:** Day picker disables any day where the earliest call starts within the next 24hr. Week mode shows "N calls in this week are within 24hr and can't be auto-credited — handle those individually" and excludes them from the batch.
  - Reason flows into parent emails and onto the affected week's lesson card in the parent portal so the kid sees context.
- **Individual: [Coach cancel] button on each call card** in Tim's admin. Bypasses the 24hr gate — this is the emergency path (Tim wakes up sick the morning of). Same reason dropdown.

Both paths produce:
- Family's cycle pauses 1 week (same mechanic as a parent >24hr cancel).
- **No impact on family's 2/cycle cap.** Tracked in `coach_cancels`, never increments `cycle_cancels_used`.
- Calendly event cancelled.
- Parent email: *"Tim is out for [reason]. This week is on him — your cycle pauses 1 week, no charge, no impact on your cancel allowance."*
- Audit row in `coach_cancels` with Tim's reason.

### Dunning & failed payment

- **Day 0 — Charge fails on cycle renewal.** Stripe webhook `invoice.payment_failed` → subscription marked `past_due` in our DB.
  - **Cycle freezes:** no Sunday PowerPoint, no mid-week call. Same mechanic as a coach-credit week — Tim's labor preserved, `cycle_lessons_delivered` stays put (e.g. 2/4 → 2/4). When payment resolves, the next scheduled lesson day picks up from there.
  - **Parent email** (branded, not Stripe's default): *"Your card was declined. We've paused Jake's lessons while you update payment. No charge, no impact on your cycle."* Prominent **[Update card]** → Stripe customer portal.
  - **Kid's portal:** *"This week's lesson is paused — Tim's holding your spot."* No mention of payment — same trust posture as the coach-cancel reason flow. Parent decides how/whether to explain.
  - **Tim's admin:** family card flagged amber `Payment hold · Day 0`. No Discord ping yet — transient declines are common, avoid noise.
- **Day 0–7 — Stripe Smart Retries.** Default retry schedule (~Day 3, 5, 7) runs automatically. Success any day → cycle resumes from the next scheduled lesson day. Branded reminder emails to parent at Day 3 and Day 6 (light touch, on top of Stripe's own retry emails which should be disabled in the Stripe dashboard so we own the voice).
- **Day 7 — Tim pinged.** Still failing after a week → Discord DM to Tim: *"Jake's family — payment failing 7 days. Want to reach out personally?"* Tim can post in the family's private Discord channel (parent-visible per the trust model).
- **Day 14 — Auto-end.** Still failing → subscription auto-ends. Parent email: *"We've paused Jake's subscription. His progress is saved. Restart any time."* Kid's portal shows the same state as a voluntary subscription end — no "your card failed" framing visible to kid.
- **First-ever dunning event for a family runs the same flow as a repeat decline.** Stripe's silent retries already handle transient bank glitches before any user-facing email fires; no special-case grace code.
- **Card expiration is separate from dunning.** Stripe's built-in expiring-card emails fire 30/15/7 days out — leave them on. No custom UI. If parent ignores and card fails on renewal → enters dunning Day 0.
- **Interaction with `pending_cancel`** (from the cancellation policy above):
  - `pending_cancel` suppresses billing → never enters dunning.
  - "Undo cancel and keep subscription" reactivates → next charge fires at the regular cycle boundary. If it fails → enters dunning Day 0.
  - If parent is mid-dunning and tries to cancel → cancel flows normally. The cycle was already paused, so cancel just ends the subscription; `cycle_cancels_used` is NOT incremented (no live cycle to spend a credit against).

### Parent communication (every email Tim sends)

- **Translation rule (above):** Fortnite term in parens, parent-facing skill first.
- **"For your back pocket" section at the end of every parent email.** 2-3 specific things the parent can say to the kid that build genuine connection — generated per-lesson, edited by Tim. Categories: informed observer, Tim-as-co-conspirator, cultural literacy, the good question, actually-impressive strategic note. Tone rules: parent asks (doesn't perform), Tim is a co-conspirator with the parent (never lectures the parent on parenting), never make the parent the butt of a joke, never script slang the parent has to pronounce. This is a strategic moat — other coaches teach Fortnite, nobody else turns coaching into a parent-kid connection mechanism.
- Sample lines (full set in `decision-parent-talking-points` memory):
  - *"Hey Jake — Tim said you're working on tunneling this week. That's where you build cover while still tracking the other guy, right? Show me what one looks like?"*
  - *"Tim told me to ask if you've stopped W-keying yet. He says it's still a problem."*
  - *"How was your endgame today — were you sweating or cracked?"*

### Notifications (Tim's side)

**No Discord DMs to Tim. All operator notifications surface in-app on Focused Home.** This is a hard policy override (2026-05-19) that supersedes the original Discord-bot architecture. See `feedback_no_discord_dms.md`.

- **Pre-call awareness** lives on Focused Home as the `call_outcome_pending` task once the call window closes + as the upcoming-call entry on `/admin/calendar`. Calendly's auto-created calendar invite is the immediate reminder; Tim has Calendly + Google Calendar on his phone.
- **Day-7 dunning + cancel-#3** surface as awareness cards on Focused Home (`past_due_opened`, `subscription_auto_renew_off`, `cycle_drag_out`). Calendar push notifications + the lime-accented Focused Home cards are the only operator-side signals; no system DM ever messages Tim.
- **Parent-side branded emails still fire** through every dunning + cancel + auto-renew transition. Resend (via `notification_log` audit). Discord stays the channel for *coaching content* (per-client private channels Tim runs manually); it is NOT a system notification channel.
- **SMS via Twilio is upgrade-later**, not MVP.

### Discord coaching server (manual setup, no system bot)

The Hard rule says coaching happens on Discord, not phone. Implementation today is **manual server management by Tim**, not an automated bot.

- Tim runs his own XPL Keyed coaching Discord server. Per-client private channels are created by hand. The channel invite URL is pasted into `/admin` via the inline form on each client card (`PATCH /api/admin/players/[id]` writes `players.discord_channel_url`).
- Parent is invited as observer when Tim creates the channel. Recording: Tim records calls locally (QuickTime), uploads to the platform later (see "What's not built" — upload UI doesn't exist yet).
- **Server template + channel naming convention + parent-observer role config + recording-bot setup are NOT documented** anywhere yet. For operator #2 this becomes a real deliverable; for Tim's n=1 it's tribal knowledge.
- **No XPL Keyed Bot exists.** The `DISCORD_BOT_TOKEN` env var is reserved in `.env.local.example` but nothing reads it. Earlier spec described a bot that DM'd Tim for 20-min reminders + Day-7 dunning + Cancel-#3 — that bot is **explicitly retired**. In-app notifications replaced it (see Notifications above).

### Parent-facing upsell ("why coached Fortnite actually builds your kid")

- Lives in three places at three lengths:
  1. One-sentence hook above the fold on the intake landing page.
  2. Full "Why this works" section above the intake form — 4 evidence-backed claims + a "what we don't claim" honesty panel.
  3. Expandable "The research" version in the parent portal — long-form with verified citations.
- **Tone: honest + slightly counterintuitive.** Includes a "what we don't claim" panel that explicitly says gaming alone won't raise grades. The trust move that distinguishes this from typical coaching upsell.
- **Draft copy with `[VERIFY]` flags is in `parent-upsell-copy.md`.** Launch-blocking: every citation must be fact-checked before publication.

### Lesson library schema

Three tables. JSONB used where structure is per-lesson-authored and never queried cross-row.

**`lessons` — the authored library**
- Per-lesson fields: `title` (internal Tim-facing), `fortnite_label` (kid-facing, e.g. "Tunneling"), `parent_label` + `parent_skill_description` (parent email translation pair from the Translation Rule, e.g. "Defensive building under pressure" + "Trains spatial planning and multi-step execution"), `topic` (hardcoded enum: building / editing / aim / game_sense / mental / tournament_prep), `difficulty_level` (beginner / intermediate / advanced / unreal), `duration_minutes`.
- `slides` JSONB: `[{ position, image_url, audio_url, speaker_notes }, ...]`. Slide PNGs exported from Google Slides; per-slide MP3s recorded in QuickTime; both uploaded to Supabase Storage with signed URLs.
- `parent_talking_points` JSONB: `[{ category, text }, ...]` with 5 categories — `informed_observer`, `co_conspirator`, `cultural_literacy`, `good_question`, `strategic_note`. Authored once when the lesson is created, reused every time that lesson is assigned.
- `author_id`, `is_published`, timestamps.

**`curricula` — a 4-week plan for a specific kid**
- `player_profile_id`, `status` (`pending_approval` → `active` → `completed` → `superseded`), `approved_at`, `approval_token` (magic-link backing the parent's "Approve plan" email CTA), `personalization_note` (Tim's 2-sentence per-kid note from Stage C).
- One `active` curriculum per kid at a time. Ongoing approval flow: Tim drafts curriculum N+1 mid-way through curriculum N, parent gets approval email, the next $56 charge is gated on the approval click — Sunday cron checks for an `active` next-curriculum before shipping lesson 1 of N+1.

**`curriculum_slots` — 4 rows per curriculum**
- `(curriculum_id, week_number)` unique (week 1 through 4). `is_vod_review` boolean. Mutually exclusive: either `lesson_id` is set OR (`vod_url` + `vod_talking_points`) are set.
- `lesson_id` weeks reuse the authored lesson's slides + parent talking points without copying.
- **VOD weeks:** `vod_url` is the kid's clip Tim is reviewing. `vod_talking_points` JSONB is custom per-VOD (same shape as `lessons.parent_talking_points`) — Tim writes 2–3 talking points specific to the kid's clip so the parent's "For your back pocket" email stays consistent in VOD weeks. Skipping them would break the strategic moat.
- `delivered_at`, `live_call_event_id` (Calendly event id), `live_call_at`, `live_call_completed_at`.

**Design choices and tradeoffs**

- **Slides as JSONB on `lessons`** (not a separate `lesson_slides` table). Slides are authored per-lesson and never queried across rows. Editor reads/writes the whole array atomically. Migrate to a normalized table only if slide-level analytics become valuable.
- **Topic taxonomy is a hardcoded enum** in app code, not a `topics` table. 6 values cover the curriculum philosophy; adding a 7th is a 5-minute code change.
- **Parent talking points live on the lesson**, not on each assignment. Authored once, reused per kid. VOD weeks are the one exception (per-VOD custom).
- **Asset storage: Supabase Storage with signed URLs** (not Google Drive links). Stable URLs, COPPA-safe per-family access control, in-portal experience stays on our domain. Tim's "Add lesson" form has file pickers that upload directly to a `lesson-assets/` bucket.
- **Translation pair lives on `lessons`**, not on `topics`. Per-lesson granularity matters: "Advanced tunneling" and "Tunneling basics" both map to the *Tunneling* Fortnite term but need different parent-facing skill descriptions.

### Design system & PWA

**Tokens — carry-forward from `index.html`.** Every surface uses the same CSS custom properties so marketing, kid portal, parent dashboard, and Tim's admin feel like one product.

- **Fonts:** Anton (display, uppercase, -1px tracking) + Inter (body)
- **Background stack:** `--bg #0B1538` / `--bg-2 #0F1B47` / `--bg-3 #142255` — always dark, never light
- **Primary accent:** `--lime #C7FF3D`
- **Rarity palette:** uncommon `#319236`, rare `#4C51F7`, epic `#C80715`, legendary `#F5A623`. Already mapped to intake levels; reused functionally for status badges (amber `Payment hold`, lime `Active`, epic-red `Cancel #3 pending`).
- **Glass-morph nav + buttons,** blob backgrounds on hero/CTA sections, scroll-reveal pattern (`.reveal` → `.is-visible`)
- **Breakpoints:** 991px (tablet), 767px (mobile, hamburger appears), 479px (small mobile)
- **Tap targets ≥ 44px** everywhere
- **`prefers-reduced-motion` respected** — disables blob drift, rarity-bar animation, scroll-reveal

**Tone by surface:**
- **Marketing site + kid portal:** full game-like treatment (rarity colors, XP bar, +25 XP floats, confetti, sound toggles)
- **Parent dashboard:** same fonts/colors, no gamification UI — calm and informational
- **Tim's admin:** same fonts/colors; functional rarity badges only; no XP/confetti/sounds

**PWA architecture.** Single Next.js app ships as a PWA for all three roles; each role installs from its own portal URL with a distinct icon/name in the manifest.

- **Push notifications:** Discord remains primary for Tim — he's on it 24/7, all 3 triggers fire there. Web push is an **additional** channel: each notification deep-links into Tim's admin (tap cancel-#3 ping → land on Jake's family card, ready to act). Two reliable paths.
- **Web push for kid + parent:** off by default, explicit opt-in prompt with clear value framing. Kid gets "new lesson dropped" / "Tim replied." Parent gets "approval needed for next 4 weeks" / "card declined" / "Tim sent your weekly email."
- **Offline (read-only):** service worker caches app shell + recent API responses. Tim offline can VIEW client list, today's calls, prep status, message history. New actions (send message, take on client, credit a week) blocked with a *"You're offline — try again when reconnected"* toast. No write queue, no sync engine, no conflict resolution — keeps the build cheap, covers the realistic spotty-wifi case.
- **Out of scope for MVP:** background sync, periodic background fetch, native wrappers (Capacitor / Expo). Revisit only if the iOS "Add to Home Screen" friction becomes a real adoption blocker.

---

## Long-term thesis: build, prove, sell

XPL Keyed is not just Tim's coaching business. **Tim's instance is n=1 of a sellable platform asset.** The end-state goal is to prove the operator-pair model in esports coaching, run it cleanly for 6–24 months with 1–3 operator pairs, then sell the platform to an acquirer with the legal, T&S, and capital infrastructure to scale it to hundreds or thousands of operators. Peter does not intend to run the platform indefinitely. Same exit-oriented framing as Elements of Chess; the two builds share a thesis with two case studies in two adjacent kids-services categories.

### What's actually being built

An acquirer is not buying revenue (they can build that). They're buying:

- **The parent-trust playbook** — the Hard Rules, the trust signals, the coaching server architecture, the translation pair (Hard Rule #4), the "for your back pocket" mechanism, the COPPA-safe intake.
- **The operator-pair pattern** — parent is the legal entity, kid is the talent, platform is the trust scaffolding. Tim + Peter are the canonical pair. This is the first structure in this space that is both legally clean and emotionally resonant. Outschool / Varsity Tutors / GamerSensei / Metafy tried adult-instructor models and missed the "same generation" magic; Roblox tried kid-as-creator without a parent layer and ate years of lawsuits. The operator-pair model threads that needle.
- **The content-distribution-to-customer flywheel** — Tim's organic TikTok comment funnel converting to free calls to paying clients. Proof that a kid coach's authentic expertise compounds without paid ads.
- **The tech stack** — multi-tenant operator economics, RLS by operator, Stripe Connect, white-label theming. Shared shape with Elements of Chess; Peter has built this machinery twice by acquisition time.

### Operator-pair structure (locked)

Every operator on the platform is a **parent-kid pair**, not an individual kid.

The **parent**:
- Holds the Stripe Connect account (a minor cannot sign Connect ToS).
- Signs the platform ToS as the operator-of-record.
- Is the legal entity for the small business (LLC or sole prop, their choice).
- Handles client-parent communication for escalations.
- Is the named adult on the coaching server, observable by client parents.
- Passes a background check (see pressure tests).

The **kid**:
- Provides the coaching expertise.
- Runs the day-to-day content (lessons, calls, messages).
- Operates under the same Hard Rules as Tim — no exceptions, no opt-outs.
- Is **never** the platform's contractor. The platform's only legal counterparty is the parent.

The **platform** (XPL Keyed today, likely "Keyed" or similar umbrella brand once operator #2 lands):
- Owns the infrastructure, the trust playbook, the brand standards.
- Charges each operator a platform fee (structure is a pressure test).
- Enforces the Hard Rules globally.
- Provides the recruiting funnel, the operator onboarding sequence, and the safety/compliance scaffolding.

**Tim's n=1 instance does NOT use Stripe Connect.** Tim runs on Peter's direct Stripe account during MVP. Connect onboarding adds friction with zero upside while there's only one operator pair, and Connect's payout architecture changes the PaymentIntent flow non-trivially. The Connect migration is queued for operator-#2 onboarding: at that point we'll add the `tenants` / `operators` table, scope every query, route per-subdomain, and stand up Stripe Connect for *both* Tim and operator #2 at the same time. Same migration pattern Peter has done on Day & Knight. Don't pre-build Connect for Tim alone.

**Re-examined 2026-05-22, decision reaffirmed.** Question raised: enforce a 30/70 split at the Stripe layer now via Connect (with Peter as both platform owner and tutor-side connected account). Conclusion: still no, for two reasons. (1) At n=1 Peter is on both sides — money would route from Peter's bank to Peter's bank, accounting noise with zero real-world flow change. (2) Tim is 14 and can't be the Connect ToS signer; the connected account would be Peter's, meaning Peter would have to stand up a SECOND Stripe account just to receive transfers from his FIRST. So the working model at n=1 is: full $56/cycle lands in Peter's platform Stripe; Peter pays Tim directly out of band (family-managed, not a product feature). The "tutor earnings dashboard" surface stays unbuilt — no point until Connect is real. **Working split number: 30/70 (locked 2026-05-22).** See pressure test #26 for the broader context. Tim-facing earnings UI revisits when Connect goes live.

### Hard age floor for operator kids: 13 minimum, 14 canonical

- **Under 13 as a coach is a non-starter.** 13 is the COPPA cliff; below it, the operator kid is themselves a regulated user, and the compliance burden compounds catastrophically.
- 14 matches Tim's age and the marketing framing. A 14-year-old coaching 8-to-14-year-olds is the sweet spot.
- Verification mechanism is a pressure test — self-attestation is the floor, but stronger checks (gov ID via parent, video verification call, tournament-result cross-check) are required before operator approval.

### Subdomain / branding structure (Option B, locked)

Each operator gets their own subdomain or domain branded around their kid (e.g. `jordan.keyed.gg` or `coachjordan.com`). `xplkeyed.com` stays Tim's. The platform brand is an umbrella, **not a marketplace** listing operators against each other.

Marketplace-style listings were rejected because they (a) pit operators against each other, (b) dilute each operator's individual brand, (c) create marketplace-platform liability exposure. SaaS-vendor-to-small-family-business is the structurally clean model — same shape as Elements of Chess.

### Geographic gating (initial)

- **US only at launch.**
- Add Canada / UK / Australia only after operator-pair pattern is proven and acquirer interest is real.
- EU (GDPR), Brazil (LGPD), China, and anywhere with hard child-labor regimes deferred indefinitely. Those are acquirer problems.

### The TikTok funnel (primary acquisition channel)

Tim's organic-comment strategy on Fortnite-creator TikToks is the platform's primary acquisition channel and its most valuable demo asset for the eventual acquirer. Tim is already posting expert tactical comments and pulling 200–400 likes per comment. Flywheel:

1. Tim comments expertly on Fortnite-creator TikToks → kids visit his profile.
2. Profile bio links to `xplkeyed.com`.
3. Site converts kid + parent to free intro call (Stage A intake).
4. Free call converts to paid lessons (Stage C conversion).
5. Satisfied clients reference back; Tim's content compounds.

**Tracked from day one** (hand-tracked spreadsheet → analytics later):
- Comments posted per week.
- Likes/replies per comment.
- Profile visits → site visits (UTM tag on bio link).
- Site visits → free call booked.
- Free call → paid conversion.
- Time from first comment exposure to paying client.

**Every viral comment is saved.** Tim screenshots each comment that pops off (the parent video, the comment text, like count, any replies). This becomes the operator-#2 playbook's first chapter: "Here are the 20 comments that got Tim from 0 to his first 10 clients." Single most valuable asset this business produces in 2026.

**Tim's safety as the funnel scales:**
- Hard Rule #1 (no photos of Tim) is non-negotiable, especially as audience grows. Pressure to "show face for engagement" will get louder; the rule does not bend.
- TikTok bio and profile scrubbed of school name, real last name, city, tournament results under real identity. "XPL Keyed, 14, Unreal, coaching at xplkeyed.com" is plenty.
- **Canned DM response** for every stranger-kid DM (TikTok, Fortnite party invite, Instagram): *"Hey! I only coach through my site so your parents can be involved. Have them check out xplkeyed.com and book the free call. Looking forward to playing with you there."* Tim builds this habit early. No off-platform coaching, ever.

### Intake throttling when the funnel turns on hot

Tim's cap is 12 active clients but the funnel will likely deliver more free-call requests than he can handle:

- Calendly free-call event capped at 5 calls/week.
- Intake form adds pre-screening fields (hours/week, rank, goal) so Tim filters to the ~30% most likely to convert.
- Overflow becomes operator-#2's pipeline once they exist; before then, overflow joins the waitlist mechanic.

### Operator recruiting funnel

- Navbar link on every operator's marketing site: *"Interested in starting your own business like this?"*
- Google form, **parent-facing primarily** (kid-facing version exists as a soft funnel that requires parent email before serious qualification).
- Form **disqualifies aggressively** — required fields like parent LinkedIn URL, day job, kid rank screenshot, BG check willingness, multi-choice on Hard Rules. Should feel slightly intimidating to a non-serious parent.
- Of every 100 submissions, target is 5–10 worth a real conversation, 1–2 worth onboarding. Form does the filtering automatically.

### Operator #1 (Tim) → Operator #2 sequencing

- **2026:** Tim's n=1 instance reaches 6–12 paying clients with clean operations, parent testimonials, zero safety incidents, clean P&L. TikTok funnel runs. Comment patterns documented.
- **Late 2026 / early 2027:** Operator #2 recruited from Tim's pipeline (overflow free-call families, recruiting form submissions, Tim's competitive Fortnite network filtered through parent screening).
- Operator #2 launches with 2–3 of Tim's overflow clients (pre-qualified soft handoff, framed as a choice: "Coach Jordan is also Unreal ranked and is taking new clients — want to meet him?").
- **90-day platform-supervised trial period** before full autonomy. See pressure tests.

**Do not** rebuild XPL Keyed as multi-tenant before operator #2 commits. Tim's instance stays single-tenant. When operator #2 signs, the minimum multi-tenant work happens then: tenants table, scoped queries, subdomain routing, separate Stripe Connect accounts. Same migration pattern Peter has done on Day & Knight.

**Do not** custom-build for operator #2's preferences. Hard Rules are non-negotiable. Branding, pricing, and curriculum content within those constraints are theirs. Platform-enforced rules vs. operator-chosen content is exactly the line that makes this acquirable.

**Do not** launch operator #2 for free. They pay something real from day one (low setup fee + low ongoing, or low monthly + low rev share). Acquirers want to see paying operators, not promotional ones.

### Acquirer pitch shape (target ~end of 2027)

> *"Keyed is the operator-pair coaching platform for esports. We've proven the model with our flagship operator (Tim, 14, Unreal ranked) running at full cap for 18 months with zero safety incidents and 70% retention. We've onboarded 2–5 additional operator pairs, each running clean under our trust playbook. Here's the parent-trust playbook. Here's the organic content-to-customer flywheel. Here's the operator-pair legal structure. Here's the tech stack. Take it from here."*

Plausible acquirers: Epic Games, Discord, Take-Two, EA, Chegg, Outschool, kids-services PE roll-ups. Same acquirer pool may overlap with Elements of Chess (kids-activities holding companies, ed-tech).

---

## What's still open (design conversation)

All major design topics are locked. New questions land here as they surface during the build.

## What's NOT built (known gaps in built reality)

Spec describes these as design-locked. Code does not implement them yet. Surfacing here so future-Claude doesn't assume they exist when reading the Locked Decisions above.

1. **Ongoing curriculum approval (cycles 2+).** First-cycle approval at Stage C is built (`/curriculum/[token]` magic-link + Approve plan and subscribe → Stripe Checkout). The Locked Decisions also say approval is monthly — i.e. every new 4-week curriculum needs parent approval before the next $56 charges. `provisionNextCycle` currently skips this; it lays down the new curriculum with `status='active'` and the auto-renew cron charges immediately. To honor the spec we'd need: (a) provision next curriculum as `pending_approval` instead of `active`, (b) email parent the new approval-token link, (c) gate the renewal PaymentIntent on `pending_approval → active`, (d) auto-cancel after N days of no approval. Not yet built; flag the gap before promising parents that every cycle is opt-in.
2. **Call recording infrastructure.** Spec says Tim records calls locally + uploads, parent can stream/download from `/portal`, with 12-month minimum retention purged at 24 months. Code: zero. `/portal` has a "Call recordings" empty-state card that never fills. Needs: upload UI on `/admin/calendar` event modal, Supabase Storage bucket with per-family RLS, signed-URL minting on parent read, retention cron. Pressure-test #13 (recording access matrix) is also unbuilt.
3. **Discord coaching server template.** Setup item #2 says "create the bot." No setup docs exist for the server template, channel-naming convention, parent-observer role config, recording-bot setup. For Tim's launch this is manual: Tim creates a per-family private channel by hand in his existing server and pastes the invite URL into `/admin` via the inline form on each client card. Operator #2 will need a documented template.
4. **iOS PWA Add-to-Home-Screen.** Manifest icons are SVG (Android-friendly, iOS ignores manifest icons). iOS uses `<link rel="apple-touch-icon">` which must be a 180×180 PNG; not added. If iOS is >50% of family users (likely), this is a real adoption blocker pre-launch.
5. **Analytics + TikTok funnel measurement.** Long-term thesis section says "hand-tracked spreadsheet → analytics later." The spreadsheet template is not in the repo. No UTM convention locked in for the marketing-site bio link. The TikTok comment screenshot library (Tim's "20 comments that got him to first 10 clients") has no storage path.
6. **`pending_intake_verifications` purge cron.** Unverified COPPA gate rows accumulate. Verified rows are deleted on `rpc_intake` success but expired/unredeemed rows sit. Low priority at 1–10 client scale; daily `DELETE WHERE expires_at < NOW() AND verified_at IS NULL` is a 5-minute task when it matters.
7. **Refund window enforcement.** Policy lives in ToS + email copy only. No Stripe-portal refund block for requests > 60 days post-charge. Build when the first refund flows.
8. **Day-7 unscheduled auto-cancel for scattered renewals.** `cron-scheduling-abandonment` reminds but doesn't auto-cancel post-charge unscheduled families.
9. **Calendly auto-booking of uniform predicted times.** Auto-renew sets predicted `live_call_at` but doesn't create real Calendly events. Parent has to manually reschedule into a real slot.
10. **Multi-tenant migration for operator #2.** `tenants` / `operators` table, RLS scoping, subdomain routing, Stripe Connect onboarding. All deferred per "do not rebuild as multi-tenant before operator #2 commits."
11. **Parent `/portal/progress` enhancements (deferred 2026-05-22).** The page now branches on lifecycle phase (trial / onboarding / active / history — see the Done entry "Parent /portal/progress: phase-aware rework") and surfaces what we have data for in each phase. Three planned enhancements were *intentionally deferred* because they need either new schema or a workflow change Tim doesn't have bandwidth for yet:
    - **Rank progression over time.** Needs a `rank_snapshots` table (player_id, rank, recorded_at, source) plus a workflow for who enters it. Cleanest design: Tim updates the kid's current rank during lesson recap on `/admin/calendar` (extends the post-call outcome form with a rank picker), writes a snapshot row, the parent progress page renders a sparkline / step chart. Alternative: kid self-reports on `/play`. Build when Tim is ready to add the recap step.
    - **Milestones.** Designed as either a separate `milestones` table OR derived heuristically from `curriculum_slots.coach_note` text (e.g., flag a slot's note as a milestone moment, surface it on /portal/progress). Cheaper path is a `coach_note_is_milestone` boolean on the slot — one extra checkbox in Tim's outcome form, zero new schema beyond a column. Defer until Tim has a few real "moment to celebrate" scenarios.
    - **History view detail.** Canceled/declined families currently see a simple "Coaching ended" / "Trial wrapped" card plus their preserved attendance + cycle history. Richer history could include: per-cycle parent talking-point archive, downloadable lesson library snapshot, a "what they accomplished" summary. Not load-bearing while we have zero history families; revisit when the first family wraps and the experience matters.

---

## Build phases (proposed MVP, ~4–6 weeks of focused work)

For 1–10 clients. Manual fallbacks are OK; we'll automate as it hurts.

1. **Foundation** (week 1) — Next.js + Supabase scaffold, auth, DB schema, deploy.
2. **Intake + payments** (week 1–2) — Game-like Stage A form → Supabase user + Stripe customer + Calendly intro link. Stripe Elements subscription checkout.
3. **Client portal** (week 2–3) — Kid login (gamified, quest log), parent login (calm dashboard), web-native lesson viewer (renders slides from JSON + plays per-slide audio), messaging with parent-visibility indicator.
4. **Tim's admin** (week 3–4) — Client list with prep indicators, curriculum drafter, lesson assignment, message inbox, revenue dashboard, coach notes, post-call action panel (Take on / Decline / Still deciding).
5. **Automation** (week 4) — Sunday cron (assigns + emails with translated curriculum + "back pocket"), 24hr-cancel enforcement via Calendly webhook + Stripe credit, payment failure handling, Discord DM bot for 20-min reminders.
6. **Custom editor** (phase 2, several weeks later) — Web-native editor with per-slide audio recording, PDF export. MP4 export later. .pptx export only if a real user need surfaces. During MVP, Tim makes lessons in Google Slides + records audio in QuickTime.

---

## Pressure tests before operator #2

Open work items to flush out before the platform takes on a second operator pair. **None of these block Tim's n=1 launch** — Tim's instance can run safely under the existing Hard Rules without any of these resolved. They become blockers the moment the operator-recruiting form goes live and a second pair is in serious conversation.

**Safety of minors is the dominant lens.** Every item below is "what could go wrong, and how do we make it not." The platform's defensibility — and its acquirability — depends on getting this right at n=1 so the structure is provable at n=2.

### Coach-side safety (operator kids)

1. **Hard age floor enforcement: 13 minimum, 14 canonical.** Self-attestation is the floor. Stronger layers: parent uploads kid's school ID or passport, live verification call with Peter (sees the kid on video, confirms age-appropriate), tournament-result cross-check (Unreal ranked players are documented in public bracket sites). Lock the verification stack before operator #2 onboards.
2. **Identity scrub protocol.** Every operator kid gets a pre-launch checklist: school name removed from all social bios, real last name removed, city removed, tournament results scrubbed of real-identity links. Platform provides the checklist and audits before the operator's site goes live. Periodic re-audits (quarterly) as audiences grow.
3. **No-DM rule enforcement and spot-check.** Every operator kid signs the no-DM rule in onboarding and is issued the canned response script. Platform spot-checks: occasional search of operator kid's TikTok / Discord / Instagram for evidence of off-platform coaching. Violation = warning → suspension → termination.
4. **No-photo rule extends to all operator kids.** Hard Rule #1 was specific to Tim; it generalizes platform-wide. No headshots, no face-cam streams, no avatars depicting the kid. Operator marketing sites use the same visual treatment as `xplkeyed.com` (rank-as-credential, not face).
5. **Coaching server template.** Every operator runs their own Discord server, not a shared one. Platform provides a template config: required channels, required roles, required parent-observer setup, required recording bot. Operator cannot deviate without platform approval.
6. **Operator-kid welfare check.** If an operator kid shows signs of burnout, parent neglect, or behavior suggesting the parent isn't doing the work (parent unresponsive, kid taking too many clients, recording quality degrading), platform escalates. Document the trigger thresholds and the protocol — probably starts with a private check-in call with the parent.

### Coach-side safety (operator parents)

7. **Operator parent background check.** Required before onboarding. Provider candidates: Checkr ($30–60/check, modern API), Sterling, GoodHire. Lock the disqualifier list: sex offender registry (hard no), violence convictions past 10 years (hard no), financial fraud convictions (hard no), recent DUIs (case-by-case). Renewal: annual. Funding: platform absorbs, baked into setup fee.
8. **Operator parent identity verification.** Stripe Connect KYC handles payout identity. Additional layer: video call with Peter before approval. Confirms parent is real, articulate, organized, understands the trust model, will be the named adult on the coaching server.
9. **Written operator agreement.** Contract every operator parent signs. Includes Hard Rules verbatim, code of conduct, recording retention policy, incident reporting obligations, indemnification, termination conditions, dispute resolution. Lawyer review (see #19).
10. **90-day supervised trial period.** Every new operator runs 2–3 clients for 90 days with closer platform oversight: weekly check-in call, platform reviews recorded sessions, platform reviews chat threads, platform shadow-replies to client-parent escalations. Operator graduates to full autonomy only after a clean 90 days.

### Client-side safety (kids being coached)

11. **COPPA intake stress test.** Re-read Stage A intake specifically through the lens of "this user is 10 and got here from a TikTok comment, no parent in the room." First field after age disclosure must be parent email, gated; no other data collected from the kid until the parent acts. Verify the existing design holds.
12. **Parent email verification for under-13 intake.** What stops a 10-year-old from typing a fake parent email and continuing? Magic-link verification before any further data is collected. Confirm and harden.
13. **Recording access and retention.** Who can access call recordings, for how long? Lock the matrix: client parent has read access via portal; platform (Peter) has admin access for audit; operator parent has access to their own kid's recordings only. Retention: 12 months minimum (incident investigation), purge after 24 months unless flagged. Document in privacy policy.
14. **Anomaly detection.** Platform-level monitoring: operator kid messaging client kid outside the coaching server, operator parent not responding to client parent within 48 hours, operator kid exceeding stated client cap, unusual cancellation patterns, recordings deleted before retention window. Each anomaly fires a platform alert to Peter.

### Incident response

15. **"Report a concern" mechanism.** One-click in the client parent dashboard plus a public `safety@` email. 24-hour platform response SLA. Escalation tree: acknowledge within 24h → triage within 48h → decision within 7d → operator suspension during investigation if warranted.
16. **Operator off-boarding protocol.** If an operator is removed, how do their clients transition? Options: refund remaining cycle and release, transition to another operator if available, platform takes over temporarily (only viable if Peter can backfill). Lock the parent communication script: honest but not alarming.

### Legal, insurance, tax

17. **Lawyer review before operator #2 onboards.** Specialty firm in children's online business. Specifically reviewing: operator agreement, platform ToS, privacy policy, COPPA compliance, FLSA exposure on operator kids, multi-state nexus, indemnification structure. Budget several thousand dollars.
18. **Platform insurance.** General liability, cyber / data breach, errors & omissions. Quote multiple carriers; specialty kids-services carriers exist.
19. **State child-labor compliance audit.** For each state where the platform has an operator: work permits, school-night restrictions, hour caps. California is among the strictest. May restrict which states we accept operators from initially.
20. **Tax structure for operators.** Each operator parent files as their own small business (LLC or sole prop). Platform issues 1099s where appropriate. Multi-state nexus grows as operators join — accountant review.

### Trust signals visible to client parents (non-Tim operators)

21. **Operator profile page standards.** Every operator's marketing site displays the same trust badges: "Parent background check verified," "Coach age verified," "All sessions recorded and parent-accessible," "Platform safety promise." Standardized so a client parent reading two operator sites sees the same guarantees.
22. **"What happens if there's a problem" public page.** Explains the incident response, the platform's role, the safety guarantees. Mandatory link in every operator-site footer.

### Quality assurance

23. **Mystery-shopper trial calls.** Platform periodically books a free trial call on each operator under a fake family identity to verify call quality, trust signals, conversion script. Quarterly minimum.
24. **Client parent NPS.** Survey at 30, 60, 90 days post-conversion. NPS below threshold flags the operator for platform review.
25. **Platform-level satisfaction guarantee.** If an operator violates the Hard Rules, platform refunds the family directly and disputes with the operator separately. This is a trust signal AND a structural enforcement lever.

### Economic structure

26. **Platform fee structure.** **Working number locked 2026-05-22: 30/70 rev share (30% platform / 70% operator-pair).** Revisit only if pressure-test data forces it. The number is per-cycle revenue, applied at Stripe-charge time once Connect is live. **Enforcement is deferred to operator-#2 onboarding** — at n=1 Peter is on both sides of every charge (platform owner AND parent-operator), so Stripe-layer split enforcement would route money from his bank to his bank for zero accounting benefit. Tim's instance therefore: Peter holds the full $56 per cycle in his platform Stripe, pays Tim directly out of band (allowance / savings / family-managed, not a product feature). When operator #2 commits, do the Connect migration as one coherent operation alongside the dedicated business bank swap — that's when the 30/70 enforcement becomes load-bearing because there's a different family on the other side. Original alternatives (flat monthly, hybrid, setup fee + low ongoing) preserved here as fallback if 30/70 doesn't hold up under acquirer scrutiny.
27. **Setup fee for new operators.** One-time fee to qualify-out non-serious operators. EOC analog: Edwin paid $500/mo with a free first year. XPL Keyed setup is probably $500–$2,000 one-time. Pressure test the number against operator-funnel conversion.

### Recruiting form

28. **Parent-side qualifying questions.** Draft set: LinkedIn URL, day job, willingness to handle Stripe Connect setup, response time commitment, multi-choice on the Hard Rules (basic comprehension quiz), willingness to undergo background check. Should feel slightly intimidating to a non-serious parent.
29. **Kid-side qualifying questions.** Rank screenshot (not self-reported), tournament history if any, why they want to coach, explicit agreement to no-photo and no-DM rules.
30. **Application volume vs. throughput.** Target: of 100 submissions, 5–10 worth a real conversation, 1–2 worth onboarding. Build the form to do that filtering automatically — Peter's time is too scarce to vet hundreds manually.

### Sunset planning

31. **Operator kid aging out.** When an operator kid turns 18, they're an adult coach. Does the parent stay as operator-of-record, or does the kid take over the Stripe Connect account directly? Probably the latter — kid transitions to a standard adult-coach model, parent steps back. Document the transition flow.
32. **Operator kid quitting.** If the kid loses interest and the parent wants to keep going, that's no longer an operator pair — it's an adult tutoring business in a different category. Platform should require close-out (refund or transition clients), not allow the operator pair to morph into something the platform was never designed for.

---

## Project layout

```
XPL_Keyed/
├── CLAUDE.md                       ← this file
├── parent-upsell-copy.md           ← parent-facing "why this works" upsell, three lengths + [VERIFY] flags (dash-free per Hard rule #8)
├── archive/
│   └── index.html                  ← original static marketing design, kept for parity reference (do not edit)
├── package.json                    ← Next.js 15 + React 19 + Supabase + Stripe + Resend + Serwist (PWA)
├── tsconfig.json
├── next.config.ts                  ← Serwist (PWA) wired in
├── tailwind.config.ts              ← design tokens from index.html: bg / lime / rarity palette / Anton+Inter / breakpoints
├── postcss.config.mjs
├── middleware.ts                   ← root middleware → @supabase/ssr session refresh
├── .env.local.example              ← Supabase + Stripe + Resend + Calendly + Discord + VAPID keys
├── .nvmrc                          ← Node 20
├── public/
│   ├── manifest.json               ← PWA manifest (single app, standalone display)
│   └── icons/                      ← PWA icons (192, 512, maskable-512) — TODO: add real PNGs
├── src/
│   ├── app/
│   │   ├── layout.tsx              ← root layout, fonts, viewport, theme-color
│   │   ├── page.tsx                ← Ported marketing landing (Server Component) — full markup from archive/index.html, mounts MarketingClient at the end
│   │   ├── globals.css             ← :root CSS tokens + full marketing component CSS (.hero/.blob/.step/.skill/.price-card/…) + 44px tap-target rule + reduced-motion
│   │   ├── intake/                 ← Stage A intake. page.tsx (Client Component: 4-level state machine + page-level form/submitting/success/submit_failed stage machine. L1 inline COPPA gate, L2 rank/platform/hours, L3 parent contact with under-13 read-only branch, L4 Calendly embed → calendly.event_scheduled postMessage → /api/intake/submit) + page.module.css (scoped). verify/route.ts redeems the COPPA token (Done entry "Intake backend complete").
│   │   ├── login/                  ← /login page (Client Component). Email + parent/player role toggle → POST /api/auth/send-magic-link. Surfaces ?error= from /auth/callback. Suspense-wrapped useSearchParams. page.module.css scoped (dark palette, 48px tap targets, dash-free).
│   │   ├── portal/                 ← Parent dashboard (trial state). page.tsx Server Component: auth+role gate → /login or /play or /admin; renders hero + free-call-scheduled card + quest mirror + what-to-expect + empty-state controls + contact strip. PortalClient.tsx Client Components: SignOutButton (POST /api/auth/signout → /login), NudgeButton (inert toast). page.module.css scoped. typedRoutes + supabase-result-type workarounds documented inline.
│   │   ├── play/                   ← Kid quest log (trial state). page.tsx Server Component: auth+role gate → /login or /portal or /admin; fetches player + parent first name + quest_completions + latest VOD + prep_responses; passes initial state to PlayClient. PlayClient.tsx: gamified XP bar + 4 quest cards with rarity stripe + tap-card option grid for prep Q1/Q2 + textarea for Q3 (with "Open your clip" link back to the VOD) + Discord-join CTA + locked Lesson Library / Message Tim cards + parent-visibility footer. page.module.css scoped with rarity colors.
│   │   ├── api/play/vod/route.ts          ← POST. Inserts vod_uploads (paste_url, is_initial_trial_vod=true) + quest_completions.drop_vod. RLS via vod_uploads_kid_insert.
│   │   ├── api/play/prep/route.ts         ← POST. Enforces "VOD must be done first" server-side, then inserts prep_responses + quest_completions.answer_questions. One-shot per player (UNIQUE player_id on prep_responses).
│   │   ├── api/play/discord-join/route.ts ← POST. Trust-based marker. Inserts quest_completions.join_discord on click after kid opens Tim's coaching server invite.
│   │   ├── admin/                         ← Tim's coach dashboard. page.tsx Server Component: coach gate (auth_user_id match OR auto-link via service-role on first email-match sign in) → fetches all subscriptions joined with player/parent/quests/vod/prep + waitlist stats. AdminClient.tsx: stats strip (Paying/12, Trials this week, Waitlist, Revenue MTD stub), New Trials cards with inline Discord URL form, Active Clients list. page.module.css scoped (functional palette, no rarity gamification).
│   │   ├── api/admin/players/[id]/route.ts ← PATCH. Coach-only (cookie session + defensive coach lookup). Updates players.discord_channel_url. Scoped narrowly today; coach-edited player fields land here.
│   │   ├── auth/callback/route.ts  ← GET. Accepts both ?code=<pkce> and ?token_hash=<otp>&type=. Calls exchangeCodeForSession / verifyOtp. Validates ?next= via safeNextPath. Failure 302 → /login?error=<code>&next=<original>.
│   │   ├── api/auth/send-magic-link/route.ts  ← POST. Zod {email, role, next?}. Dispatches to sendParentMagicLink / sendPlayerMagicLink. No-enumeration: unknown emails return 200; only infra failures 502.
│   │   ├── api/auth/signout/route.ts          ← POST. supabase.auth.signOut(). Idempotent.
│   │   └── sw.ts                   ← Serwist service worker entry
│   ├── components/
│   │   └── MarketingClient.tsx     ← Client Component: hamburger toggle, scroll-reveal IntersectionObserver, count-up timer since 2020-02-20 (C2S2 launch). Renders null; pure side-effects.
│   ├── lib/
│   │   ├── supabase/{client,server,middleware,auth}.ts  ← @supabase/ssr setup; service-role exported separately. auth.ts owns sendParentMagicLink + sendPlayerMagicLink (kid synthetic-email → parent inbox override) + safeNextPath open-redirect guard.
│   │   ├── stripe/server.ts        ← Stripe SDK init
│   │   ├── email/{resend,template}.ts  ← Resend SDK init + FROM_EMAIL; brandedEmailHtml() Node-runtime template (mirrors supabase/functions/_shared/resend.ts)
│   │   ├── discord/bot.ts          ← Discord REST helpers (sendDirectMessage, sendChannelMessage)
│   │   └── utils.ts                ← `cn()` for class merging
│   └── types/
│       └── db.ts                   ← STUB; regenerate via `npm run gen:types` after `supabase start`
└── supabase/
    ├── config.toml                 ← Supabase CLI local config
    ├── migrations/
    │   ├── 20260517000000_initial_schema.sql   ← 14 tables
    │   ├── 20260517000100_rls_policies.sql     ← RLS + is_coach() / family_id_for_user() helpers
    │   ├── 20260517000200_seed_dev.sql         ← Tim's coach row
    │   ├── 20260517000300_cron_jobs.sql        ← 7 pg_cron jobs + app_config + cron_fire()
    │   ├── 20260517000400_dunning_reminder_columns.sql   ← adds notified_at_dunning_day3 + notified_at_dunning_day6 on subscriptions (idempotency for the D3/D6 dunning emails)
    │   ├── 20260517000500_intake_verifications.sql       ← pending_intake_verifications table for COPPA gate (intake_id, parent fields, 64-char hex token, verified_at, expires_at). RLS on, no policies (service-role-only).
    │   ├── 20260517000600_rpc_intake.sql                 ← rpc_intake() SECURITY DEFINER: atomically writes families → parents → players → subscriptions (trial) → quest_completions (signup); validates COPPA gate for under-13; cleans up the pending row. EXECUTE granted only to service_role.
    │   └── 20260517000700_admin_columns.sql              ← Adds coaches.email NOT NULL (backfilled to tim@xplkeyed.com) with unique lower-case index + players.discord_channel_url (nullable). Idempotent + DO-block-guarded NOT NULL flip. Apply with `supabase migration up`, then regen src/types/db.ts.
    └── functions/
        ├── _shared/
        │   ├── discord.ts                      ← dmTim() + sendChannelMessage() REST helpers
        │   └── resend.ts                       ← sendEmail() + brandedEmailHtml() template (parent emails inherit `--bg` / `--lime` tokens inline)
        ├── cron-twenty-min-pre-call-reminder/index.ts   ← 20min DM to Tim. Idempotency: curriculum_slots.notified_at_20min. Original example; not yet refactored to use _shared/discord.ts
        ├── cron-day7-dunning-ping/index.ts              ← daily 14:00 UTC. DM Tim at Day 7 of past_due. Idempotency: subscriptions.notified_at_day7_dunning
        ├── cron-dunning-parent-reminders/index.ts       ← daily 15:00 UTC. D3 + D6 branded emails to parent. Idempotency: subscriptions.notified_at_dunning_day3 / day6
        ├── cron-pending-cancel-lifecycle/index.ts       ← daily 16:00 UTC. D3/D6 reminders + D7 auto-confirm. Idempotency: subscriptions.pending_cancel_reminder_3day_at / 6day_at; D7 transition uses pending_cancel_auto_confirm_at vs status='canceled'
        ├── cron-waitlist-offer-lifecycle/index.ts       ← every minute. 24hr reminder + 48hr expiry + promote next FIFO waitlist family with fresh 48hr offer. Idempotency: waitlist_entries.reminder_24hr_sent_at + status transitions
        ├── cron-waitlist-freshness-check/index.ts       ← daily 17:00 UTC. 60d "still interested?" email + 14d auto-remove silent families. Idempotency: waitlist_entries.last_freshness_check_at + freshness_response
        └── cron-sunday-lesson-delivery/index.ts         ← Sundays 13:00 UTC. One lesson email per active subscription with translation pair (Hard rule #4) + "🤫 For your back pocket" block. Skips if no active curriculum / coach_cancel exists / subscription is not active. Idempotency: curriculum_slots.delivered_at + subscriptions.cycle_lessons_delivered. TODO: trigger Stripe billing when counter hits 4 — owned by the Stripe webhook layer.

```

### Running locally (first time)

```bash
npm install
cp .env.local.example .env.local        # fill in keys
npm run db:start                         # boots local Supabase via Docker
npm run gen:types                        # regenerates src/types/db.ts from the local DB
npm run dev                              # http://localhost:3000
```

Migrations apply automatically when Supabase starts (or via `npm run db:reset`).

For Stripe webhook testing locally: `stripe listen --forward-to localhost:3000/api/stripe-webhook`.

---

## Next session pickup

The scaffold lands here. Don't reconstruct from memory — read the files, then continue.

### Open TODO (build next, ordered by ROI)

Wired-but-invisible + specced-but-unbuilt items surfaced by the 2026-05-20 audit, plus a couple of new asks. None block production for Tim's n=1 instance; each closes a real UX or operator gap.

1. **Tim secret password login.** ✅ Built 2026-05-20. **Single-click** the "XPL KEYED" brand on `/login` to reveal username + password form. (Originally specced as triple-tap; simplified after the timing-based detection proved unreliable on the live install.) URL bypass `?coach=1` also works. Both surfaces show the form even when a session exists, so Tim can switch accounts without signing out first. See "Done" entry for setup SQL.
2. **`notification_log` table wiring.** ✅ Built 2026-05-20. Node-side `sendBrandedEmail()` wrapper writes every Resend send + status to the table. All 14 Node-side call sites migrated. Dad admin shows last 50 rows. **Deno Edge Functions still bypass** — see item #12.
3. **Read receipts on messages.** ✅ Built 2026-05-20. `POST /api/messages/mark-read` stamps `read_by_parent_at` or `read_by_recipient_at` on `MessageThread` mount. Data is there for any future "unread" badge UI; surfacing it is a small follow-up.
4. **Lesson edit route at `/admin/lessons/<id>/edit`.** ✅ Built 2026-05-20. `PATCH /api/admin/lessons/[id]` covers all metadata + per-slide speaker notes + parent talking points. Edit link on each row of `/admin/lessons`. Media re-upload deferred — Tim re-authors via `/admin/lessons/new` for new images/audio.
5. **Live trial-call countdown + "Join Discord call" CTA on `/play`.** ✅ Built 2026-05-20. `TrialCallCard` shows a live countdown until 15 min before call time, then flips to a green join button pointing at `players.discord_channel_url`. Hides after the call ends + 2 hours.
6. **Multi-kid login UX on `/login`.** ✅ Built 2026-05-20. Single text input instead of a second screen: when Player role is picked, a "Player first name" input appears below the parent email. Required to submit. `sendPlayerMagicLink` accepts optional `playerFirstName` and uses `.ilike("first_name", name)` within the family; falls back to the family's oldest player if omitted (backwards compat for any old callers). API route adds `player_first_name` to the Zod schema. No-enumeration policy preserved: a name mismatch returns 200 ok same as success, so an attacker can't probe which kids belong to which family. Success card surfaces the kid by name ("We sent Jake's sign in link to the parent email on file").
7. **Intake form polish.** ✅ Already built (audit was wrong — this landed in an earlier session and got missed). `/intake` ships: sound toggle (off-default, persisted under `xpl-intake-sound`), `+25 XP` floats on each level advance, Web Audio level-up + success chimes, `canvas-confetti` 3-burst on success in brand colors, `SuccessCard` with `ACHIEVEMENT UNLOCKED` kicker + entrance/pulse keyframes. `prefers-reduced-motion` respected throughout.
8. **Dad admin Phase 2.** ✅ Built 2026-05-20. All four pieces shipped: Tim activity strip (today vs 7-day window for messages replied / tasks completed / calls done / no-shows / coach cancels), Business glance (paying clients, cycle MRR, last 7 days revenue, Stripe balance, next payout), Operational alerts (24h Resend failure pct + per-cron freshness pills with stale thresholds), and View as Tim (lime "View as Tim →" button in Dad's topbar + reciprocal "← Back to Dad view" in the Admin sidebar footer when `coach.is_dad=true`).
9. **60-day refund window enforcement.** Today the policy lives in ToS + email copy; no actual block on Stripe-portal refund requests > 60 days. Customer experience unchanged at MVP scale. Build when first real refund flows in.
10. **Day-7 unscheduled auto-cancel for scattered renewals.** Existing `cron-scheduling-abandonment` Edge Function needs a branch for "post-charge unscheduled." Currently parent gets reminded but never auto-cancelled.
11. **Calendly auto-booking of uniform predicted times.** Auto-renew sets `live_call_at` to predicted times but doesn't create a real Calendly event. Parent has to manually reschedule into a real slot. Either use Calendly's one-time scheduling-link API or add an auto-suggest UI on next sign-in.
12. **Deno-side notification_log wiring.** ✅ Built 2026-05-20. `sendEmailWithLog()` helper added to `supabase/functions/_shared/resend.ts` (writes `notification_log` row with `status='sent'` or `status='failed'+error_message` after the Resend call; never throws). All 13 Deno-side sends across 8 crons migrated: `cron-dunning-parent-reminders` (2), `cron-pending-cancel-lifecycle` (3), `cron-waitlist-offer-lifecycle` (3), `cron-waitlist-freshness-check` (1), `cron-sunday-lesson-delivery` (1), `cron-scheduling-abandonment` (3), `cron-payment-abandonment` (3), `cron-auto-renew-detection` (1, also fixed a signature bug where it called `sendEmail({apiKey,...})` instead of positional). Triggers: `dunning_reminder_day3/6`, `pending_cancel_reminder_day3/6 + auto_confirmed`, `waitlist_offer_reminder_24hr/expired/email`, `waitlist_freshness_check`, `sunday_lesson_delivery`, `scheduling_reminder_24h/72h + released_7d`, `payment_reminder_6h/12h + released_24h`, `auto_renew_subscription_canceled`. Cron audit trail is now complete; the Dad admin's "Recent system activity" panel will show cron sends once any fire.

### Human setup (only Peter can do)

This section is the running source of truth for what's on Peter's plate. Update it at the end of each session — done items move to "✅ Done", new items get added under the right group. Claude maintains it; Peter executes against it.

#### ✅ Done

- **Production deploy complete + end-to-end smoke test passed (2026-05-22, deploy steps 6/7/8/9 DONE).** Full intake → Stage C take-on → curriculum approval → Stripe Checkout → cycle activation → auto-renew toggle validated in live prod against `https://xplkeyed.com`. Real card charged, real refund issued, test data wiped. **Tim's n=1 instance is launchable.**
  - **TLS landed** on the Railway custom domain via Let's Encrypt. `https://xplkeyed.com` resolves cleanly with a valid cert.
  - **Stripe webhook endpoint created** at https://dashboard.stripe.com → Developers → Webhooks → Add endpoint. URL: `https://xplkeyed.com/api/stripe-webhook`. Subscribed to all 5 spec events: `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.paid`, `invoice.payment_failed`. Signing secret (`whsec_...`) captured and rotated through **both** Railway env vars AND Supabase Edge Function secrets, replacing the `whsec_placeholder_will_update_after_webhook_setup` placeholder set during initial Railway provisioning.
  - **Calendly webhook re-registered** against production URL. Old ngrok-pointed subscription `3ef00395-c104-4083-9e95-9d7e1f17a8f0` deleted via `DELETE /webhook_subscriptions/...` (HTTP 204). New production subscription created via `POST /webhook_subscriptions` reusing the existing `CALENDLY_WEBHOOK_SECRET` (durable; no env var change needed). **New subscription URI: `https://api.calendly.com/webhook_subscriptions/4df0efa7-6e1a-425a-ad0a-f6f0cbff5d07`.** Callback: `https://xplkeyed.com/api/calendly-webhook`. Events: `invitee.created` + `invitee.canceled`. Scope: user. State: active.
  - **Supabase Auth Site URL fix.** Caught during the smoke test — the welcome email's magic link was pointing at `http://localhost:3000` instead of `https://xplkeyed.com` because new Supabase projects default the **Site URL** (Authentication → URL Configuration) to localhost. Even when our code passes the correct `redirect_to` via `auth.admin.generateLink`, Supabase falls back to the Site URL if the redirect URL isn't in the allowlist. Fix: Site URL → `https://xplkeyed.com`. Redirect URLs allowlist → added `https://xplkeyed.com/**` AND kept `http://localhost:3000/**` for local dev. **Cookbook follow-up for the next operator deploy:** this Site URL config is now mandatory step in the prod Supabase setup; flagged in 🎛️ Per-service dashboard config below.
  - **Tim's prod coach account.** Coach row already seeded by migration `20260517000200_seed_dev.sql` (display_name='Tim', is_active=true) and migration `20260520000500_coach_username.sql` (username='timothyaugros'). What needed setting up in prod:
    - **Auth user creation** via Supabase Dashboard → Authentication → Users → Add User. Email: `timothyaugros2384@gmail.com` (Tim's actual address). Password: `urmyworld7772`. **Auto Confirm Email**: ON (so sign-in works immediately without email verification).
    - **`coaches.email` updated to match** via SQL Editor: `UPDATE coaches SET email='timothyaugros2384@gmail.com' WHERE display_name='Tim';`. Was originally seeded as `tim@xplkeyed.com` (placeholder, no inbox); now points at Tim's real address so future magic links + branded coach emails actually land in his inbox.
    - **First sign-in verified.** Tim hits `https://xplkeyed.com/login?coach=1` → single-click the **XPL KEYED** brand text → password form reveals → username `timothyaugros` + password `urmyworld7772` → sign-in succeeds → lands on `/admin` → the self-healing auto-link branch writes `auth_user_id` on the coach row.
  - **Stripe Cards payment method activation.** Fresh Stripe live accounts have Cards in a "Requires action" state until additional info is provided. Hit during first `/curriculum/[token]` checkout attempt — server returned 500 with `StripeInvalidRequestError: No valid payment method types for this Checkout Session`. Resolution path: dashboard → Settings → Payment methods → click Cards "Requires action" pill → Stripe's setup guide walked through asking *"How do you want to accept recurring payments?"* with three options. **Chose "Prebuilt checkout form"** (matches our architecture — we call `stripe.checkout.sessions.create()` and redirect to the hosted Stripe-hosted page). Setup guide also tried to route into a "Add a product" wizard which is irrelevant to us (our code generates products inline via `price_data`). Closed out of the wizard after Cards flipped to Enabled. **Cookbook follow-up:** flagged this in 🎛️ Per-service dashboard config as a mandatory step for next operator deploy.
  - **End-to-end smoke test (real prod, real card):**
    1. Signed out of Tim → `/intake` Level 1-4 walkthrough as parent (age 14 to skip COPPA gate). Welcome email landed in Peter's inbox. Magic link redeemed cleanly → `/portal` rendered with trial-state dashboard.
    2. Booked a real Calendly slot from intake L4. Branded confirmation email arrived; Calendly's own confirmation also arrived (still need to toggle Calendly's invitee email OFF per 🔧 Setup item 1c).
    3. Signed in as Tim → trial card appeared on `/admin`. Clicked **Take on**, drafted a 4-week curriculum + personalization note, clicked Send. Conversion email landed in Peter's inbox.
    4. Opened approval link → `/curriculum/[token]` rendered correctly with the 4-week plan using the parent-translation pair, personalization note, and billing terms.
    5. Clicked **Approve plan and subscribe** → redirected to Stripe-hosted Checkout. Paid $56 with a real card.
    6. Stripe `checkout.session.completed` webhook fired → DB updated: `curricula.status='active'`, `subscriptions.tier='monthly'`, `subscriptions.status='active'`, `cycle_started_at=NOW()`. Verified via Supabase Table Editor.
    7. Tested auto-renew toggle on `/portal/billing` → flipped `auto_renew_enabled=FALSE` and back to TRUE. No regressions.
    8. Refunded the test charge via Stripe dashboard (full refund, no fees within 120 days).
    9. Cancelled the test Calendly event via Calendly dashboard.
    10. Wiped test rows from prod via SQL Editor (DELETE from quest_completions → vod_uploads → prep_responses → messages → curriculum_slots → curricula → cancellation_events → coach_cancels → notification_log → stuck_events → task_completions → subscriptions → players → parents → families → pending_intake_verifications + auth.users WHERE email='peteraugros@gmail.com' OR email LIKE 'kid+%@xplkeyed.internal').
  - **17 Railway env vars all live.** Final state: 14 from spec + `CALENDLY_PAID_LESSON_EVENT_TYPE_URI` + 3 inert DISCORD_* (Peter left them; harmless). The two placeholders (`STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_URL`) are now updated/legacy: webhook secret = real value, portal URL = still placeholder but never read.
  - **Still deferred (not blocking launch, captured for follow-up):**
    1. **Dedicated business bank for Stripe payouts.** Currently routing to Peter's personal bank as placeholder. Open Mercury or Relay (free, ~1hr online onboarding) and update Stripe → Settings → Payouts → External accounts before Tim's first real paying customer lands. ~5min admin task in Stripe + 1-2 day micro-deposit verification.
    2. **MX records / forwarding for `tim@xplkeyed.com`.** Per locked decision, in-app messaging is the long-term contact channel, so MX is no longer load-bearing. Could still be useful for stray "reply" hits on transactional emails. Cheap registrar-side forwarding or Google Workspace ($6/mo) when ready.
    3. **Calendly invitee confirmation email still ON.** 🔧 Setup item 1c — both Calendly's stock email AND our branded one currently fire on intro-call booking. Tim asked for the stock one to be toggled OFF; not done yet. Calendly's calendar invite notification should stay ON.
    4. **Embedded Stripe Elements vs hosted Checkout.** First-cut uses hosted Checkout per the Locked Decisions (single-endpoint refactor when polish time comes). Working in prod; revisit only when conversion polish becomes important.
    5. **AI-suggest cost monitoring.** Anthropic API is metered; for safety, watch the Anthropic dashboard for unexpected spend if Tim starts authoring lessons heavily.

- **Stripe live activation + Railway deploy + DNS (2026-05-21, deploy steps 6/8/9 mostly done).** App is serving on Railway behind the production domain; just waiting on Let's Encrypt TLS to land. Two webhook re-registrations (Stripe + Calendly) are the remaining cross-step work, both blocked on TLS being active.
  - **Stripe live mode activated.** Account: **XPL_Keyed** (separate from Day & Knight in Peter's Stripe login). Business type: **Sole proprietorship**. Statement descriptor: **`XPL KEYED`** (22-char cap, all caps; appears on parent credit card statements). Shortened descriptor skipped. Tax category: General → Services. Stripe Tax skipped (free until first registration; not relevant for US-only single-state pre-revenue). Climate contributions skipped.
    - **Bank for payouts: Peter's PERSONAL account, placeholder.** Decision: use personal now to unblock deploy; swap to a dedicated business bank (Mercury or Relay, both ~1hr online onboarding, free) before Tim takes a real customer. Swap procedure = ~5min admin task in Stripe dashboard + 1-2 day micro-deposit verification. No code/webhook changes; Stripe account-level `acct_xxx` ID stays the same, only the external destination changes. Tax 1099-K is account-level, so swapping banks doesn't fragment reporting.
    - **Smart Retries left ON (8 attempts over 2 weeks).** Vestigial for our PaymentIntent-based architecture — those settings apply to Stripe **Subscription** invoices, which our code never creates. Harmless to leave at default.
    - **Customer-facing dunning emails: OFF.** Our branded D3/D6 emails from `cron-dunning-parent-reminders` own that voice. Bank-debit-failed: OFF (we don't accept bank debits). **Card-expiration emails: ON** — Stripe's 30/15/7-day expiry warnings stay; we don't replicate that flow.
    - **Live API keys captured** (pk_live + sk_live) and saved to Peter's password manager. `STRIPE_SECRET_KEY` added to Supabase Edge Function secrets via dashboard UI.
    - **Still pending under step 6**: create webhook endpoint at `https://xplkeyed.com/api/stripe-webhook` subscribed to `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `invoice.paid`, `invoice.payment_failed`. Capture the resulting `whsec_...` and update `STRIPE_WEBHOOK_SECRET` in **both** Railway env vars AND Supabase Edge Function secrets. Blocked on TLS being active.
  - **Railway project created.** Auto-named **"astonishing-ambition"** (Railway's whimsical default; never renamed). Single service: **`XPL_Keyed`**. Region: `us-west1`. Deploy source: GitHub repo `peteraugros/XPL_Keyed`, `main` branch, auto-deploy on push. Nixpacks auto-detected Node 20 (`.nvmrc` honored) + npm package manager. Build: `npm ci → npm run build → npm run start`. No `railway.json` or `nixpacks.toml` created — auto-detection works.
    - **Build #1 FAILED** during "Collecting page data": `Missing API key. Pass it to the constructor 'new Resend("re_123")'`. Root cause: env vars not set yet on first deploy. The Resend SDK throws at module load when `RESEND_API_KEY` is undefined; Next.js 15 `next build` instantiates route modules during the "Collect page data" step to do tree-shaking/analysis, which triggered the throw. **Flagged as a code-side improvement for later:** lazy-init the Resend client (`getResend()` instead of module-level `new Resend(...)`) so a deploy without env vars fails at runtime, not build time. Not blocking now since env vars are set.
    - **Build #2 FAILED** during static prerender: `useSearchParams() should be wrapped in a suspense boundary at page "/intake"`. Root cause: `/intake/page.tsx` was a single Client Component calling `useSearchParams()` directly; Next.js 15 requires a `<Suspense>` boundary for prerender to work. The `/login` page already had this pattern; `/intake` didn't. **Fix shipped in commit `21c3c8a`**: extracted `IntakePageInner`, made default export a thin `<Suspense fallback={null}>` wrapper. Same pattern as `/login`. Also surveyed for other `useSearchParams` usages — `src/app/admin/clients/ClientsClient.tsx` has one, but its parent `page.tsx` is a Server Component with async DB queries (forces dynamic rendering at build time), so no Suspense wrap needed there.
    - **Build #3 SUCCEEDED.** App live on the Railway-generated `*.up.railway.app` URL.
  - **Railway env vars (17 total)** set via the "Raw editor" bulk-paste tab in **Variables**:
    - 14 from the spec list (Supabase prod URL/anon/service_role, Stripe pk_live/sk_live, Resend, VAPID, App URL, Calendly PAT+secret, Anthropic).
    - **+1 missed by the spec**: `CALENDLY_PAID_LESSON_EVENT_TYPE_URI` (in `.env.local` from the reschedule MVP work, used by the Calendly webhook handler to discriminate trial vs paid events). Future spec cleanup: add this to the 🔑 Env vars status table.
    - **+3 inert**: `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_TIM_USER_ID` — Peter copied from `.env.local` during the bulk edit; no code reads them (bot architecture retired per `feedback_no_discord_dms.md`). Harmless dead weight; remove or leave at will.
    - **Two intentional placeholders** (to be replaced after Stripe webhook endpoint exists): `STRIPE_WEBHOOK_SECRET=whsec_placeholder_will_update_after_webhook_setup` and `STRIPE_PORTAL_URL=https://billing.stripe.com/p/login/placeholder`. `STRIPE_PORTAL_URL` is a legacy env var — the code creates portal sessions dynamically via `stripe.billingPortal.sessions.create`, so the placeholder is never read. The webhook secret placeholder lets build succeed; runtime signature verification will fail until the real secret is set, but no webhooks are firing in prod yet.
  - **DNS pointed at Railway from registrar.** CNAME propagated globally per Peter's confirmation. **TLS provisioning in progress** at write time — Railway uses Let's Encrypt; usually 2-30 min after DNS resolves. Once Railway shows the custom domain as "Active" with a green check, `https://xplkeyed.com` resolves cleanly and TLS-dependent steps unblock.
  - **Resend domain verification confirmed** for production `xplkeyed.com`. Same DKIM + SPF + DMARC records from the 2026-05-17 dev setup carry over; no new records needed. Domain shows Verified in Resend dashboard.
  - **MX records for `tim@xplkeyed.com`: still not set up.** Locked decision (2026-05-17) is to route all parent contact through in-app messaging; MX/forwarding is no longer load-bearing. Stripe + Calendly + Resend outbound work fine without inbound MX.
  - **Remaining cross-step work, ordered**: (1) wait for TLS to go Active; (2) Stripe webhook endpoint + `STRIPE_WEBHOOK_SECRET` rotation through Railway + Supabase; (3) Calendly webhook re-registration (delete ngrok subscription, recreate against `https://xplkeyed.com/api/calendly-webhook` reusing existing `CALENDLY_WEBHOOK_SECRET` per the 2026-05-17 Done entry); (4) browser smoke test of `/`, `/login`, `/intake`, `/admin` (with Tim's coach-password login or magic link); (5) optional first end-to-end Stripe test charge (real card → refund).
  - **Sign-in-as-Tim caveat for prod smoke test**: coach magic-link emails go to `tim@xplkeyed.com` (production seed value), which has no inbox. For smoke-testing Tim's `/admin` access against prod, either (a) fix MX/forwarding first, (b) temporarily `UPDATE coaches SET email='peteraugros@gmail.com' WHERE display_name='Tim';` against prod and revert before launch, or (c) use the secret coach password login at `/login?coach=1` (single-click the brand text to reveal the password form — see `decision-secret-coach-login` history). Option (c) avoids touching prod data.

- **Live Supabase project provisioned (2026-05-21, deploy step 5 part 1).** Production Supabase project stood up; everything except `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (deferred until Stripe activation) is wired.
  - **Project ref: `fmsekesjdkjpvvleefpu`.** Region: `us-west-2` (Oregon). Plan: **Free tier** (org-level). Decision context: Pro is $25/mo and removes (a) 7-day inactivity auto-pause, (b) the 1 GB storage cap. At pre-revenue scale neither is load-bearing — pg_cron jobs keep the DB warm so auto-pause won't trigger, lesson-asset storage is ~0 GB until Tim actually authors content, and Stripe/Calendly retry failed webhooks automatically if a wake-up delay ever happens. Upgrade trigger conditions: (a) first paying customer (revenue covers it), (b) storage approaches 800 MB, (c) auto-pause causes a real prod incident. One-click upgrade, no migration.
  - **API URL: `https://fmsekesjdkjpvvleefpu.supabase.co`.** Anon + service_role legacy JWTs grabbed from Settings → API → "Legacy anon, service_role API keys" tab (NOT the new `sb_publishable_*` / `sb_secret_*` keys — codebase is built against the legacy JWT format per the local-dev Done entry). Saved to Peter's password manager; **not yet pushed to Railway env** (will happen during Railway setup, deploy step 9).
  - **CLI now linked to prod.** `supabase link --project-ref fmsekesjdkjpvvleefpu` completed cleanly. After today, the local CLI's `supabase db push` targets prod by default. Other CLI commands (`supabase start`, `supabase db reset`, `supabase status`) still target the local Docker stack. If extra safety is wanted before next dev session: `supabase unlink` to break the link; re-link with the same `--project-ref` command when needed.
  - **All 36 migrations applied via `supabase db push`.** Output had harmless NOTICEs (DROP IF EXISTS noting nothing was there to drop on a fresh DB; PGCRYPTO already exists since Supabase pre-installs it). Final list at deploy time: `20260517000000_initial_schema.sql` through `20260520000500_coach_username.sql`. Coach seed (`20260517000200_seed_dev.sql`) inserted Tim's row with `email='tim@xplkeyed.com'` — that's the right value for prod (don't apply the local-dev `UPDATE coaches SET email='peteraugros@gmail.com'` override in 🔧 Setup item 1b; that's local-only).
  - **PG version mismatch noted, deferred.** Local Docker runs Postgres 15 (older `supabase/config.toml` default); cloud project provisioned with Postgres 17. Migrations use standard SQL that works on both. If a future migration uses PG17-specific syntax (window functions, MERGE features, new JSON ops), update `supabase/config.toml` to `major_version = 17` and `npm run db:reset` to recreate local on PG17. Not blocking now.
  - **Types regenerated** via `npm run gen:types`. Script targets `--local` (uses local Docker), but since local + prod schemas match, the output is correct for prod use. `src/types/db.ts` at 1322 lines.
  - **4 Edge Function secrets set via dashboard UI** (Settings → Edge Functions → Secrets, bulk save):
    - `RESEND_API_KEY` (from `.env.local`)
    - `RESEND_FROM_EMAIL = "XPL Keyed <tim@xplkeyed.com>"`
    - `CALENDLY_PAT` (from `.env.local`)
    - `NEXT_PUBLIC_APP_URL = "https://xplkeyed.com"`
    - **Deferred** to deploy step 6 (Stripe activation): `STRIPE_SECRET_KEY` (live, not sandbox).
    - **Deferred** to deploy step 6 (Stripe webhook registration): `STRIPE_WEBHOOK_SECRET` (live).
  - **`app_config` rows inserted via SQL Editor** so `cron_fire()` can dispatch Edge Function calls:
    - `edge_base_url = "https://fmsekesjdkjpvvleefpu.functions.supabase.co"` (50 chars)
    - `edge_service_key = <legacy service_role JWT>` (218 chars)
    - **Operator footgun caught during setup:** the original INSERT template in CLAUDE.md's "⚙️ Post-deploy DB config" section had a `<service-role-jwt>` placeholder that Peter pasted literally on his first attempt. The query succeeded but stored the placeholder string instead of the real JWT. Fix was an UPDATE: `UPDATE app_config SET value = '<real_jwt>' WHERE key = 'edge_service_key';`. Verification query — `SELECT key, length(value) FROM app_config;` — should show ~200+ chars for `edge_service_key`. Next session: consider tightening that section's instructions to call out the placeholder substitution explicitly.
  - **Remaining work under deploy step 5:** none until Stripe activation (deploy step 6). After Stripe live: come back to Edge Function secrets and add `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` from the dashboard UI.
  - **Cron eligibility:** with the `app_config` rows now populated, `cron_fire()` will start dispatching every cron job at its scheduled UTC time. The crons will run against prod the moment they hit their schedule — there's no active subscription data yet, so every job will no-op cleanly (waitlist freshness loops through zero rows, dunning loops through zero past-due rows, etc.). No spam, no failures. Confirmed posture: crons are safe to run on a fresh DB.

- **CLAUDE.md reconcile pass (2026-05-20).** Brought the canonical Locked Decisions section in line with built reality after an audit caught multiple contradictions between the top-of-doc spec and what's actually shipped. Five concrete edits:
  - **Stage C section rewritten.** Was: "Stripe subscription with manually-advanced cycle" + "Or metered billing with a custom job." Is now: "**One-time PaymentIntents against a saved card. NO Stripe Subscription object.**" Documents the locked first-cycle flow (Stripe Checkout `mode='payment'` + `setup_future_usage='off_session'`) and cycle-2+ flow (`cron-auto-renew-detection` fires `paymentIntents.create({customer, payment_method, off_session:true, confirm:true})`). Explains *why* this beats Stripe Subscriptions for our delivery-driven (not calendar-driven) billing rhythm. Documents the `renewal_pi_id` idempotency mechanism.
  - **Cancellation section rewritten.** Was: "2 credits per 4-lesson cycle, 3rd cancel ends the subscription with type-to-confirm + 7-day pending window" using `cycle_cancels_used`. Is now: **"2 skips per cycle, 3rd skip triggers `auto_renew_enabled=FALSE`"** with grace-recovery (clean cycle restores TRUE silently) and no immediate-end-subscription path. Documents state A (>=24hr free reschedule) vs state B (<24hr forfeit), the 168hr same-week threshold, coach-cancel reasons, the locked backend state shape, and the "no Discord DM, in-app only" notification posture.
  - **New "Lifecycle states (locked)" subsection.** Documents every value of the `lifecycle_state_t` enum (TRIAL_PREP / TRIAL_SCHEDULED / TRIAL_DONE / ACCEPTED_PENDING_SCHEDULING / SCHEDULING_IN_PROGRESS / PENDING_PAYMENT / ACTIVE / PAST_DUE / PENDING_CANCEL / CANCELED) + how `lifecycle_state` relates to `status` (lifecycle_state is canonical when they disagree) + `waiting_on` enum (TIM / PARENT / KID / SYSTEM / DAD).
  - **Operator-pair section** got a one-paragraph addition: **"Tim's n=1 instance does NOT use Stripe Connect."** Locks the decision to defer Connect onboarding until operator #2 lands; both Tim + operator #2 get the Connect migration at the same time.
  - **Notifications + Discord bot architecture rewritten.** Was: a 3-trigger XPL Keyed Bot DMing Tim for 20-min reminders + Day-7 dunning + Cancel-#3 ping. Is now: **"No Discord DMs to Tim. All operator notifications surface in-app on Focused Home."** Per `feedback_no_discord_dms.md` (2026-05-19 hard policy override). The bot is **explicitly retired**; Discord stays the channel for coaching content only (manual per-client channels Tim runs by hand).
  - **New "What's NOT built (known gaps)" section.** 10-item list covering ongoing curriculum approval (cycles 2+), call recording infrastructure, Discord server template, iOS PWA apple-touch-icon, analytics/TikTok funnel measurement, pending_intake_verifications purge cron, 60-day refund window enforcement, Day-7 unscheduled auto-cancel, Calendly auto-booking, multi-tenant operator-#2 migration. Surfaces the gaps so future-Claude doesn't assume a spec feature works just because it's in Locked Decisions.
  - **Deployment section expanded** from a 3-line stub to a 10-step plan covering: live Supabase project secrets (incl. Edge Function `supabase secrets set`), live Stripe activation + webhook subscriptions list, Calendly webhook re-registration off ngrok, DNS + Resend domain verification, smoke test plan, rollback notes.
  - **Table of contents** added at the top of the file. 1679 lines is still long; the TOC makes the doc scannable instead of requiring a linear read to find one fact.
- **Dad admin Phase 2 (2026-05-20).** Closed TODO #8. Four new surfaces on `/dad`, each pulling data already in the system:
  - **Tim activity strip** — 2-column grid (Today / Last 7 days) with 5 metrics: messages replied (`messages` WHERE `sender_role='coach'`), tasks completed (`task_completions.completed_at`), calls done (`curriculum_slots.live_call_completed_at`), no-shows (`curriculum_slots.no_show_at`), coach cancels (`coach_cancels.created_at`). Total-today summary in the panel header.
  - **Business glance** — 5 KPI tiles: paying clients of 12 (DB count `subscriptions WHERE status='active' AND tier='monthly'`), cycle MRR (count × $56), last 7 days revenue (Stripe `paymentIntents.list` paginated up to 5 pages, sum of `status='succeeded'`), Stripe balance (`balance.retrieve()` summed across available currencies), next payout (`payouts.list({status:'pending', limit:1})` with arrival date hint). All Stripe calls inside one try/catch; failure surfaces a `subtleFail` message in the panel header rather than crashing the page.
  - **Operational alerts** — header line with 24h Resend failure rate (`status='failed'` count / total count from `notification_log`); per-cron-trigger freshness list with 3-state pills (green ok, amber stale, neutral never-run). Stale thresholds tuned per cron cadence (Sunday delivery: stale after 8 days; auto-renew-canceled: stale after 60 days; etc). Pulls the last 500 sent rows from `notification_log` and reduces to max `sent_at` per trigger in JS — no DB DISTINCT ON needed.
  - **View as Tim** — pure UI plumbing on top of the existing dual-role coach row. Lime "View as Tim →" button in Dad's topbar links to `/admin`; reciprocal "← Back to Dad view" lime pill in the Admin sidebar footer conditionally renders when `coach.is_dad=true`. Needed surfacing `is_dad` through `requireCoachSession` (added to `CoachRow` type + the `.select` chain) and threading the prop through `layout.tsx` → `AdminShell`.
  - **Data pattern note:** for `count`-only queries Supabase's `head: true` mode is used (`select("id", { count: "exact", head: true })`) — returns the count without dragging row data through the wire. Used across all 10 activity counts + 3 notification_log aggregates.
- **Deno-side notification_log wiring (2026-05-20).** Closed TODO #12. New helper `sendEmailWithLog()` in `supabase/functions/_shared/resend.ts` mirrors the Node-side `sendBrandedEmail()` posture: dispatch through Resend, then write a `notification_log` row with `status='sent'` (or `status='failed' + error_message` on Resend error). Never throws. All 13 cron-side Resend calls across 8 functions migrated. Audit trail is now end-to-end; the Dad admin's "Recent system activity" panel pulls a unified feed of Node + Deno sends. Side-fix in `cron-auto-renew-detection`: was calling the legacy `sendEmail` with object args (`{apiKey, from, ...}`) instead of the positional `(apiKey, defaultFrom, args)` signature, which would have failed silently in prod. Now uses the new helper correctly.
- `npm install` (2026-05-17)
- Dash sweep visual verification at `localhost:3002` (2026-05-17). Resolved by acceptance of current state: markdown bullets `-` and HR `---` in `parent-upsell-copy.md` kept (render as `•` and `<hr>`, no visible dash); `Tesch-Römer` proper-name hyphen kept (factual academic citation); `archive/index.html` kept long-term as a parity reference.
- **Local toolchain installed (2026-05-17):** OrbStack (chosen over Docker Desktop because the cask install needed interactive sudo to create `/usr/local/cli-plugins`; OrbStack's install doesn't). Supabase CLI 2.98.2 via `brew install supabase/tap/supabase`. Stripe CLI 1.40.0 was already on the machine.
- **`supabase/config.toml` fix (2026-05-17):** removed the legacy `[functions] verify_jwt = false` block; newer Supabase CLI parses `[functions.<name>]` per-function and rejected the old top-level form with "expected a map or struct, got 'bool'". Default `verify_jwt=true` is correct for our cron functions since `cron_fire()` already sends the service role JWT.
- **Local Supabase stack running (2026-05-17):** `npm run db:start` applies all 5 migrations cleanly. Studio at http://127.0.0.1:54323, Mailpit at http://127.0.0.1:54324, API at http://127.0.0.1:54321.
- **`npm run gen:types` (2026-05-17):** `src/types/db.ts` regenerated off the live local schema. 18 business tables visible.
- **`.env.local` populated for local dev (2026-05-17):**
  - Supabase: URL + legacy `anon` and `service_role` JWTs from `supabase status -o env`. Chose legacy JWT format over the new `sb_publishable_*` / `sb_secret_*` keys so Edge Runtime `verify_jwt=true` keeps working when `cron_fire()` invokes Edge Functions with the service role key as bearer.
  - Stripe: pk_test, sk_test, whsec, customer-portal login URL from the XPL_Keyed sandbox. Sandbox onboarding chosen: "Non-recurring payments" + "Recurring payments" only (no invoicing / marketplace / tax / etc).
  - Resend: API key + `tim@xplkeyed.com` as `RESEND_FROM_EMAIL`.
  - VAPID keypair from `npx web-push generate-vapid-keys`.
- **`xplkeyed.com` purchased and verified in Resend (2026-05-17).** Domain is sendable; `tim@xplkeyed.com` works for outbound. Note: no inbox at that address yet — replies bounce until either a forwarding rule at the registrar, Google Workspace, or a Resend `replyTo` header is wired up.
- **Stripe CLI authed against XPL_Keyed sandbox (2026-05-17)** via `stripe login`. Webhook secret captured via `stripe listen --print-secret`.
- **Calendly webhook subscription live (2026-05-17, evening).**
  - Subscription URI: `https://api.calendly.com/webhook_subscriptions/3ef00395-c104-4083-9e95-9d7e1f17a8f0`
  - State: `active`. Events: `invitee.created` + `invitee.canceled`. Scope: `user`.
  - **Signing key was created by us, not Calendly.** Calendly's API takes `signing_key` as a **request param** (not a response field) — we generated a random 32-byte hex string via `openssl rand -hex 32`, passed it in the POST body, and stored the same value in `.env.local` as `CALENDLY_WEBHOOK_SECRET`. Future Claude/Peter: do NOT re-generate by deleting and recreating without preserving the key — you'll break local sig verification. To rotate, PATCH the subscription (or delete + recreate) AND update `CALENDLY_WEBHOOK_SECRET` to the new value in lockstep.
  - **Callback URL is ngrok (ephemeral).** Current value: `https://difficult-wand-sixties.ngrok-free.dev/api/calendly-webhook`. ngrok free tier rotates the subdomain on every restart, so this URL will break the next time the tunnel comes down. The signing key is durable; only the URL needs to change. To rotate: start a new ngrok tunnel, PATCH the subscription's `callback_url` (Calendly does not support PATCH directly on `webhook_subscriptions` — delete + recreate with the same `signing_key` is the official path).
  - **Production deploy plan:** when Railway + production Supabase are set up (queued under 🚢 Deployment), delete the ngrok-pointed subscription and recreate against the Railway URL (or `xplkeyed.com` once DNS lands), reusing the same `CALENDLY_WEBHOOK_SECRET` so existing handler code keeps working.
  - **E2E validation done:** hand-signed `invitee.canceled` payload through ngrok → handler verified signature (200 OK), dispatched to canceled handler, gracefully no-op'd on the missing DB row (no `curriculum_slots` data exists yet). Signature verification math is correct.

- **Calendly account configured (2026-05-17).**
  - Workspace renamed to `xpl-keyed` (brand-locked to XPL Keyed, no Augros family name in infrastructure URL). Standard plan ($12/mo) for webhooks + custom questions + minimum-notice.
  - Event type **"30 minute free intro call"** published at `https://calendly.com/xpl-keyed/intro-call`. This is the URL the Stage A Level 4 step will embed.
  - **Locked settings:** 30 min duration · 15-min before/after buffers · 2/day, 5/week meeting cap (capacity gate for when the TikTok funnel scales) · 24hr minimum notice · 60-day max date range · notetaker OFF (consent/privacy with minors) · autofill from prior bookings OFF (prevents phone number injection) · invitee guests OFF · US federal holidays auto-block ON · availability Wed/Thu/Fri 4–6pm + Sat 1–5pm only.
  - **Location:** Custom, dash-free copy. *"Discord voice call. After you book, Tim will send the XPL Keyed coaching server invite to the Discord username you provide below. The call happens there at your scheduled time. We never call or text your phone."* Visibility set to "only after booking confirmation" so the trust copy lands in the email at peak relevance, not the public page.
  - **Invitee form: phone field removed.** Top-level Name + Email captures the **parent** (the person booking). Five custom questions: kid's first name (req), kid's Discord username (req, with help text), kid's Fortnite IGN (req), kid's age (req), what they want to get better at (optional, multi-line).
  - **Design decision locked: kid's Discord username, NOT parent's.** The original spec assumed parent's Discord. Corrected at setup because 90%+ of parents don't use Discord and would bounce. Parent's observer role in the coaching server happens via post-conversion invite, not at the booking form. **This generalizes: parent Discord is never collected at any intake surface.** Trust model unchanged; conversion friction removed.
  - **Personal Access Token generated** and pasted into `.env.local` as `CALENDLY_PAT`. Scopes: all Scheduling (10) + all Webhooks (2). Token name "XPL Keyed dev."
  - **Not yet done:** cancellation/reschedule window setting (couldn't be found in Standard-tier UI; not blocking the intro call which is free with no cycle math; revisit when paid-lessons event type is built — see Open decisions). Webhook subscription registration (blocked on a public callback URL — see Next coding tasks #4).

- **Intake backend complete (2026-05-17, late).** Steps 1–3 of Task 5. Two new migrations, three API routes, and a shared email-template helper. Backend ships in a usable state; gamified form (Steps 4–5) is the remaining work.
  - **Migration `20260517000500_intake_verifications.sql`** — `pending_intake_verifications` table (intake_id UUID, parent_first_name, parent_email, 64-char hex token, verified_at, expires_at). RLS enabled with no policies (deny-all for anon/authenticated; service-role bypasses). Used as the magic-link gate for under-13 kids at the L1→L2 boundary.
  - **Migration `20260517000600_rpc_intake.sql`** — `rpc_intake()` SECURITY DEFINER. Takes pre-created auth user IDs (parent + synthetic kid) plus all form fields; atomically writes `families → parents → players → subscriptions (tier='trial', status='trial') → quest_completions (quest_key='signup')`. Validates the COPPA gate for under-13 (matches `intake_id` + lowercased `parent_email` against a verified, unexpired row). Stamps `parents.email_verified_at = NOW()` for under-13. Cleans up the pending row on success. EXECUTE revoked from PUBLIC/anon/authenticated and granted only to `service_role`.
  - **Routes:**
    - `POST /api/intake/request-verification` — upserts the pending row by `intake_id`, sends a Resend email with `/intake/verify?t=<token>` link. Zod-validated body. Re-requests overwrite the token (handles parent-changes-email-mid-flow).
    - `GET /intake/verify` at `src/app/intake/verify/route.ts` — validates token length + lookup + expiry, marks `verified_at`, 307s to `/intake?verified=<intake_id>`. Bad/expired tokens redirect with `?coppa_error=expired|not_found|server`. Idempotent re-clicks (already-verified row still redirects successfully).
    - `POST /api/intake/submit` — creates parent auth user (real email, `email_confirm: true`) + kid auth user (synthetic `kid+<uuid>@xplkeyed.internal`, `email_confirm: true`) via Supabase admin SDK; calls `rpc_intake`; rolls back both auth users via `auth.admin.deleteUser` if rpc fails; generates parent magic link via `auth.admin.generateLink` redirected to `/auth/callback?next=/portal`; sends branded welcome email via Resend.
  - **Helper `src/lib/email/template.ts`** — Node-runtime `brandedEmailHtml()`. Two copies of this template exist (Node here, Deno at `supabase/functions/_shared/resend.ts`) because Edge Functions can't import from `src/`. Keep them in sync; both must stay dash-free per Hard rule #8.
  - **End-to-end tests against the local stack (all green):**
    1. **14yo intake, no COPPA gate** → 200; all 5 records created (family, parent, player, trial subscription, signup quest); both auth users present; `parents.email_verified_at` = NULL.
    2. **10yo intake, no verification** → 403 `coppa_verification_required`; rollback verified (0 orphan auth users for that email).
    3. **10yo intake with verification** → 200; `parents.email_verified_at` set to NOW(); pending row cleaned up.
    4. **Duplicate parent email** → 409 `parent_email_already_registered`; original auth user untouched (caught at `createUser` before kid creation, so no rollback needed).
    5. **Verify token valid** → 307 to `/intake?verified=<intake_id>`; DB marked verified.
    6. **Verify token short or unknown** → 307 to `/intake?coppa_error=not_found`.
  - **Flags carried forward:**
    1. **Resend in dev hits the real Resend API, not Mailpit.** Both request-verification and submit emails go out for real. Test runs used `example.com` recipients (Resend accepted with 200; deliverability is whatever Resend does with non-existent inboxes). For local visibility of magic-link URLs while building the UI, either send to a real address or add a dev-only `console.log` of the link in each route handler — not done yet.
    2. **`pending_intake_verifications` has no purge cron.** Verified rows are deleted by `rpc_intake` on success; unverified rows expire and sit. Low priority at 1–10 client scale. A daily `DELETE WHERE expires_at < NOW() AND verified_at IS NULL` cron is a follow-up, not part of Task 5.
    3. **`/auth/callback` does not exist yet (Task 6).** The magic-link URL in the welcome email is valid (Supabase's `/auth/v1/verify?...&redirect_to=<our callback>`), but clicking it currently 404s on our side. Email send works; the deep link works post-Task-6.
    4. **Synthetic kid auth user has no purpose yet.** It exists in `auth.users` and `players.auth_user_id` is set, but no magic link is sent to it. Task 6 wires the email-interception layer that routes kid magic links to the parent inbox.

- **Intake form UI complete (2026-05-17, evening).** Step 4 (a/b/c/d) of Task 5. Stage A 4-level gamified form lands at `/intake`. Form is functional end-to-end against the local stack: L1 (Player Profile) → L2 (Skill Check) → L3 (Parent Contact) → L4 (Schedule Call with inline Calendly embed) → `calendly.event_scheduled` postMessage → `POST /api/intake/submit` → "Achievement Unlocked" success card. Mobile-first, dash-free per Hard rule #8, design tokens inherited from `globals.css`. L1 + COPPA gate verified in the browser by Peter (2026-05-17); L4 Calendly handoff wired but not yet sanity-checked in browser end-to-end.
  - **Files:** `src/app/intake/page.tsx` (single Client Component, ~500 lines, all 4 level components co-located) + `src/app/intake/page.module.css` (scoped styles).
  - **State machine:**
    - Page-level `stage`: `form` → `submitting` → (`success` | `submit_failed`). Wraps the Calendly handoff so the success card can replace the whole form (not just the level card).
    - Within `stage=form`: `level` (1–4). LocalStorage key `xpl-intake-v1` mirrors the entire FormState, restored on mount, wiped on success so a refresh after booking doesn't replay stale data.
    - COPPA gate sub-state: `unneeded` (age ≥ 13) | `idle` | `requesting` | `pending` | `verified` | `error:{expired|not_found|server|send_failed}`. Auto-resets when age moves in/out of the under-13 zone.
    - `intake_id`: client-generated UUID, persisted; same value is sent to both `/api/intake/request-verification` and `/api/intake/submit` so the COPPA gate row matches at validation time.
  - **Level 1 — Player Profile (uncommon green):** kid first name, age (8–18 with out-of-range inline error pointing to `tim@xplkeyed.com`), Fortnite username, Discord username. Kid-tone copy ("What's *your* first name?"). Inline COPPA gate expands at the bottom when age <13 detected, collects parent name + email, fires the request-verification API, surfaces pending/verified/error state. Parent fields lock during `requesting`/`pending`/`verified` so they can't drift out of sync with the email already sent.
  - **Level 2 — Skill Check (rare blue):** rank dropdown (Not ranked yet → Bronze → Silver → Gold → Platinum → Diamond → Elite → Champion → Unreal — band only, no sub-tiers), platform dropdown (PC, PlayStation, Xbox, Switch, Mobile), hours-per-week number (0–168 with "Rough estimate is fine. Helps Tim size the curriculum." hint).
  - **Level 3 — Parent Contact (epic red):** **13+ branch:** two fresh inputs (parent first name + email). **Under-13 branch:** locked read-only lime-bordered card showing the verified parent name/email from L1's gate, with "Tap Back, then go back one more time to Level 1" hint. Prevents the kid from invalidating the verified email mid-flow.
  - **Level 4 — Schedule Call (legendary orange):** Inline Calendly embed at `https://calendly.com/xpl-keyed/intro-call`, themed to the dark palette (`background_color=0F1B47`, `text_color=FFFFFF`, `primary_color=C7FF3D`, `hide_gdpr_banner=1`, `hide_event_type_details=1`). Calendly's `widget.js` loaded via `next/script` with `strategy="afterInteractive"`, only when L4 mounts. Min-height 700px so the time picker shows without internal scroll on mobile. Hint copy above pulls the kid's first name + Discord username through.
  - **Calendly prefill assumption (TEST BEFORE LIVE):** Top-level `name`=parent_first_name + `email`=parent_email; custom `a1`=kid_first_name, `a2`=kid_discord_username, `a3`=kid_fortnite_username, `a4`=kid_age, `a5`=blank (we don't collect "what they want to get better at" in our intake — that lives in the Stage B prep quest log). Order assumed from CLAUDE.md's Calendly setup notes. If `a1`–`a5` drift out of order in the event-type definition, prefill silently lands in the wrong field. Verify by booking a test call and confirming each answer landed in the right Calendly slot. Fix is a one-line ordering change in `buildCalendlyUrl()`.
  - **Booking → submit handoff:** `window.message` listener filters for any `calendly.*` event but only acts on `calendly.event_scheduled`. On fire, `POST /api/intake/submit` with all 10 form fields (intake_id + parent fields + 7 kid fields). LocalStorage wiped on success. Maps the two known recoverable failure modes to specific copy (`parent_email_already_registered` → "head to sign in"; `coppa_verification_required` → "go back to Level 1 and resend approval"); everything else surfaces a generic "your call is still on the calendar, tap retry" message. Retry button re-fires `submitIntake` (Calendly event already exists, so retry doesn't double-book).
  - **XP bar:** 4 segments of 25%. Active segment color tracks the level's rarity (uncommon → rare → epic → legendary). Within-level nudge to 80% of segment when `canAdvance` is true. On `success`, bar fills to 100% in lime + the progress label becomes "DASHBOARD UNLOCKED" / "DONE".
  - **Hard rules honored:** all visible copy dash-free per Hard rule #8 (no em/en/hyphen anywhere visitors read); mobile-first 560px max-width frame, 48px min-height inputs, 44px tap targets via the existing globals.css base rule; no photo of Tim anywhere (Hard rule #1); `prefers-reduced-motion` respected on XP bar transition + the submitting-card spinner.
  - **Open items deferred to Step 5 polish or later:**
    1. **Confetti + +25 XP floats + level-up sound (muted with toggle).** Spec calls for these on level transitions and on the "Achievement Unlocked" reveal. Not built — Step 5 polish.
    2. **Calendly event URI not linked to player record.** The `event_scheduled` payload contains the event URI but we don't pass it to `/api/intake/submit` and don't store it. The Calendly `invitee.created` webhook is still a no-op for trial calls (commit `44de31b`). Tim sees the new client in admin and the booking in Calendly separately; no DB linkage yet. Probable follow-up: add `trial_call_event_uri` + `trial_call_at` columns on `subscriptions` (or a dedicated `trial_calls` table) + enhance the Calendly webhook handler to populate them. Forward-compatible: not adding it now doesn't break anything.
    3. **Ghost-Calendly-event risk on submit failure.** If the user closes the tab between Calendly success and our `/api/intake/submit` completing, the Calendly event exists with no XPL account. Retry handles this if they reopen the tab (localStorage still has the form data). If they don't reopen, Tim sees the orphan booking in Calendly with parent contact info from the answers Calendly collected and can reach out manually.
    4. **Cross-device COPPA verification.** The pending-verification URL works server-side regardless of which device the parent clicks from, but the kid's localStorage form data is on the original device. So the kid only sees the "verified" state on the original device. Documented in the gate copy ("open link on this same browser"). Manual workaround if it bites: parent forwards the email to the kid's device or hands their device back to the kid to click. A future enhancement could add a polling "check approval" button or a postMessage-from-other-tab listener.

- **Auth routes complete (2026-05-17, night).** Task 6. `/login`, `/auth/callback`, `/api/auth/send-magic-link`, `/api/auth/signout`, plus the canonical `src/lib/supabase/auth.ts` helper that owns the "Supabase never sends our auth emails, Resend does" pattern. `npx tsc --noEmit` clean.
  - **Helper `src/lib/supabase/auth.ts`** — two exported magic-link senders + a `safeNextPath` open-redirect guard.
    - `sendParentMagicLink(supabase, parentEmail, opts)`: looks up `parents` by case-insensitive email, calls `auth.admin.generateLink({ type:'magiclink' })`, ships the action_link via Resend's branded template to the parent's real address. Accepts copy overrides (`subject`, `headline`, `bodyHtml`, `ctaLabel`) so intake's "welcome" voice can differ from `/login`'s "welcome back" voice while sharing the plumbing.
    - `sendPlayerMagicLink(supabase, parentEmail, opts)`: the override. Resolves `parents.email` → `family_id` → oldest `players` row → reads the synthetic `kid+<uuid>@xplkeyed.internal` off `auth.users` via `admin.getUserById`, generates the link for THAT synthetic email (so the resulting session is the kid's, not the parent's), then **delivers the link to the parent's real inbox**. No code path in the app emails a synthetic address. Default `next=/play`.
    - `safeNextPath`: rejects anything not starting with `/`, plus `//` and `/\\` to block protocol-relative + backslash open-redirects. Shared between the callback route and the magic-link helpers.
    - `MagicLinkResult` discriminated union: `{ok:true}` or `{ok:false, code:'not_found'|'no_auth_user'|'generate_failed'|'send_failed'}`. Route handlers map the code to HTTP status; the user-facing `/login` collapses `not_found`/`no_auth_user` to "we sent a link" per the no-enumeration policy below.
  - **`POST /api/auth/send-magic-link`** — Zod-validates `{email, role:'parent'|'player', next?}`. Dispatches to the right helper. **No-enumeration policy:** unknown parent email and family-with-no-eligible-player both return 200 ok (same as a real send). Only infra failures (Resend rate limit, generateLink timeout) surface as 502 so the UI can offer a retry. An attacker can't enumerate parent emails by toggling the status code.
  - **`GET /auth/callback`** — accepts both `?code=<pkce>` and `?token_hash=<hash>&type=<otp>`. Supabase's `auth.admin.generateLink` actually emits the legacy `token_hash` query params on the verify URL, not PKCE, so we handle both for forward compatibility. Calls `exchangeCodeForSession` or `verifyOtp` accordingly. Reads `?next=`, validates via `safeNextPath` (default `/portal`), 302s on success. Any failure 302s to `/login?error=<code>&next=<original>` so the user lands back on the form with their intended destination preserved.
  - **`/login` page** (`src/app/login/page.tsx` + `page.module.css`) — single-screen Client Component, dark palette, mobile-first, 48px tap targets, dash-free per Hard rule #8. Stages: `form` → `submitting` → `sent` | `error`. Role toggle is a `radiogroup` with two pill buttons ("I am the parent" / "I am the player"); player mode swaps the label from "Your email" to "Parent's email" + adds the "the link goes to your parent" hint. Inline alert renders both server-side callback errors (via `?error=` from `/auth/callback`) and client-side fetch errors. Suspense wrapper around `useSearchParams` for the Next 15 build.
  - **`POST /api/auth/signout`** — `supabase.auth.signOut()`, returns 200. Trivial route for the future portal nav's "Sign out" button. Idempotent.
  - **Intake/submit refactor** — `src/app/api/intake/submit/route.ts` now imports `sendParentMagicLink` instead of calling `generateLink + resend.emails.send` inline. Welcome-email copy preserved verbatim via the helper's copy overrides (`subject`, `headline`, `bodyHtml`, `ctaLabel`). Drops the `APP_URL` constant + the Resend/template imports that were only used for the welcome. Functionally a no-op against the test suite from "Intake backend complete."
  - **Flags carried forward:**
    1. **`/portal` and `/play` don't exist yet.** The callback redirects to them and they currently 404. Building them is downstream of Task 6 (client portal work). Until then, a successful sign-in lands on a 404 — the session cookie is set correctly, so the moment the routes are added, sign-in works end-to-end without changes here.
    2. **Resend in dev still hits the live Resend API.** Same posture as the intake routes (see "Intake backend complete" flag #1). Magic-link URLs go to real inboxes; for local visibility while building portal nav state, send to a real address or add a dev-only `console.log` of `linkResult.data.properties.action_link` in `src/lib/supabase/auth.ts`.
    3. **Player login resolves the OLDEST player in the family.** MVP families are 1-kid, so this is a non-issue. When multi-kid lands, `/login` needs a "which kid?" step — probably a second screen that lists kids by first name after the email is entered. Helper signature already takes a `playerId` shape via the family-of-1 lookup; multi-kid would change the API to `sendPlayerMagicLink(supabase, parentEmail, playerId, opts)`. Schema already supports it; UX work only.
    4. **No rate limit on `/api/auth/send-magic-link`.** Resend's per-recipient limits are the backstop. Acceptable at 1–10 client scale; revisit when the TikTok funnel is live and someone tries to use the endpoint as an outbound-email cannon.

- **Parent /portal (trial state) complete (2026-05-17, night).** First slice of Task 7. Server-rendered parent dashboard at `/portal`. Auth + role gate, calm informational tone (no rarity colors, no XP bar — parent isn't a player). `npx tsc --noEmit` clean.
  - **Files:** `src/app/portal/page.tsx` (Server Component, ~280 lines incl. quest config + render) + `src/app/portal/PortalClient.tsx` (sign-out + nudge Client Components) + `src/app/portal/page.module.css` (scoped, mobile-first, dash-free).
  - **Auth + role gate at the top of `PortalPage()`:**
    1. `supabase.auth.getUser()` → if no session, `redirect("/login?next=/portal")`.
    2. `parents` lookup by `auth_user_id`. If row exists → render.
    3. If no parent row → check `players` by `auth_user_id` → `redirect("/play")` (the user is a kid on the wrong tab; route 404s today but the routing decision is correct).
    4. If no player row → check `coaches` by `auth_user_id` → `redirect("/admin")` (Tim on the wrong tab; 404s today).
    5. If no role row at all → `redirect("/login?error=no_role")` (orphan auth user).
  - **RLS posture:** the page uses the cookie-bound client (`createClient()`, not the service-role client), so every query passes through `family_id_for_user()` and only the family's own rows surface. The cross-role lookups in the no-parent branch (players, coaches) rely on `players_family_select` / `coaches_self_select` respectively.
  - **Sections rendered:**
    1. **Hero** — "Welcome, [parent first name]" + "[kid first name]'s free trial is in motion."
    2. **Free call scheduled** — placeholder card pointing the parent at the Calendly confirmation email for date / reschedule. We don't store the Calendly event URI on `subscriptions` yet (see follow-ups). Card name-drops the kid's Discord username so the trust framing is reinforced.
    3. **Prep checklist** — mirror of the kid's 4 quests (`signup`, `drop_vod`, `answer_questions`, `join_discord`). Reads `quest_completions` filtered by `player_id`. Done rows render with a green check + `doneLabel`; incomplete rows render the parent-facing blurb + a "Nudge by email" button (inert client toast for now). Progress pill shows `X of 4`.
    4. **What to expect** — static bullets covering the 30-min Discord call, the no-charge trial, $56/mo for 4 lessons, 24hr-cancel = credit, private-channel + parent-observer trust posture. All dash-free.
    5. **Your controls** — 3 empty-state cards (Billing, Call recordings, Message audit) rendered with dashed borders + intentional empty-state copy. Trail row has a disabled "Cancel trial" button + a "cancel through Calendly for now" hint (real cancel flow lands next phase).
    6. **Contact** — `mailto:tim@xplkeyed.com` strip.
    7. **Footer** — "Signed in as [email]." for confirmation.
  - **Client Components (`PortalClient.tsx`):** `SignOutButton` (POSTs `/api/auth/signout`, then `router.replace("/login")` + `router.refresh()`); `NudgeButton` (`window.alert` with a "coming soon" message that name-checks the kid). Both stay tiny so the page can remain a Server Component.
  - **Smoke trace (manual):** unauthed → /login. Parent-with-trial → portal renders. Player-on-wrong-tab → /play (404 today). Coach-on-wrong-tab → /admin (404 today). Orphan auth user → /login?error=no_role. RLS chains verified against `family_id_for_user()`.
  - **typedRoutes workaround documented in-file.** Next 15 `experimental.typedRoutes` rejects redirect targets that include query strings (`/login?next=/portal`) or that point at routes that don't have page files yet (`/play`, `/admin`). The page declares a tiny `redirect(url: string): never` wrapper that casts through string and re-throws so flow-narrowing still sees the `never` return. Same pattern + comment block in `PortalClient.tsx` for `router.replace`. Remove the wrappers once `/play` and `/admin` exist + the query-string redirects are templated.
  - **Supabase result-type cast pattern.** `@supabase/ssr@0.5.0`'s chained `.select().eq().maybeSingle()` doesn't always propagate the `Database` generic through to the row type — the chain falls back to `never` on some shapes (notably when the `.eq` column is nullable, e.g. `parents.auth_user_id`). The page declares `ParentLookup` / `PlayerLookup` / `SubscriptionLookup` / `QuestLookup` / `IdLookup` shapes and casts each `.data` at the boundary. Runtime payloads match by construction (columns are in the schema; RLS filters rows, not columns). If `@supabase/ssr` ships a fix in a later version, the casts can be removed.
  - **Open follow-ups (deferred, NOT blocking the rest of Task 7):**
    1. **Trial-call date wiring.** Right now the "Free call scheduled" card says "check your Calendly email." Wiring the real date requires: pass `event_scheduled.payload.event.uri` from `src/app/intake/page.tsx` to `/api/intake/submit`, add `trial_call_event_uri` + `trial_call_at` columns on `subscriptions` (small migration), populate them on intake submit and update them from the Calendly `invitee.created` webhook. Then `/portal` reads + renders date / time / "Reschedule" deep link inline. Forward-compatible — not adding now doesn't break anything; the Calendly confirmation email is comprehensive on its own.
    2. **Nudge-by-email endpoint.** Currently inert client toast. Real impl: `POST /api/portal/nudge` taking `{quest_key, kid_id}`, authorizes via cookie-bound session + family check, sends a branded Resend email to the parent's inbox with copy directed at the kid ("Hey [kid], your parent is wondering when you'll [quest]") per the synthetic-email override pattern from `src/lib/supabase/auth.ts`. Rate-limit per-quest-per-day so the kid doesn't get spammed.
    3. **Real cancel-trial flow.** Currently a disabled button. Real impl: confirm modal + POST endpoint that calls Calendly DELETE on the trial event, sets `subscriptions.status='canceled'`, optionally cleans up auth users. Multi-step backend dance — warrants its own task.
    4. **Multi-kid kid selector.** Page picks the oldest player by `created_at`. CLAUDE.md spec calls for a kid-selector tab in the nav when the family has 2+ players. Schema supports it; UI deferred until a real multi-kid family lands.
    5. **`/portal` is the entire trial-state path.** After Tim hits "Take on" + parent subscribes, the same `/portal` URL needs to render an `active` subscription dashboard (live cycle counter, billing history, call recordings, message audit, parent-talking-points feed). That's a major branch on `subscription.status` and is its own task downstream of Stage C conversion.

- **Kid /play (trial-state quest log) complete (2026-05-17, night).** Second slice of Task 7. Server-rendered page + interactive Client Component + 3 POST endpoints. `npx tsc --noEmit` clean.
  - **Files:**
    - `src/app/play/page.tsx` — Server Component. Auth + role gate (mirror of /portal but inverted: parent→/portal, coach→/admin). Fetches player, parent first name (via family_id RLS), quest_completions, latest vod_uploads, prep_responses. Passes initial state into PlayClient.
    - `src/app/play/PlayClient.tsx` — Big interactive Client Component. Owns local form state per quest; calls POSTs and `router.refresh()` after success so the server state stays canonical. ~330 lines.
    - `src/app/play/page.module.css` — Gamified palette: rarity stripe on the left of each quest card (uncommon → rare → epic → legendary), XP bar with lime-to-legendary gradient, tap-card option grid for Q1/Q2, locked-card grayscale, locked Lesson Library + Message Tim cards with dashed borders.
    - `src/app/api/play/vod/route.ts` — Inserts `vod_uploads` (source='paste_url', is_initial_trial_vod=true) + marks `quest_completions.drop_vod`. UNIQUE(player_id, quest_key) makes the marker idempotent.
    - `src/app/api/play/prep/route.ts` — Inserts `prep_responses` + marks `quest_completions.answer_questions`. **Enforces the Q2-before-Q3 sequence server-side** (refuses the write if `drop_vod` quest isn't already completed) so a hand-crafted POST can't skip the gate the UI imposes.
    - `src/app/api/play/discord-join/route.ts` — Trust-based marker. Just writes `quest_completions.join_discord` on click. Real Discord OAuth (kid authorizes the app, we check guild membership) is the upgrade-later path; CLAUDE.md spec is fine with trust-based here because the call literally happens in Discord.
  - **Quest model:**
    - **Q1 Signup** (uncommon green) — done at intake, +25 XP. Auto-completed.
    - **Q2 Drop VOD** (rare blue) — paste URL form. Twitch / YouTube / Medal / Streamable any public link works. Validated with `z.string().url()` server-side. UI is one-shot; once submitted, shows the saved link as a clickable badge.
    - **Q3 Answer 3 questions** (epic red) — locked until Q2 is done (UI + server gate). 7-option tap card for Q1 (frustration), 7-option for Q2 (goal), free-text Q3 (rewatch reflection). Q3 surfaces a "Open your clip" link back to the VOD so the kid can actually rewatch per the spec's instruction. "Other" picks open a 1-sentence text input. One-shot — `prep_responses` has UNIQUE(player_id) and there's no kid-side UPDATE policy.
    - **Q4 Join Discord** (legendary orange) — opens `https://discord.gg/REPLACE_ME` (hard-coded placeholder; replace with Tim's real coaching server invite when the server is set up) plus a "I'm in the server" CTA that fires the trust-based completion.
  - **RLS posture (kid's session):**
    - Page reads: `players_family_select`, `parents_family_select`, `quest_completions_family_select`, `vod_uploads_family_select`, `prep_responses_family_select` — all gated by `family_id = family_id_for_user()` which resolves to the kid's family via the UNION branch in the helper.
    - Endpoint writes: `vod_uploads_kid_insert`, `prep_responses_kid_insert`, `quest_completions_kid_insert` — all WITH CHECK `player_id = player_id_for_user()`. A forged player_id in the body cannot succeed even if the route forgets to scope manually.
  - **Smoke trace (manual):**
    1. Unauthed → `/login?next=/play`.
    2. Fresh-intake player → XP bar at 25%, Q1 done, Q2 form open, Q3 locked, Q4 form open.
    3. VOD submit → Q2 done, Q3 unlocks with "Open your clip" link.
    4. Prep submit → Q3 done with the 3 saved answers visible.
    5. Discord click → Q4 done, "You're in the server" badge.
    6. Parent on /play → /portal redirect. Coach on /play → /admin redirect.
  - **TS workarounds documented in-file** (same shape as /portal):
    1. `redirect(url: string): never` wrapper for typedRoutes / query-string / not-yet-built routes.
    2. `.maybeSingle()` result rows cast through declared `*Lookup` types to dodge `@supabase/ssr@0.5.0`'s `never` regression.
    3. `.insert()` payloads typed via `TablesInsert<"...">` from `@/types/db` and cast through `as never` to bypass the chain-generic regression on the insert side. Cleaner than `as any`; correct at runtime by construction.
  - **Open follow-ups (NOT blocking Task 7 slice (c) — Tim's admin):**
    1. **Discord invite URL.** Hard-coded `https://discord.gg/REPLACE_ME`. Peter needs to swap this once Tim's coaching server is set up. Could be promoted to `NEXT_PUBLIC_DISCORD_INVITE_URL` env var; not worth the indirection at 1-kid scale.
    2. **Polish layer.** Spec calls for confetti on quest completion, +25 XP floats animating off the row, level-up sound (muted by default with toggle). All deferred. The XP bar transition is wired; reduced-motion is respected.
    3. **Re-submit affordances.** Both VOD and prep are one-shot (no kid-side UPDATE policy). If a kid needs to swap clips or fix an answer, they email Tim and Tim updates via service role. Real re-submit would need an UPDATE RLS policy on `vod_uploads` / `prep_responses` and an `UPDATE` branch in the routes. Document the kid-facing workaround in the form copy when it becomes a real friction.
    4. **Real Discord OAuth.** Current join verification is trust-based. Upgrade path: kid authorizes the XPL Keyed Bot's OAuth scope, the route uses the bot token + Discord REST `GET /guilds/{id}/members/{user.id}` to verify they're actually in the server before marking the quest done.
    5. **Countdown timer + live "Join Discord call" CTA.** The page renders a disabled "Locked until call time" button. Wiring requires storing the Calendly event time on the subscription (same follow-up flagged on /portal) plus a client-side ticker that re-enables the button 15 minutes before. Deferred with /portal's trial-call wiring.

- **Tim's /admin (trial-window view) complete (2026-05-17, night).** Third slice of Task 7. Coach-gated dashboard. Coach login plumbing bundled in (auth helper, /login role, magic-link route branch). `npx tsc --noEmit` clean.
  - **Migration `20260517000700_admin_columns.sql`** — adds `coaches.email TEXT NOT NULL` (backfilled to `tim@xplkeyed.com` for the seeded Tim row, defensive fallback for any extras, NOT NULL flip is DO-block-guarded so the migration is re-runnable) + a unique lower-case index on email + `players.discord_channel_url TEXT` (nullable). Idempotent (`IF NOT EXISTS` on column adds + index). **Apply with `npm run db:reset` or `supabase migration up`. Then regen types: `npm run gen:types`** — `src/types/db.ts` still reflects the pre-700 schema; the admin code is shipped with explicit `as never` casts at write boundaries until regen.
  - **Coach login plumbing:**
    - **`src/lib/supabase/auth.ts`** — new `sendCoachMagicLink(supabase, coachEmail, opts)`. Mirror of `sendParentMagicLink` but looks up `coaches` by email + `is_active=true`, defaults `next=/admin`, branded subject "Sign in to XPL Keyed admin." Same `MagicLinkResult` shape.
    - **`/api/auth/send-magic-link`** — body schema accepts `role: 'parent' | 'player' | 'coach'`; switch dispatches to the matching helper.
    - **`/login`** — 3-button role toggle (Parent / Player / Coach) replacing the 2-button pair. CSS `roleRow` widened to `repeat(3, 1fr)`. Email label flips to "Your coach email" + placeholder copy when Coach is selected. No-enumeration policy unchanged.
  - **`src/app/admin/page.tsx`** — Server Component. Coach gate is the load-bearing piece:
    1. `supabase.auth.getUser()` → unauthed redirects to `/login?next=/admin`.
    2. `coaches` lookup by `auth_user_id`. If row matches → use it.
    3. **Auto-link branch (self-healing):** if no row matched the auth_user_id but the seed left a coach with the same email and `auth_user_id IS NULL`, use the service-role client to write `auth_user_id = user.id` on that coach row. Cookie-bound client can't do this UPDATE because the coach RLS only matches once `auth_user_id` is set — chicken-and-egg. The service-role write happens exactly once per coach lifetime.
    4. Fallback role-redirect tree (parent → /portal, player → /play, orphan → /login?error=no_role).
  - **Data fetched in one page-render:** all subscriptions ordered by created_at desc, the matching players (via `IN (player_ids)`), parents (via `IN (family_ids)`), `quest_completions`, latest VODs (most recent per player by sort + first-wins map), prep responses, plus waitlist count + oldest entry. Two-phase: subscriptions first, then a parallelized `Promise.all` for the rest. Index helpers (`playersById`, `parentByFamily`, `questsByPlayer`, `vodByPlayer`, `prepByPlayer`) flatten the data into a per-trial-card shape passed into the Client Component.
  - **`AdminClient.tsx`** — coach-tone palette (no rarity gamification — functional badges only):
    - **Stats strip:** `Paying X / 12` (turns epic-red when at capacity), `Trials this week`, `Waitlist N (oldest Yd)`, `Revenue MTD $0` (stubbed; flagged inline as wiring up with the Stripe webhook).
    - **New Trials section:** one card per trial subscription. Header has kid first name + age + "Prep X/4" badge (turns uncommon-green at 4/4). Sub-line has IGN / rank / platform / hours per week. Quest chips row (functional rarity per quest state). Parent name + email mailto. Kid Discord username. Latest VOD URL link. Prep block with Q1 frustration / Q2 goal / Q3 rewatch (slug-to-label translation maps for Q1 + Q2). **Inline Discord channel URL form** — Tim pastes the per-kid private channel invite, submit hits `PATCH /api/admin/players/[id]`, router.refresh on success.
    - **Active Clients list:** one row per `subscriptions.status='active'`. Shows kid + parent first names + `Cycle X/4` + `Cancels X/2` pills. Stage C take-on / decline UI lands here in a later task.
  - **`/api/admin/players/[id]/route.ts`** — PATCH endpoint. Zod body `{ discord_channel_url: string|null }` (URL-validated; empty string normalized to null). Auth gate: getUser → defensive coach lookup (RLS would also stop a non-coach but we 403 early for cleaner error semantics). Update via cookie-bound client; `players_coach_all` RLS permits. Scoped narrowly today; coach notes / VOD pre-call review / Stage C status all drop in here without route sprawl.
  - **Smoke trace:** unauthed → /login. Linked coach → renders dashboard. First-time coach (email match, auth_user_id NULL) → auto-link writes, then renders. Parent → /portal. Player → /play. Orphan → /login?error=no_role. Discord URL save → DB persists, card refreshes via `router.refresh()`.
  - **TS workarounds (pre-regen db.ts):**
    1. Existing redirect/result-cast patterns from /portal + /play.
    2. **`coaches.email` SELECT and `players.discord_channel_url` UPDATE** — both columns added by migration 700 but not yet in `src/types/db.ts`. Reads cast through declared `*Lookup` types. The two writes (`coaches.update({ auth_user_id })` and `players.update({ discord_channel_url })`) cast through `as never`. All inline-commented. After `npm run gen:types` the casts can tighten back to `TablesUpdate<"...">` literals.
  - **Open follow-ups (NOT blocking the rest of MVP):**
    1. **Tim's email + inbox.** Migration seeds `coaches.email='tim@xplkeyed.com'`. That domain forwards nowhere yet (Setup item #3 still open). For local dev Peter should `UPDATE coaches SET email='peteraugros@gmail.com' WHERE display_name='Tim'` so magic links land somewhere he reads. Production swap back when the inbox is set up.
    2. **Stage C panel.** Active Clients row + New Trial card both need the "Take Jake on / Not the right fit / Still deciding" buttons + curriculum drafter. Own task.
    3. **Upcoming Calls list.** Spec calls for a list with prep-completion indicators per kid. Trial-call dates aren't stored on subscriptions yet (paired with /portal's trial-call wiring follow-up). Curriculum-slot calls live in `curriculum_slots.live_call_at` and can already be queried — but there are none until Stage C ships.
    4. **Revenue MTD.** Stubbed at $0. Real wiring: query Stripe invoice events (or our own audit log of paid invoices) for the current calendar month, sum the paid amounts. Lands with the Stripe webhook + dashboard polish task.
    5. **"Message parent" inline composer.** Today the parent email is a `mailto:` link. Spec calls for a one-click composer with templated subject/body. Defer until the message audit feature lands (CLAUDE.md "Parent has read-only access to ALL messages between kid and Tim").
    6. **Coach login UX in production.** First-time coach sign-in works via the email auto-link, but a coach who somehow ends up with a stale `auth_user_id` mismatch (e.g. account deletion + re-create) has no recovery path. Add a `/admin/relink` endpoint or a manual SQL recipe if it ever happens.

- **Branded booking confirmation email (2026-05-17, night).** Calendly's stock invitee email was bad enough to flag during testing (verbose default copy, host display name leaking through, mailto from the Calendly account owner). We now own the parent-facing confirmation via the `invitee.created` webhook handler — Calendly's email gets disabled in their UI, our handler sends a Resend email in the XPL Keyed voice. `npx tsc --noEmit` clean.
  - **File touched:** `src/app/api/calendly-webhook/route.ts`. Extended `InviteePayload` type with the `invitee.created` fields (name / first_name / email / timezone / questions_and_answers / scheduled_event.start_time + cancel_url / reschedule_url for later). Replaced the no-op `invitee.created` branch with `handleInviteeCreated()`.
  - **Email content:** Subject `You're booked. See you Saturday, May 23.`; body opens "Hi [parent first name], You're all set for a 30 minute free intro call with Tim" + `When:` / `Where:` block + "What happens next" paragraph with the kid's Discord username name-checked + 3-bullet reminders + sign-off as "Peter, (Tim's dad, who runs the back end of XPL Keyed)." All dash-free per Hard rule #8; bullets are `<ul><li>` (markup, not visible hyphens).
  - **Time formatting:** `Intl.DateTimeFormat` in the invitee's timezone (from `payload.timezone`, falling back to `America/Los_Angeles`). Custom `formatTime` helper lower-cases the AM/PM, drops the space ("2:30pm" not "2:30 PM"), and strips the daylight/standard distinction from US zones (PDT → PT, EST → ET, CDT → CT, etc). Non-US zones keep whatever Intl emits.
  - **Q&A field matching:** by `position`, not question text. Position 2 is kid Discord per the Calendly event-type setup notes. Robust to question-label edits.
  - **From line:** `Peter (XPL Keyed) <tim@xplkeyed.com>`. Inbox at tim@xplkeyed.com still doesn't forward anywhere (Setup item #3 below), so replies land in the void until Peter wires forwarding. Once that's done the email is end-to-end production-quality.
  - **Reschedule handling:** for now `invitee.created` triggered by a reschedule (`rescheduled_from` set) sends the same email — confirms the new time, content reads identically. Reschedule-specific copy ("Your call has been moved to...") is a follow-up.
  - **Paid-lessons branch:** every `invitee.created` we currently see is a trial intro call (Calendly is intake-only at MVP). When paid lessons become Calendly-bookable, this handler needs a `scheduled_event.event_type` branch to discriminate trial vs paid. Flagged inline.

- **End-to-end test sweep + polish (2026-05-17 late night).** Live testing exposed a long list of copy + UX + bug items. All shipped this turn; `npx tsc --noEmit` clean.
  - **Marketing site CTAs unified.** All 7 trial-flow buttons (nav desktop + mobile, hero, pricing trial card, single-lesson card, monthly card, bottom hero) now route to `/intake`. Removed the dead `https://calendly.com/REPLACE-WITH-YOUR-LINK` placeholders and the `mailto:REPLACE@EMAIL.COM` paid-tier links. Paid tier card buttons now read "Start with the free call" — matches the locked Stage-C-Tim-initiated playbook (no self-serve subscribe path). Also added a "Sign in" link to the nav (desktop + mobile drawer) that points at `/login` so returning users have a discoverable path back to their dashboard.
  - **`/login` restructured into Server + Client.** Was a single Client Component; split into `src/app/login/page.tsx` (Server Component shell) + `src/app/login/LoginForm.tsx` (Client form). The shell checks the cookie session before rendering and auto-redirects signed-in users to their dashboard (parent → `/portal`, player → `/play`, coach → `/admin`). Closes the "browser remembers me" loop — hitting `/login` while still inside a 30 day session jumps straight to the right dashboard, no email round trip. Form falls through for unauth + orphan sessions.
  - **Coach role hidden from public sign in.** The `/login` Coach button only renders when the URL has `?role=coach`. Tim bookmarks `xplkeyed.com/login?role=coach`. Parents and players never see "Coach" on their sign in surface. Role row CSS switched from a fixed 3-column grid to flex so the layout doesn't leave an empty column when Coach is hidden — buttons flex 50/50 (two visible) or ~33/33/33 (three visible).
  - **`/auth/callback` converted from route handler to Client Component page** (`src/app/auth/callback/page.tsx`). Handles all three Supabase credential shapes: PKCE `?code=`, OTP `?token_hash=&type=`, and **hash fragment `#access_token=&refresh_token=`** (which the older Supabase verify endpoint emits and a server route handler can't see — the browser strips hashes before the request reaches the server). Uses `window.location.replace()` for a hard navigation to the destination so the next page reads fresh auth cookies and the callback page exits the React tree cleanly. Empty `useEffect` deps prevent the earlier "infinite render" loop (was `[router]` + `router.refresh()` retriggering the effect endlessly).
  - **`/portal` parent dashboard rebuilt around the player-access pain point.** New "Player access" card above the prep checklist with `SendPlayerLinkButton`: clicking POSTs to `src/app/api/portal/send-player-link/route.ts`, which uses service-role to fire `sendPlayerMagicLink` against the authed parent's own email (the endpoint never accepts an email from the client — keeps the trust gate tight). On success the card flips to "Link sent to [email]. Forward to [kid] or hand them the device." Plus a "Send another link" reset button.
  - **`/portal` copy fixes (driven by testing):**
    - Free-call card now reads "Tim will send the invite to [kid first name] ([discord]) before the call" (was "posts the server invite to [discord]" — added kid name).
    - Prep checklist body explains VOD in parent vocabulary: "[kid] uploads a recorded clip from a recent Fortnite game and Tim watches it to get ready for the call. [kid] knows what this is. It's called a VOD, short for video on demand, and [kid] sees these all the time." (Replaces the parent-unfriendly "Tim watches the VOD and reads the prep answers.") Also fixed "their player view" → "the player view."
    - "Player access" body: "[kid]'s sign in link will be sent to your email, not theirs. Click the button below to send it, then forward the email or hand them the device when you're ready. You'll only need to do this once. [kid] will stay signed in for 30 days as long as the browser isn't reset or cleared." (30 day claim is conservative — Supabase refresh-token TTL is typically longer than that; the "as long as cookies persist" caveat is fully accurate.)
    - What-to-expect bullets: "$56 a month for 4 lessons" → "$56 for 4 lessons (one per week)." Cancel rule expanded from one bullet to two: 24hr+ cancel = cycle pauses one week / full credit; plus "Up to 2 cancellations per 4 lesson cycle. A 3rd cancel ends the subscription."
    - Footer now reads "Signed in as [email]. Bookmark this page so you can return any time." (added bookmark hint).
  - **`/play` kid quest log simplified + reframed:**
    - **Deleted the "Free Call / Join Discord call" card.** It rendered a permanently-disabled "Locked until call time" button; no call-time data is stored anyway and the kid gets the time via the calendar invite. Cleared the visual clutter between the XP bar and the quest log.
    - **Quest 1 (Signup)** collapsed to one line: title "Sign up, DONE!" + body "Welcome to the squad." Dropped the redundant "+25 XP" chip on this always-done quest.
    - **Quest 2 (VOD) badge contrast bug fixed.** The "2" disc was invisible (dark-navy text on rare-blue background, same hue family). Badge text color is now white across all four rarity backgrounds.
    - **Quest 4 (Discord) reframed to Tim-sends model.** Dropped the dead `https://discord.gg/REPLACE_ME` "Open invite" button + the `DISCORD_INVITE_URL` constant. Single button now reads "I accepted the invite." Copy: "Tim will send you an invite to the XPL Keyed coaching server. Look for it in Discord, accept it, then tap below. Your private channel goes live after you join." Aligns with the booking confirmation email's claim that Tim sends invites (per the spec: Tim creates per-client private channels manually).
    - **XP one-liner hint** under the bar: "Earn XP for each quest. More coming after your first paid cycle." Sets expectations without overpromising.
    - **Hero copy:** "...so we can hit the ground running." (was "Tim can hit the ground running" — softened to first-person plural; the kid is part of the team).
    - **Footer:** "Your parents can see every message and quest you submit. No DMs with Tim. Coaching only happens in the server." (Was using parent first name; switched to generic "parents" since older kids might find name-checking weird.) `parentFirstName` prop dropped from `PlayClient`; the parent-lookup query was removed from `/play/page.tsx` (one fewer DB round trip per `/play` render).
    - **Subtle bookmark hint** below the hero body: "Bookmark this page so you can come back any time."
    - **Decision NOT taken: collapse to single auth.** Considered making parent auth cover both `/portal` and `/play` (one sign-in for everything), but Peter chose to preserve the kid identity. "Kid is the actor" trust signal > one-click friction reduction. Parent's "Send Jake's sign in link to my email" stays the primary first-time path.
  - **Branded booking confirmation email — multiple revisions:**
    - **Position indexing bug fixed.** Calendly's `questions_and_answers` are **0 indexed**, not 1 indexed. The handler was reading position 1 (Discord username) into `kidFirstName`. Past emails like "Jake is all set" were actually displaying "jakedc" (Jake / jakedc same first letter, easy to miss). David exposed it ("davedc is all set"). Now `findByPos(0)` = first name, `findByPos(1)` = Discord username.
    - **From line** is explicitly `XPL Keyed <tim@xplkeyed.com>` (regex-strips any display name from `FROM_EMAIL` env and re-wraps). Gmail's self-recipient name substitution still happens for Peter, but real parents see "XPL Keyed."
    - **Body refactored:** opens with "[Kid] is all set for a 30 minute free intro call with Tim" (uses real first name, not the Discord username). "What happens next" reads "be sure to accept the invite Tim will send to [Kid]'s Discord username ([discord]). That's where the call will happen." (was "to JakeFN", which exposed the position bug and read like a Discord-DM-to-handle rather than the action-framed "be sure to accept"). Removed "You'll be invited too, as an observer" line. Reminders bullet rewritten: "Parents are welcome to listen in on the first call and ask questions at the end." (was "A parent should be present for the first call" — defensive). "Tim never calls or texts your phone." (was "We never call or text your phone." — direct attribution).
    - **Bookmark footnote** appended via `deliver()` in `src/lib/supabase/auth.ts` — every magic-link email (welcome, parent re-auth, player re-auth, coach re-auth) gets a small "Need to come back later? Sign in any time at xplkeyed.com/login." line above the brand footer. Same line added directly to `bookingConfirmationHtml`.
  - **Intake success card** rewritten to be parent-facing (was kid-facing copy implying the parent was someone else). New copy: "Nice work! We emailed you at [parent email] with a sign in link. Tap it and your dashboard opens." Plus a real **Done** button below the success card (href `/`) — the "DONE" text in the progress strip was a label, not a button, and parents clicked it expecting navigation. Now there's an actual primary CTA. Dropped the kid-context "Tim wants to watch a clip" / "Drop a VOD" mention; that lives in `/play`.
  - **Intake L1 field label** changed from "What's your first name?" → "Student first name" (matches the parent-as-form-filler reality; the kid name is data, not a personal question).
  - **`.env.local` `RESEND_FROM_EMAIL`** updated from bare `tim@xplkeyed.com` to `XPL Keyed <tim@xplkeyed.com>` so Gmail and other clients render "XPL Keyed" as the sender display across all FROM_EMAIL-derived emails. Requires `npm run dev` restart to pick up.
  - **`src/app/layout.tsx`** got `suppressHydrationWarning` on the `<html>` element. Browser extensions (Scribe, Grammarly, LastPass, etc) inject attributes onto `<html>` before React hydrates; without the suppress, Next.js dev overlay surfaces a spurious warning. Only suppresses the warning on `<html>` itself, not children.

- **In-app messaging surface complete (2026-05-18, early morning).** Task #8 from "Next coding tasks." Replaces the email contact path. Kid (on `/play`), parent (on `/portal`), and Tim (on `/admin`) all see the same `messages` thread per player. `npx tsc --noEmit` clean.
  - **No migration needed.** The `messages` table + RLS policies (`messages_coach_all`, `messages_kid_select`, `messages_kid_insert`, `messages_parent_select`) were already in the initial schema. Just wired the UI + endpoints.
  - **Shared `MessageThread` component** at `src/components/MessageThread.tsx` (+ scoped CSS module). Renders messages chronologically with own-vs-other bubbles, sender labels translated per viewer role (player sees "You" vs "Tim", coach sees "You (Tim)" vs kid first name, parent sees "Tim" vs kid first name), optional composer (player + coach send; parent is read-only). Visibility hint *"Your parents can read every message in here"* renders above the player's input. Auto-scrolls to latest on mount + new message. Optimistic append on send + `router.refresh()` so the server-rendered initial state stays canonical.
  - **`/play` "Message Tim" card unlocked.** Replaced the dead "Locked. Opens after Tim takes you on" card with a real `MessageThread` (viewerRole=player, endpoint=`/api/play/message`). Trial-state messaging is open from day 1 — explicit decision per testing conversation, since the whole point of building this was to replace the email-contact path that was bouncing.
  - **`/portal` Messages section.** New card between Prep checklist and What to expect; `MessageThread` with viewerRole=parent + endpoint=null (read-only). Replaces the empty-state "Message audit" card that used to live in the Your controls grid (which is now 2 cards instead of 3). Contact strip at the bottom rewritten: dropped the `mailto:tim@xplkeyed.com` link; now reads *"Have [kid] message Tim in the Messages panel above."*
  - **`/admin` Messages per client.** Each New Trial card and Active Client row now has a `Messages with [kid]` block at the bottom with the full thread + reply composer (viewerRole=coach). Coach writes with sender_role=coach, sender_id=coach.id. `activeRow` in the page Server Component picked up a `player_id` field (was missing) so the admin composer can scope the insert correctly.
  - **Booking confirmation email** "Questions?" line rewritten: was *"reply to this email and Tim or I will get back to you within 24 hours"* (which bounced because xplkeyed.com has no MX); now *"Sign in to your XPL Keyed dashboard and message Tim in the Messages panel. Tim sees it and replies there."* Closes the email-bounce gap without needing to fix MX records.
  - **Endpoints:**
    - `POST /api/play/message` — kid sends. Resolves the player from auth.uid, inserts with `sender_role='player'`, `sender_id=auth.uid`. Returns the inserted message row for optimistic UI append.
    - `POST /api/admin/message` — Tim sends. Defensive coach lookup (RLS would catch a non-coach too). Body specifies `player_id` (Tim chooses which thread). Inserts with `sender_role='coach'`, `sender_id=coach.id`.
  - **Real-time NOT wired.** Both surfaces rely on `router.refresh()` after send + page reload to fetch new messages. Polling or Supabase Realtime subscription can layer on later. Acceptable for 1–10 client scale.
  - **Open follow-ups (not blocking):**
    1. **Real-time / push notifications.** Today: kid sends, Tim sees on next page refresh / open. Supabase Realtime subscription on the `messages` table filtered by `player_id` would give live updates. Web Push (the existing VAPID setup) could notify the kid when Tim replies.
    2. **Read receipts.** The `messages` schema has `read_by_recipient_at` + `read_by_parent_at` columns that we're not yet writing to. Useful for "you have an unread reply from Tim" badge in the future.
    3. **Bot messages.** The schema supports `sender_role='bot'` for system messages (e.g., "Tim added you to the coaching server" auto-message after Quest 4 completes). Not wired yet.
    4. **MX record fix still useful (not load-bearing).** Parents who reply to OLD emails before this change still bounce. New emails route them to the dashboard. Long term, setting up forwarding at the registrar is cheap insurance for accidental "reply" hits, but no longer load-bearing because in-app messaging owns the contact channel.

- **Stage C conversion flow phase 1 complete (2026-05-18 morning).** Tim's post-trial decision panel + curriculum drafter + parent approval landing. `npx tsc --noEmit` clean. **Phase 2 (Stripe Elements + actual paid status transition) is the natural follow-up.**
  - **Stage C panel on every `/admin` trial card.** Three buttons per `CLAUDE.md` spec: **Take [Kid] on**, **Not the right fit**, **Still deciding**.
    - **Take on** expands an inline curriculum drafter (4 weeks × { kid-facing title, parent-facing skill description, VOD checkbox } + 2-sentence personalization note). Submit triggers the take-on endpoint.
    - **Not the right fit** opens a small confirmation step ("decline + send free-creator email?"); confirm fires the decline endpoint.
    - **Still deciding** collapses to a "saved for review" state with no DB write. Tim can decide later.
  - **`POST /api/admin/conversion/take-on`** (`src/app/api/admin/conversion/take-on/route.ts`):
    - Auth: defensive coach lookup on top of `coaches_self_select` RLS.
    - Inserts 1 stub `lessons` row per non-VOD week (`is_published=false`, `slides=[]`, `parent_talking_points=[]`; Tim authors real content later in his Google Slides + QuickTime workflow). The lesson row's `fortnite_label` + `parent_label` + `parent_skill_description` come from the drafter form so the conversion email has real translation copy now.
    - Inserts `curricula` row with `status='pending_approval'`, fresh `approval_token` (32-byte hex), and `personalization_note`.
    - Inserts 4 `curriculum_slots` rows honoring the `lesson_xor_vod` CHECK constraint. VOD weeks default `vod_url` to the kid's latest trial VOD if one exists, else a `xplkeyed.com/admin/needs-vod` placeholder Tim swaps in his own.
    - Sends conversion email to the parent via Resend with: 4-week plan using the parent-translation rule (real-world skill first, Fortnite term in italicized parens per Hard rule #4), Tim's personalization note, billing terms ($56 / 4 lessons / 2-cancel cap / 3rd-cancel ends), and a single CTA linking to `/curriculum/[approval_token]`.
  - **`POST /api/admin/conversion/decline`** (`src/app/api/admin/conversion/decline/route.ts`):
    - Coach-gated. Sets `subscriptions.status='declined'` (CHECK constraint already permits that value).
    - Sends a kind decline email to the parent with Mero / Reet / Pandvil free-creator recommendations per spec. Account stays open so kids who circle back later can reactivate.
  - **`/curriculum/[token]` parent approval landing** (`src/app/curriculum/[token]/page.tsx`):
    - Public route — possession of the magic-link token is the gate. Uses service-role client to look up the curriculum, slots, lessons, and parent name; nothing else is exposed.
    - Renders the 4 weeks with the parent-translation rule, Tim's personalization note in a lime-bordered call-out, billing terms with the cancel rules spelled out, and a primary **Approve plan and subscribe** button.
    - **Button is non-functional in phase 1** — clicking shows a small "Coming next phase: Stripe checkout lands here. Reply to Tim's email to activate manually." note. The preview is the value today; checkout is phase 2.
    - Renders a "You're all set" terminal state if the curriculum has already transitioned to `active` (so a parent revisiting the link post-conversion gets clean copy).
  - **`/portal` curriculum-approval banner.** When the parent's `/portal` Server Component finds a `curricula` row for their player with `status='pending_approval'`, a prominent lime-gradient banner renders right under the hero with a **Review the plan** CTA pointing at the same `/curriculum/[token]` page. Closes the "I lost the email" recovery path.
  - **Phase 2 follow-ups (not built):**
    1. **Stripe Elements embedded checkout** on `/curriculum/[token]`. Wire the existing Stripe SDK (already in `src/lib/stripe/server.ts`) to create a $56/cycle subscription against the family's stripe_customer_id. On `customer.subscription.created` webhook → flip `curricula.status='active'`, `subscriptions.tier='monthly'`, `subscriptions.status='active'`, write `cycle_started_at=NOW()`. The existing Stripe webhook handler at `src/app/api/stripe-webhook/route.ts` already handles `invoice.paid` and resets cycle state.
    2. **`/portal` active-state branching.** Currently `/portal` only renders the trial-state dashboard. Post-conversion, branch on `subscription.status='active'`: hide the prep checklist, show the live cycle counter (`X of 4 lessons this cycle`), the lesson library section (currently locked on `/play`, would unlock similarly), billing history, and call recordings (still empty until Tim uploads).
    3. **`/play` active-state branching.** Show the kid's curriculum-week-2-of-4 progression rather than the trial quest log. Unlock the lesson library card.
    4. **Sunday cron real billing wire.** The existing `cron-sunday-lesson-delivery` Edge Function has a TODO for triggering the next $56 charge when `cycle_lessons_delivered` hits 4. Wire it once Stripe subscriptions are alive.
    5. **Curriculum-drafter UX nice-to-haves.** Lesson library picker (once Tim has authored lessons, let him pick existing ones instead of stub-writing inline). Drag-and-drop reorder of weeks. Preview the conversion email before sending.

- **Stage C phase 2 complete — Stripe-hosted Checkout (2026-05-18 morning).** Paid conversion path closes: parent clicks **Approve plan and subscribe** on `/curriculum/[token]`, lands in Stripe Checkout for $56, payment flips the family's subscription to active via webhook. `npx tsc --noEmit` clean.
  - **`POST /api/curriculum/[token]/checkout`** (`src/app/api/curriculum/[token]/checkout/route.ts`):
    - Service-role token lookup (no auth — possession of the token is the gate).
    - Idempotently provisions a Stripe Customer per family (writes `families.stripe_customer_id` on first creation; future cycles reuse).
    - Creates a Stripe Checkout Session in `payment` mode (one-time $56) with `payment_intent_data.setup_future_usage='off_session'` so the card is saved on the Customer for cron-driven cycle 2+ charges (no re-prompt).
    - Inline `price_data` (`unit_amount: 5600, currency: 'usd'`) — no pre-created Product/Price needed. The product name shows the kid's first name so the parent sees "Jake's 4 lesson cycle" on Stripe's hosted page.
    - Stashes `kind:'first_cycle'`, `curriculum_id`, `subscription_id`, `family_id`, `player_id`, `approval_token` in both session and PaymentIntent metadata so the webhook can resolve rows. (Belt-and-suspenders: PaymentIntent metadata is useful when our cron creates future-cycle charges via PaymentIntent.create with the saved card.)
    - `success_url` → `/curriculum/[token]/success`. `cancel_url` → back to `/curriculum/[token]`.
  - **`ApproveButton` Client Component** (`src/app/curriculum/[token]/ApproveButton.tsx`) — replaces the placeholder button on the review page. POSTs to the checkout endpoint, then `window.location.href = session.url` for the redirect to Stripe-hosted Checkout. Hosted-redirect chosen over embedded Elements for first-cut speed; switching to embedded Elements is a swap of the same endpoint shape later.
  - **`/curriculum/[token]/success` page** — minimal "Subscription locked in" confirmation. No DB writes here; the Stripe webhook is the source of truth. A potential race exists where the parent lands here before the webhook has finished processing; for now we accept the brief "still shows pending banner on /portal" window because both paths converge in seconds.
  - **`/api/stripe-webhook` extended** — new `checkout.session.completed` branch in the dispatch switch + new `handleCheckoutSessionCompleted` function. Reads `session.metadata.kind='first_cycle'` + `curriculum_id` + `subscription_id` and flips:
    - `curricula.status='active'`, `approved_at=NOW()`.
    - `subscriptions.tier='monthly'`, `status='active'`, `cycle_started_at=NOW()`, `cycle_lessons_delivered=0`, `cycle_cancels_used=0`, `past_due_started_at=null`, `notified_at_day7_dunning=null` (defensive cleanup in case the family was previously dunning).
    - **Note: stripe_subscription_id stays NULL** in this flow. We're using one-time payments + saved card (off_session) rather than Stripe Subscription objects. Per CLAUDE.md spec: "manually-advanced cycle" — our Sunday cron will fire PaymentIntents on cycle completion rather than relying on Stripe's recurring billing engine. The Stripe Subscription object can be layered in later if we want Stripe's native cancel/pause UI; not load-bearing for MVP.
  - **`/portal` branches on subscription status.** New green/lime "Subscription active" banner renders when `subscription.status='active'`. Suppresses the pending-curriculum banner since they're mutually exclusive in practice (pending → active transition is one-shot). Below the banner everything else is unchanged from trial-state UI; **real active-state dashboard branching (live cycle counter, billing history, call recordings, lesson library) is still a follow-up.** This is just the visual ack that the conversion landed.
  - **Stage C drafter UX hint** — disabled "Send to parent" button now renders a small hint line when `canSubmit()` is false ("Fill in both fields for every non VOD week and write the personalization note to enable Send"). Closes the "I forgot the note and the button just sat there" friction Peter hit during testing.
  - **Open follow-ups (real production blockers):**
    1. **`/portal` active-state dashboard branching.** Currently the post-conversion parent sees the green banner ON TOP of the unchanged trial-state UI (prep checklist, what-to-expect, etc). That's misleading — trial copy on top of an active subscription. Real fix: server-side check `subscription.status` and render entirely different sections (Lesson library card, cycle counter, billing). Likely needs a sibling `ActivePortal` component to keep the trial code clean.
    2. **`/play` active-state branching.** Same issue. Kid still sees trial quests after conversion. Should show curriculum-week progression + unlocked lesson library.
    3. **Sunday cron live billing wire.** `cron-sunday-lesson-delivery` increments `cycle_lessons_delivered`. When it hits 4, we need to fire a PaymentIntent against the family's saved card for $56, then reset the cycle counter. Currently it's a TODO in the cron function.
    4. **Stub lesson content.** Take-on creates lessons with empty `slides=[]` and `parent_talking_points=[]`. First Sunday delivery for a paid family would email blank content. Either: build Tim's lesson-authoring UI (the planned "Add lesson" form per CLAUDE.md Stack scope), or guard the Sunday cron against empty lesson content.
    5. **Embedded Elements** instead of hosted-redirect. Spec calls for embedded inline. Hosted Checkout is fine for first cut; the swap is a one-endpoint refactor.
    6. **Customer Portal link.** Stripe has a hosted Customer Portal where parents manage payment methods + see invoices. We have `STRIPE_PORTAL_URL` in env. Add a "Manage payment" link in the /portal active banner pointing at the configured portal session URL.

- **Active-state portal branching (2026-05-18 mid morning).** `/portal` and `/play` now render entirely different content when `subscription.status='active'`. `npx tsc --noEmit` clean.
  - **`/portal` active branch:**
    - Hero copy flips: eyebrow becomes "Parent dashboard. Active." and body shifts to "[Kid]'s lessons are running. Cycle counter, billing, and messages with Tim are below."
    - **Cycle counter card** — "Lesson X of 4" + cancellations-used line ("0 of 2 used" or count) + cycle start date.
    - **4 week plan card** — lists the active curriculum's 4 slots with the parent-facing translation (parent_skill_description first, Fortnite term in italicized parens per Hard rule #4). Tim's personalization_note surfaces above the list if present.
    - **Billing + recordings card** — replaces the trial-state "Your controls" empty-state. Includes the new **Manage payment and cancel** button.
    - Trial-only sections (Free call scheduled, Player access, Prep checklist, What to expect, Your controls) all hidden via `{isActive ? … : …}` branches.
    - Messages section + contact strip + footer all stay (shared between states).
  - **`/play` active branch:**
    - Hero eyebrow flips to "Player profile. Active." and the body line becomes "Lesson [N+1] of 4 incoming Sunday. Watch the messages for anything Tim drops in the meantime."
    - **Cycle counter card** — "Lesson X of 4 dropped" + Sunday-rhythm reminder.
    - **4 week plan card** — kid-facing list (Fortnite labels only, no parent translation). "Tim is putting the slides and voiceover together. They drop here Sunday by Sunday." subtle hint.
    - XP strip + quest log + locked Lesson library card all hidden in active state. Messages section + parent-visibility footer stay.
  - **`POST /api/portal/billing-portal`** — parent-authed cookie session. Resolves family → `stripe_customer_id`. Calls `stripe.billingPortal.sessions.create({ customer, return_url: APP_URL/portal })` and returns `{ url }`. 409 if the family has no Stripe Customer (hasn't paid yet).
  - **`ManagePaymentButton` Client Component** in `PortalClient.tsx` — POSTs to the billing-portal endpoint and redirects to the returned Stripe-hosted URL. Mirrors the SendPlayerLinkButton shape; failures surface inline.
  - **Open follow-ups (deferred for sanity — none block production):**
    1. **"Next lesson drops Sunday" prediction.** Cycle counter says "Lesson X of 4" but doesn't tell parents when the next drop is. Compute next Sunday after cycle_started_at + N weeks, accounting for paused weeks. Useful but not urgent.
    2. **Lesson detail view.** Kid sees a list of week labels but no way to click into a week and view the slides + audio. Wait for the lesson-authoring UI + actual content; clicking into a stub-empty week is misleading.
    3. **Call recordings panel.** Renders an empty-state card today. Real impl: list `curriculum_slots.live_call_completed_at` rows where Tim has uploaded a recording. Storage layer not built; coach-uploads-to-bucket is its own task.
    4. **Cancel within /portal.** Stripe customer portal already has a cancel UI, so we get this for free via the **Manage payment and cancel** button. Replacing with an in-app modal that calls Stripe's API directly is a polish item, not load-bearing.

- **Lesson authoring UI shipped (2026-05-18 noon).** Tim can author lessons in a library, separate from the curriculum drafter. Stage C take-on still auto-creates stub lessons; Tim's job after take-on is to come back to the library and complete the stubs before the first paid Sunday delivery fires. `npx tsc --noEmit` clean.
  - **Migration `20260518000000_lesson_assets_bucket.sql`** — creates the private Supabase Storage bucket `lesson-assets` with a 10MB per-file limit + allowed MIME types (PNG/JPEG/WebP + MP3/MP4/WAV/M4A). RLS policy `lesson_assets_coach_all` grants the coach full CRUD on `storage.objects` filtered to `bucket_id='lesson-assets'`. No SELECT for non-coach — parents/players access via signed URLs that the app mints server-side after the normal family-id RLS check.
  - **`POST /api/admin/lessons`** (`src/app/api/admin/lessons/route.ts`): coach-gated multipart handler.
    - Parses metadata (Zod-validated against the lessons CHECK constraints), `slide_count`, indexed slide rows (`slide_<i>_image`, `slide_<i>_audio`, `slide_<i>_notes`), and per-category parent talking points (`ptp_<category>`).
    - Two-phase write: (a) INSERT the lesson row with empty `slides=[]` so we have an id for path scoping; (b) upload each slide PNG + optional MP3 to `lessons/<lesson_id>/slide-<n>.<ext>` via the service-role storage client; (c) UPDATE the lesson with the final `slides` JSONB referencing the stored paths.
    - Failure recovery: if an upload fails mid-way, the lesson row exists with empty slides — surfaces in `/admin/lessons` as a STUB and Tim can re-author it later. No orphan files because we filter by lesson_id in the path.
  - **`/admin/lessons`** (`src/app/admin/lessons/page.tsx`): coach-gated Server Component listing every lesson row. Shows title, fortnite→parent translation, topic / difficulty / duration / slide-count badges, PUBLISHED / DRAFT / STUB state. Top-of-page **stub warning** banner if any stubs exist ("Finish those lessons before the first Sunday delivery for that kid fires, or the parent email goes out empty"). Big **+ Author a new lesson** CTA.
  - **`/admin/lessons/new`** (`src/app/admin/lessons/new/page.tsx` Server Component shell + `LessonForm.tsx` Client Component): three-section form.
    1. **Metadata:** title (internal), fortnite_label (kid-facing), parent_label + parent_skill_description (translation pair), topic (enum), difficulty (enum), duration_minutes, publish toggle.
    2. **Slides** — dynamic list. Each slide row has: PNG file picker (required), MP3 file picker (optional for MVP), speaker-notes textarea. Add/remove per slide.
    3. **Parent talking points** — 5 categorized textareas with per-category hints (informed_observer, co_conspirator, cultural_literacy, good_question, strategic_note). All required per Hard rule "strategic moat."
  - **Nav link to lesson library** added to the `/admin` top bar (`AdminClient.tsx`).
  - **Open follow-ups:**
    1. ~~**Vercel 4.5MB body limit**~~ — no longer applies. Deploy host swapped to Railway (Stack section), which has no route-handler body limit. The original multipart upload path works in production as-is. If we ever migrate back to a serverless host, this becomes a real follow-up again: swap to client-side direct upload via Supabase signed URLs.
    2. **Edit existing lesson.** Today the form is create-only. To replace a stub lesson's content, Tim would author a new lesson and Stage C drafter would re-pick. Real edit (re-upload slides for an existing lesson) is a follow-up — needs UPDATE in the route + load-and-prefill in the form.
    3. **Curriculum drafter ↔ lesson library integration.** Today the Stage C drafter creates stub lessons inline (one per non-VOD week). The intended flow is: drafter shows a picker of published lessons + an "Author new" link. Smaller cosmetic refactor; mainly UI work.
    4. **Storage cleanup.** Deleting a lesson row doesn't currently delete the associated files in storage. Low priority at scale; lessons are kept for posterity anyway.
    5. **Signed-URL minting for parents/players.** Sunday cron currently has a TODO for "deliver lesson email with slides+audio." When that's wired, the cron + the /play lesson detail view will need to mint signed URLs for each slide file (1-hour TTL is typical).

- **Admin rebuild: backend foundation (2026-05-18 afternoon).** First commit of the admin rebuild per `Coach Dashboard Spec/backend-spec.md`. Data layer only — Home queue UI + Stuck button flow + Tasks abstraction land on top in later commits. `npx tsc --noEmit` clean.
  - **Migration `20260518000100_waiting_on_lifecycle.sql`** — adds two enum types and denormalizes `waiting_on` onto four state-bearing tables.
    - `waiting_on_t` enum: `TIM` | `PARENT` | `KID` | `SYSTEM` | `DAD`. Per spec section 12 we chose the denormalized field over a separate ownership table for query simplicity.
    - `lifecycle_state_t` enum: `TRIAL_PREP` | `TRIAL_SCHEDULED` | `TRIAL_DONE` | `ACTIVE` | `PAST_DUE` | `PENDING_CANCEL` | `CANCELED` | `WAITLIST`. Distinct concept from `subscriptions.status` (which stays as the Stripe-flavored field).
    - `waiting_on` added to `messages`, `curricula`, `cancellation_events`, `subscriptions`. Default `SYSTEM`. Backfilled from real data: latest-message sender_role for threads; curriculum.status='pending_approval' → PARENT; subscription.status='trial' → TIM; subscription.status='pending_cancel' → PARENT; everything else → SYSTEM.
    - `lifecycle_state` added to `subscriptions` only (other state-bearing rows derive their state from related tables). Backfilled from `subscriptions.status`: trial → TRIAL_PREP, active → ACTIVE, past_due → PAST_DUE, pending_cancel → PENDING_CANCEL, canceled → CANCELED, declined → CANCELED.
    - Partial indexes on `(waiting_on, *_at)` for fast Home queue queries — filtered to `waiting_on = 'TIM'` rows only.
  - **Migration `20260518000200_stuck_events.sql`** — new table per spec section 7. Columns: `id`, `tim_user_id` (coach FK), `object_type` (CHECK: message_thread / trial_decision / checklist_item / curriculum_approval / cancellation_event / dunning / other), `object_id` (UUID), `reason` (Tim's optional note), `resolved_by` (parent FK, NULL until Dad resolves), `resolved_at`, `resolution_type` (handled_directly / returned_to_tim / no_action_needed), `resolution_note` (Dad's note back to Tim). Three partial indexes (open events / by-object / by-tim). RLS: coach-only via `stuck_events_coach_all`. Dad's admin reads via service-role until the Dad auth surface is built.
  - **Migration `20260518000300_derived_tasks_view.sql`** — `derived_tasks_view` per spec section 6. Phase 1 unions three task sources:
    1. **`message_thread`**: latest message per kid where `waiting_on='TIM'` (DISTINCT ON player_id). Priority 50 if kid-sender, 60 if parent-sender (parent-channel reserved for future).
    2. **`trial_decision`**: subscriptions in `status='trial'` with `waiting_on='TIM'`. Priority 80.
    3. **`cancellation_event`**: cancellation_events with `waiting_on='TIM'`. Priority 20.
    - Future phase additions (deferred): checklist items, dunning day-6+, curriculum approvals (TIM-side), quiet-client check-ins.
    - View inherits RLS from source tables. Coach-authed reads see every row; non-coach reads only family-scoped rows. Home queue queries should run coach-authed.
    - Sanity check: against the existing local test data the view emits 13 tasks (one trial_decision per existing test trial family).
  - **Write paths updated** to set `waiting_on` going forward:
    - `/api/play/message` (kid sends) → `waiting_on='TIM'` on the new message row.
    - `/api/admin/message` (Tim sends) → `waiting_on='KID'`.
    - `/api/admin/conversion/take-on` → curricula INSERT with `waiting_on='PARENT'` + subscription UPDATE `waiting_on='SYSTEM'`, `lifecycle_state='TRIAL_DONE'`.
    - `/api/admin/conversion/decline` → subscription UPDATE adds `lifecycle_state='CANCELED'`, `waiting_on='SYSTEM'`.
    - `/api/stripe-webhook` `checkout.session.completed` → curricula UPDATE adds `waiting_on='SYSTEM'`; subscription UPDATE adds `lifecycle_state='ACTIVE'`, `waiting_on='SYSTEM'`.
    - `/api/stripe-webhook` `invoice.payment_failed` → subscription UPDATE adds `lifecycle_state='PAST_DUE'` (waiting_on stays SYSTEM until day-6 dunning cron flips it).
    - `/api/stripe-webhook` `invoice.paid` (recovery) → subscription UPDATE adds `lifecycle_state='ACTIVE'`, `waiting_on='SYSTEM'`.
    - `/api/calendly-webhook` `invitee.canceled` with 3rd-cancel pending_cancel → subscription UPDATE adds `lifecycle_state='PENDING_CANCEL'`, `waiting_on='PARENT'`. Audit `cancellation_events` row sets `waiting_on='SYSTEM'` (auto-classified, no Tim review yet).
  - **Open follow-ups (next phase):**
    1. **Home queue UI on `/admin`.** Server-side fetch from `derived_tasks_view` ordered by `priority_score DESC, age_in_state DESC`. Single top task in Focused-mode-Home; full list in Command-mode-Pipeline. Renders both modes off the same view.
    2. **Stuck button flow.** Button on each task surface in `/admin`. Writes `stuck_events` row. Sets the source object's `waiting_on='DAD'`. Sends Discord DM via the existing `dmTim` helper but addressed to Dad's user id. Dad's admin doesn't exist yet — that's the next-next chunk.
    3. **Trial substages.** Currently `TRIAL_PREP / TRIAL_SCHEDULED / TRIAL_DONE` all collapse to `TRIAL_PREP` on backfill because we don't yet store the Calendly event time on subscriptions. Wiring: pass `event_scheduled` URI to `/api/intake/submit`, store + transition `TRIAL_PREP → TRIAL_SCHEDULED` on `invitee.created` webhook, daily cron flips `TRIAL_SCHEDULED → TRIAL_DONE` when event end time passes. Paired with the trial-call-date wiring follow-up on `/portal`.
    4. **Day-6 dunning flips waiting_on='TIM'.** Cron-side, not webhook. Existing `cron-day7-dunning-ping` already runs at day 7; the spec wants `waiting_on='TIM'` set at day 6. Either move the cron forward a day or add a separate day-6 trigger.
    5. **Backfill imperfections.** All current trial subscriptions backfilled to `waiting_on='TIM'`, which over-classifies (the kid hasn't done the trial call yet for most). That's resolved when the Calendly substage wiring lands (TRIAL_SCHEDULED won't be TIM-waiting; TRIAL_DONE will).
    6. **`derived_tasks_view` performance.** Re-evaluated as a materialized view once volume grows. Current view recomputes on every query; fine at 1-10 client scale.

- **Admin rebuild: Focused-mode Home (Phase 1 UI) shipped (2026-05-18 evening).** First user-facing surface of the admin rebuild per `Coach Dashboard Spec/CEO/admin-spec-focused.md` section 4 ("One Thing"). `npx tsc --noEmit` clean.
  - **Server-side fetch in `/admin/page.tsx`:** queries `derived_tasks_view` ordered by `priority_score DESC, age_in_state DESC`, limit 20. Top row → Focused Home; remaining count → "X more waiting" demoted indicator. Passed to `AdminClient` as `topTask` + `remainingTasks`.
  - **`FocusedHome` component** (in `AdminClient.tsx`) renders the single highest-priority task with task-type-aware copy:
    - `message_thread`: *"[Kid] is waiting on you."* + first 200 chars of the latest message as a snippet quote. CTA: **Reply**.
    - `trial_decision`: *"Decide on [kid]'s trial."* + *"The call wrapped. Take on, decline, or sit with it."* CTA: **Decide**.
    - `cancellation_event`: *"[kid]'s cancel needs your review."* + *"Credit or forfeit. The 24 hour rule decides."* CTA: **Review**.
    - Generic fallback for unknown task types.
    - Empty state (no tasks waiting on Tim): *"Nothing waiting on you. Quiet inbox. Tim's on top of it. Stay loose."*
  - **Visual treatment** per Focused-mode design principle: warm lime-gradient card, no red urgency, soft visual weight. Kid name + age-in-state pill below the title (`14 min` / `3h waiting` / `2d waiting` — calm urgency, never aggressive per spec section 3). Single CTA button on the card.
  - **`age_in_state` formatter** in-file: <60 min → "X min"; <24 hr → "Xh waiting"; ≥24 hr → "Xd waiting". Mirrors the spec's calm-urgency phrasing.
  - **Anchor IDs added** to every `TrialCardView` `<article>` and Active Client `<li>` (`id="client-<player_id>"`). The Home CTA is an `<a href="#client-<id>">` so clicking it scroll-anchors directly to the relevant client card below — Tim can act inline (Reply via the Messages thread, Decide via the Stage C panel, etc.) without leaving the page.
  - **Architectural note:** Focused-mode Home sits ABOVE the existing stats strip + New Trials cards + Active Clients list on the same `/admin` page. The existing dashboard is the *de facto* Clients section per spec mapping (Focused-Home → top, Focused-Clients → below). Future refactor will move the Clients block to its own `/admin/clients` route once we add the mode toggle + nav, but for now it lives together on `/admin` so Tim doesn't have to navigate twice.
  - **Open follow-ups (next phases of the rebuild):**
    1. **"More waiting" expansion.** Today shows just the count. Spec wants an expandable section listing tasks 2..N. Adds a click-to-expand state on `FocusedHome` that renders a compact list below the top task.
    2. **Inline action buttons.** "Reply" currently anchors to the messages section — Tim still has to click in the thread input. Future: render a reply box inline in the Home card. Same for "Decide" (inline Stage C buttons).
    3. **Streak/done-today counter.** Spec calls for *"✦ 4 done today"* line at the bottom of Home. Needs a `task_completions` audit log we don't have yet — every time `waiting_on` flips away from `TIM` could write a row. Future commit.
    4. **Next call pinned card.** Spec calls for *"Next call: Jake, Saturday 2pm"* on Home. Blocked on the Calendly event-time wiring (currently flagged on /portal too — need `subscriptions.trial_call_at` / curriculum_slot `live_call_at` reads).
    5. **Mode toggle.** Per `admin-modes.md`, the top-right header should have `[Focused] [Command]` toggle. Phase 2 work — currently `/admin` is implicitly Focused-only.
    6. **Stuck button.** Each task gets a discrete "Stuck" affordance that writes to `stuck_events` and routes the task to Dad. Phase 3.
    7. **Trial substage refinement.** Backfill currently marks ALL trial subs as `waiting_on='TIM'`, so the trial-decision tasks include pre-call trials too (over-classified). When Calendly event-time wiring lands, transition `TRIAL_SCHEDULED → TRIAL_DONE` on call end, and only `TRIAL_DONE` should be `waiting_on='TIM'`.

- **Admin rebuild: four-chunk extension (2026-05-18 evening).** Phase 1 of the rebuild now has every load-bearing surface in place. Four commits shipped one after the other; each independently reviewable. `npx tsc --noEmit` clean across all four.
  - **(A) Focused Home expansion + inline reply** (commit `9e9eac9`)
    - "X more waiting" toggles to reveal tasks 2..N as compact rows with per-task `Reply / Decide / Review` CTAs (scroll-anchors to client cards).
    - Top message_thread task gets an inline reply textarea on the Home card itself — reuses `/api/admin/message`. Tim fires a reply without scrolling to the thread; success state acknowledges + `router.refresh()`.
    - `AdminClient` signature swapped from `(topTask, remainingTasks)` to full `(tasks)` so expansion has the data.
  - **(B) Stuck button + flow** (commit `9a3b252`)
    - New `POST /api/admin/stuck` endpoint. Coach-only. Inserts `stuck_events` row, flips source object's `waiting_on='DAD'` per `object_type` (messages / subscriptions / curricula / cancellation_events), fires a Discord DM via the configured operator id (falls back to `DISCORD_TIM_USER_ID` until `DISCORD_DAD_USER_ID` env is added).
    - `StuckButton` component on FocusedHome top task (inline link) + expanded list items. Two-step UX: first click reveals a reason prompt (optional), second click submits. "Sent to Dad" success state. After submit, task drops out of `derived_tasks_view` immediately (since `waiting_on=DAD`).
    - Dad's admin UI to resolve Stucks is deferred — the data model is ready (stuck_events rows accumulate with `resolved_at IS NULL`).
  - **(C) Mode toggle + Command-mode Pipeline** (commit `fe13df3`)
    - Migration `20260518000400_admin_mode_pref.sql`: `coaches.admin_mode TEXT NOT NULL DEFAULT 'focused'` with CHECK constraint. Per-user persisted preference.
    - `POST /api/admin/mode` toggles `coaches.admin_mode`. `ModeToggle` pill component in the header — `[Focused] [Command]`. Click → POST + `router.refresh()` re-renders the page in the new mode.
    - `CommandPipeline` component: horizontal kanban with 7 columns mapped from `lifecycle_state` (Trial prep / Trial scheduled / Trial done / Active / Past due / Pending cancel) + a Waitlist column reading from `waitlist_entries`. Compact client cards per column. Cards `waiting_on='TIM'` get a lime accent. CANCELED rows hidden (terminal).
    - Pipeline header shows `Paying X/12 · Trials this week N · Waitlist M (oldest Xd)`. Data-transparent, no narrative wrap per Command-mode design principles.
    - Both modes share `/admin` route + below-the-fold cards. Existing trial/active cards stay visible in both modes so inline actions (messages, Stage C, Discord URL) remain accessible.
  - **(D) Trial substage refinement** (commit pending)
    - Migration `20260518000500_trial_call_substate.sql`: adds `subscriptions.trial_call_event_uri TEXT` + `trial_call_at TIMESTAMPTZ` columns. Indexed where NOT NULL.
    - Modifies `derived_tasks_view` so `trial_decision` tasks only surface when (a) `lifecycle_state='TRIAL_DONE'` OR (b) `trial_call_at < NOW() - 30min` (call already ended with a buffer) OR (c) `trial_call_at IS NULL` (backward compat for pre-wiring trials). Closes the "over-classified pre-call trials" gap noted in the prior Done entry.
    - Calendly `invitee.created` handler now extends beyond sending the branded email: it resolves the subscription by parent email + family + player, then UPDATEs `trial_call_event_uri`, `trial_call_at`, `lifecycle_state='TRIAL_SCHEDULED'`. `waiting_on` stays SYSTEM; the view does the lazy time-based transition for surfacing as TIM-task.
    - The view's "lazy advance" means we don't need a cron to flip `TRIAL_SCHEDULED → TRIAL_DONE`. Future cron can still update the column for correctness, but the view is the source of truth for Home queue semantics.
  - **Open follow-ups still pending:**
    1. **Dad admin** — consume `stuck_events` rows; render handle / return-to-Tim / no-action-needed buttons; write `resolution_*` columns + transition `waiting_on` back to TIM (if returned).
    2. **`DISCORD_DAD_USER_ID` env var** — current Stuck DM routes to whatever's in `DISCORD_TIM_USER_ID` (Tim's own DM, which is wrong long-term). Once Peter's Discord identity is wired, add the env var + flip the route.
    3. **Keyboard shortcuts** — `j/k` nav, `cmd+K` palette, `g p / g i / g c` tab switching for Command mode per spec. None of these exist yet.
    4. **Inline Stage C actions on Focused Home.** Today the trial_decision task CTA is "Decide" → anchor link. Spec wants inline Take on / Decline / Still deciding buttons on the Home card itself.
    5. **"✦ X done today" streak counter** on Focused Home. Needs a `task_completions` audit log.
    6. **Mode toggle keyboard shortcut** — `cmd+\` per spec section 2. Not wired.
    7. **Command-mode Clients / Inbox / Money / Operations tabs.** Today Command mode only has the Pipeline at the top + the same below-the-fold cards as Focused. Spec calls for Inbox tab (batch reply), Money tab (bar chart of MRR), Operations tab (Stripe/Discord/Calendly health). Each is its own substantial chunk.

- **Dad admin (Phase 1: Stuck queue) shipped (2026-05-18 night).** Per `Coach Dashboard Spec/dad-admin-spec.md`. The Stuck button on Tim's side has been routing escalations to a queue with no consumer; this commit closes that loop. `npx tsc --noEmit` clean.
  - **Migration `20260518000600_coach_is_dad.sql`** — `coaches.is_dad BOOLEAN NOT NULL DEFAULT FALSE` + filtered index. Distinguishes Tim (`is_dad=false`) from Peter (`is_dad=true`). Same table because the schema treats coaches as the platform-operator surface, and Peter is operator-of-record alongside Tim.
  - **Local-test bootstrap:** Peter's coach row (`email='peteraugros@gmail.com'`) flipped to `is_dad=true` via SQL. In MVP local testing, Peter is both `is_active` coach AND `is_dad`, so he can hit `/admin` (Tim's view) or `/dad` (his view) from the same login. Production with separate humans gets separate coach rows.
  - **`/dad` page** (`src/app/dad/page.tsx`, `DadClient.tsx`, `page.module.css`): Server Component shell + Client interactive surface.
    - Auth gate: must be authed AND `coaches.is_dad=true`. Non-Dad routes get bounced (parents → `/portal`, players → `/play`, regular coaches → `/admin`, orphans → `/login?error=no_role`).
    - Fetches open `stuck_events` (`resolved_at IS NULL`) ordered newest first, limit 50.
    - Resolves context per `object_type`: messages → snippet of body + sender role + client name; subscriptions → lifecycle state + sub status; curricula → status; cancellation_events → classification + hours until call. Batched lookups per type — one query each, not N+1.
    - Each Stuck row renders as a card with: object label + client name + age + Tim's reason (or "no note") + the bundled source-object summary + three resolution buttons.
  - **Three resolution paths per Stuck row:**
    1. **Handle directly** — Dad acted out of band. `stuck_events.resolution_type='handled_directly'`, source object's `waiting_on='SYSTEM'`. Drops out of Tim's queue cleanly.
    2. **Send back with note** — reveals a textarea, Dad writes guidance, submits. `resolution_type='returned_to_tim'`, `resolution_note=<text>`, source object's `waiting_on='TIM'`. Task re-surfaces in Tim's Home queue.
    3. **No action needed** — Tim hit Stuck on something that doesn't actually need Dad. `resolution_type='no_action_needed'`, source object's `waiting_on='TIM'`. Quietly returns; no note, no shame.
    - "Done" state replaces the card with a small confirmation + summary.
  - **`POST /api/dad/stuck-resolve`** — Dad-gated. Validates input. Updates the stuck row's resolution columns. Flips the source object's `waiting_on` per type (`messages` / `subscriptions` / `curricula` / `cancellation_events`). RLS lets coaches do all of this via `*_coach_all` policies.
  - **Schema note flagged in-code:** `stuck_events.resolved_by` currently FKs `parents(id)` per the original migration. Dad is a coach, not a parent — so we leave it NULL on Dad-resolve. The stuck row's existence + resolution_type + resolution_note capture Dad's action. Future schema cleanup: re-target the FK at `coaches(id)` or a generic users table.
  - **Tim ↔ Dad channel:** spec mentions it for delivering the "Send back with note" copy to Tim. Channel doesn't exist yet; for now the note lives on `stuck_events.resolution_note`. Tim's admin should surface it as a banner on the relevant task — flagged as a follow-up. Phase 2 wires a dedicated message channel between Tim and Dad.
  - **Phase 2+ deferred (per spec, none blocking):**
    1. **Operational alerts** — Stripe webhook fail count, Discord bot heartbeat, Calendly webhook delivery status, Resend bounce rate. Each needs a polling source or recent-events query; none of those exist yet.
    2. **Tim today / Tim this week summaries.** Needs a `task_completions` audit log (same dependency as the `✦ X done today` streak counter).
    3. **Business glance** with Stripe balance + next payout. Stripe API call per render.
    4. **View as Tim** read-only mirror of Tim's `/admin` from Dad's session.
    5. **Tim ↔ Dad channel** for guidance notes.
    6. **Banner on Tim's `/admin`** when a Stuck was resolved with a note — currently Tim has no surfacing.

- **Stuck-return banner + done-today streak (2026-05-18 late night).** Two follow-ups from the Dad-admin commit closed. `npx tsc --noEmit` clean.
  - **Migration `20260518000700_stuck_tim_seen.sql`** — adds `stuck_events.tim_seen_at TIMESTAMPTZ`. Filtered index covers the unseen-with-note query that powers the banner.
  - **`StuckReturnBanner`** above FocusedHome / CommandPipeline on `/admin`. Renders unseen Dad-notes (resolved Stucks with `resolution_note IS NOT NULL AND tim_seen_at IS NULL`). Each row has Dad's note, the object type, and a **Got it** button. Multi-note state adds a **Got it on all N** shortcut. `POST /api/admin/stuck-ack` stamps `tim_seen_at` on the supplied IDs. Optimistic dismissal — UI marks dismissed immediately; server ack happens in background.
  - **Migration `20260518000800_task_completions.sql`** — new `task_completions` table (coach_id, source_table, source_id, completed_at). RLS: coach can SELECT all; writes happen via SECURITY DEFINER triggers (bypass RLS). Two AFTER triggers per table (`messages`, `subscriptions`, `curricula`, `cancellation_events`):
    - `log_task_completion()` on UPDATE OF waiting_on — fires when value transitions from `'TIM'` to anything else.
    - `log_task_completion_on_insert()` on INSERT — fires for new `messages` with `sender_role='coach'` (Tim replied = completion).
    - Coach attribution defaults to the oldest active coach (single-coach MVP). Multi-coach attribution lands later via session var or `auth.uid()` lookup.
  - **"✦ X done today" streak** rendered at the bottom of FocusedHome (both empty state + main state). Lime, italic, quiet — never aggressive per spec section 3 ("calm urgency, not panic urgency"). Anchors on server midnight.
  - **Verified trigger fires:** one `UPDATE messages SET waiting_on='KID' WHERE waiting_on='TIM'` writes exactly one `task_completions` row.

- **Read receipts + lesson edit + trial-call countdown + secret-reveal fix (2026-05-20).** Three TODO items (#3, #4, #5) plus a coda fix on the secret coach-login mechanism + a marketing-copy tidy. `npx tsc --noEmit` clean.

  **TODO #3 — Read receipts on messages.**
  - **`POST /api/messages/mark-read`** — Zod-validated `{ player_id, viewer_role: 'recipient' | 'parent' }`. Auth gate via service-role: looks up the viewer's parent/player/coach rows in parallel and verifies ownership of the target player's family before any UPDATE.
    - `viewer_role='parent'` → stamps `read_by_parent_at` on every unread message in the player's thread.
    - `viewer_role='recipient'` → stamps `read_by_recipient_at` on every message NOT sent by the viewer (i.e., kid reads coach messages, coach reads kid messages). Excludes the viewer's own messages via `.neq('sender_role', viewerRoleAsSender)`.
  - **`MessageThread` Client Component** now fires the mark-read POST on mount via a fire-and-forget `useEffect`. Re-fires when `playerId` or `viewerRole` change. Doesn't block UI on failure.
  - `MessageRow` type extended with `read_by_recipient_at` + `read_by_parent_at` fields so any future "unread" badge has the data.
  - `playerId` prop threaded through the two callers that were missing it: `/play/squad/page.tsx` + `/portal/messages/page.tsx`. Admin paths already passed it.

  **TODO #4 — Lesson edit route.**
  - **`PATCH /api/admin/lessons/[id]`** — coach-gated. Strict Zod-validated body covers all metadata fields + `slide_notes: string[]` (one per slide, indexed) + `parent_talking_points: {category, text}[]`. **Preserves existing slide `image_url` + `audio_url`** by reading the lesson's current `slides` JSONB and only overwriting `speaker_notes` per position. No media-side mutations.
  - **`/admin/lessons/[id]/edit`** — Server Component that loads the lesson, hands off to `LessonEditForm`. Renders 404 if no lesson matches.
  - **`LessonEditForm`** — text-only edit surface, reuses the existing `form.module.css`. All metadata fields editable. Each slide shows its number + a "View image" link to the existing storage URL + an editable `speaker_notes` textarea. All 5 parent-talking-point categories editable. Submits JSON PATCH; on success router.refresh + green "Saved." indicator.
  - **Edit link** added to each row on `/admin/lessons` library list, lime hover.
  - **Out of scope (by design):** changing slide images, adding/removing slides, changing audio. Tim re-authors via `/admin/lessons/new` for new media.

  **TODO #5 — Trial-call countdown + Join CTA on `/play`.**
  - `subscriptions.trial_call_at` + `players.discord_channel_url` fetched on `/play` and passed to `PlayClient` as new props.
  - **`TrialCallCard`** Client Component renders between the hero and the rest of the page, but ONLY when:
    1. A trial call is on the books (`trialCallAt` is set)
    2. Subscription is not yet active or ended (kid is mid-trial)
    3. Call ended < 2 hours ago (anything older = hide entirely)
  - **Live countdown** via `setInterval(1s)`. Format adapts: `3d 4h` → `2h 15m` → `12m 34s` → `5s`.
  - **15 min before call**: the gray "Opens 15 min before" disabled button flips to a lime **Join Discord call** button that opens `players.discord_channel_url` in a new tab (or falls back to `xplkeyed.com` if Tim hasn't pasted a channel URL yet).
  - After call start: button reads "Call is live now" and stays joinable until the 2hr cutoff.
  - Amber-gradient card style, distinct from the regular kid-portal cards.

  **Coda fix — secret coach-login mechanism simplification.**
  - Original spec was **triple-tap the brand** on `/login` within 1.5 seconds. Built it; didn't work on Peter's install. Tried widening to 2.5s, switching from `onClick` to `onPointerDown`, adding a backup "type tim" keyboard sequence. None reliably fired.
  - Root cause: the auto-redirect at the top of `/login/page.tsx` was bouncing signed-in users to their dashboard BEFORE the form ever mounted. Form never rendered → triggers never registered.
  - Fix landed in two parts:
    1. **Auto-redirect skipped when `?coach=1` is in the URL.** Server-side check now: `if (user && !initialCoachPanel) { ...redirect tree... }`. Lets Tim hit `/login?coach=1` and see the form even when his session is active (e.g. switching from magic-link auth to password auth without signing out).
    2. **Simplified the secret to a SINGLE click on the brand.** No tap counter, no timing window, no keyboard sequence. `onClick={() => setSecretRevealed(true)}`. Cursor stays default + no visual hint, so the "secret" feel is preserved (a normal visitor sees the brand as a logo, not a button). One click → coach panel replaces magic-link form.
  - Diagnostic in the middle of this: the click event was reaching the handler all along, but the form wasn't mounting because of the auto-redirect, so no handler was attached to listen. Fixing the redirect + simplifying both went in the same commit.

  **Marketing copy tidy.**
  - `/` hero subhead: "Personalized async coaching from XPL Keyed..." → "Personalized coaching from XPL Keyed..." (drops "async").
  - `/` parent-upsell paragraph: "Sessions are short (30 minutes), scheduled, and async first..." → "Sessions are short (30 minutes) and scheduled in advance...".
  - Peter's read: "async" is jargon parents don't track; "scheduled in advance" lands better.

  **Marketing hero soldier (earlier in the same session):**
  - Replaced original Dreamstime soldier silhouette with a Fortnite-style character silhouette (Tim's call: the original read too "Call of Duty"). Reprocessed via sharp: row-scan to find figure bottom edge, crop below feet, binary threshold (>200 avg → transparent; else → solid black), auto-trim transparent edges.
  - Asset at `public/images/hero-silhouette.png`. Filename changed mid-session to bust browser cache after a stuck Chrome image cache.
  - Sized via height-driven CSS so a tall/slim figure stays inside the hero's visible bounds: `height: clamp(280px, 55vh, 560px); width: auto; max-width: 35vw;`. Width auto-derives from aspect ratio (~93:212).
  - Position: `bottom: 100%; right: clamp(0px, 3vw, 50px)` — sits up against the rarity bars on the right, lands feet-AT-top of the stats row.
  - Animation: drop-from-above + squash + recoil + settle keyframes triggered by `.hero:has(.rarity-bars:hover)`. Mobile hidden, `prefers-reduced-motion` respected.

- **Marketing hero soldier silhouette + notification_log audit wiring (2026-05-20).** Two pieces in one session. `npx tsc --noEmit` clean.

  **Marketing hero — Fortnite silhouette drop-in:**
  - New `<img>` inside `.credentials` on the marketing landing (`src/app/page.tsx`). Pure black silhouette + transparent PNG at `public/images/hero-silhouette.png`.
  - Source was a generic Fortnite character silhouette (Tim's call — the original soldier image read too "Call of Duty"). Processed via a node + sharp script that:
    1. Loads the source PNG
    2. Scans pixel rows from bottom up to find the gap between the figure and any watermark/attribution strip below
    3. Crops just below the figure's feet
    4. Applies a binary threshold (pixels brighter than 200 avg → fully transparent; everything else → solid pure black with full alpha)
    5. Auto-trims surrounding transparent pixels via `sharp.trim()`
  - **Triggered on `:has(.rarity-bars:hover)`** — a CSS-only mechanism that requires no JavaScript. The soldier drops from `translateY(-120vh)` with a 1.1s cubic-bezier easing curve:
    - 0%: above the viewport, scale 0.55, opacity 0
    - 35%: opacity 1 (becomes visible mid-fall)
    - 55%: lands hard at translateY(18px) with scale(1.18, 0.78) — horizontal squash + vertical compress
    - 72%: small recoil to translateY(-18px) with scale(0.94, 1.08)
    - 86%: settling bob
    - 100%: rests at translateY(0) scale(1)
  - **Position**: `absolute` inside `.credentials` with `bottom: 100%` so the soldier's feet sit AT the top edge of the stats row when landed. `right: clamp(0px, 3vw, 50px)` biases right toward the rarity bars; `width: clamp(370px, 50vw, 640px)` scales responsively.
  - Mobile (<768px): hidden via `display: none` — no sensible side-room when the hero collapses to a single column.
  - `prefers-reduced-motion` respected — soldier appears in place without the drop/squash animation.
  - **Image processing flag**: the original soldier silhouette source was a watermarked Dreamstime preview. **Not licensed for production use.** Peter swapped to a different (still unknown-provenance) Fortnite silhouette. Need to verify the new image's licensing before launch.

  **notification_log audit wiring** (TODO item #2 from the Open TODO list — now ✅ done):
  - Schema (`notification_log` table from migration `20260517000000_initial_schema.sql`) had zero reads or writes since day one. Wired as a write-side audit trail.
  - **`src/lib/email/send.ts`** — new `sendBrandedEmail()` wrapper:
    - Body: `{to, subject, html, trigger, recipientType, recipientId?, relatedEntityType?, relatedEntityId?}`
    - Strict `trigger` enum: `magic_link / coppa_verification / branded_booking_confirmation / stage_c_take_on / stage_c_decline / lesson_delivery_week1 / auto_renew_off / coach_cancel / coach_cancel_late / no_show / parent_cancel_notification / other`
    - Strict `recipientType` enum: `coach / parent / player`
    - Strict `relatedEntityType` enum: `curriculum_slot / subscription / cancellation_event / waitlist_entry / curriculum / intake / trial_call / no_show`
    - Calls `resend.emails.send` THEN writes a `notification_log` row with `status='sent' + sent_at=NOW()` on success, OR `status='failed' + error_message=<msg>` on Resend failure. Never throws — caller's main flow keeps going.
    - If `RESEND_API_KEY` not set, writes `status='failed' + error_message='resend_not_configured'` and returns `{ ok: false }`.
  - **14 Resend call sites migrated** to the wrapper:
    1. `/api/portal/sessions/[slot_id]/cancel` — auto_renew_off
    2. `/api/portal/sessions/[slot_id]/reschedule` — auto_renew_off
    3. `/api/admin/calendar/coach-cancel` — coach_cancel
    4. `/api/admin/calendar/mark-outcome` (no-show branch) — no_show
    5. `/api/admin/calendar/mark-outcome` (late-cancel branch) — coach_cancel_late
    6. `/api/admin/conversion/take-on` — stage_c_take_on
    7. `/api/admin/conversion/decline` — stage_c_decline
    8. `/api/intake/request-verification` — coppa_verification
    9. `/api/calendly-webhook` (trial confirmation) — branded_booking_confirmation
    10. `/api/calendly-webhook` (paid-lesson confirmation) — branded_booking_confirmation
    11. `/api/calendly-webhook` (parent cancel notification) — parent_cancel_notification
    12. `/api/calendly-webhook` (auto-renew-off) — auto_renew_off
    13. `/lib/supabase/auth.ts` `deliver()` (magic links, all 3 callers tagged with the correct recipient role)
    14. `/lib/lessons/deliver-week-one.ts` — lesson_delivery_week1
  - Verified: `grep -rn "resend.emails.send" src/` returns only the one inside `send.ts`. No bypass.
  - **Dad admin panel surfaces it.** `/admin/dad` now shows a "Recent system activity" section below the Tim ↔ Dad channel:
    - Last 50 rows from `notification_log` ordered newest first.
    - Each row: date+time / trigger label / `channel · recipient_type` / status pill (green for sent, red for failed).
    - Failed rows get a red row border. Summary line at the top: "Last N transactional emails. X failed."
    - Read-only — no resend/retry yet.

  **Deferred to a later session:**
  - **Deno Edge Functions still use the old Resend path**. Every cron (`cron-day7-dunning-ping`, `cron-dunning-parent-reminders`, `cron-pending-cancel-lifecycle`, `cron-waitlist-offer-lifecycle`, `cron-waitlist-freshness-check`, `cron-sunday-lesson-delivery`, `cron-scheduling-abandonment`, `cron-payment-abandonment`, `cron-auto-renew-detection`) sends through `supabase/functions/_shared/resend.ts` which doesn't write to notification_log. Needs a parallel Deno helper that writes to the table. Added to the Open TODO list as item #12.

- **Lesson plan panel + library-driven auto-renew + nav reorder (2026-05-20).** Three phases shipped together. Closes the "Tim has no view into student progress + no swap controls" gap. `npx tsc --noEmit` clean.

  **Phase A — Read-only lesson plan view in `/admin/clients?client=<id>`.**
  - `ActiveRow` type extended with `curricula: CurriculumWithSlots[]`. New `LessonSummary` + `CurriculumSlotRow` + `CurriculumWithSlots` types exported from `AdminClient.tsx`.
  - `clients/page.tsx` Server Component now fetches curricula (`pending_approval`/`active`/`completed`/`superseded`) → curriculum_slots → lessons, builds a per-player `curriculaByPlayer` map, threads it into ActiveRow.
  - New `LessonPlanPanel` component in `ClientsClient.tsx`. Renders between the active client header and messages thread:
    - **Current cycle block** with status eyebrow + Tim's personalization note + 4 slot rows.
    - **Pending approval block** when the curriculum is pre-payment (read-only view of the proposed 4 weeks).
    - **Past cycles** compact list: one row per completed/superseded curriculum with date + the 4 lesson labels in a single line.
  - Each slot row classified into one of 7 status states (Completed / Upcoming / Past unmarked / No show / Cancelled / Delivered / Not scheduled) with status-driven row colors + matching pill.
  - Slot row layout: Week# · title (Fortnite or "VOD review") · parent translation subtitle · live call date+time · coach note (if set) · status pill · inline controls.

  **Phase B — Swap + VOD toggle controls.**
  - **`POST /api/admin/curriculum-slots/[id]/swap-lesson`** — coach-gated. Body `{ lesson_id }`. Rejects already-delivered slots. Updates `lesson_id` + force-clears `is_vod_review` + VOD fields (lesson_xor_vod CHECK constraint requires one OR the other).
  - **`POST /api/admin/curriculum-slots/[id]/toggle-vod`** — coach-gated. Discriminated body:
    - `mode='vod_on'`: requires `vod_url`, optional `vod_note`. Sets `is_vod_review=true`, clears `lesson_id`, stores URL + a single-item `vod_talking_points` array if a note was provided.
    - `mode='vod_off'`: requires `lesson_id`. Mirror of swap-lesson but explicitly flips off VOD mode.
  - **`GET /api/admin/lessons/library?player_id=<uuid>`** — backs the swap modal's library picker. Returns every lesson with title + fortnite_label + parent_label + topic + difficulty + duration + `is_published` + `already_done` (joined subquery against curriculum_slots → curricula filtered to this player). Per the design call from earlier: Tim isn't BLOCKED from re-assigning a done lesson, just informed via the badge.
  - **Two modals in ClientsClient.tsx:**
    - `SwapLessonModal` — search-filterable library list. Each row shows lesson card + "Already done" badge (rare-blue) for known-done + "Draft" badge (amber) for unpublished. Click → POST to swap-lesson endpoint (or toggle-vod with `mode='vod_off'` if the slot was VOD). Reuses for VOD-off flow.
    - `VodOnModal` — VOD URL input + optional talking-point textarea. POST to toggle-vod with `mode='vod_on'`.
  - **Inline slot controls** appear only on non-delivered slots:
    - If slot is lesson mode: **Swap** (lime, primary) + **VOD** (ghost) buttons.
    - If slot is VOD mode: single **Pick lesson** button (reuses swap modal).

  **Phase C — Library-driven auto-renew.**
  - `provisionNextCycle()` no longer creates 4 stub lessons inline. Instead delegates to new `selectLessonsForRenewal(supabase, playerId, createdBy)` helper.
  - Selection logic, in order:
    1. **Fresh first** — query every `is_published=true` lesson ordered by `created_at ASC` (Tim authors in his preferred curriculum sequence). Exclude lessons this player has ever been assigned (via curriculum_slots → curricula). If ≥ 4 fresh, take the first 4.
    2. **Top up from history** — if < 4 fresh, fill the gap with the player's oldest assigned lessons (least likely to be remembered). Acceptable per the design call: Tim can swap mid-cycle if review repetition isn't appropriate.
    3. **Stub fallback** — library completely empty. Falls back to the original stub-creation pattern. Auto-renew loop never breaks; Tim sees `lesson_authoring_needed` tasks as those stubs hit slots in upcoming weeks.
  - **New awareness task `library_running_low` (P22)** added to `derived_tasks_view` (migration `20260520000400`). Fires when `(SELECT COUNT(*) FROM lessons WHERE is_published=TRUE) < 12` (three cycles' worth of fresh content). Per-coach card. Title: *"Your lesson library is running low."* / body: *"Only N published lessons. Auto renew starts repeating or falling back to stubs at this level. Author a few more when you have a free hour."* Rare-blue `LIBRARY` pill. Inline CTA pairs **Author a lesson** + **See library**. Auto-drops when count crosses 12.

  **Nav reorder (separate small ask landed in the same session):**
  - `AdminShell` NAV: `Home / Clients / Waitlist / Calendar / Lessons / Money`.
  - **Dad link removed** — per Peter "he can text me by phone when he needs help." The `/admin/dad` route still exists (still accessible by URL, Stuck button still writes there) but it's no longer a navigable destination.

- **Calendar Round 3 + Cycle drag-out + Money KPIs (2026-05-20).** Three operational pieces closing real gaps. `npx tsc --noEmit` clean.

  **Round 3 — Tim cancels → parent reschedules.** Closes the bug that previously caused families to LOSE a week's content entirely when Tim cancelled. The lesson is meant to be rescheduled, not skipped (per CLAUDE.md "Coach cancellations" spec).
  - Calendly's API doesn't support backend-initiated bookings, so the auto-shift-+7-days happy path I initially considered isn't possible. Going with "Pick a new time, every time" — parent drives the rebooking via the existing reschedule UI pattern with a Calendly embed defaulted to +7d.
  - **`/api/admin/calendar/coach-cancel`** + **`/api/admin/calendar/mark-outcome`'s `coach_cancel_late` branch** updated: instead of stamping `delivered_at` (which made the Sunday cron skip the lesson entirely), they now **clear `live_call_at` and sentinel `live_call_event_id`**. The slot enters a "needs reschedule" limbo until the parent picks a new time.
  - **Email copy rewritten.** Subject: "Picking a new time for this week's call" / "Picking a new time for the call I missed." Body explains Tim's reason + a "Pick the next time that works and I'll be there" framing. New **Pick a new time** CTA on the email links to `/portal/sessions`. Kid auto-chat updated to match ("Your parent has a link to pick a new time").
  - **`POST /api/portal/sessions/[slot_id]/book-after-coach-cancel`** — new endpoint. Validates the slot is in coach-cancelled state (live_call_at NULL + cancelled: sentinel) + belongs to the parent's family. Sets new `live_call_at` + `live_call_event_id`. **No 24hr check, no 7-day delta math, no skip counter touch** — different semantics from the regular reschedule endpoint because Tim caused this, not the family.
  - **`ActiveCycleManager` updated.** New `isCoachCancelled(slot)` helper detects the limbo state. Cancelled slots render with a lime-bordered row + "Tim cancelled. Pick a new time." subtitle + green **Pick a time** primary button (vs the regular ghost-link Reschedule button for normal slots).
  - **`BookAfterCoachCancelModal`** — new client component. Same Calendly embed init pattern as `RescheduleModal` (window message listener + manual `initInlineWidget()` since the modal mounts dynamically). Pre-navigates to today+7d as a sensible default. On `event_scheduled` → resolves new time via `/api/portal/sessions/resolve-event` server-side (keeps the Calendly PAT off the browser) → POSTs to the new book-after-coach-cancel endpoint.
  - **Tim's calendar**: coach-cancelled limbo slots quietly disappear (no `live_call_at` to render on a time grid). They reappear normally once the parent picks a new time. Parent-side cancels still show with strike-through since those calls are gone permanently — different semantics.

  **Cycle drag-out awareness card.** Operational alarm for cycles running too long.
  - **Migration `20260520000300_cycle_drag_out.sql`** — adds `cycle_drag_out` task type (P60) to `derived_tasks_view`. Sits between past_due_opened (55) and message_thread coach (60).
  - Fires when `lifecycle_state='ACTIVE'` AND `cycle_lessons_delivered < 4` AND `cycle_started_at < NOW() - INTERVAL '8 weeks'` (2x intended duration).
  - **Task payload includes the breakdown:** `cycle_started_at`, `cycle_lessons_delivered`, `cycle_skips_used` (parent-driven), `coach_cancels_count` (subquery counting `coach_cancels` rows linked to the active curriculum's slots).
  - **Card body:** *"Jake's cycle is dragging. 9 weeks running, only 2 of 4 lessons delivered. 2 parent skips, 3 of your own cancels. Worth a check in."* — formed in `phraseForTask` from the payload. Amber `CYCLE DRAG` pill.
  - **Why this matters:** Stripe charges per cycle completion, not calendar time. A 12-week cycle = 4 cycles/year/kid instead of 13 = ~$500/yr/kid revenue leakage. At 12 paying kids that's ~$6K/year. Real money. Drag-out also dilutes the curriculum (designed as a coherent 4-week block) and erodes family momentum.
  - **Doesn't auto-resolve.** Tim has to act (reach out in messages, course-correct his own cancel rate, in extreme cases manually advance the cycle). 16-week auto-end is a future option — deferred to lock the refund/intervention policy first.

  **Money page operational KPIs.**
  - New stat tile **Avg cycle weeks** — average weeks elapsed across active paying cycles. Tile flips amber when avg > 6. Snapshot of currently-active cycles, not history. Target is 4. Hint on hover explains.
  - New stat tile **Dragging cycles** — count of cycles running 8+ weeks. Only renders when > 0. Amber.
  - Together with the awareness card, gives Tim immediate visibility into operational health: cards show specific families, KPIs show the trend.

- **Calendar (Rounds 1 + 2): list view + coach cancel + post-call outcome marking (2026-05-20).** Operations stub replaced with a real schedule + accountability surface. `npx tsc --noEmit` clean after both rounds.

  **Round 1 — list view + proactive coach cancel:**
  - **Nav swap.** `AdminShell` NAV: Operations stub → `/admin/calendar`. SOON chip dropped.
  - **`/admin/calendar` page.** Server Component fetches every upcoming live call + every booked trial call. Grouped into Today / Tomorrow / This week / Next week / Later buckets. Past events hidden (cutoff = midnight today). Single-source-of-truth for "what's on Tim's plate."
  - **Event detail modal.** Click any event → full panel:
    - Lesson plan (kid-facing label + parent-translation pair + skill description). Amber warning if the lesson is a stub.
    - Client identity: kid name + rank + Fortnite username + Discord username + parent name + mailto.
    - Link to client card.
  - **Coach cancel flow** (paid lessons only — trial cancels still point at Calendly for round 1):
    - Reveal button → form with **3 locked reasons** (Peter's revision from CLAUDE.md's longer list): `sick / out_of_control / need_to_reschedule`. Christmas/Thanksgiving are availability blocks at the Calendly level, not cancel reasons.
    - **Type CANCEL to verify** before the submit button enables. Within-24hr warning banner.
    - `POST /api/admin/calendar/coach-cancel` writes `coach_cancels` row + cancels Calendly event via REST (idempotent via the existing sentinel pattern) + stamps `delivered_at` + sentinels `live_call_event_id` + sends parent email in Tim's voice + posts auto-chat to kid thread (`sender_role='coach'`, `waiting_on='KID'`).
    - Parent + kid copy per reason (REASON_COPY map): "Tim's out sick this week" / "Something came up Tim couldn't control" / "Tim needs to move this week's call. He'll reach out shortly."
  - **Cancelled events stay on the calendar** (per Peter mid-build: "don't remove it, just a strike through with a reason"). Row renders with strike-through title, amber-red border, CANCELLED pill, cancel reason as subtitle. Modal hides the cancel form + shows a Status banner explaining what happened.
  - **Cancel reason reconciliation.** Two sources joined into the calendar event: `coach_cancels.reason` (Tim cancelled) wins; falls back to `cancellation_events.classification + initiated_via` (parent cancelled). Friendly labels: "Tim cancelled: sick" / "parent cancel (inside 24hr)" / "no show (skip used)".

  **Round 2 — post-call outcome marking (the "Tim forgot" backstop):**
  - **Migration `20260520000200_post_call_outcome.sql`:**
    - Adds `curriculum_slots.coach_note` + `coach_note_at` columns. Tim's 2-3 sentence observation surfaces on `/portal/progress` per week.
    - Extends `derived_tasks_view` with **`call_outcome_pending` (P78)** — fires when `live_call_at < NOW() - 2 hours` AND no `live_call_completed_at` AND no `no_show_at` AND no `coach_cancels` row for the slot AND not parent-cancel-sentinel'd. Sits just above `new_student_welcome` (P70) because every 2-hour gap means a real family is wondering what happened. Stays in the queue until Tim marks an outcome.
  - **`POST /api/admin/calendar/mark-outcome` endpoint** — discriminated body on `outcome`:
    - **`done`**: stamps `live_call_completed_at` + `delivered_at` + optional `coach_note` + advances `cycle_lessons_delivered`. Sunday cron now ticks to the next lesson cleanly.
    - **`no_show`** with `charge_skip=true` (default): forfeit-equivalent. `no_show_at` stamped, `cycle_skips_used+1`, `cycle_lessons_delivered+1` (kid keeps materials), `cancellation_events` audit row with `initiated_via='no_show'`, "Hope all is well" email to parent.
    - **`no_show`** with `charge_skip=false` (courtesy pass): `no_show_at` stamped, `coach_cancels` row instead of skip charge, cycle pauses 1 week, parent email reads "Hope all is well, no charge this week." Per CLAUDE.md: "Tim can manually convert a no-show to a credit if a legitimate reason surfaces."
    - **`coach_cancel_late`**: after-the-fact coach cancel. Same shape as the proactive cancel — coach_cancels row + Calendly REST cancel (best-effort) + parent email in Tim's voice + auto-chat to kid. Apology framing in the email ("Sorry I didn't get word to you sooner.").
  - **`OutcomeForm`** Client Component in `CalendarClient.tsx`:
    - Renders inside the event modal whenever `hoursUntil(live_call_at) <= 0` AND not cancelled.
    - 3-button outcome picker. Click expands the relevant follow-up form:
      - Done → coach note textarea with placeholder example
      - No-show → charge-skip checkbox (default ON) + clear copy on what each option does
      - Late cancel → 3-reason dropdown (same as proactive cancel)
    - Success state renders an inline confirmation. `router.refresh()` on Done drops the `call_outcome_pending` Focused Home task.
  - **Calendar modal decision tree** (clean conditional):
    1. cancelled → Status banner (terminal)
    2. past + not yet outcome'd → OutcomeForm
    3. upcoming → CoachCancelForm (proactive cancel)
    4. trial → placeholder pointing at Calendly
  - **Focused Home render branch** for `call_outcome_pending`:
    - Amber `POST CALL` pill (reuses `pastDuePill` style).
    - Title: `How did [Kid]'s call go?` / body: `Live call was Nh ago. Mark it done, no show, or a late cancel so the family's records close out.`
    - Inline CTA: **Mark outcome** → `/admin/calendar` + **Open client card**.
  - **`/portal/progress` coach-note rendering.** Each week row in the current plan now shows Tim's coach note inline (when set) as a lime-bordered callout labeled "Note from Tim." Surfaces immediately after Tim marks the call done with a note. This is the strategic moat — Tim's voice landing on the parent's dashboard within minutes of the call ending.

  **One important decision baked in:** the kid no-show path counts as a skip by default (Peter: "if a kid misses that just counts as an illegal cancel or a skip, no refund, just a Hope all is well"). The courtesy-pass override is the safety valve for genuine emergencies. Avoids the "just don't reply, win" hack.

- **Money page + Waitlist page + 2 new Focused Home tasks (2026-05-20).** Six pieces landed end-to-end. `npx tsc --noEmit` clean.
  - **`/admin/money` rebuilt from stub.** Server Component that calls Stripe directly (no caching at 1-10 client scale; 5-min revalidate is the upgrade path if /admin/money render gets slow):
    - Headline stats grid: Paying / 12, Cycle run rate (paying × $56), This month, Year to date, Past due, Auto renew off.
    - **Last 6 months revenue bar chart** built from `stripe.paymentIntents.list({created:{gte}, limit:100})` paginated up to 10 pages. Grouped by month in JS, plain CSS bars with lime gradient (no charting library — `chart.module.css` does it). Empty months render flat.
    - **Past-due families list** — derived from DB (`status='past_due'`), not Stripe. Sorted by days past due; pill escalates color at 7/14 days.
    - **Cards expiring within 60 days** — `stripe.paymentMethods.list({customer, type:'card'})` per family. Pill flips epic-red within 14 days.
    - **Last 10 paid charges** — from Stripe, with `metadata.kind` resolving "First cycle" vs "Cycle renewal" labels and `metadata.player_id` resolving kid name.
    - Catches Stripe API errors gracefully — DB-derived sections still render with a small warning.
  - **Inbox dropped, Waitlist promoted to nav.** `AdminShell` NAV array swap. The Inbox stub is removed entirely — messages already live inside each client on `/admin/clients`, and the message-arrival surfaces in Focused Home, so a dedicated Inbox page is redundant. Money item also got its SOON chip dropped in the same edit.
  - **`/admin/waitlist` built out.** Server Component fetches all `waitlist_entries` ordered by created_at. Split into:
    - **Stats strip**: Waiting / Active offers / Oldest waiting (days) / Removed all time.
    - **Open queue** with FIFO position numbers (`#1`, `#2`, ...) per locked spec. Each row: parent email + kid first name + age + signup date + freshness check history + status pill (`Waiting`, `Offered. Nh left`, `Offer expiring`, etc.). Per-row **Remove** button with reason field + two-step confirm.
    - **History section** for closed entries (claimed / converted / expired / removed) with the removed_reason inline.
  - **`POST /api/admin/waitlist/[id]/remove`** — coach-gated. Marks `status='removed'`, stamps `removed_at + removed_reason`. Used for ghost families, bad contact info, or any FIFO-bypass case. Skip-in-queue intentionally NOT built (strict FIFO per CLAUDE.md spec; if it ever matters, additive endpoint).
  - **Two new Focused Home task types** (migration `20260520000100_admin_home_action_items.sql`):
    - **`lesson_authoring_needed` (P75)** — fires when an active client's NEXT pending curriculum_slot (lowest `week_number` with `delivered_at IS NULL`) points at a lesson with empty `slides` JSONB AND the `live_call_at` is within 7 days. Catches the broken-Sunday-delivery bug Stage C take-on (and auto-renew provisioning) creates by writing stub lessons with empty slides. View uses a CTE (`next_stub_slot`) that joins subscriptions → curricula → slots → lessons. P75 sits just below `new_student_welcome` (P70) which makes sense — both are action-required, lesson stubs slightly more urgent.
    - **`tiktok_daily_reminder` (P25)** — daily awareness card nudging Tim to drop his Fortnite-creator comment. Per CLAUDE.md, the TikTok organic-comment funnel is the platform's primary acquisition channel. Card fires once per UTC day via `NOT EXISTS` against a new `tiktok_comments` table; logging just inserts a row stamped with `logged_at` and a UNIQUE `(coach_id, logged_date)` index dedupes the day. `logged_date` is a `GENERATED ALWAYS AS ((logged_at AT TIME ZONE 'UTC')::date) STORED` column for clean partial-index queries.
    - **`POST /api/admin/tiktok/log`** — coach-gated. Inserts row; treats unique-violation (Postgres SQLSTATE 23505) as success so Tim tapping twice in the same day still drops the card cleanly.
  - **AdminClient render branches** added for both new types:
    - `lesson_authoring_needed`: amber `LESSON STUB` pill + inline CTA row with **Open lesson library** + **Open client card**. Note: `/admin/lessons/<id>/edit` doesn't exist yet, so the primary CTA routes to the list. Real lesson-edit route is the next missing piece if Tim hits this often.
    - `tiktok_daily_reminder`: rare-blue `FUNNEL` pill. Special-cased meta row (no kid name + no Stuck button since it's not client-scoped). Inline **✓ Commented today** button via new `TikTokLogButton` Client Component that fires `/api/admin/tiktok/log` and `router.refresh()`.
  - **AI prompt retune** for the parent-translation suggest endpoint shipped in the same window. Original output was reading like a psychology textbook ("Trains spatial planning and sequenced execution while filtering threats..."). Retuned with:
    - System prompt now has an explicit "WRITE FOR A REGULAR PARENT, NOT A PSYCHOLOGY TEXTBOOK" section.
    - **Banned vocabulary** list: spatial planning, sequenced execution, executive function, cognition, pattern recognition, decision making (as noun phrase), filtering, processing, parsing, working memory, motor planning, etc.
    - **Use plain language instead** list: "thinking ahead," "staying calm when things get fast," "noticing what's happening," etc.
    - Reference examples rewritten in warm parent-friendly tone: Tunneling → "Staying calm when a fight gets fast" / "Helps your kid keep their head when someone's pushing them, and make a plan instead of panicking." (vs the old "Trains spatial planning and multi step execution while reacting to incoming pressure.")
    - parent_label constraint tightened: "a short phrase a parent would actually say at dinner."
    - parent_skill_description constraint: 12-22 words, starts with warm verb ("Helps your kid" / "Teaches your kid" / "Builds").

- **AI lesson-authoring assist (2026-05-20).** Two "✨ Suggest" buttons in the `/admin/lessons/new` form let Tim draft parent-facing copy from the Fortnite term + topic. Output lands in editable fields; never auto-saved. `npx tsc --noEmit` clean.
  - **`@anthropic-ai/sdk` installed** (first AI integration in the repo). New env var `ANTHROPIC_API_KEY` documented in `.env.local.example`. Model: `claude-opus-4-7`. Single-turn, 1024 max tokens.
  - **`POST /api/admin/lessons/ai-suggest`** — coach-gated. Discriminated body shape:
    - `kind='parent_translation'` → returns `{parent_label, parent_skill_description}` per Hard rule #4 (real-world skill first, one-sentence cognitive-function blurb starting with "Trains" or "Builds").
    - `kind='talking_points'` → returns one line per category (`informed_observer`, `co_conspirator`, `cultural_literacy`, `good_question`, `strategic_note`).
  - **System prompt embeds Hard Rules verbatim** + the trust/tone framing from CLAUDE.md:
    - Dash-free constraint called out as the #1 rule with examples; "30 min" not "30-min", "to" instead of dashes in ranges.
    - Parent-translation pattern explicit + 3 reference pairs (Tunneling / Box fighting / Editing).
    - Tim-as-co-conspirator framing, parent-asks-not-performs, no-slang-the-parent-has-to-pronounce, never-make-the-parent-the-butt-of-a-joke. All from the existing `decision_parent_talking_points.md` memory.
  - **Strict JSON output, no markdown fences.** Defensive `safeJsonParse()` extracts the first `{...}` block if the model wraps it in prose. Last-mile `stripDashes()` replaces em/en dashes (`—` `–`) with periods on the output side (plain ASCII hyphens left alone because they're often inside legitimate compound words; Tim's edit pass cleans those if they slip in).
  - **`LessonForm.tsx` integration:**
    - Single `aiBusy` state (per-kind, so the right button labels "Drafting...") + shared `aiError`.
    - **Suggest parent label + description** button below the metadata section, fills both `parent_label` + `parent_skill_description` from `fortnite_label` + `topic` + `difficulty`.
    - **Suggest all 5 talking points** button at the top of the PTP fieldset, fills every category in one shot. Tim's existing `parent_label` + `parent_skill_description` ride along as additional context if filled.
    - Both buttons disabled until `fortnite_label` is non-empty.
    - AI output writes directly to form state — Tim sees the draft land in editable fields. Never auto-saved. The form's existing `canSubmit()` gate still requires Tim to confirm by hitting Save.
  - **Cost posture:** roughly $0.01–$0.02 per suggest call at current pricing. Tim authoring 4 stub lessons per cycle = ~$0.10/cycle of AI cost. Negligible at the operator-pair scale; if the platform later runs N operators, costs scale linearly with N. Cap via Anthropic dashboard if it ever matters.

- **Reschedule MVP testing pass: 8 fixes + Progress build + in-app cancel (2026-05-20).** Live-testing session against the reschedule + auto-renew system surfaced a series of UX gaps and policy adjustments. All shipped this turn; `npx tsc --noEmit` clean.
  - **Calendly embed init fix.** The reschedule modal's Calendly embed was rendering empty space because `widget.js` auto-scans the DOM on initial load — and our modal mounts dynamically after page hydration, so the auto-scan misses it. Fix: replaced the `.calendly-inline-widget` data attribute pattern with an explicit `Calendly.initInlineWidget()` call inside a `useEffect` that polls for the global. Container `<div>` now uses an `id={"calendly-resched-<slot_id>"}` target.
  - **Calendly URL params (date= drop).** Modal was pre-navigating with both `month=` and `date=`, which dropped the parent into Calendly's single-day time-picker rather than the month-calendar view (forced a tap on the back arrow to change days). Dropped `date=`, kept `month=` — embed now lands on the month calendar.
  - **Paid lesson event type setup (Calendly side).** The `xpl-keyed/paid-lesson` event type existed but wasn't fully configured. Wrote a setup checklist for Peter at `/Users/peteraugros/Desktop/calendly-paid-lesson-setup.md` covering: 0hr min-notice / cancel / reschedule windows (so our backend governs the 24hr rule; if Calendly's defaults block late cancels we lose webhook visibility), 30 min duration, Tim's availability windows (Wed/Thu/Fri 4-6pm + Sat 1-5pm), 2 custom questions (kid first name → `a1`, kid Discord → `a2`), and `CALENDLY_PAID_LESSON_EVENT_TYPE_URI` env var for the webhook discriminator. Standard-tier limitations called out (cancel-window settings aren't separable, invitee-email-confirmation isn't togglable separately from calendar invite). **Decision (Peter):** two emails per booking is fine; instead customize Calendly's default email template to use our voice/copy rather than the data-dump default.
  - **Skip cap policy: 3 → 2 allowance, 3rd is trigger.** Initial spec called for "3 skips ends auto renew" with a `cycle_skips_used CHECK (0..3)`. Peter revised twice during testing:
    - First: "the policy isn't 3 skips, it's two" → tightened to (0..2), trigger at `>= 2`.
    - Then: "Skips: 0 of 2 used this cycle. 2 skips turns off auto renew" needs to say **3 skips turns off auto renew** — the right framing is "allowance is 2 per cycle, the 3rd is the trigger." Final state: allowance 2, trigger at `>= 3`. CHECK relaxed to (0..10) as a sanity bound since the counter could theoretically advance to ~4 in a 4-lesson cycle if every session is skipped.
    - Migrations `20260519000900_skip_cap_two.sql` (tightened to 2) and `20260519001000_skip_check_relax.sql` (final state, 0..10) ship the two-step journey.
    - Spec doc `/Users/peteraugros/Desktop/xpl-reschedule-spec.md` updated to the locked framing throughout (modal copy, email copy, CHECK constraint).
  - **`SessionPolicyPanel` deleted.** Legacy stub component at `/portal/sessions` rendered "0/1 skip + 0/2 cancels" — pre-spec terminology from the original stub layout. Removed from page.tsx import + render, file unlinked. The new `ActiveCycleManager` skip counter strip up top is the single source of truth.
  - **Migration `20260519001100_lessons_label_visibility.sql`.** The `lessons_assigned_select` RLS policy gated row visibility on `is_published = true`, which blocked the parent's /portal/sessions + /play views from reading lesson titles (`fortnite_label`) before Tim published the content. Every session row was falling back to the generic "Lesson" label even when Tim had typed real titles in the curriculum drafter. Dropped the `is_published` clause — the title + parent-translation pair is meant to be visible the moment Tim assigns the lesson to a `curriculum_slots` row. If we ever need to gate the slides/audio rendering itself on `is_published`, that's an asset-layer concern (signed URL minting), not a row-read concern.
  - **"Reply to Tim" copy sweep — 5 parent-facing places.** Per the trust model, parent has read-only access to messages; they can't write. Old copy in 5 spots implied parent could message Tim directly:
    1. `/portal` post-payment "Enrolled" hero card bullet: "Message me anytime from the dashboard" → "Have [kid] message me from the player view. You see every message here." Plus the **Message Me** button relabeled to **View Messages**.
    2. `/curriculum/[token]/success` post-payment landing: "Message me anytime from your parent dashboard if you have questions" → "Have [kid] message me from the player view if anything comes up. You see every message in your dashboard."
    3. Auto-renew-off email (3 senders: `/api/portal/sessions/[slot_id]/cancel`, `…/reschedule`, `/api/calendly-webhook`): "Anything to share? Reply to Tim in your messages." → "Anything to share? Have [kid] message me in the chat. You see everything in your dashboard."
    4. `/portal/messages` page intro: appended "If you want Tim to know something, have [kid] message him from the player view."
  - **Progress page built out (replaces StubPage).** `/portal/progress` was a "Coming soon" stub. Rebuilt to show what we actually have data for:
    - **This cycle** card: lesson N of 4, skips used X of 2, auto renew on/off (with tone — amber when skips at cap, green when auto-renew on), cycle started date.
    - **Current plan** card: 4 weeks listed with parent-translation pair (real-world skill first, Fortnite term in italicized parens per Hard rule #4). Personalization note from Tim's Stage-C draft shown in a lime-bordered callout. Per-week status pill: **Completed / Upcoming / Delivered / Missed / Not scheduled** (classified from `live_call_completed_at` / `no_show_at` / `delivered_at` / `live_call_at` vs `now`).
    - **Live call attendance** card: lifetime tally of attended / missed / forfeited calls. Only renders when there's accountable history.
    - **Cycle history** card: each completed curriculum as a compact row with date + the 4 weeks' parent labels. Only renders if at least one cycle is `completed`.
    - **Where they started** card: pulls from trial prep `q2_choice` (mapped to Q2_GOALS lookup). If Q3 reflection exists, renders as a styled blockquote attributed to the kid's first VOD.
    - **Coming soon** footer: rank progression over time / Tim's notes from each lesson / milestones — kept as the honest "not built yet" placeholder.
    - **Sidebar `SOON` chips removed** from Sessions + Progress now that both are real surfaces.
  - **Billing nav consolidation.** Sidebar said "Manage subscription" but the page heading said "Billing" — two different labels for the same destination. Renamed sidebar item to **Billing** to match the page. Also dropped the redundant "Manage your subscription" hero action card on `/portal` overview for active state (it duplicated the Billing nav item). Past-due + pending-cancel hero cards stay because those are urgent recovery actions, not generic account management. Hero row layout switched to a conditional `[hero] [action]` vs `[hero]` so the missing right column doesn't leave dead space in active state.
  - **In-app cancel auto-renew flow.** Old `/portal/billing` had a "Manage payment and cancel" button that went to Stripe's customer portal — but our model uses one-time PaymentIntents off a saved card (no Stripe Subscription object), so the Stripe portal had nothing cancelable. Built the cancel path in-app instead:
    - `POST /api/portal/subscription/cancel-auto-renew` — parent-authed, flips `auto_renew_enabled=FALSE`. Only valid while `status='active'`. Idempotent.
    - `POST /api/portal/subscription/reenable-auto-renew` — mirror. Clears `auto_renew_off_acknowledged_at` so Tim sees the re-on signal.
    - `AutoRenewToggle` Client Component on `/portal/billing`. Two-step confirm to cancel ("Yes, cancel auto renew" / "Never mind"). When auto-renew is off, shows a "current cycle still completes through lesson 4" reassurance + **Re enable auto renew** button.
    - Page copy fixes: Stripe portal description no longer claims to handle cancel (just card updates + invoices). Stripe portal button relabeled from "Manage payment and cancel" → "Manage payment." Current state dl swapped from "Cancels used" → "Skips used" + added "Auto renew" row. "How billing works" bullets rewritten with the correct skip terminology + "Cancel any time from this page" line.
    - End-to-end: parent clicks Cancel → endpoint flips flag → Sunday cron continues delivering lessons 1-4 → `cron-auto-renew-detection` cron sees `lifecycle_state='ACTIVE' + cycle_lessons_delivered=4 + auto_renew_enabled=FALSE` → transitions to `canceled` + sends final email.

- **Reschedule + skip system + auto-renew lifecycle (2026-05-19 night).** Locked spec at `/Users/peteraugros/Desktop/xpl-reschedule-spec.md`. Built phases 1-4 + 7; deferred phases 5-6 (Day-7 unscheduled auto-cancel + 60-day refund enforcement) for a separate session. `npx tsc --noEmit` clean.
  - **Migration `20260519000500_skip_counter_and_renew.sql`** — adds 3 columns on `subscriptions`:
    - `cycle_skips_used SMALLINT NOT NULL DEFAULT 0 CHECK (0..3)` — per-cycle counter, resets when lesson 4 delivers. Backfilled from `cycle_cancels_used` for existing rows; both columns kept in sync during rollout.
    - `auto_renew_enabled BOOLEAN NOT NULL DEFAULT TRUE` — flips to FALSE on 3rd skip. Subscription completes the current cycle to lesson 4, then ends. Grace recovery restores TRUE silently when a future cycle runs with 0 skips.
    - `cycle_timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles'` — frozen at cycle creation. All cadence math (24hr, 7-day window, uniform-pattern detection) runs in this timezone so DST + parent-travel can't break the rules.
  - **`src/lib/calendly/api.ts`** — `cancelCalendlyEvent()` helper. Posts to Calendly REST `/scheduled_events/{id}/cancellation` with the PAT. Idempotent for sentinel ids (`cancelled:`, `auto:`, `manual:`) and 404s.
  - **`POST /api/portal/sessions/[slot_id]/cancel`** — State B (<24hr). Defensive 24hr re-check, cancels Calendly event, sentinel-marks the slot's `live_call_event_id`, advances `cycle_lessons_delivered` (forfeit pattern — kid keeps materials), increments the skip counter, fires the auto-renew-off email if it's strike 3.
  - **`POST /api/portal/sessions/[slot_id]/reschedule`** — State A (>=24hr). Computes `delta_hours` from the original slot time to the new picked time. `<=168` = free reschedule (cadence preserved). `>168` = consumes a skip (cycle pushed forward). Updates slot to new time + new Calendly event id, cancels the old event.
  - **`GET /api/portal/sessions/resolve-event?uri=...`** — internal lookup endpoint. Resolves a Calendly event's `start_time` server-side so the PAT never reaches the browser. Called by the reschedule modal after `event_scheduled` postMessage.
  - **`/portal/sessions` active-state UI** — `ActiveCycleManager` Client Component replaces the 3-button stub. One **Reschedule** button per future-dated slot. Modal auto-branches on the 24hr boundary:
    - State A: pre-navigated Calendly embed (defaults to the original slot's week so the parent's first reflex is a free same-week pick). On `event_scheduled` postMessage → resolves new time → commits via `/reschedule`. Result screen shows "Free reschedule" or "1 skip used".
    - State B: explains the kid keeps slides + voiceover, only the live call is forfeit. Adapts confirm copy when this would be strike 3 ("Cancel and end auto renew").
    - **Skip counter strip** above the session list: `0..2/3` calmly; `3/3` flips to amber "auto renew off, cycle still completes to lesson 4."
  - **Calendly webhook reconciliation** — `applyParentCancel` in `src/app/api/calendly-webhook/route.ts` rewritten for the unified skip model. Both credit (>=24hr) and forfeit (<24hr) increment `cycle_skips_used`; forfeit also advances `cycle_lessons_delivered`. 3rd skip flips `auto_renew_enabled = FALSE` and emails the parent. The retired pending_cancel trigger is gone. Slot's `live_call_event_id` sentinel-marked so duplicate webhook fires are no-ops. `notifyTimCancelThird` is now dead code; cleanup follow-up.

  **Auto-renew lifecycle (phases 4 + 7):**
  - **Migration `20260519000600_auto_renew_card.sql`** — extends `derived_tasks_view` with `subscription_auto_renew_off` (priority 50, between past_due and player messages). Fires when `lifecycle_state='ACTIVE'` AND `auto_renew_enabled=FALSE` AND `auto_renew_off_acknowledged_at IS NULL` (new column). Awareness-class; auto-drops when Tim acknowledges, re-enables, or the cycle ends.
  - **Migration `20260519000700_renewal_in_flight.sql`** — `subscriptions.renewal_pi_id TEXT` gates the cron from double-firing PaymentIntents. Set by cron when PI fires; cleared by Stripe webhook when PI settles either way.
  - **Migration `20260519000800_auto_renew_cron.sql`** — daily pg_cron at 13:30 UTC (30 min after the Sunday delivery cron so cycle_lessons_delivered increments first).
  - **`src/lib/lessons/auto-renew.ts`** — `detectUniformPattern(slots, timezone)` returns `{uniform:true, anchor_iso}` if all 4 slots share weekday + time-of-day within a 15-minute window in the frozen timezone. `provisionNextCycle({supabase, subscriptionId})` is the canonical cycle-rollover function: marks old curriculum `completed`, creates new curriculum with 4 stub lessons (Tim authors content during the cycle), creates 4 slots (uniform soft-books at predicted times; scattered leaves NULL `live_call_at`), resets counters, runs grace recovery if `cycle_skips_used=0 + auto_renew_enabled=false`.
  - **`supabase/functions/cron-auto-renew-detection/index.ts`** — Deno cron. Eligibility: `status='active' + lifecycle_state='ACTIVE' + cycle_lessons_delivered=4 + renewal_pi_id IS NULL`. Branch A (auto_renew_enabled=FALSE): flip subscription `canceled`, mark old curriculum `completed`, send "this was your last cycle" email. Branch B (TRUE): look up default Stripe payment method (with fallback to most-recent card), fire off-session PaymentIntent for 5600 cents with metadata `kind=renewal + subscription_id + player_id + family_id`, stamp `renewal_pi_id`.
  - **Stripe webhook `payment_intent.succeeded`** — when `metadata.kind='renewal'`, dynamic-imports `provisionNextCycle` and calls it. Clears `renewal_pi_id` after success so the next cycle's renewal can fire.
  - **Stripe webhook `payment_intent.payment_failed`** — flips lifecycle to `PAST_DUE`, sets `past_due_started_at`, clears `renewal_pi_id`. Existing dunning crons (Day-3, Day-6 reminders + Day-7 ping) handle the rest.
  - **Tim's admin Re-enable + Got-it actions** — two endpoints. `POST /api/admin/subscriptions/[id]/re-enable-auto-renew` flips `auto_renew_enabled` back to TRUE, resets `cycle_skips_used=0`, clears `auto_renew_off_acknowledged_at`. `POST /api/admin/subscriptions/[id]/ack-auto-renew-off` just stamps the acknowledged_at column (dismiss without re-enabling). Both coach-gated. Surfaced as inline buttons on the FocusedHome card via a small `AutoRenewOffActions` Client Component.
  - **Eyebrow pill** for the auto-renew-off card reuses the `pastDuePill` style (amber). All other awareness pills stay rare-blue.

  **Deferred for a later session (not blocking core MVP):**
  1. Day-7 unscheduled auto-cancel for scattered renewals — extends the existing `cron-scheduling-abandonment` Edge Function to fire when a renewed cycle still has empty slots after Day 7.
  2. 60-day refund window enforcement — today the policy lives in the ToS + auto-cancel email copy. Active block on Stripe portal refund requests >60 days requires a refund webhook handler that intercepts and rejects.
  3. Calendly-side booking of uniform predicted times. Current approach: slots have a predicted `live_call_at` but `live_call_event_id=NULL` (no real Calendly event yet). Parent can reschedule from any of those slots to materialize a real event. Auto-booking via Calendly's scheduling-link API is the upgrade path.
  4. Schema cleanup: drop `cycle_cancels_used` once the skip counter rollout is stable + retire `notifyTimCancelThird` dead code from the Calendly webhook.

- **Focused Home awareness card sweep (2026-05-19 night).** Five new awareness-class task types added to `derived_tasks_view`, extending the pattern established by `new_student_welcome` (action-required, P70) and `new_trial_booked` (awareness, P40). Awareness cards have no `waiting_on='TIM'` filter — they auto-drop when the underlying state changes (parent finishes payment, Stripe recovers, trial wraps into `trial_decision`, etc.). No "mark as seen" action required. `npx tsc --noEmit` clean.
  - **Migration `20260519000400_awareness_cards_sweep.sql`** — `CREATE OR REPLACE VIEW derived_tasks_view` to add 5 new UNION ALL branches. The view now has 10 task types total, ranked:
    - 80 `trial_decision` (action required)
    - 70 `new_student_welcome` (action required)
    - 60 `message_thread` coach-channel
    - **55 `past_due_opened`** *(NEW)* — `lifecycle_state='PAST_DUE'`. Awareness; Stripe is auto-retrying. Body shows day count since `past_due_started_at`. Day-7 dunning still owns the hard escalation path separately.
    - 50 `message_thread` player-channel
    - **45 `pending_payment`** *(NEW)* — `lifecycle_state='PENDING_PAYMENT'`. All 4 slots reserved, parent on Stripe Checkout. Anchored on `payment_pending_at`.
    - 40 `new_trial_booked` (awareness)
    - **38 `vod_dropped`** *(NEW)* — kid posted a VOD during trial within the last 14 days. Surfaces the most recent VOD per player (DISTINCT ON `player_id` ORDER BY created_at DESC). `task_payload.vod_url` carries the link.
    - **38 `prep_answered`** *(NEW)* — kid completed the 3 prep questions during trial within the last 14 days. `task_payload.q1_choice` + `q2_choice` carry the slugs.
    - **35 `parent_started_scheduling`** *(NEW)* — `lifecycle_state IN ('ACCEPTED_PENDING_SCHEDULING', 'SCHEDULING_IN_PROGRESS')` with `scheduling_started_at` stamped. `task_payload.slots_booked` is a live subquery against `curriculum_slots` so the card can show "2 of 4 slots reserved" without server-side context fetching.
    - 20 `cancellation_event` (action required)
  - **Render in `AdminClient.tsx`:** five new branches in `phraseForTask()` with type-specific bodies that pull from `task_payload` directly (no new server-side context plumbing). `past_due_opened` body says "Day N" based on `past_due_started_at`; `parent_started_scheduling` body branches on slot count (0 / 1-3 / 4); `vod_dropped` adds a secondary "Watch clip" link next to "Open card"; `prep_answered` translates Q1/Q2 slugs via the existing `Q1_LABELS` + `Q2_LABELS` maps. Each gets its own eyebrow pill — `SCHEDULING` / `AWAITING PAYMENT` / `CARD DECLINED` / `NEW VOD` / `PREP IN`.
  - **Visual treatment:** `past_due_opened` gets a new amber-accented variant (`focusedHomePastDue` + `pastDuePill` styles, using the `--legendary` token from the rarity palette). All other new types share the existing rare-blue `focusedHomeTrialBooked` variant. None of them pulse (only `new_student_welcome` does that — it's the celebratory event).
  - **Skipped from this sweep:** "waitlist family joined" as a unified-queue card. Waitlist entries don't fit the kid-centric shape of `derived_tasks_view` (no `player_id`), and the existing Pipeline waitlist column + stats strip already surface them. Add only if Pipeline visibility proves insufficient.
  - **One schema gotcha caught:** `prep_responses` uses `submitted_at` (not `created_at`); `vod_uploads` uses `created_at`. Verified against `\d` output before the migration applied cleanly.

#### 🔧 Setup (blocking the next coding work)

1. ~~**PNG icons** for the PWA.~~ **DONE 2026-05-17 night via SVG.** `public/icons/icon.svg` (full-bleed, rounded corners, blue `#0B1538` + white "K") and `public/icons/icon-maskable.svg` (no corners, K shrunk to fit the central 80% safe zone for Android launcher masking). `manifest.json` updated to two entries (`purpose:"any"` + `purpose:"maskable"`), `sizes:"any"`, `type:"image/svg+xml"`. Android Chrome + Edge handle SVG manifest icons; iOS "Add to Home Screen" ignores manifest icons entirely and reads `<link rel="apple-touch-icon">` (which must be a PNG). If iOS adoption matters pre-launch, rasterize `icon.svg` to a 180×180 PNG and add `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">` in `src/app/layout.tsx`. The in-tab favicon (data-URI SVG in layout.tsx) is separate and stays as lime-K on dark blue.
1a. **Apply migration 700 + regen types** to make `/admin` actually run against the local DB. `supabase migration up` (or `npm run db:reset` for a clean slate) then `npm run gen:types`. Without this, /admin will crash at runtime when it queries `coaches.email` / `players.discord_channel_url`. After the regen, the `as never` casts in `admin/page.tsx` + `api/admin/players/[id]/route.ts` + `lib/supabase/auth.ts` (sendCoachMagicLink lookup) can be tightened to typed literals — search for the inline comments referencing migration 700.
1b. **Override Tim's coach email for local testing.** Migration 700 backfills `coaches.email='tim@xplkeyed.com'` but that mailbox doesn't forward anywhere yet (Setup item #3 below). For local dev, run `UPDATE coaches SET email = 'peteraugros@gmail.com' WHERE display_name = 'Tim';` once after applying the migration. Magic links land in your gmail. Revert before production deploy.
1c. **Turn off Calendly's invitee confirmation email** so the parent only gets our branded one. **Event Types → 30 minute free intro call → Notifications → Invitee Email Confirmation → toggle OFF.** Keep the **Calendar Invitation** notification ON (that's the separate .ics event that adds the call to Google Calendar — useful and not duplicative). Also fix the bad event-title template (currently rendering "Cassidy Healzer and Peter Augros") in **Event Types → ... → Edit → Calendar Event Templates** if it's still showing the wrong host name. Our `invitee.created` webhook handler now owns the parent confirmation; if Calendly's email stays on, the parent gets two emails covering the same booking.
2. **Discord developer app:** create the "XPL Keyed Bot" application in the Developer Portal, generate the bot token, and invite it to Tim's coaching server with permissions to (a) DM Tim and (b) post in any per-client channel. Populate `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_TIM_USER_ID` in `.env.local`.
3. **Inbox / MX record at `xplkeyed.com`** so parent replies don't bounce. **Confirmed in live testing (2026-05-17 late): emails to `tim@xplkeyed.com` bounce with "Address not found" because the domain has no MX record set up.** Cheapest fix: most registrars (Namecheap, Cloudflare Registrar, Porkbun, Squarespace, etc.) offer free email forwarding — add MX records pointing at their forwarder and a rule like `tim@xplkeyed.com → peteraugros@gmail.com`. Most "real": Google Workspace ($6/mo) for a full inbox. Until this is fixed, any parent who clicks reply on a magic-link email or hits a future `mailto:tim@xplkeyed.com` link will get a bounce. **Decision locked (Peter, 2026-05-17):** rather than work around the bounce with `replyTo` headers, the long-term direction is to **kill all email contact references and route everything through in-app messaging** (the existing `messages` table). The MX/forwarding fix is still useful for incidental "reply to confirmation" hits, but it's no longer a load-bearing piece — in-app messaging is the planned target.
4. **Verify Calendly booking flow end-to-end** — load `https://calendly.com/xpl-keyed/intro-call` in incognito, walk through as a fake parent, confirm: no phone field, all 5 custom questions render, 24hr min notice enforced, 60-day max range enforced, daily/weekly caps respected, confirmation email arrives with the dash-free Discord trust copy as the location. Cancel the test booking after to keep Tim's calendar clean. Quick verification, not a build task.

#### 🚢 Deployment (when MVP is ready to ship)

5. ~~**Live Supabase project** at supabase.com.~~ **DONE 2026-05-22** (project ref `fmsekesjdkjpvvleefpu`, region `us-west-2`, Free tier). All 5 Edge Function secrets live (Resend, Calendly PAT, app URL, Stripe secret, Stripe webhook secret). `app_config` rows for cron dispatch in place. **Site URL set to `https://xplkeyed.com`** in Authentication → URL Configuration (CRITICAL — see 🎛️ Per-service dashboard config). See Done entries "Live Supabase project provisioned (2026-05-21)" + "Production deploy complete + end-to-end smoke test passed (2026-05-22)".
6. ~~**Live Stripe account.**~~ **DONE 2026-05-22** (see Done entry "Production deploy complete + end-to-end smoke test passed"). ✅ Account activated. ✅ Cards payment method enabled (went through Stripe's "Prebuilt checkout form" setup guide — see 🎛️ Per-service dashboard config). ✅ Webhook endpoint at `https://xplkeyed.com/api/stripe-webhook` subscribed to all 5 events. ✅ `STRIPE_WEBHOOK_SECRET` real value live in BOTH Railway + Supabase Edge Function secrets. ✅ Dunning emails OFF, expiring-card emails ON. End-to-end card charge + refund + webhook flow validated.
7. ~~**Calendly webhook re-registration.**~~ **DONE 2026-05-22**. Old ngrok-pointed subscription `3ef00395-...` deleted; new prod subscription at `https://api.calendly.com/webhook_subscriptions/4df0efa7-6e1a-425a-ad0a-f6f0cbff5d07` against `https://xplkeyed.com/api/calendly-webhook`, reusing existing `CALENDLY_WEBHOOK_SECRET`. State: active. Events: invitee.created + invitee.canceled. Scope: user.
8. ~~**Domain + DNS at xplkeyed.com.**~~ **DONE 2026-05-22** (see Done entry). ✅ CNAME pointed at Railway, propagated globally. ✅ Resend domain verified. ✅ TLS active via Let's Encrypt. ❌ MX/forwarding for `tim@xplkeyed.com` still not set up — per locked decision (in-app messaging is the contact channel), not load-bearing.
9. ~~**Railway deploy.**~~ **DONE 2026-05-22** (see Done entry). Railway project "astonishing-ambition" / service `XPL_Keyed`, 17 env vars live, custom domain `xplkeyed.com` attached with TLS. Production smoke test of `/`, `/login`, `/intake`, `/admin`, `/portal`, `/curriculum/[token]`, `/portal/billing` all clean. **End-to-end Stripe charge passed** (paid → webhook fired → DB transitioned curricula+subscriptions to active → cycle counter live → auto-renew toggle works → refunded cleanly).
10. **Rollback plan.** Railway keeps every deployment in the project history; revert via the Railway dashboard → Deployments tab → click a prior green deploy → Redeploy. Atomic and instant (no rebuild; the prior image is cached). Supabase migrations are forward-only — for a bad migration the recovery is a remediation migration (don't rely on rollback). Stripe webhook events are replayable from the Stripe dashboard if a deploy was missing a handler.

#### 🔑 Env vars status

`.env.local` for local dev. Supabase project secrets need the same values for Edge Functions at runtime — that's a deploy-time step.

- ✅ `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (local-dev values)
- ✅ `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_URL` (sandbox)
- ✅ `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- ✅ `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- ✅ `NEXT_PUBLIC_APP_URL=http://localhost:3000` (swap to `https://xplkeyed.com` in Railway for prod)
- ✅ `CALENDLY_PAT` (Standard plan, scopes: Scheduling + Webhooks, token name "XPL Keyed dev")
- ✅ `CALENDLY_WEBHOOK_SECRET` (64-char hex, generated locally via `openssl rand -hex 32` and passed to Calendly as a request param when creating the subscription — see Done entry for full context). Durable across ngrok URL changes; only rotate if security demands it.
- 🚫 `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_TIM_USER_ID` — **reserved but not used.** Bot architecture retired per `feedback_no_discord_dms.md`. Leave in `.env.local.example` for future operator-pair pattern; do not populate.
- ✅ `ANTHROPIC_API_KEY` (for `/admin/lessons/new` AI-assist suggest buttons)

#### ⚙️ Post-deploy DB config (when the live Supabase project exists)

✅ **DONE 2026-05-21** for the live Supabase project (`fmsekesjdkjpvvleefpu`). See the Done entry "Live Supabase project provisioned (2026-05-21)" for context, including the operator footgun where the SQL placeholder gets pasted literally if you're not paying attention.

For reference / future ops (do NOT re-run against the same project — `app_config_pkey` will reject duplicate keys):

```sql
INSERT INTO app_config (key, value) VALUES
  ('edge_base_url',    'https://<your-project>.functions.supabase.co'),
  ('edge_service_key', '<service-role-jwt>'); -- paste the actual long eyJ... JWT here, not the literal placeholder text
```

To update (e.g. after rotating the service_role key), use `UPDATE app_config SET value = '<new>' WHERE key = '<key>';`.

Without these rows, `cron_fire()` logs a NOTICE and bails (intentional, no cron spam pre-deploy).

#### 🎛️ Per-service dashboard config

- **Supabase Auth Site URL** (Authentication → URL Configuration). Default is `http://localhost:3000`; **must be changed to `https://xplkeyed.com`** before any prod magic link goes out. Otherwise welcome emails / sign-in links point at localhost. Also add `https://xplkeyed.com/**` to the Redirect URLs allowlist; keep `http://localhost:3000/**` for local dev. Caught during 2026-05-22 smoke test — operator footgun for next deploy.
- **Stripe Cards payment method activation.** Fresh live Stripe accounts have Cards in a "Requires action" state. Until activated, `stripe.checkout.sessions.create()` throws `No valid payment method types`. Fix: Settings → Payment methods → click the Cards "Requires action" pill → walk through Stripe's setup guide. When asked *"How do you want to accept recurring payments?"* pick **"Prebuilt checkout form"** (matches our hosted-Checkout architecture). Cards must show **Enabled** before the conversion flow works.
- **Stripe dashboard:** disable Stripe's own dunning emails so our branded D3/D6 emails from `cron-dunning-parent-reminders` own the voice. Stripe's expiring-card emails (30/15/7-day) should stay enabled.
- **Calendly:** 0hr cancel/reschedule window is required only on the **paid-lessons event type** (not yet built) so our backend governs the 24hr rule. The intro-call event type is free with no cycle math, so its cancel window doesn't matter. The setting wasn't visible in the Standard-tier UI as of 2026-05-17; revisit when building the paid-lessons event type — see Open decisions.

#### 🤔 Open decisions

- **0hr cancel/reschedule window on the paid-lessons Calendly event type.** Setting wasn't findable in the Standard-tier UI during the 2026-05-17 intro-call setup. Possibly Teams-tier ($16/mo) only, possibly buried in a sub-section we missed. Critical for paid lessons (backend needs to see all late cancels to govern the 24hr rule). Resolution options before paid-lessons event type goes live: (a) find the setting in Standard, (b) upgrade to Teams, (c) design around it — the parent dashboard's [Cancel this week] CTA deep-links Calendly's cancel page, so most cancels route through us anyway; the Calendly-email path is the minority and could be handled with a "you can only cancel via the parent portal" UX nudge.

### Next coding tasks (in order)

1. ~~Port `index.html` into `src/app/page.tsx`.~~ **DONE 2026-05-17.** Static design lives at `archive/index.html` for reference; live site at `src/app/page.tsx` + `src/components/MarketingClient.tsx` + `src/app/globals.css`. All marketing copy is dash-free per Hard rule #8.
2. ~~The remaining 6 cron Edge Functions under `supabase/functions/`.~~ **DONE 2026-05-17.** All 6 plus the `_shared/` helpers (`discord.ts`, `resend.ts`) and migration `20260517000400_dunning_reminder_columns.sql` are in place. See Project layout above for per-function summaries. Functions are functional stubs at the same fidelity as the existing example: real DB queries, real outbound, real idempotency, placeholder content with dash-free copy (Hard rule #8). Follow-ups when the time is right: refactor `cron-twenty-min-pre-call-reminder` to use `_shared/discord.ts`; layer in `notification_log` writes for audit; replace minimal email HTML with real branded templates.
3. ~~**Stripe webhook handler** at `src/app/api/stripe-webhook/route.ts`.~~ **DONE 2026-05-17.** Verifies Stripe-Signature, dispatches the four events. Notes diverging from the original sketch: (a) `invoice.paid` does NOT increment `cycle_lessons_delivered` — that's the Sunday cron's job. Instead, `invoice.paid` resets the cycle (lessons=0, cancels=0, clears dunning state) because each paid invoice is a cycle BOUNDARY. (b) Only `subscription_create` / `subscription_cycle` invoices reset cycle state; proration / manual invoices are ignored. (c) `pending_cancel` is preserved against all Stripe transitions except final `canceled`. (d) `past_due_started_at` is anchored on first occurrence so the dunning crons stay aligned. (e) Validated end-to-end against the Stripe sandbox.
4. ~~**Calendly webhook handler** at `src/app/api/calendly-webhook/route.ts`.~~ **DONE 2026-05-17.** Handler committed (commit `44de31b`). Calendly webhook subscription registered against an ngrok tunnel (`https://difficult-wand-sixties.ngrok-free.dev`); see the Done entry above for the subscription URI, signing-key origin story (we generate the key, Calendly stores it), and the rotation/production-migration plan. Pre-existing typecheck errors blocking Vercel build also fixed (commit `2b32ec9`). What the handler covers: HMAC-SHA256 signature verification with 5-minute replay tolerance (Calendly uses `t=<unix>,v1=<hex_hmac>` like Stripe); `invitee.canceled` dispatch only (`invitee.created` and the reschedule chain are stubbed until intake exists); host vs invitee `canceler_type` branching (host → `coach_cancels` row, no cap impact; invitee → credit/forfeit per the 24hr rule); credit increments `cycle_cancels_used` and leaves `cycle_lessons_delivered`; forfeit increments `cycle_lessons_delivered` and leaves the cap; 3rd credit triggers `pending_cancel` with `pending_cancel_started_at` + `pending_cancel_auto_confirm_at = now+7d`, calls Stripe `subscriptions.update(..., cancel_at_period_end: true)`, sends the [Confirm end]/[Undo cancel] email and DMs Tim; `cancellation_events` audit row written each time; defensive payload access (`payload.event ?? payload.scheduled_event?.uri`) for Calendly API version drift; email shells dash-free per Hard rule #8. Validated end-to-end with a hand-signed payload through the ngrok tunnel against the running dev server.
5. **Intake flow** — Backend **DONE 2026-05-17** (see Done entry "Intake backend complete"). Form UI (L1–L4) **DONE 2026-05-17 evening** (see Done entry "Intake form UI complete"). What remains:
   - **(a) Polish layer.** Confetti on success, +25 XP floats on level transitions, level-up sound (muted by default with a toggle), animated "Achievement Unlocked" reveal. Spec calls for all of these. None block functionality.
   - **(b) Live verification of Calendly prefill `a1`–`a5` field order** by booking a test call (Setup item #4 in this CLAUDE.md). If order drifts in the event-type definition, prefill silently lands wrong; fix is a one-line ordering change in `buildCalendlyUrl()` in `src/app/intake/page.tsx`.
   - **(c) Calendly event linkage (optional follow-up).** Pass the `event_scheduled` payload URI to `/api/intake/submit`, add a column on `subscriptions` (or a dedicated `trial_calls` table), and enhance the Calendly webhook handler to populate it. Forward-compatible — not adding now doesn't break anything; Tim sees both surfaces (admin + Calendly) separately until then.
   - None of (a)–(c) block proceeding to Task 6.
6. ~~**Auth routes** — `/login`, `/auth/callback`, plus the synthetic-email-for-kids magic-link routing.~~ **DONE 2026-05-17 night.** See Done entry "Auth routes complete" for the full surface. Helper at `src/lib/supabase/auth.ts` owns the parent + player magic-link plumbing; the player override delivers to the parent's real inbox. `/login` is the unified sign-in surface (parent/player toggle); `/auth/callback` handles both PKCE and legacy `token_hash` flows. Intake's welcome email refactored onto the same helper. `npx tsc --noEmit` clean. Open follow-ups: `/portal` + `/play` don't exist yet (next phase), multi-kid login UX, optional rate-limit on `/api/auth/send-magic-link`.
7. **Post-booking portals + Tim's admin.** Three surfaces, each its own slice:
   - **(a) Parent `/portal` trial state.** ✅ **DONE 2026-05-17 night.** See Done entry "Parent /portal (trial state) complete." Server Component with auth + role gate; calm informational tone; quest mirror reading `quest_completions`; empty-state controls panels. Open follow-ups documented inline (trial-call date wiring, real nudge endpoint, real cancel-trial flow, multi-kid selector, active-state dashboard branch). **The welcome email magic link now resolves end-to-end into a real dashboard instead of a 404.**
   - **(b) Kid `/play` trial state.** ✅ **DONE 2026-05-17 night.** See Done entry "Kid /play (trial-state quest log) complete." Server-rendered shell + PlayClient + 3 POST endpoints. 4 quests with sequential unlock for Q3 (locked until VOD dropped), enforced both client- and server-side. RLS via `*_kid_insert` policies stops any forged player_id. Hard-coded Discord invite placeholder + trust-based join verification documented as upgrade-later. Open follow-ups: confetti / +25 XP floats / sound polish, re-submit affordances, real Discord OAuth, live countdown + call CTA (paired with /portal's trial-call wiring).
   - **(c) Tim's admin trial-window view.** ✅ **DONE 2026-05-17 night.** See Done entry "Tim's /admin (trial-window view) complete." Coach-gated dashboard with self-healing auto-link on first sign-in. Stats strip, New Trials cards with inline Discord channel URL form, Active Clients list, stubbed Revenue MTD. Coach login plumbing bundled (sendCoachMagicLink helper + send-magic-link role branch + 3-button role toggle on /login). Migration 700 adds `coaches.email NOT NULL` + `players.discord_channel_url`. Open follow-ups: Stage C panel, Upcoming Calls list, real Revenue MTD, in-app message composer.
8. ~~**In-app messaging surface.**~~ ✅ **DONE 2026-05-18 early morning.** See Done entry "In-app messaging surface complete." Shared `MessageThread` component on `/play` (kid writes), `/portal` (parent read-only), `/admin` (Tim writes per family). Two endpoints (`/api/play/message`, `/api/admin/message`). Booking confirmation email + portal contact strip both repointed at the dashboard. Email contact path retired. Open follow-ups: real-time / push notifications, read receipts, bot messages. **Original scope below kept for context:**
   - **Kid side `/play`:** unlock the currently-locked "Message Tim" card. Text-only thread, parent-visibility indicator "Your parent can read this" visible above the input. Reads from `messages` filtered by `player_id`, writes via a new `POST /api/play/message` route. `messages_kid_insert` RLS already drafted in the initial schema.
   - **Parent side `/portal`:** swap the empty "Message audit" panel into a real read-only message audit. Read-only — parent never writes here. Just a log of everything between kid and Tim.
   - **Tim side `/admin`:** add a "Messages" inbox panel per family card. Lets Tim reply inline. Coach writes go through `messages_coach_all` RLS.
   - **Remove email contact references** from `/portal` contact strip and the booking confirmation email's "reply to this email" line. Replace with "Message Tim in your dashboard." Resolves the MX-record bounce issue without needing to fix MX.
   - **Scope note:** Peter explicitly chose this over working around the email-bounce problem with `replyTo` headers or registrar forwarding. The MX/forwarding fix is no longer load-bearing.
   - **Open question for when this lands:** trial-state vs paid-state behavior. Currently the spec implies messaging unlocks at conversion; but parents-asking-questions-pre-call is a real use case. Decide whether to (a) open messaging in trial state, or (b) point trial families at the Discord coaching server channel for pre-call questions.

---

## Pointers

### Admin spec set (the canonical four)

Peter dropped a full admin redesign spec into the repo on 2026-05-18. The four documents below are **the set** — they describe an admin product significantly more ambitious than the MVP `/admin` page that ships in this repo today. Read together; they're internally consistent.

- [`Coach Dashboard Spec/CEO/admin-spec-focused.md`](Coach%20Dashboard%20Spec/CEO/admin-spec-focused.md) — **Focused mode.** One-thing-at-a-time, scaffolded decisions, warm tone. Default for Tim and ADHD/novice operators. Supersedes `Coach Dashboard Spec/admin-spec.md` (the original draft is kept for posterity but the focused-mode file is canonical).
- [`Coach Dashboard Spec/CEO/admin-spec-command.md`](Coach%20Dashboard%20Spec/CEO/admin-spec-command.md) — **Command mode.** Pipeline (kanban), Inbox tab, Money dashboard with bar chart, Operations tab, keyboard-first (`cmd+K` palette, `j/k` nav, `g p / g i / g c` tab switching). Power-user surface, *not* "Focused minus warmth" — different mindset, not different level.
- [`Coach Dashboard Spec/CEO/admin-modes.md`](Coach%20Dashboard%20Spec/CEO/admin-modes.md) — **Meta-spec for how the two modes coexist.** Toggle UI (top-right, `cmd+\`), per-user persistence, context preservation across switches, shared infrastructure, per-mode preferences, onboarding nudge thresholds. **Default for new users is Focused.** Tim-specific note: suppress the Command-mode suggestion for at least 6 months because the responsibility curriculum is the point of the product for him.
- [`Coach Dashboard Spec/backend-spec.md`](Coach%20Dashboard%20Spec/backend-spec.md) — **The `waiting_on` field and lifecycle state model.** Small but load-bearing. The Tasks abstraction, Home queue, stale-client detection, and Stuck-button flow all depend on this. Build the backend first; admin features ladder on top.

Companion Dad spec (separate product, same family):

- [`Coach Dashboard Spec/dad-admin-spec.md`](Coach%20Dashboard%20Spec/dad-admin-spec.md) — **Peter's admin surface.** Stuck queue (Tim's escalations), operational alerts (Stripe/Discord/Calendly/Resend health), Tim activity summary, read-only "View as Tim" mirror. Tone: safety net, not control panel. "Send back with a note" preserves Tim as the operator.

### What's in the repo vs. what's in the spec

**Built today** (`src/app/admin/...`): single-mode dashboard. Stats strip (Paying/12, Trials this week, Waitlist, Revenue MTD), New Trials cards with Stage C panel (take on / decline / drafter) + inline Discord URL form + Messages thread per kid, Active Clients list, Lesson library list + author form, basic coach-gated auth + auto-link. No modes, no Tasks abstraction, no `waiting_on` field, no Pipeline view, no Inbox tab, no Stuck button, no Tim ↔ Dad channel, no Coach Mode for live calls, no Dad admin at all.

**The spec describes** a substantial rebuild. Treat current code as the data-layer + early-product scaffolding that the spec'd admin will eventually rebuild on top of. Don't assume continuity of UI patterns — the spec is opinionated and the built UI doesn't match it.

### Memory files (user-level, auto-loaded across sessions)

Detailed reasoning behind specific decisions lives in user-level memory at `~/.claude/projects/-Users-peteraugros-Desktop-XPL-Keyed/memory/` — auto-loaded by future Claude sessions. Files include:

- `user_peter_tim.md` — who Peter and Tim are, roles
- `project_xpl_keyed_overview.md` — top-level project state + open questions
- `decision_no_pptx_export.md` — why lessons are web-native, not .pptx
- `decision_trust_and_accounts.md` — heavy trust signals, linked accounts, monthly curriculum approval
- `decision_post_booking_portal.md` — kid quest log + parent dashboard during trial
- `decision_tim_notifications.md` — Discord DM bot for call reminders
- `decision_stage_c_conversion.md` — Tim-initiated conversion with curriculum draft
- `decision_parent_translation_and_upsell.md` — translation rule + 3-place upsell
- `decision_parent_talking_points.md` — "🤫 For your back pocket" mechanic
- `decision_claudemd_source_of_truth.md` — lock decisions and checklists into CLAUDE.md, don't leave them in chat (added 2026-05-17)

If you're a future Claude session and any of those memory files weren't loaded, surface that to Peter — something is off.
