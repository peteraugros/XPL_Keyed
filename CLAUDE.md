# XPL Keyed — Project Context

This file is loaded into any Claude session working in this directory. It captures everything we've decided in the design conversation so far. Read it end-to-end before suggesting changes — many decisions are deliberate and have a "why" behind them.

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
- **Vercel** — hosting

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
- **Parent's conversion email** uses the parent-translation rule: each week shows the real-world skill it builds with the Fortnite term in italicized parens. Single CTA: "Approve plan & subscribe." Cancellation policy stated plainly.
- **Conversion screen** uses Stripe Elements embedded inline. Two tiers: MONTHLY $56 (default selected, "Recommended") and SINGLE LESSON $14.
- **Billing cycle for monthly tier is every 4 lessons, NOT every 30 days.** Parent pays $56, gets 4 lessons delivered (one per Sunday), then billed again. If a week is skipped (illness, vacation), cycle pauses. Matches the "$56 for 4 lessons" mental model on the marketing site and avoids the "I paid for 4 weeks but only got 2 lessons due to spring break" complaint. Slightly more complex Stripe implementation — use a subscription with manually-advanced cycle (deliver lesson → increment counter → at counter=4, charge next $56 and reset). Or metered billing with a custom job.
- **Kid's portal during this window:**
  - Awaiting Tim's decision: quest log shows "Tim is reviewing your session. Check back soon."
  - Conversion approved: big "ACHIEVEMENT UNLOCKED · LEVEL 2 · ACTIVE PLAYER" moment with confetti, trial badge replaced, first lesson countdown to Sunday appears, 4-week curriculum visible.
  - Conversion declined: graceful "thanks for trying" screen with Tim's recommended free creators. Account stays open.

### Cancellation policy & credits

- **Two cancel paths, both reconciled through the same backend webhook:**
  1. Parent dashboard → Upcoming Lessons card → **[Reschedule this week]** (primary, deep-links Calendly's reschedule flow) or **[Cancel this week]** (smaller secondary action).
  2. Native Calendly cancel/reschedule link in booking confirmation emails.
  - **Calendly's cancel/reschedule window must be opened to 0hr in Calendly settings** so all cancels reach our webhook. Our backend governs the 24hr rule, not Calendly — otherwise Calendly silently blocks late cancels and we never see them.
- **>24hr from call = credit.** Cycle pauses 1 week. No "credit balance" surface anywhere — `cycle_lessons_delivered` simply doesn't advance. Next Sunday becomes the rescheduled lesson.
  - **If PowerPoint+VO was already delivered Sunday and parent cancels Mon/Tue (still >24hr from a Wed call):** kid keeps the material as a freebie, cycle still pauses. Tim absorbs the work cost. The 2/cycle cap limits damage.
- **<24hr from call = no credit.** Kid keeps the PowerPoint+VO, the 30-min call is forfeit, cycle advances. Does NOT count toward the 2/cycle cap.
- **No-shows = same mechanical outcome as <24hr cancel** (lesson counts, cycle advances, no cap impact). Tracked in a separate `no_shows` log so Tim sees repeat patterns. Auto-email to parent: "We missed you — everything OK?" Tim can manually convert a no-show to a credit if a legitimate reason surfaces. No automatic grace.
- **Cap: 2 credits per 4-lesson cycle**, not per calendar month. Cycle is the right window because billing is per 4 lessons, not per 30 days — see Stage C above. Cap resets when the cycle's 4th lesson is delivered and the next $56 charges.
- **3rd cancel attempt ends the subscription**, different confirmation flow per surface:
  - **Portal path:** dedicated end-subscription screen with type-to-confirm ("Type END to confirm"). Framed protectively, not punitively: "kids who skip more than 2 per cycle don't see meaningful progress, and we'd rather pause than charge you for lessons that aren't landing." Restart any time, progress is preserved.
  - **Calendly-email path:** webhook marks subscription `pending_cancel` immediately (the call IS cancelled), sends email with two CTAs: **[Confirm end subscription]** or **[Undo cancel and keep subscription]**. 7-day pending window with reminder emails at day 3 and day 6. No billing, no new lessons during pending. Day 7 no response → auto-confirm. "Undo" reverts the 3rd cancel itself: `cycle_cancels_used` → 2, Calendly event re-booked, subscription remains active.
- **Reschedules do NOT count toward the cap.** Cancel-after-reschedule does — otherwise the cap is trivially gameable.
- **Backend state on the subscription row:** `cycle_started_at`, `cycle_lessons_delivered` (0–4), `cycle_cancels_used` (0–2; 3 triggers `pending_cancel`), `last_cancel_at`. Coach-initiated cancels live in a separate `coach_cancels` table and never touch `cycle_cancels_used` — see below.
- **Tim's admin client card** shows running state: `Cycle: 3/4 lessons · 1 cancel used`. Discord DM bot fires on any cancel #3 attempt so Tim sees it in real time and can reach out before auto-confirm.

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

- **Discord DM bot, 20 min before each call**, with full context: prep completion status, VOD link, channel link. Tim is on Discord 24/7 for the coaching server — push notifications are reliable and free.
- **Day-7 dunning ping and cancel-#3 ping** also DM Tim — see Cancellation and Dunning sections above for the triggers, and Discord bot architecture below for the infra.
- **Calendly auto-creates a calendar invite** — backstop reminder via Tim's calendar app.
- **SMS via Twilio is upgrade-later**, not MVP. Add if Discord notifications ever miss a critical reminder.

### Discord bot architecture

The XPL Keyed Bot handles three outbound notification triggers from the same Supabase Edge Function infrastructure. Outbound-only — no persistent Discord gateway connection. Inbound interaction (kid messages, parent observation) happens in the coaching server itself via Discord's normal clients; the bot doesn't proxy that.

- **Where it lives:** Supabase Edge Function in TypeScript, deployed alongside the rest of the Supabase project. No dedicated long-lived server. Outbound messages via Discord's REST API.
- **Auth:** Bot identity registered in Discord's developer portal, invited to Tim's coaching server with permissions to (a) DM Tim and (b) post in any per-client channel. Token stored as `DISCORD_BOT_TOKEN` env var in Supabase. **Bot speaks as itself ("XPL Keyed Bot"), never as Tim.** Honest framing — never disguise an auto-message as Tim writing personally.
- **Three triggers:**
  1. **20-min pre-call reminder** — `pg_cron` job runs every 1 minute, queries for calls in the 19–21 minute window not yet pinged, fires the Edge Function. Function DMs Tim with prep-completion status, VOD link, channel link.
  2. **Day-7 dunning ping** — `pg_cron` job runs once a day, queries for subscriptions where `past_due` began exactly 7 days ago, fires the function. DM: *"Jake's family — payment failing 7 days. Want to reach out personally?"*
  3. **Cancel-#3 ping** — event-driven (no cron). Fires from the cancel webhook handler the moment a 3rd cancel is registered. DM: *"Jake's family is about to hit cancel #3 — flagged for ending. Want to reach out?"*
- **Idempotency:** each trigger has a `notified_at` column on the relevant row (`calls.notified_at_20min`, `subscriptions.notified_at_day7_dunning`, `cancel_attempts.notified_at_third`). Edge Function sets it on send. pg_cron queries filter on `IS NULL` so a missed run never double-pings, and a late-firing 2-minute job still catches the call.
- **Failure mode:** if Discord API is down or rate-limited, the Edge Function logs to Supabase and does not retry. Calendly invites are the backstop for the 20-min ping. Dunning and cancel-#3 ping have parallel branded emails going to the parent regardless — a missed Discord ping means Tim doesn't intervene personally, not that the family is unhandled.
- **Out of scope for MVP:** inbound bot commands, persistent gateway connection, real-time presence tracking. If/when those matter, migrate to a dedicated tiny Node service on Railway/Fly.

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

26. **Platform fee structure.** Currently undefined. Options: flat monthly per operator, revenue share, hybrid (low monthly + low rev share), setup fee + low ongoing. Pressure test: what's fair to a parent-kid pair earning $4K–$8K/year while still funding BG checks + insurance + platform oversight, while still being attractive to an acquirer? Lock the number before operator-#2 conversations start.
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

### Human setup (only Peter can do)

This section is the running source of truth for what's on Peter's plate. Update it at the end of each session — done items move to "✅ Done", new items get added under the right group. Claude maintains it; Peter executes against it.

#### ✅ Done

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
  - **Production deploy plan:** when Vercel + production Supabase are set up (queued under 🚢 Deployment), delete the ngrok-pointed subscription and recreate against the Vercel URL, reusing the same `CALENDLY_WEBHOOK_SECRET` so existing handler code keeps working.
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

#### 🔧 Setup (blocking the next coding work)

1. ~~**PNG icons** for the PWA.~~ **DONE 2026-05-17 night via SVG.** `public/icons/icon.svg` (full-bleed, rounded corners, blue `#0B1538` + white "K") and `public/icons/icon-maskable.svg` (no corners, K shrunk to fit the central 80% safe zone for Android launcher masking). `manifest.json` updated to two entries (`purpose:"any"` + `purpose:"maskable"`), `sizes:"any"`, `type:"image/svg+xml"`. Android Chrome + Edge handle SVG manifest icons; iOS "Add to Home Screen" ignores manifest icons entirely and reads `<link rel="apple-touch-icon">` (which must be a PNG). If iOS adoption matters pre-launch, rasterize `icon.svg` to a 180×180 PNG and add `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">` in `src/app/layout.tsx`. The in-tab favicon (data-URI SVG in layout.tsx) is separate and stays as lime-K on dark blue.
1a. **Apply migration 700 + regen types** to make `/admin` actually run against the local DB. `supabase migration up` (or `npm run db:reset` for a clean slate) then `npm run gen:types`. Without this, /admin will crash at runtime when it queries `coaches.email` / `players.discord_channel_url`. After the regen, the `as never` casts in `admin/page.tsx` + `api/admin/players/[id]/route.ts` + `lib/supabase/auth.ts` (sendCoachMagicLink lookup) can be tightened to typed literals — search for the inline comments referencing migration 700.
1b. **Override Tim's coach email for local testing.** Migration 700 backfills `coaches.email='tim@xplkeyed.com'` but that mailbox doesn't forward anywhere yet (Setup item #3 below). For local dev, run `UPDATE coaches SET email = 'peteraugros@gmail.com' WHERE display_name = 'Tim';` once after applying the migration. Magic links land in your gmail. Revert before production deploy.
1c. **Turn off Calendly's invitee confirmation email** so the parent only gets our branded one. **Event Types → 30 minute free intro call → Notifications → Invitee Email Confirmation → toggle OFF.** Keep the **Calendar Invitation** notification ON (that's the separate .ics event that adds the call to Google Calendar — useful and not duplicative). Also fix the bad event-title template (currently rendering "Cassidy Healzer and Peter Augros") in **Event Types → ... → Edit → Calendar Event Templates** if it's still showing the wrong host name. Our `invitee.created` webhook handler now owns the parent confirmation; if Calendly's email stays on, the parent gets two emails covering the same booking.
2. **Discord developer app:** create the "XPL Keyed Bot" application in the Developer Portal, generate the bot token, and invite it to Tim's coaching server with permissions to (a) DM Tim and (b) post in any per-client channel. Populate `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_TIM_USER_ID` in `.env.local`.
3. **Inbox / MX record at `xplkeyed.com`** so parent replies don't bounce. **Confirmed in live testing (2026-05-17 late): emails to `tim@xplkeyed.com` bounce with "Address not found" because the domain has no MX record set up.** Cheapest fix: most registrars (Namecheap, Cloudflare Registrar, Porkbun, Squarespace, etc.) offer free email forwarding — add MX records pointing at their forwarder and a rule like `tim@xplkeyed.com → peteraugros@gmail.com`. Most "real": Google Workspace ($6/mo) for a full inbox. Until this is fixed, any parent who clicks reply on a magic-link email or hits a future `mailto:tim@xplkeyed.com` link will get a bounce. **Decision locked (Peter, 2026-05-17):** rather than work around the bounce with `replyTo` headers, the long-term direction is to **kill all email contact references and route everything through in-app messaging** (the existing `messages` table). The MX/forwarding fix is still useful for incidental "reply to confirmation" hits, but it's no longer a load-bearing piece — in-app messaging is the planned target.
4. **Verify Calendly booking flow end-to-end** — load `https://calendly.com/xpl-keyed/intro-call` in incognito, walk through as a fake parent, confirm: no phone field, all 5 custom questions render, 24hr min notice enforced, 60-day max range enforced, daily/weekly caps respected, confirmation email arrives with the dash-free Discord trust copy as the location. Cancel the test booking after to keep Tim's calendar clean. Quick verification, not a build task.

#### 🚢 Deployment (when MVP is ready to ship)

5. **Create the live Supabase project** at supabase.com; copy URL + anon + service_role keys into Vercel project env (and rerun `supabase db push` against the live project).
6. **Activate live Stripe account** (currently only the sandbox is set up). Re-generate prod webhook endpoint via Stripe dashboard (a fresh `whsec_...` separate from the sandbox one).
7. **Vercel deploy** pointed at `xplkeyed.com` (domain is already owned).

#### 🔑 Env vars status

`.env.local` for local dev. Supabase project secrets need the same values for Edge Functions at runtime — that's a deploy-time step.

- ✅ `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (local-dev values)
- ✅ `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PORTAL_URL` (sandbox)
- ✅ `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
- ✅ `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- ✅ `NEXT_PUBLIC_APP_URL=http://localhost:3000` (swap to `https://xplkeyed.com` in Vercel for prod)
- ✅ `CALENDLY_PAT` (Standard plan, scopes: Scheduling + Webhooks, token name "XPL Keyed dev")
- ✅ `CALENDLY_WEBHOOK_SECRET` (64-char hex, generated locally via `openssl rand -hex 32` and passed to Calendly as a request param when creating the subscription — see Done entry for full context). Durable across ngrok URL changes; only rotate if security demands it.
- ⏳ `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_TIM_USER_ID` — blocked on Discord setup

#### ⚙️ Post-deploy DB config (when the live Supabase project exists)

Run once against the live db, after `supabase db push`:

```sql
INSERT INTO app_config (key, value) VALUES
  ('edge_base_url',    'https://<your-project>.functions.supabase.co'),
  ('edge_service_key', '<service-role-jwt>');
```

Without these rows, `cron_fire()` logs a NOTICE and bails (intentional, no cron spam pre-deploy).

#### 🎛️ Per-service dashboard config

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
