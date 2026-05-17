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
│   │   └── sw.ts                   ← Serwist service worker entry
│   ├── components/
│   │   └── MarketingClient.tsx     ← Client Component: hamburger toggle, scroll-reveal IntersectionObserver, count-up timer since 2020-02-20 (C2S2 launch). Renders null; pure side-effects.
│   ├── lib/
│   │   ├── supabase/{client,server,middleware}.ts  ← @supabase/ssr setup; service-role exported separately
│   │   ├── stripe/server.ts        ← Stripe SDK init
│   │   ├── email/resend.ts         ← Resend SDK init + FROM_EMAIL
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
    │   └── 20260517000400_dunning_reminder_columns.sql   ← adds notified_at_dunning_day3 + notified_at_dunning_day6 on subscriptions (idempotency for the D3/D6 dunning emails)
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

#### 🔧 Setup (blocking the next coding work)

1. **PNG icons** for the PWA — drop into `public/icons/`:
   - `icon-192.png` (192×192)
   - `icon-512.png` (512×512)
   - `icon-maskable-512.png` (512×512, safe-zone padding for Android maskable)
2. **Calendly account:** create the 30-min free-call event type; set the cancel/reschedule window to **0hr** in Calendly settings so all cancels reach our webhook. Generate a Personal Access Token (`CALENDLY_PAT`) and a webhook signing secret (`CALENDLY_WEBHOOK_SECRET`) and paste into `.env.local`.
3. **Discord developer app:** create the "XPL Keyed Bot" application in the Developer Portal, generate the bot token, and invite it to Tim's coaching server with permissions to (a) DM Tim and (b) post in any per-client channel. Populate `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_TIM_USER_ID` in `.env.local`.
4. **Inbox at `tim@xplkeyed.com`** so parent replies don't bounce. Cheapest: forwarding rule at registrar → Peter's gmail. Most "real": Google Workspace ($6/mo) for a full inbox. Or skip-and-defer by adding `replyTo` to `_shared/resend.ts`.

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
- ⏳ `CALENDLY_PAT`, `CALENDLY_WEBHOOK_SECRET` — blocked on Calendly setup
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
- **Calendly:** confirm cancel/reschedule window is 0hr (mentioned above; restated because it matters and is easy to miss). Our backend governs the 24hr rule, not Calendly.

#### 🤔 Open decisions

_(None currently. New items surfaced during work land here until Peter resolves them.)_

### Next coding tasks (in order)

1. ~~Port `index.html` into `src/app/page.tsx`.~~ **DONE 2026-05-17.** Static design lives at `archive/index.html` for reference; live site at `src/app/page.tsx` + `src/components/MarketingClient.tsx` + `src/app/globals.css`. All marketing copy is dash-free per Hard rule #8.
2. ~~The remaining 6 cron Edge Functions under `supabase/functions/`.~~ **DONE 2026-05-17.** All 6 plus the `_shared/` helpers (`discord.ts`, `resend.ts`) and migration `20260517000400_dunning_reminder_columns.sql` are in place. See Project layout above for per-function summaries. Functions are functional stubs at the same fidelity as the existing example: real DB queries, real outbound, real idempotency, placeholder content with dash-free copy (Hard rule #8). Follow-ups when the time is right: refactor `cron-twenty-min-pre-call-reminder` to use `_shared/discord.ts`; layer in `notification_log` writes for audit; replace minimal email HTML with real branded templates.
3. ~~**Stripe webhook handler** at `src/app/api/stripe-webhook/route.ts`.~~ **DONE 2026-05-17.** Verifies Stripe-Signature, dispatches the four events. Notes diverging from the original sketch: (a) `invoice.paid` does NOT increment `cycle_lessons_delivered` — that's the Sunday cron's job. Instead, `invoice.paid` resets the cycle (lessons=0, cancels=0, clears dunning state) because each paid invoice is a cycle BOUNDARY. (b) Only `subscription_create` / `subscription_cycle` invoices reset cycle state; proration / manual invoices are ignored. (c) `pending_cancel` is preserved against all Stripe transitions except final `canceled`. (d) `past_due_started_at` is anchored on first occurrence so the dunning crons stay aligned. (e) Validated end-to-end against the Stripe sandbox.
4. **Calendly webhook handler** at `src/app/api/calendly-webhook/route.ts` — reconcile cancels against `cycle_cancels_used` (>24hr = credit, <24hr = forfeit), trigger `pending_cancel` state on cancel #3, fire branded emails through Resend.
5. **Intake flow** — Stage A 4-level gamified form + `rpc.intake()` SECURITY DEFINER function that atomically creates `families` + `parents` + `players` + `auth.users` + first quest_completion + sends magic link.
6. **Auth routes** — `/login`, `/auth/callback`, plus the synthetic-email-for-kids magic-link routing: kids under 13 get a generated `kid+{uuid}@xplkeyed.internal` auth identity; magic-link delivery is intercepted server-side and routed to `parents.email` instead. Document the email override hook in a `src/lib/supabase/auth.ts` helper.

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
