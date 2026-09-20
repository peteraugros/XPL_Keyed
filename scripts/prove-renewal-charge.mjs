// npm run prove:charge
//
// Proves the $56 auto renew charge, in Stripe TEST mode, by running the REAL
// Edge Function against a REAL (test) card.
//
// WHY SEPARATELY FROM `npm run rehearse`. That walks the lifecycle but calls
// `provisionNextCycle` directly, so it never touches Stripe and never proves
// money moves. `cron-auto-renew-detection` is where the charge lives, it is an
// Edge Function rather than app code, and as of 2026-09-20 it had never fired
// once in any environment: production has 0 active subscriptions, so every
// observation of it has been `no_subs`.
//
// This seeds a family that is genuinely renewal eligible, attaches a real test
// card, runs the deployed-shape function locally, and then asks STRIPE what
// happened rather than asking our own database.
//
// ---------------------------------------------------------------------------
// 🔴 REFUSES TO RUN AGAINST LIVE STRIPE.
// ---------------------------------------------------------------------------
// Production is sk_live_ with an enabled webhook on xplkeyed.com. This creates
// a customer, attaches a card and CONFIRMS a payment intent off session. On a
// live key that is a real $56 taken from a real person.
//
// Needs: local Supabase up, `supabase functions serve` running, TEST keys.
// Every fixture is removed and the charge count is asserted at the end.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const FUNCTIONS_URL = process.env.FUNCTIONS_URL ?? "http://127.0.0.1:54421/functions/v1";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const SK = env.STRIPE_SECRET_KEY ?? "";
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL ?? "";

if (SK.includes("_live_")) {
  console.error("\nREFUSING TO RUN: STRIPE_SECRET_KEY is a LIVE key. This CONFIRMS a $56 charge.");
  process.exit(2);
}
if (!SK.startsWith("sk_test_")) { console.error("\nREFUSING TO RUN: need an sk_test_ key."); process.exit(2); }
if (!/127\.0\.0\.1|localhost/.test(SUPA)) { console.error(`\nREFUSING TO RUN: Supabase is not local (${SUPA}).`); process.exit(2); }

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

async function stripeApi(path, form, method) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: method ?? (form ? "POST" : "GET"),
    headers: {
      Authorization: `Basic ${Buffer.from(`${SK}:`).toString("base64")}`,
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}
async function fire() {
  const res = await fetch(`${FUNCTIONS_URL}/cron-auto-renew-detection`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` },
    body: JSON.stringify({ trigger: "prove-charge" }),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, text, json };
}

const TAG = `charge-${randomUUID().slice(0, 8)}`;
const made = { families: [], players: [], parents: [], subs: [], customers: [] };

// Builds a renewal-eligible family. `withCard` decides whether the customer has
// a payment method, `autoRenew` which branch the function should take.
async function seedFamily({ withCard = true, autoRenew = true } = {}) {
  const family = await db.from("families").insert({}).select("id").single();
  if (family.error) throw new Error(`families: ${family.error.message}`);
  made.families.push(family.data.id);

  const parent = await db.from("parents").insert({
    family_id: family.data.id, first_name: "Proof", email: `${TAG}-${randomUUID().slice(0,4)}@example.test`,
  }).select("id, email").single();
  if (parent.error) throw new Error(`parents: ${parent.error.message}`);
  made.parents.push(parent.data.id);

  const player = await db.from("players").insert({
    family_id: family.data.id, first_name: "Jaxon", age: 14,
  }).select("id").single();
  if (player.error) throw new Error(`players: ${player.error.message}`);
  made.players.push(player.data.id);

  const cust = await stripeApi("customers", { email: parent.data.email, "metadata[tag]": TAG });
  if (cust.status !== 200) throw new Error(`stripe customer: ${JSON.stringify(cust.json)}`);
  made.customers.push(cust.json.id);

  if (withCard) {
    // pm_card_visa is Stripe's canonical test card. Attaching it and making it
    // the default is exactly what setup_future_usage='off_session' does at
    // real checkout, which this cannot drive because it needs a hosted page.
    const att = await stripeApi(`payment_methods/pm_card_visa/attach`, { customer: cust.json.id });
    if (att.status !== 200) throw new Error(`attach: ${JSON.stringify(att.json)}`);
    const upd = await stripeApi(`customers/${cust.json.id}`, {
      "invoice_settings[default_payment_method]": att.json.id,
    });
    if (upd.status !== 200) throw new Error(`default pm: ${JSON.stringify(upd.json)}`);
  }

  await db.from("families").update({ stripe_customer_id: cust.json.id }).eq("id", family.data.id);

  const sub = await db.from("subscriptions").insert({
    player_id: player.data.id, status: "active", lifecycle_state: "ACTIVE", tier: "monthly",
    cycle_sessions_delivered: 4, auto_renew_enabled: autoRenew,
  }).select("id").single();
  if (sub.error) throw new Error(`subscriptions: ${sub.error.message}`);
  made.subs.push(sub.data.id);

  return { subId: sub.data.id, customerId: cust.json.id, playerId: player.data.id };
}

async function chargesFor(customerId) {
  const r = await stripeApi(`payment_intents?customer=${customerId}&limit=10`);
  return r.json?.data ?? [];
}

async function main() {
  console.log(`$56 auto renew charge proof  [${TAG}]`);
  console.log(`  Stripe: TEST   functions: ${FUNCTIONS_URL}`);

  // Anything but a 200 here means the prerequisite is missing, and it must exit
  // rather than proceed. The narrow version of this check (0 / ECONNREFUSED /
  // 404) walked straight past a 503 "name resolution failed", which is what the
  // local gateway answers when IT is up but the function is not being served.
  // The run then seeded, charged nothing, and printed fourteen failures that
  // read exactly like a regression in working code.
  const up = await fire();
  if (up.status !== 200) {
    console.error(`\nPREREQUISITE MISSING, not a test failure.`);
    console.error(`  ${FUNCTIONS_URL}/cron-auto-renew-detection answered ${up.status || "no response"}`);
    if (up.text) console.error(`  ${up.text.slice(0, 160)}`);
    console.error(`\nStart the Edge Function runtime first:`);
    console.error(`  npx supabase functions serve --env-file <env with TEST Stripe keys> --no-verify-jwt`);
    process.exit(2);
  }

  // -------------------------------------------------------------------------
  step("A. a family whose cycle is finished, with a card on file");
  const a = await seedFamily({ withCard: true, autoRenew: true });
  ok("seeded a renewal eligible subscription", !!a.subId);
  eq("no charge on the customer yet", (await chargesFor(a.customerId)).length, 0);

  // -------------------------------------------------------------------------
  step("B. the real Edge Function runs  (money has never moved before this)");
  const run = await fire();
  eq("the function returned 200", run.status, 200);
  const mine = (run.json?.results ?? []).find((r) => r.subscription_id === a.subId);
  ok("it acted on our subscription", !!mine, JSON.stringify(run.json ?? run.text).slice(0, 200));
  eq("and reports the payment intent fired", mine?.status, "pi_fired");

  // -------------------------------------------------------------------------
  step("C. ask STRIPE what happened, not our own database");
  const pis = await chargesFor(a.customerId);
  eq("exactly one payment intent exists", pis.length, 1);
  const pi = pis[0];
  eq("it is for $56.00", pi?.amount, 5600);
  eq("in usd", pi?.currency, "usd");
  eq("it SUCCEEDED", pi?.status, "succeeded");
  ok("it is TEST mode", pi?.livemode === false);
  ok("charged off session, as a cron must", pi?.off_session === true || pi?.confirmation_method !== "manual");
  eq("tagged as a renewal", pi?.metadata?.kind, "renewal");
  eq("carrying our subscription id", pi?.metadata?.subscription_id, a.subId);
  ok("described in session language, not lesson language",
     typeof pi?.description === "string" && /session cycle/.test(pi.description) && !/lesson/i.test(pi.description),
     pi?.description);

  const subAfter = await db.from("subscriptions").select("renewal_pi_id").eq("id", a.subId).single();
  eq("and the subscription remembers the payment intent", subAfter.data?.renewal_pi_id, pi?.id);

  // -------------------------------------------------------------------------
  step("D. it does not charge twice  (the guard is renewal_pi_id)");
  const again = await fire();
  eq("a second run returns 200", again.status, 200);
  const twice = (again.json?.results ?? []).find((r) => r.subscription_id === a.subId);
  ok("our subscription is no longer eligible", !twice, JSON.stringify(twice ?? {}));
  eq("still exactly one charge", (await chargesFor(a.customerId)).length, 1);

  // -------------------------------------------------------------------------
  step("E. auto renew OFF cancels instead of charging");
  const b = await seedFamily({ withCard: true, autoRenew: false });
  const runB = await fire();
  const mineB = (runB.json?.results ?? []).find((r) => r.subscription_id === b.subId);
  ok("the function handled it", !!mineB, JSON.stringify(runB.json ?? "").slice(0, 200));
  ok("it did NOT fire a payment intent", mineB?.status !== "pi_fired", JSON.stringify(mineB));
  eq("no charge on that customer", (await chargesFor(b.customerId)).length, 0);
  const subB = await db.from("subscriptions").select("status, lifecycle_state").eq("id", b.subId).single();
  eq("the subscription is canceled", subB.data?.lifecycle_state, "CANCELED");

  // -------------------------------------------------------------------------
  step("F. no card on file is reported, not thrown");
  const c = await seedFamily({ withCard: false, autoRenew: true });
  const runC = await fire();
  const mineC = (runC.json?.results ?? []).find((r) => r.subscription_id === c.subId);
  eq("it says no_payment_method", mineC?.status, "no_payment_method");
  eq("and charges nothing", (await chargesFor(c.customerId)).length, 0);
  const subC = await db.from("subscriptions").select("renewal_pi_id, lifecycle_state").eq("id", c.subId).single();
  ok("leaving the subscription untouched for a retry",
     subC.data?.renewal_pi_id === null && subC.data?.lifecycle_state === "ACTIVE",
     JSON.stringify(subC.data));

  // -------------------------------------------------------------------------
  step("G. teardown");
  let total = 0;
  for (const cid of made.customers) total += (await chargesFor(cid)).length;
  eq("exactly ONE charge across the whole run", total, 1);
  await cleanup();
  console.log(`  (Stripe TEST customers left as evidence: ${made.customers.join(", ")})`);
}

async function cleanup() {
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
