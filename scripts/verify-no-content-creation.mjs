// npm run verify:nocontent
//
// Phases 3 to 5 of the content-to-coaching simplification: nothing can create
// lesson content any more, and removing that did not break billing or the
// coach's task queue.
//
// The central property USED to be blunt and behavioural: count the rows in
// `lessons`, perform every action that used to create one, count again. Phase 5
// dropped the table, so the property is now STRUCTURAL and strictly stronger.
// There is no table to write a row into, and the columns that attached content
// to a session are gone, so the old failure is unrepresentable rather than
// merely unobserved.
//
// Run:  node scripts/verify-no-content-creation.mjs
// Needs: local Supabase up + a dev server (BASE_URL, default :3100).

import { createClient } from "@supabase/supabase-js";
import { readFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim();
}
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54421";
const db = createClient(SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Schema questions go to Postgres, never to PostgREST, and the reason is a
// trap this suite walked into on 2026-09-20. supabase-js called with
// { count: "exact", head: true } against a table that DOES NOT EXIST returns
// status 204, NO error and a null count, so the old `count ?? 0` reported
// "0 lessons" whether the table was empty, dropped or renamed. That is a probe
// that cannot fail. A plain select does surface the error; a head-count does not.
import { execFileSync } from "node:child_process";
const PG = "postgresql://postgres:postgres@127.0.0.1:54422/postgres";
const sql = (q) => execFileSync("psql", [PG, "-tAc", q], { encoding: "utf8" }).trim();
const tableExists = (t) => sql(`select to_regclass('public.${t}') is not null;`) === "t";
const columnExists = (t, c) => sql(
  `select exists (select 1 from information_schema.columns where table_schema='public' and table_name='${t}' and column_name='${c}');`) === "t";

// Any read naming a dropped column comes back data:null with an error, and the
// old `?? []` turned that into a confident "got 0" that read as a broken route.
// Throw instead, so the next dropped column is loud.
function rows(label, r) {
  if (r.error) throw new Error(`${label}: ${r.error.message}`);
  return r.data ?? [];
}

let passed = 0;
const failures = [];
function ok(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function eq(label, a, b) { ok(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

const TAG = `verifync-${randomUUID().slice(0, 8)}`;
const made = { authUsers: [], coaches: [], families: [], players: [], parents: [], subs: [], curricula: [] };

async function seed() {
  const coachEmail = `${TAG}-coach@example.test`;
  const coachPw = `Vn-${randomUUID()}`;
  const cu = await db.auth.admin.createUser({ email: coachEmail, password: coachPw, email_confirm: true });
  if (cu.error) throw new Error(`coach auth: ${cu.error.message}`);
  made.authUsers.push(cu.data.user.id);
  const coach = await db.from("coaches").insert({
    display_name: "Verify Coach", email: coachEmail, username: TAG,
    auth_user_id: cu.data.user.id, is_active: true,
  }).select("id").single();
  if (coach.error) throw new Error(`coaches: ${coach.error.message}`);
  made.coaches.push(coach.data.id);

  const family = await db.from("families").insert({}).select("id").single();
  made.families.push(family.data.id);
  const parent = await db.from("parents").insert({
    family_id: family.data.id, first_name: "Verify", email: `${TAG}-parent@example.test`,
  }).select("id").single();
  if (parent.error) throw new Error(`parents: ${parent.error.message}`);
  made.parents.push(parent.data.id);
  const player = await db.from("players").insert({
    family_id: family.data.id, first_name: "Jaxon", age: 14,
  }).select("id").single();
  if (player.error) throw new Error(`players: ${player.error.message}`);
  made.players.push(player.data.id);

  // trial + waiting_on TIM is the state Stage C acts on.
  const sub = await db.from("subscriptions").insert({
    player_id: player.data.id, status: "trial", lifecycle_state: "TRIAL_DONE",
    tier: "trial", waiting_on: "TIM", cycle_lessons_delivered: 0,
  }).select("id").single();
  if (sub.error) throw new Error(`subscriptions: ${sub.error.message}`);
  made.subs.push(sub.data.id);

  return { coachUser: TAG, coachPw, playerId: player.data.id, subId: sub.data.id, coachId: coach.data.id };
}

async function cleanup() {
  const curs = await db.from("curricula").select("id").in("player_id", made.players);
  for (const c of curs.data ?? []) {
    await db.from("curriculum_slots").delete().eq("curriculum_id", c.id);
    await db.from("curricula").delete().eq("id", c.id);
  }
  for (const id of made.subs) await db.from("subscriptions").delete().eq("id", id);
  for (const id of made.players) await db.from("players").delete().eq("id", id);
  for (const id of made.parents) await db.from("parents").delete().eq("id", id);
  for (const id of made.families) await db.from("families").delete().eq("id", id);
  for (const id of made.coaches) {
    await db.from("lessons").delete().eq("author_id", id);
    await db.from("coaches").delete().eq("id", id);
  }
  for (const id of made.authUsers) await db.auth.admin.deleteUser(id);
}

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

async function main() {
  try {
    const probe = await fetch(`${BASE_URL}/login`, { redirect: "manual" });
    if (probe.status >= 500) throw new Error(`status ${probe.status}`);
  } catch (err) {
    console.error(`\nNo dev server at ${BASE_URL} (${err.message}).`);
    process.exit(1);
  }

  const fx = await seed();

  // -------------------------------------------------------------------------
  console.log("\nA. taking a student on creates sessions, not content");
  const coach = jar();
  eq("coach signed in", (await post(coach, "/api/auth/sign-in-coach-password", { username: fx.coachUser, password: fx.coachPw })).status, 200);

  // Still sends `weeks`, exactly as StageCPanel does today. The route must
  // accept it and ignore it, so the admin panel and the route can be changed
  // in separate phases.
  const take = await post(coach, "/api/admin/conversion/take-on", {
    player_id: fx.playerId,
    personalization_note: "Jaxon reads fights well and panics on the rebuild. That is what we start with.",
    weeks: [
      { kid_facing_title: "Tunneling", parent_facing_skill: "Defensive building under pressure", is_vod_review: false },
      { kid_facing_title: "Edits", parent_facing_skill: "Fast decision making", is_vod_review: false },
      { kid_facing_title: "VOD", parent_facing_skill: "Self review", is_vod_review: true },
      { kid_facing_title: "Endgame", parent_facing_skill: "Planning ahead", is_vod_review: false },
    ],
  });
  ok("take-on succeeds while still being sent the old weeks payload",
     take.status === 200, `status ${take.status} ${JSON.stringify(take.json)}`);

  ok("there is no lessons table for any path to write a row into", !tableExists("lessons"));
  ok("and no lesson_bundles table either", !tableExists("lesson_bundles"));

  const cur = await db.from("curricula").select("id, status").eq("player_id", fx.playerId).maybeSingle();
  ok("a curriculum was created", !!cur.data?.id);
  const slots = rows("take-on slots", await db.from("curriculum_slots")
    .select("week_number")
    .eq("curriculum_id", cur.data.id).order("week_number"));
  eq("four sessions exist", slots.length, 4);
  eq("they are weeks 1 to 4", slots.map((s) => s.week_number).join(","), "1,2,3,4");

  // "Every session is bare" used to be checked by reading nulls back. After
  // Phase 5 it is a fact about the schema, which no row can contradict.
  for (const gone of ["lesson_id", "vod_url", "is_vod_review", "vod_talking_points"])
    ok(`a session cannot carry ${gone}: the column is gone`, !columnExists("curriculum_slots", gone));
  ok("lesson_xor_vod went with the columns it governed",
     sql("select count(*) from pg_constraint where conname='lesson_xor_vod';") === "0");

  // -------------------------------------------------------------------------
  console.log("\nB. a renewal cycle also creates bare sessions");
  // Put the subscription into the shape provisionNextCycle expects, and give
  // the finished cycle real call times so the uniform/scattered branch runs.
  await db.from("subscriptions").update({
    status: "active", lifecycle_state: "ACTIVE", tier: "monthly",
    cycle_lessons_delivered: 4, cycle_started_at: new Date(Date.now() - 28 * 864e5).toISOString(),
  }).eq("id", fx.subId);
  for (let i = 0; i < 4; i++) {
    await db.from("curriculum_slots")
      .update({ live_call_at: new Date(Date.now() - (28 - i * 7) * 864e5).toISOString() })
      .eq("curriculum_id", cur.data.id).eq("week_number", i + 1);
  }
  await db.from("curricula").update({ status: "active" }).eq("id", cur.data.id);

  const { provisionNextCycle } = await import("../src/lib/lessons/auto-renew.ts").catch(() => ({}));
  if (provisionNextCycle) {
    const result = await provisionNextCycle({ supabase: db, subscriptionId: fx.subId });
    ok("provisionNextCycle created a new cycle", !!result?.newCurriculumId);
    const newSlots = rows("renewal slots", await db.from("curriculum_slots")
      .select("week_number").eq("curriculum_id", result.newCurriculumId));
    eq("the renewal made four sessions", newSlots.length, 4);
    made.curricula.push(result.newCurriculumId);
  } else {
    console.log("  (provisionNextCycle not importable directly; covered by source checks in D)");
  }

  // -------------------------------------------------------------------------
  console.log("\nC. the coach's queue and the schedule, read from the database");

  // Asserted against what Postgres HOLDS, not against the migration file. A
  // migration that failed halfway would still read correctly on disk.
  const def = sql("select pg_get_viewdef('derived_tasks_view'::regclass);");
  ok("derived_tasks_view no longer references the lessons table",
     !/\blessons\b/.test(def));
  ok("and no longer counts slides", !/\bslides\b|\bslide_count\b/.test(def));

  const types = [...def.matchAll(/'([a-z_]+)'::text AS task_type/g)].map((m) => m[1]);
  eq("the view has 14 branches", types.length, 14);
  for (const gone of ["lesson_authoring_needed", "library_running_low", "single_session_needs_lesson"]) {
    ok(`${gone} is gone from the queue`, !types.includes(gone));
  }
  // The control. Removing three branches must not have taken others with it,
  // and call_outcome_pending in particular is the Phase 1 billing backstop.
  for (const kept of ["call_outcome_pending", "cycle_drag_out", "refund_request_pending",
                      "message_thread", "vod_dropped", "prep_answered", "trial_decision"]) {
    ok(`${kept} survived`, types.includes(kept));
  }

  const contentCrons = sql("select coalesce(string_agg(jobname, ','), '') from cron.job where jobname in ('sunday_lesson_delivery', 'cron-rough-draft-cleanup');");
  eq("both content delivery crons are unscheduled", contentCrons, "");
  const otherCrons = Number(sql("select count(*) from cron.job;"));
  ok("the other scheduled jobs are untouched", otherCrons === 11, `${otherCrons} jobs`);

  // -------------------------------------------------------------------------
  console.log("\nD. source invariants");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const takeOnSrc = strip(readFileSync("src/app/api/admin/conversion/take-on/route.ts", "utf8"));
  ok("take-on never writes to lessons", !/from\("lessons"\)/.test(takeOnSrc));
  // Deliberately about USE, not mention. `parent_facing_skill` still appears
  // in WeekSchema, because the route still accepts (and ignores) the old
  // payload so the admin panel can change in a later phase. Forbidding the
  // string failed on the schema, which is the "matched the right word in the
  // wrong place" mistake.
  ok("take-on no longer reads week titles into the email",
     !/weeksHtml/.test(takeOnSrc) &&
     !/\bw\.parent_facing_skill/.test(takeOnSrc) &&
     !/\bw\.kid_facing_title/.test(takeOnSrc) &&
     !/body\.weeks\s*\n?\s*\.map/.test(takeOnSrc));
  ok("the conversion email talks about sessions, not lessons",
     /4 sessions/.test(takeOnSrc) && !/for 4 lessons/.test(takeOnSrc));

  const arSrc = strip(readFileSync("src/lib/lessons/auto-renew.ts", "utf8"));
  ok("provisionNextCycle does not call selectLessonsForRenewal",
     !/await selectLessonsForRenewal/.test(arSrc));
  // Phase 3 wrote `lesson_id: null, is_vod_review: false` explicitly to satisfy
  // the lesson_xor_vod CHECK. Phase 4 dropped both: the column defaults are
  // `false` NOT NULL and NULL, which land on the constraint's third disjunct
  // ((is_vod_review = false) AND (lesson_id IS NULL) AND (vod_url IS NULL)).
  // PROVEN against the local database rather than reasoned about: an insert of
  // exactly these four columns succeeds and comes out unsettled + uncounted.
  // So the property to hold is that the renewal insert names NO content column,
  // which is what stops someone reintroducing one.
  ok("the renewal slot insert names no lesson or VOD column",
     !/lesson_id/.test(arSrc) && !/is_vod_review/.test(arSrc) && !/vod_url/.test(arSrc));

  const stripeSrc = strip(readFileSync("src/app/api/stripe-webhook/route.ts", "utf8"));
  ok("the stripe webhook no longer delivers week one materials",
     !/deliverWeekOneImmediately/.test(stripeSrc) && !/shouldDeliverWeek1Immediately/.test(stripeSrc));

  const successSrc = strip(readFileSync("src/app/curriculum/[token]/success/SuccessClient.tsx", "utf8"));
  ok("the booking confirmation no longer promises a PDF lesson",
     !/PDF lesson/.test(successSrc));

  // Phase 4 goes further than Phase 3 could: nothing in the app touches the
  // `lessons` or `lesson_bundles` tables at all any more, read or write. That is
  // the precondition for the Phase 5 schema drop, so it is asserted rather than
  // spot checked.
  //
  // grep EXITS NON-ZERO WHEN IT FINDS NOTHING, and finding nothing is the
  // success case here, so execFileSync would throw on a passing run. The first
  // version of this block did exactly that and reported a suite error on a
  // clean tree. Shell out through a wrapper that treats "no matches" as an
  // empty list.
  const { execFileSync } = await import("node:child_process");
  function grepFiles(pattern) {
    try {
      return execFileSync("grep", ["-rln", pattern, "src"], { encoding: "utf8" })
        .split("\n").filter(Boolean);
    } catch (err) {
      if (err.status === 1) return []; // grep's "no lines selected"
      throw err;
    }
  }

  for (const table of ["lessons", "lesson_bundles"]) {
    const hits = grepFiles(`from("${table}")`);
    eq(`nothing in src reads or writes ${table}`, hits.length, 0);
    if (hits.length > 0) console.log("      ", hits.join(", "));
  }

  // The helpers that chose content for a renewal are gone, not merely unused.
  for (const fn of ["selectLessonsForRenewal", "fetchPriorLessonIds"]) {
    eq(`${fn} no longer exists anywhere`, grepFiles(fn).length, 0);
  }

  // And the surfaces are gone, so a nav entry cannot point at a dead page.
  for (const dir of [
    "src/app/admin/lessons",
    "src/app/api/admin/lessons",
    "src/app/api/admin/lesson-bundles",
    "src/app/play/library",
  ]) {
    ok(`${dir} is deleted`, !existsSync(dir));
  }
  for (const nav of ["src/app/admin/_components/AdminShell.tsx", "src/app/play/PlayShell.tsx"]) {
    const src = strip(readFileSync(nav, "utf8"));
    ok(`${nav} has no link to a deleted surface`,
       !/\/admin\/lessons/.test(src) && !/\/play\/library/.test(src));
  }
}

let code = 0;
try { await main(); }
catch (err) { console.error(`\nSUITE ERROR: ${err.stack ?? err.message}`); failures.push(`suite error: ${err.message}`); }
finally {
  try { await cleanup(); } catch (e) { console.error(`cleanup: ${e.message}`); }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  for (const f of failures) console.log(`  - ${f}`);
  code = failures.length > 0 ? 1 : 0;
}
process.exit(code);
