// npm run verify:billing
//
// Proves the billing lifecycle survives the content-to-coaching change, by
// driving the REAL /api/admin/calendar/mark-outcome route as a REAL signed in
// coach against the REAL local database. No mocks.
//
// Why this suite exists. $56 buys 4 sessions and cron-auto-renew-detection
// fires the next charge on cycle_lessons_delivered = 4. That counter used to
// have five writers, two of them the content delivery path
// (cron-sunday-lesson-delivery, deliver-week-one) which this project removes.
// Afterwards a COMPLETED CALL is the only thing that advances the cycle, so
// the increment inside mark-outcome is the single point of failure for
// revenue. This asserts the properties that have to hold before any of that
// removal happens, so a later failure is attributable to a later phase.
//
// Run:  node scripts/verify-billing-lifecycle.mjs
// Needs: local Supabase up (npm run db:start) + a dev server (BASE_URL).

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";

// ---------------------------------------------------------------------------
// env
// ---------------------------------------------------------------------------
function readEnvLocal() {
  const out = {};
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {}
  return out;
}
const env = readEnvLocal();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54421";
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_KEY) {
  console.error("No SUPABASE_SERVICE_ROLE_KEY in .env.local or environment.");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------------------
// assertions
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
function ok(label, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
function eq(label, actual, expected) {
  ok(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// fixture
// ---------------------------------------------------------------------------
const TAG = `verifybilling-${randomUUID().slice(0, 8)}`;
const made = { authUsers: [], coaches: [], families: [], players: [], parents: [], subs: [], curricula: [], slots: [], dismissals: [] };

async function seed() {
  const password = `Vb-${randomUUID()}`;
  const coachEmail = `${TAG}-coach@example.test`;

  const created = await db.auth.admin.createUser({
    email: coachEmail,
    password,
    email_confirm: true,
  });
  if (created.error) throw new Error(`coach auth user: ${created.error.message}`);
  made.authUsers.push(created.data.user.id);

  const coach = await db.from("coaches").insert({
    display_name: "Verify Coach",
    email: coachEmail,
    username: TAG,
    auth_user_id: created.data.user.id,
    is_active: true,
  }).select("id").single();
  if (coach.error) throw new Error(`coaches: ${coach.error.message}`);
  made.coaches.push(coach.data.id);

  const family = await db.from("families").insert({}).select("id").single();
  if (family.error) throw new Error(`families: ${family.error.message}`);
  made.families.push(family.data.id);

  // Columns read off information_schema rather than guessed: parents
  // requires family_id + email + first_name and has no last_name.
  const parent = await db.from("parents").insert({
    family_id: family.data.id,
    first_name: "Verify",
    email: `${TAG}-parent@example.test`,
  }).select("id").single();
  if (parent.error) throw new Error(`parents: ${parent.error.message}`);
  made.parents.push(parent.data.id);

  const player = await db.from("players").insert({
    family_id: family.data.id,
    first_name: "Verify",
    age: 14,
  }).select("id").single();
  if (player.error) throw new Error(`players: ${player.error.message}`);
  made.players.push(player.data.id);

  const sub = await db.from("subscriptions").insert({
    player_id: player.data.id,
    status: "active",
    lifecycle_state: "ACTIVE",
    tier: "monthly",
    cycle_lessons_delivered: 0,
    auto_renew_enabled: true,
  }).select("id").single();
  if (sub.error) throw new Error(`subscriptions: ${sub.error.message}`);
  made.subs.push(sub.data.id);

  const curriculum = await db.from("curricula").insert({
    player_id: player.data.id,
    created_by: coach.data.id,
    status: "active",
  }).select("id").single();
  if (curriculum.error) throw new Error(`curricula: ${curriculum.error.message}`);
  made.curricula.push(curriculum.data.id);

  // Four sessions, all in the past so an outcome is legitimately markable.
  const slotIds = [];
  for (let w = 1; w <= 4; w++) {
    const at = new Date(Date.now() - (5 - w) * 24 * 3600 * 1000).toISOString();
    const slot = await db.from("curriculum_slots").insert({
      curriculum_id: curriculum.data.id,
      week_number: w,
      live_call_at: at,
      live_call_event_id: `${TAG}-evt-${w}`,
    }).select("id").single();
    if (slot.error) throw new Error(`slot w${w}: ${slot.error.message}`);
    made.slots.push(slot.data.id);
    slotIds.push(slot.data.id);
  }

  return { coachEmail, password, subId: sub.data.id, slotIds, playerId: player.data.id };
}

async function cleanup() {
  for (const id of made.dismissals) await db.from("task_dismissals").delete().eq("id", id);
  for (const id of made.slots) await db.from("curriculum_slots").delete().eq("id", id);
  for (const id of made.curricula) await db.from("curricula").delete().eq("id", id);
  for (const id of made.subs) await db.from("subscriptions").delete().eq("id", id);
  for (const id of made.players) await db.from("players").delete().eq("id", id);
  for (const id of made.parents) await db.from("parents").delete().eq("id", id);
  for (const id of made.families) await db.from("families").delete().eq("id", id);
  for (const id of made.coaches) await db.from("coaches").delete().eq("id", id);
  for (const id of made.authUsers) await db.auth.admin.deleteUser(id);
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function counter(subId) {
  const r = await db.from("subscriptions").select("cycle_lessons_delivered").eq("id", subId).single();
  if (r.error) throw new Error(`counter read: ${r.error.message}`);
  return r.data.cycle_lessons_delivered;
}
async function slotRow(slotId) {
  const r = await db.from("curriculum_slots")
    .select("cycle_counted_at, coach_note, training_routine, parent_summary, live_call_completed_at, delivered_at")
    .eq("id", slotId).single();
  if (r.error) throw new Error(`slot read: ${r.error.message}`);
  return r.data;
}

let cookie = "";
async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    const jar = new Map(cookie ? cookie.split("; ").map((c) => { const i = c.indexOf("="); return [c.slice(0, i), c.slice(i + 1)]; }) : []);
    for (const c of setCookie) {
      const pair = c.split(";")[0];
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
    cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  // Fail loudly if the dev server is not up, rather than reporting every
  // assertion as a product failure.
  try {
    const probe = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
    if (probe.status >= 500) throw new Error(`status ${probe.status}`);
  } catch (err) {
    console.error(`\nNo dev server at ${BASE_URL} (${err.message}).`);
    console.error("Start one, or pass BASE_URL=http://127.0.0.1:PORT\n");
    process.exit(1);
  }

  const fx = await seed();

  console.log("\nA. sign in as the coach");
  const signin = await post("/api/auth/sign-in-coach-password", { username: TAG, password: fx.password });
  eq("coach password sign in returns 200", signin.status, 200);
  ok("session cookie captured", cookie.includes("sb-"), cookie.slice(0, 40));

  console.log("\nB. an UNMARKED call does not advance the cycle");
  eq("counter starts at 0", await counter(fx.subId), 0);

  console.log("\nC. marking a call done advances it exactly one, and stores the coaching payload");
  const r1 = await post("/api/admin/calendar/mark-outcome", {
    outcome: "done",
    slot_id: fx.slotIds[0],
    coach_note: "You are pre building before you have a read on where they are.",
    training_routine: "20 min edit course, then 10 box fight games. Every day until Thursday.",
    parent_summary: "Working on planning before acting under pressure. (Fortnite term: pre building.)",
  });
  eq("mark done returns 200", r1.status, 200);
  eq("route reports the cycle advanced", r1.json?.cycle, "advanced");
  eq("counter is 1", await counter(fx.subId), 1);

  const s1 = await slotRow(fx.slotIds[0]);
  ok("coach_note stored", (s1.coach_note ?? "").startsWith("You are pre building"), String(s1.coach_note));
  ok("training_routine stored", (s1.training_routine ?? "").includes("edit course"), String(s1.training_routine));
  ok("parent_summary stored", (s1.parent_summary ?? "").includes("Fortnite term"), String(s1.parent_summary));
  ok("cycle_counted_at stamped", !!s1.cycle_counted_at);
  ok("delivered_at preserved as the settled flag", !!s1.delivered_at);

  console.log("\nD. exactly once: a double submit does not bill twice");
  const r2 = await post("/api/admin/calendar/mark-outcome", {
    outcome: "done", slot_id: fx.slotIds[0], coach_note: "duplicate submit",
  });
  eq("second submit reports already_marked", r2.json?.already_marked, true);
  eq("counter is STILL 1", await counter(fx.subId), 1);

  console.log("\nE. the repair path: a failed advance can be completed later");
  // Simulate the crash window: the call is marked, the advance did not land.
  await db.from("curriculum_slots").update({ cycle_counted_at: null }).eq("id", fx.slotIds[0]);
  await db.from("subscriptions").update({ cycle_lessons_delivered: 0 }).eq("id", fx.subId);
  eq("state rewound to the failure window", await counter(fx.subId), 0);
  const r3 = await post("/api/admin/calendar/mark-outcome", {
    outcome: "done", slot_id: fx.slotIds[0],
  });
  eq("retry on an already marked slot repairs the cycle", r3.json?.cycle, "advanced");
  eq("counter repaired to 1", await counter(fx.subId), 1);

  console.log("\nF. four completed calls reach the auto renew trigger");
  for (let i = 1; i < 4; i++) {
    const r = await post("/api/admin/calendar/mark-outcome", {
      outcome: "done", slot_id: fx.slotIds[i], coach_note: `week ${i + 1}`,
      training_routine: `routine ${i + 1}`, parent_summary: `summary ${i + 1}`,
    });
    eq(`week ${i + 1} marked done`, r.status, 200);
  }
  eq("counter is 4", await counter(fx.subId), 4);

  // The cron's own filter, verbatim from cron-auto-renew-detection.
  const eligible = await db.from("subscriptions")
    .select("id")
    .eq("status", "active")
    .eq("lifecycle_state", "ACTIVE")
    .eq("cycle_lessons_delivered", 4)
    .is("renewal_pi_id", null);
  ok("the auto renew cron's own query now matches this subscription",
     (eligible.data ?? []).some((r) => r.id === fx.subId),
     `matched ${(eligible.data ?? []).length} rows`);

  console.log("\nG. call_outcome_pending cannot be dismissed");
  const dis = await post("/api/admin/tasks/dismiss", {
    task_type: "call_outcome_pending",
    source_object_id: fx.slotIds[0],
  });
  eq("dismiss is refused with 409", dis.status, 409);
  eq("refusal names the reason", dis.json?.error, "task_not_dismissible");
  const rows = await db.from("task_dismissals").select("id").eq("source_object_id", fx.slotIds[0]);
  eq("nothing was written to task_dismissals", (rows.data ?? []).length, 0);

  console.log("\nH. control: an ordinary task is still dismissible");
  const ok2 = await post("/api/admin/tasks/dismiss", {
    task_type: "message_thread",
    source_object_id: fx.slotIds[1],
  });
  eq("a non protected task dismisses with 200", ok2.status, 200);
  const rows2 = await db.from("task_dismissals").select("id").eq("source_object_id", fx.slotIds[1]);
  eq("and it did write a row", (rows2.data ?? []).length, 1);
  for (const r of rows2.data ?? []) made.dismissals.push(r.id);

  // -------------------------------------------------------------------------
  // I. source invariants the driven half cannot see
  // -------------------------------------------------------------------------
  // The rule is enforced in two places and this suite only exercises one of
  // them. A route that refuses while the UI still offers the button is a
  // worse experience than no button, and a hidden button with no route guard
  // is not a rule at all. Both sides must read the SAME constant, so assert
  // that rather than re-testing the behaviour.
  console.log("\nI. source invariants (the UI half)");
  const stripComments = (t) =>
    t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  const adminSrc = stripComments(readFileSync("src/app/admin/AdminClient.tsx", "utf8"));
  ok("AdminClient imports the shared constant",
     /from "@\/lib\/tasks\/protected"/.test(adminSrc));
  ok("DismissButton itself refuses to render for a protected task",
     /const protectedTask = isProtectedTask\(task\.task_type\)/.test(adminSrc) &&
     /if \(protectedTask\) return null;/.test(adminSrc));
  ok("no DismissButton is rendered without a protected check beside it",
     (adminSrc.match(/<DismissButton/g) ?? []).length ===
     (adminSrc.match(/isProtectedTask\(/g) ?? []).length - 1,
     `${(adminSrc.match(/<DismissButton/g) ?? []).length} renders vs ${(adminSrc.match(/isProtectedTask\(/g) ?? []).length} checks`);

  const dismissSrc = stripComments(readFileSync("src/app/api/admin/tasks/dismiss/route.ts", "utf8"));
  ok("the dismiss route reads the same constant",
     /from "@\/lib\/tasks\/protected"/.test(dismissSrc) &&
     /isProtectedTask\(body\.task_type\)/.test(dismissSrc));

  const protectedSrc = stripComments(readFileSync("src/lib/tasks/protected.ts", "utf8"));
  ok("call_outcome_pending is in the protected set",
     /"call_outcome_pending"/.test(protectedSrc));

  // The billing advance must not regress to a discarded error. This is the
  // exact shape that made a failed advance silent.
  const moSrc = stripComments(readFileSync("src/app/api/admin/calendar/mark-outcome/route.ts", "utf8"));
  ok("mark-outcome advances the cycle only through advanceCycleOnce",
     (moSrc.match(/cycle_lessons_delivered: sub\.cycle_lessons_delivered \+ 1/g) ?? []).length === 1,
     `${(moSrc.match(/cycle_lessons_delivered: sub\.cycle_lessons_delivered \+ 1/g) ?? []).length} increment sites`);
  ok("the advance result is checked, not discarded",
     /cycle === "failed"/.test(moSrc) && /cycle_advance_failed/.test(moSrc));
}

let exitCode = 0;
try {
  await main();
} catch (err) {
  console.error(`\nSUITE ERROR: ${err.stack ?? err.message}`);
  failures.push(`suite error: ${err.message}`);
} finally {
  try { await cleanup(); } catch (e) { console.error(`cleanup: ${e.message}`); }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
  exitCode = failures.length > 0 ? 1 : 0;
}
process.exit(exitCode);
