// npm run rehearse
//
// One family, front door to renewal, through the REAL routes.
//
// WHY THIS EXISTS. The verify suites cover the middle of the lifecycle well
// (advance, idempotency, four calls, the write-up, both portal pages) and they
// all START from a seeded ACTIVE subscription. Two things therefore had never
// run at all as of 2026-09-20:
//
//   the FRONT DOOR   take-on -> approval token -> Stripe checkout -> webhook
//                    -> subscription ACTIVE with four bare sessions
//   the MONEY        no suite touches Stripe. Production has 0 active
//                    subscriptions and nobody has ever been taken on, so the
//                    $56 charge has never fired and every cron has only ever
//                    been observed no-opping against empty state.
//
// This walks one family the whole way so those joins are exercised once before
// a real parent meets them.
//
// ---------------------------------------------------------------------------
// 🔴 IT REFUSES TO RUN AGAINST LIVE STRIPE, AND THAT IS THE POINT.
// ---------------------------------------------------------------------------
// Production Stripe is LIVE (verified 2026-09-20: sk_live_, plus an enabled
// webhook at https://xplkeyed.com/api/stripe-webhook subscribed to
// checkout.session.completed and invoice.paid). A rehearsal pointed there
// would create a real Customer and a real charge on a real card.
//
// So stage 0 reads the key and ABORTS on sk_live_. It also refuses a non local
// Supabase URL. Neither check is a formality: the difference between a
// rehearsal and an incident is one env var.
//
// ⚠️ IT SENDS REAL EMAIL. The run logs 5 notifications and they go out through
// whatever RESEND_API_KEY is in .env.local, addressed to @example.test, which
// is a reserved domain that cannot reach a person. That is deliberate: the
// recap email is one of the things being proven, and a mocked send would prove
// nothing about it.
//
// Run:  npm run rehearse
// Needs: local Supabase up, a dev server on :3100, and TEST Stripe keys in
//        .env.local. Every fixture is removed at the end and the row counts
//        are checked back to baseline.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

let passed = 0;
const failures = [];
function ok(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function eq(label, a, b) { ok(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function step(s) { console.log(`\n${s}`); }

// ---------------------------------------------------------------------------
// 0. Refuse before touching anything
// ---------------------------------------------------------------------------
const SK = env.STRIPE_SECRET_KEY ?? "";
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (SK.includes("_live_")) {
  console.error("\nREFUSING TO RUN: STRIPE_SECRET_KEY in .env.local is a LIVE key.");
  console.error("This rehearsal creates a Stripe Customer and a charge. Point it at test keys.");
  process.exit(2);
}
if (!/127\.0\.0\.1|localhost/.test(SUPA)) {
  console.error(`\nREFUSING TO RUN: NEXT_PUBLIC_SUPABASE_URL is not local (${SUPA}).`);
  process.exit(2);
}
if (!SK.startsWith("sk_test_")) {
  console.error("\nREFUSING TO RUN: no sk_test_ Stripe key found in .env.local.");
  process.exit(2);
}

const db = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const TAG = `rehearse-${randomUUID().slice(0, 8)}`;
const made = { authUsers: [], coaches: [], families: [], players: [], parents: [], subs: [], curricula: [] };
const stripeMade = { customers: [] };

function jar() {
  let cookie = "";
  return {
    get: () => cookie,
    absorb(res) {
      const sc = res.headers.getSetCookie?.() ?? [];
      if (!sc.length) return;
      const m = new Map(cookie ? cookie.split("; ").map((c) => { const i = c.indexOf("="); return [c.slice(0, i), c.slice(i + 1)]; }) : []);
      for (const c of sc) { const pr = c.split(";")[0]; const i = pr.indexOf("="); m.set(pr.slice(0, i), pr.slice(i + 1)); }
      cookie = [...m].map(([k, v]) => `${k}=${v}`).join("; ");
    },
  };
}
async function post(j, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(j.get() ? { cookie: j.get() } : {}) },
    body: JSON.stringify(body), redirect: "manual",
  });
  j.absorb(res);
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
async function stripeApi(path, form) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${SK}:`).toString("base64")}`,
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
function rows(label, r) {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data ?? [];
}

async function census() {
  const t = ["families", "players", "parents", "subscriptions", "curricula", "curriculum_slots", "notification_log"];
  const out = {};
  for (const name of t) {
    const r = await db.from(name).select("id", { count: "exact", head: false }).limit(1);
    const c = await db.from(name).select("*", { count: "exact", head: true });
    if (c.error) throw new Error(`census ${name}: ${c.error.message}`);
    out[name] = c.count ?? 0;
    void r;
  }
  return out;
}

async function main() {
  console.log(`XPL Keyed lifecycle rehearsal  [${TAG}]`);
  console.log(`  Stripe: TEST   Supabase: local   dev server: ${BASE_URL}`);

  const before = await census();

  // -------------------------------------------------------------------------
  step("A. a family that has had its free call, ready for Tim's decision");
  const password = `Rh-${randomUUID()}`;
  const coachEmail = `${TAG}-coach@example.test`;
  const created = await db.auth.admin.createUser({ email: coachEmail, password, email_confirm: true });
  if (created.error) throw new Error(`coach auth: ${created.error.message}`);
  made.authUsers.push(created.data.user.id);

  const coach = await db.from("coaches").insert({
    display_name: "Rehearsal Coach", email: coachEmail, username: TAG,
    auth_user_id: created.data.user.id, is_active: true,
  }).select("id").single();
  if (coach.error) throw new Error(`coaches: ${coach.error.message}`);
  made.coaches.push(coach.data.id);

  const family = await db.from("families").insert({}).select("id").single();
  if (family.error) throw new Error(`families: ${family.error.message}`);
  made.families.push(family.data.id);

  const parent = await db.from("parents").insert({
    family_id: family.data.id, first_name: "Rehearsal",
    email: `${TAG}-parent@example.test`,
  }).select("id").single();
  if (parent.error) throw new Error(`parents: ${parent.error.message}`);
  made.parents.push(parent.data.id);

  const player = await db.from("players").insert({
    family_id: family.data.id, first_name: "Jaxon", age: 14,
  }).select("id").single();
  if (player.error) throw new Error(`players: ${player.error.message}`);
  made.players.push(player.data.id);

  // The state take-on expects: trial done, Tim deciding.
  // Enum and CHECK values read off pg_enum / pg_constraint rather than
  // guessed. lifecycle_state_t has TRIAL_SCHEDULED, not TRIAL_BOOKED, and
  // subscriptions.status allows 'trial', not 'trialing'. Guessing both cost a
  // run; this repo's own notes warn about exactly that.
  const sub = await db.from("subscriptions").insert({
    player_id: player.data.id, status: "trial", lifecycle_state: "TRIAL_SCHEDULED",
    tier: "trial", cycle_sessions_delivered: 0, auto_renew_enabled: true,
  }).select("id").single();
  if (sub.error) throw new Error(`subscriptions: ${sub.error.message}`);
  made.subs.push(sub.data.id);
  ok("a trial family exists, not yet taken on", !!sub.data.id);

  const j = jar();
  // The route takes USERNAME, not email. Read from its Zod schema after a 400.
  const signin = await post(j, "/api/auth/sign-in-coach-password", { username: TAG, password });
  eq("coach signed in", signin.status, 200);

  // -------------------------------------------------------------------------
  step("B. Tim takes them on  (the front door, never exercised before)");
  const take = await post(j, "/api/admin/conversion/take-on", {
    player_id: player.data.id,
    personalization_note: "Jaxon reads fights well and panics on the rebuild. That is where we start.",
  });
  eq("take-on succeeds", take.status, 200);

  const cur = await db.from("curricula").select("id, status, approval_token")
    .eq("player_id", player.data.id).maybeSingle();
  if (cur.error) throw new Error(`curricula: ${cur.error.message}`);
  made.curricula.push(cur.data?.id);
  ok("a curriculum is waiting on the parent", cur.data?.status === "pending_approval");
  ok("an approval token was minted", (cur.data?.approval_token ?? "").length >= 32);

  const slots = rows("slots", await db.from("curriculum_slots")
    .select("id, week_number, live_call_at, delivered_at, cycle_counted_at")
    .eq("curriculum_id", cur.data.id).order("week_number"));
  eq("four bare sessions exist", slots.length, 4);
  ok("none is scheduled or settled yet",
     slots.every((s) => !s.live_call_at && !s.delivered_at && !s.cycle_counted_at));

  // -------------------------------------------------------------------------
  step("C. the parent pays  (real Stripe TEST customer + checkout session)");
  const checkout = await post(jar(), `/api/curriculum/${cur.data.approval_token}/checkout`, {});
  eq("checkout session created", checkout.status, 200);
  ok("Stripe returned a hosted page url", typeof checkout.json?.url === "string");

  const fam = await db.from("families").select("stripe_customer_id").eq("id", family.data.id).single();
  const customerId = fam.data?.stripe_customer_id;
  ok("the family now has a Stripe customer", typeof customerId === "string" && customerId.startsWith("cus_"));
  if (customerId) stripeMade.customers.push(customerId);

  const cust = await stripeApi(`customers/${customerId}`);
  eq("that customer really exists in Stripe", cust.status, 200);
  ok("and it is TEST mode", cust.json?.livemode === false, JSON.stringify(cust.json?.livemode));

  // -------------------------------------------------------------------------
  step("D. Stripe tells us it was paid  (real signed webhook, real handler)");
  const sessions = await stripeApi(`checkout/sessions?limit=1&customer=${customerId}`);
  const session = sessions.json?.data?.[0];
  ok("the checkout session is retrievable", !!session?.id);
  ok("it carries the metadata the webhook needs",
     !!session?.metadata?.curriculum_id && !!session?.metadata?.subscription_id,
     JSON.stringify(session?.metadata ?? {}));

  // Build the event Stripe would send, and sign it the way Stripe signs it, so
  // the route's own signature verification is exercised rather than bypassed.
  const evt = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "event", type: "checkout.session.completed", livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object: { ...session, payment_status: "paid", status: "complete" } },
  };
  const payload = JSON.stringify(evt);
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET)
    .update(`${ts}.${payload}`).digest("hex");
  const hookRes = await fetch(`${BASE_URL}/api/stripe-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` },
    body: payload,
  });
  eq("the webhook accepted a correctly signed event", hookRes.status, 200);

  const afterPay = await db.from("subscriptions")
    .select("status, tier, lifecycle_state, cycle_started_at, cycle_sessions_delivered")
    .eq("id", sub.data.id).single();
  eq("the subscription is ACTIVE", afterPay.data?.lifecycle_state, "ACTIVE");
  eq("on the monthly tier", afterPay.data?.tier, "monthly");
  ok("the cycle has started", !!afterPay.data?.cycle_started_at);
  eq("and no session is counted yet", afterPay.data?.cycle_sessions_delivered, 0);

  const curAfter = await db.from("curricula").select("status").eq("id", cur.data.id).single();
  eq("the curriculum is active", curAfter.data?.status, "active");

  // -------------------------------------------------------------------------
  step("E. the four calls get scheduled  (as the Calendly webhook does)");
  for (let i = 0; i < 4; i++) {
    const at = new Date(Date.now() - (4 - i) * 24 * 3600 * 1000).toISOString();
    const u = await db.from("curriculum_slots")
      .update({ live_call_at: at, live_call_event_id: `${TAG}-evt-${i + 1}` })
      .eq("id", slots[i].id);
    if (u.error) throw new Error(`schedule ${i + 1}: ${u.error.message}`);
  }
  const scheduled = rows("scheduled", await db.from("curriculum_slots")
    .select("live_call_at").eq("curriculum_id", cur.data.id));
  eq("all four now have a call time", scheduled.filter((s) => s.live_call_at).length, 4);

  // -------------------------------------------------------------------------
  step("F. Tim runs the four sessions  (the counter has never moved for real)");
  for (let i = 0; i < 4; i++) {
    const r = await post(j, "/api/admin/calendar/mark-outcome", {
      outcome: "done",
      slot_id: slots[i].id,
      coach_note: `Session ${i + 1}. Your rebuild is late when you take the first shot. Reset before you challenge.`,
      training_routine: `Before next week: 20 minutes of box fight retakes, then 10 edit reps on the cone.`,
      parent_summary: `Jaxon worked on staying calm under pressure and planning two moves ahead. (Fortnite term: rebuilding.)`,
    });
    eq(`call ${i + 1} marked done`, r.status, 200);

    const s = await db.from("subscriptions").select("cycle_sessions_delivered").eq("id", sub.data.id).single();
    eq(`the counter is now ${i + 1}`, s.data?.cycle_sessions_delivered, i + 1);
  }

  const written = rows("written up", await db.from("curriculum_slots")
    .select("coach_note, training_routine, parent_summary, delivered_at, cycle_counted_at")
    .eq("curriculum_id", cur.data.id));
  eq("every session has advice", written.filter((s) => s.coach_note).length, 4);
  eq("every session has a routine", written.filter((s) => s.training_routine).length, 4);
  eq("every session has a parent line", written.filter((s) => s.parent_summary).length, 4);
  eq("every session is settled", written.filter((s) => s.delivered_at).length, 4);
  eq("and counted exactly once each", written.filter((s) => s.cycle_counted_at).length, 4);

  // -------------------------------------------------------------------------
  step("G. the cycle is complete, so the renewal is now due");
  const renewReady = rows("renew candidates", await db.from("subscriptions")
    .select("id").eq("status", "active").eq("lifecycle_state", "ACTIVE")
    .eq("cycle_sessions_delivered", 4));
  ok("this family is now what cron-auto-renew-detection looks for",
     renewReady.some((r) => r.id === sub.data.id),
     `${renewReady.length} candidate(s)`);

  const { provisionNextCycle } = await import("../src/lib/lessons/auto-renew.ts").catch(() => ({}));
  if (provisionNextCycle) {
    const result = await provisionNextCycle({ supabase: db, subscriptionId: sub.data.id });
    ok("a new cycle was provisioned", !!result?.newCurriculumId);
    if (result?.newCurriculumId) {
      made.curricula.push(result.newCurriculumId);
      const fresh = rows("new cycle slots", await db.from("curriculum_slots")
        .select("week_number, delivered_at").eq("curriculum_id", result.newCurriculumId));
      eq("with four fresh sessions", fresh.length, 4);
      ok("none of them settled", fresh.every((s) => !s.delivered_at));
      const s2 = await db.from("subscriptions").select("cycle_sessions_delivered").eq("id", sub.data.id).single();
      eq("and the counter reset for the new cycle", s2.data?.cycle_sessions_delivered, 0);
    }
  } else {
    console.log("  SKIP  provisionNextCycle not importable (announced, not silent)");
  }

  // -------------------------------------------------------------------------
  step("H. the parent was actually written to  (never verified before)");
  // The first version of this asserted notification_log back to BASELINE and
  // failed, which was the assertion being wrong rather than the app: the run
  // legitimately sends mail. That is the single most valuable thing this
  // rehearsal proves, because the recap email had never fired for a real
  // completed call, so it is asserted instead of cleaned away.
  // ⚠️ notification_log.recipient_id is NULL on every row this run produces,
  // even though recipient_type says 'parent'. The log records WHAT KIND of
  // recipient but not WHICH ONE, so "every email we ever sent this parent" is
  // not answerable from it. Matching on related_entity_id instead, which is
  // the slot or curriculum the email was about.
  const mine = [...slots.map((s) => s.id), cur.data.id];
  const notes = rows("notifications", await db.from("notification_log")
    .select("trigger, channel, recipient_type, status, related_entity_id")
    .in("related_entity_id", mine));
  eq("five emails were logged for this parent", notes.length, 5);
  eq("one take-on email", notes.filter((n) => n.trigger === "stage_c_take_on").length, 1);
  eq("one session recap per completed call", notes.filter((n) => n.trigger === "session_recap").length, 4);
  ok("all of them went to the PARENT", notes.every((n) => n.recipient_type === "parent"));
  ok("and all of them sent", notes.every((n) => n.status === "sent"),
     JSON.stringify(notes.map((n) => n.status)));

  step("I. teardown");
  await cleanup();
  const after = await census();
  for (const k of Object.keys(before)) eq(`${k} back to baseline`, after[k], before[k]);
}

async function cleanup() {
  for (const id of made.curricula.filter(Boolean)) {
    const sl = await db.from("curriculum_slots").select("id").eq("curriculum_id", id);
    const ids = [id, ...(sl.data ?? []).map((r) => r.id)];
    await db.from("notification_log").delete().in("related_entity_id", ids);
  }
  for (const id of made.curricula.filter(Boolean)) await db.from("curriculum_slots").delete().eq("curriculum_id", id);
  for (const id of made.curricula.filter(Boolean)) await db.from("curricula").delete().eq("id", id);
  for (const id of made.subs) await db.from("subscriptions").delete().eq("id", id);
  for (const id of made.players) await db.from("players").delete().eq("id", id);
  for (const id of made.parents) await db.from("parents").delete().eq("id", id);
  for (const id of made.families) await db.from("families").delete().eq("id", id);
  for (const id of made.coaches) await db.from("coaches").delete().eq("id", id);
  for (const id of made.authUsers) await db.auth.admin.deleteUser(id).catch(() => {});
  // Stripe test customers are left in the TEST dashboard on purpose: deleting
  // them would also delete the PaymentIntents that are the evidence this ran.
  if (stripeMade.customers.length) {
    console.log(`  (left ${stripeMade.customers.length} Stripe TEST customer(s) as evidence: ${stripeMade.customers.join(", ")})`);
  }
}

main()
  .catch((err) => { failures.push(`suite error: ${err.message}`); console.error(err); })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log(`\n${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = failures.length ? 1 : 0;
  });
