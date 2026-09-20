// npm run prove:webhooks
//
// Proves what happens AFTER the $56 arrives.
//
// `npm run prove:charge` proves the money moves. It stops there. The charge is
// only half the loop: the Edge Function fires a PaymentIntent and then STOPS,
// leaving `renewal_pi_id` set and the cycle still finished. Everything that
// makes the family's next month exist happens in the WEBHOOK, and none of it
// had ever run.
//
//   payment_intent.succeeded  (kind=renewal) -> provisionNextCycle, then clear
//                                               renewal_pi_id so the cycle
//                                               after this one can also renew
//   payment_intent.payment_failed            -> PAST_DUE + past_due_started_at,
//                                               clear the marker so the cron
//                                               retries once the card is fixed
//
// Events are built from REAL Stripe test PaymentIntents (a succeeded one and a
// genuinely DECLINED one) and signed the way Stripe signs them, so the route's
// own signature verification runs rather than being bypassed.
//
// Two of these assertions are the ones nobody thinks to write:
//
//   RETRY     Stripe redelivers a webhook it did not get a 2xx for, and it can
//             redeliver one it did. If the handler is not idempotent a retry
//             gives the family TWO cycles for one payment.
//   FORGERY   an event with a bad signature must change NOTHING. This endpoint
//             is public and provisioning a cycle is worth money.
//
// Needs: local Supabase, a dev server on :3100, TEST Stripe keys.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID, createHmac } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const FUNCTIONS_URL = process.env.FUNCTIONS_URL ?? "http://127.0.0.1:54421/functions/v1";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SK = env.STRIPE_SECRET_KEY ?? "";
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (SK.includes("_live_")) { console.error("\nREFUSING: live Stripe key."); process.exit(2); }
if (!SK.startsWith("sk_test_")) { console.error("\nREFUSING: need sk_test_."); process.exit(2); }
if (!/127\.0\.0\.1|localhost/.test(SUPA)) { console.error(`\nREFUSING: Supabase not local (${SUPA}).`); process.exit(2); }

const db = createClient(SUPA, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
const failures = [];
function ok(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function eq(label, a, b) { ok(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function step(s) { console.log(`\n${s}`); }

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

// Signed exactly as Stripe signs: t=<ts>,v1=HMAC_SHA256(`${ts}.${payload}`)
async function deliver(type, object, { forge = false } = {}) {
  const evt = {
    id: `evt_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    object: "event", type, livemode: false,
    created: Math.floor(Date.now() / 1000),
    data: { object },
  };
  const payload = JSON.stringify(evt);
  const ts = Math.floor(Date.now() / 1000);
  const secret = forge ? "whsec_not_the_real_secret" : env.STRIPE_WEBHOOK_SECRET;
  const sig = createHmac("sha256", secret).update(`${ts}.${payload}`).digest("hex");
  const res = await fetch(`${BASE_URL}/api/stripe-webhook`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${ts},v1=${sig}` },
    body: payload,
  });
  return { status: res.status, text: await res.text().catch(() => "") };
}

const TAG = `hook-${randomUUID().slice(0, 8)}`;
let COACH_ID = null;
const made = { families: [], players: [], parents: [], subs: [], curricula: [] };

async function seedMidRenewal(piId, { uniform = true } = {}) {
  const family = await db.from("families").insert({}).select("id").single();
  if (family.error) throw new Error(`families: ${family.error.message}`);
  made.families.push(family.data.id);
  const parent = await db.from("parents").insert({
    family_id: family.data.id, first_name: "Hook", email: `${TAG}-${randomUUID().slice(0,4)}@example.test`,
  }).select("id").single();
  if (parent.error) throw new Error(`parents: ${parent.error.message}`);
  made.parents.push(parent.data.id);
  const player = await db.from("players").insert({
    family_id: family.data.id, first_name: "Jaxon", age: 14,
  }).select("id").single();
  if (player.error) throw new Error(`players: ${player.error.message}`);
  made.players.push(player.data.id);
  const sub = await db.from("subscriptions").insert({
    player_id: player.data.id, status: "active", lifecycle_state: "ACTIVE", tier: "monthly",
    cycle_sessions_delivered: 4, auto_renew_enabled: true, renewal_pi_id: piId,
    cycle_started_at: new Date(Date.now() - 28 * 864e5).toISOString(),
  }).select("id").single();
  if (sub.error) throw new Error(`subscriptions: ${sub.error.message}`);
  made.subs.push(sub.data.id);
  // The finished cycle it is renewing FROM.
  // status='active' is load-bearing: provisionNextCycle finds the cycle it is
  // renewing FROM by looking for the player's active curriculum.
  const cur = await db.from("curricula").insert({
    player_id: player.data.id, created_by: COACH_ID, status: "active",
    approved_at: new Date(Date.now() - 28 * 864e5).toISOString(),
  }).select("id").single();
  if (cur.error) throw new Error(`curricula: ${cur.error.message}`);
  made.curricula.push(cur.data.id);

  // The four sessions the family already had. A renewal reads these to work out
  // WHEN to put the next four: same weekday and time each week means Tim can
  // soft book them, anything scattered means the family has to be asked. With
  // no slots at all there is no rhythm to find, so an empty cycle is not a
  // neutral fixture, it silently tests only the scattered branch.
  const base = new Date(Date.now() - 28 * 864e5);
  const slots = [];
  for (let w = 1; w <= 4; w++) {
    const at = new Date(base.getTime() + (w - 1) * 7 * 864e5);
    if (!uniform) at.setTime(at.getTime() + w * 31 * 3600e3); // drift it out of rhythm
    slots.push({
      curriculum_id: cur.data.id, week_number: w,
      // delivered_at IS the delivery marker; there is no status column. Phase 5
      // kept exactly this field when the content schema came out.
      live_call_at: at.toISOString(), delivered_at: at.toISOString(),
    });
  }
  const ins = await db.from("curriculum_slots").insert(slots);
  if (ins.error) throw new Error(`curriculum_slots: ${ins.error.message}`);

  return { subId: sub.data.id, playerId: player.data.id, curriculumId: cur.data.id,
           familyId: family.data.id };
}

async function cyclesFor(playerId) {
  const r = await db.from("curricula").select("id").eq("player_id", playerId);
  if (r.error) throw new Error(`curricula: ${r.error.message}`);
  for (const c of r.data ?? []) if (!made.curricula.includes(c.id)) made.curricula.push(c.id);
  return (r.data ?? []).length;
}

async function main() {
  console.log(`renewal webhook proof  [${TAG}]`);
  console.log(`  Stripe: TEST   webhook: ${BASE_URL}/api/stripe-webhook`);

  const coach = await db.from("coaches").select("id").eq("is_active", true)
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (coach.error || !coach.data) throw new Error(`no coach to own a curriculum: ${coach.error?.message}`);
  COACH_ID = coach.data.id;

  // A real succeeded renewal PI to carry in the event.
  const cust = await stripeApi("customers", { "metadata[tag]": TAG });
  await stripeApi(`payment_methods/pm_card_visa/attach`, { customer: cust.json.id });
  const good = await stripeApi("payment_intents", {
    amount: "5600", currency: "usd", customer: cust.json.id,
    payment_method: "pm_card_visa", off_session: "true", confirm: "true",
  });
  ok("a real succeeded test PaymentIntent exists", good.json?.status === "succeeded", JSON.stringify(good.json?.status));

  // -------------------------------------------------------------------------
  step("A. payment_intent.succeeded provisions the next cycle");
  const a = await seedMidRenewal(good.json.id);
  eq("one cycle before", await cyclesFor(a.playerId), 1);
  const resA = await deliver("payment_intent.succeeded", {
    ...good.json,
    metadata: { kind: "renewal", subscription_id: a.subId, player_id: a.playerId },
  });
  eq("the webhook accepted it", resA.status, 200);
  eq("a second cycle now exists", await cyclesFor(a.playerId), 2);
  const subA = await db.from("subscriptions")
    .select("renewal_pi_id, cycle_sessions_delivered, lifecycle_state").eq("id", a.subId).single();
  eq("the renewal marker is cleared so the NEXT cycle can renew", subA.data?.renewal_pi_id, null);
  eq("the counter reset for the new cycle", subA.data?.cycle_sessions_delivered, 0);
  eq("a uniform cycle renews straight to ACTIVE, no scheduling round trip",
     subA.data?.lifecycle_state, "ACTIVE");

  const newCur = await db.from("curricula").select("id")
    .eq("player_id", a.playerId).eq("status", "active")
    .order("created_at", { ascending: false }).limit(1).single();
  const newSlots = await db.from("curriculum_slots")
    .select("week_number, live_call_at, delivered_at").eq("curriculum_id", newCur.data.id)
    .order("week_number");
  eq("the new cycle has four fresh sessions", (newSlots.data ?? []).length, 4);
  ok("and none is marked delivered yet",
     (newSlots.data ?? []).every((s) => s.delivered_at === null));
  ok("and they are soft booked, not blank",
     (newSlots.data ?? []).every((s) => !!s.live_call_at),
     JSON.stringify((newSlots.data ?? []).map((s) => s.live_call_at)));
  const days = new Set((newSlots.data ?? []).map((s) => new Date(s.live_call_at).getUTCDay()));
  ok("all four on the same weekday the family already had", days.size === 1, `weekdays: ${[...days]}`);
  const oldCur = await db.from("curricula").select("status").eq("id", a.curriculumId).single();
  eq("and the finished cycle was closed out", oldCur.data?.status, "completed");

  // -------------------------------------------------------------------------
  step("B. RETRY: Stripe redelivers the same event  (a retry must not bill two cycles)");
  const resRetry = await deliver("payment_intent.succeeded", {
    ...good.json,
    metadata: { kind: "renewal", subscription_id: a.subId, player_id: a.playerId },
  });
  const cyclesAfterRetry = await cyclesFor(a.playerId);
  eq("the retry is accepted", resRetry.status, 200);
  ok("a redelivery does NOT create a third cycle", cyclesAfterRetry === 2,
     `expected 2 cycles, got ${cyclesAfterRetry} — one payment would have bought two cycles`);

  // -------------------------------------------------------------------------
  step("B2. a SCATTERED cycle asks the family instead of guessing");
  const sc = await seedMidRenewal(good.json.id, { uniform: false });
  const resSc = await deliver("payment_intent.succeeded", {
    ...good.json, metadata: { kind: "renewal", subscription_id: sc.subId },
  });
  eq("accepted", resSc.status, 200);
  const subSc = await db.from("subscriptions").select("lifecycle_state").eq("id", sc.subId).single();
  eq("no weekly rhythm to copy, so it goes to SCHEDULING_IN_PROGRESS",
     subSc.data?.lifecycle_state, "SCHEDULING_IN_PROGRESS");

  // -------------------------------------------------------------------------
  step("C. FORGERY: a bad signature must change nothing");
  const b = await seedMidRenewal(good.json.id);
  const before = await cyclesFor(b.playerId);
  const resForge = await deliver("payment_intent.succeeded", {
    ...good.json,
    metadata: { kind: "renewal", subscription_id: b.subId, player_id: b.playerId },
  }, { forge: true });
  ok("an unsigned/forged event is REFUSED", resForge.status >= 400, `got ${resForge.status}`);
  eq("and no cycle was provisioned", await cyclesFor(b.playerId), before);
  const subF = await db.from("subscriptions").select("renewal_pi_id").eq("id", b.subId).single();
  ok("the renewal marker is untouched", subF.data?.renewal_pi_id === good.json.id);

  // -------------------------------------------------------------------------
  step("D. a NON renewal payment intent is ignored");
  const c = await seedMidRenewal(good.json.id);
  const beforeC = await cyclesFor(c.playerId);
  const resC = await deliver("payment_intent.succeeded", {
    ...good.json, metadata: { kind: "single_session", subscription_id: c.subId },
  });
  eq("accepted", resC.status, 200);
  eq("but no cycle provisioned: first-cycle money settles via checkout.session.completed",
     await cyclesFor(c.playerId), beforeC);

  // -------------------------------------------------------------------------
  step("E. payment_intent.payment_failed puts the family into PAST_DUE");
  const declined = await stripeApi("payment_intents", {
    amount: "5600", currency: "usd", payment_method: "pm_card_chargeDeclined", confirm: "true",
    "automatic_payment_methods[enabled]": "true", "automatic_payment_methods[allow_redirects]": "never",
  });
  const failedPi = declined.json?.error?.payment_intent ?? declined.json;
  ok("a genuinely DECLINED test PaymentIntent exists",
     failedPi?.status === "requires_payment_method", JSON.stringify(failedPi?.status));

  const d = await seedMidRenewal(good.json.id);
  const resD = await deliver("payment_intent.payment_failed", {
    ...failedPi, metadata: { kind: "renewal", subscription_id: d.subId },
  });
  eq("the webhook accepted the failure", resD.status, 200);
  const subD = await db.from("subscriptions")
    .select("status, lifecycle_state, past_due_started_at, renewal_pi_id").eq("id", d.subId).single();
  eq("status is past_due", subD.data?.status, "past_due");
  eq("lifecycle is PAST_DUE", subD.data?.lifecycle_state, "PAST_DUE");
  ok("the dunning clock started", !!subD.data?.past_due_started_at);
  eq("and the marker is cleared so the cron retries once the card is fixed",
     subD.data?.renewal_pi_id, null);
  eq("no cycle was provisioned for an unpaid renewal", await cyclesFor(d.playerId), 1);

  // -------------------------------------------------------------------------
  step("F. a FAILED provision must hand the marker back");
  const e = await seedMidRenewal(good.json.id);
  // Remove the active curriculum so provisionNextCycle throws for real
  // (active_curriculum_not_found) rather than being mocked into failing.
  await db.from("curriculum_slots").delete().eq("curriculum_id", e.curriculumId);
  await db.from("curricula").delete().eq("id", e.curriculumId);
  const resE = await deliver("payment_intent.succeeded", {
    ...good.json, metadata: { kind: "renewal", subscription_id: e.subId },
  });
  ok("the webhook reports the failure to Stripe so it will retry", resE.status >= 400, `got ${resE.status}`);
  const subE = await db.from("subscriptions").select("renewal_pi_id").eq("id", e.subId).single();
  eq("and the marker is BACK, so the retry does the work rather than skipping it",
     subE.data?.renewal_pi_id, good.json.id);

  // -------------------------------------------------------------------------
  // The seam neither proof covers on its own. prove:charge shows the Edge
  // Function WRITES metadata; stages A to F show the webhook READS metadata.
  // Both pass in full while a typo in either key breaks the loop, because each
  // side supplies its own. Here the Edge Function fires a real PI and its real
  // metadata is handed to the real webhook, with nothing synthesized between.
  step("H. end to end: the charge the Edge Function fires is the one the webhook acts on");
  const fnUp = await fetch(`${FUNCTIONS_URL}/cron-auto-renew-detection`, { method: "POST" })
    .then((r) => r.status).catch(() => 0);
  if (fnUp !== 200) {
    console.log(`  SKIP  Edge Function runtime not serving (${fnUp || "no response"}).`);
    console.log(`        npx supabase functions serve --env-file <test env> --no-verify-jwt`);
  } else {
    const h = await seedMidRenewal(null); // no marker: the cron must find it eligible
    const cust2 = await stripeApi("customers", { "metadata[tag]": TAG });
    await stripeApi("payment_methods/pm_card_visa/attach", { customer: cust2.json.id });
    await stripeApi(`customers/${cust2.json.id}`, { "invoice_settings[default_payment_method]": "pm_card_visa" });
    // The card lives on the FAMILY, not the subscription: one card, and a
    // family can have more than one player on it.
    await db.from("families")
      .update({ stripe_customer_id: cust2.json.id })
      .eq("id", h.familyId);

    const fired = await fetch(`${FUNCTIONS_URL}/cron-auto-renew-detection`, { method: "POST" });
    const fjson = await fired.json().catch(() => null);
    const mine = (fjson?.results ?? []).find((r) => r.subscription_id === h.subId);
    ok("the Edge Function fired a renewal for our family", !!mine?.pi_id,
       JSON.stringify(mine ?? fjson).slice(0, 180));

    const realPi = await stripeApi(`payment_intents/${mine.pi_id}`);
    eq("it succeeded", realPi.json?.status, "succeeded");
    const beforeH = await cyclesFor(h.playerId);

    // Its OWN metadata, untouched.
    const resH = await deliver("payment_intent.succeeded", realPi.json);
    eq("the webhook accepted the Edge Function's own PaymentIntent", resH.status, 200);
    eq("and provisioned the next cycle from it", await cyclesFor(h.playerId), beforeH + 1);
    const subH = await db.from("subscriptions")
      .select("renewal_pi_id, cycle_sessions_delivered").eq("id", h.subId).single();
    eq("the marker the cron set is now cleared", subH.data?.renewal_pi_id, null);
    eq("and the new cycle starts at zero delivered", subH.data?.cycle_sessions_delivered, 0);
  }

  step("I. teardown");
  await cleanup();
  console.log(`  (Stripe TEST customer left as evidence: ${cust.json.id})`);
}

async function cleanup() {
  for (const id of made.curricula.filter(Boolean)) await db.from("curriculum_slots").delete().eq("curriculum_id", id);
  for (const id of made.curricula.filter(Boolean)) await db.from("curricula").delete().eq("id", id);
  for (const id of made.subs) await db.from("subscriptions").delete().eq("id", id);
  for (const id of made.players) await db.from("players").delete().eq("id", id);
  for (const id of made.parents) {
    await db.from("notification_log").delete().eq("recipient_id", id);
    await db.from("parents").delete().eq("id", id);
  }
  for (const id of made.families) await db.from("families").delete().eq("id", id);
}

main()
  .catch((err) => { failures.push(`suite error: ${err.message}`); console.error(err); })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log(`\n${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = failures.length ? 1 : 0;
  });
