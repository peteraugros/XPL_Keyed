// npm run verify:coaching
//
// Phase 2 of the content-to-coaching simplification: the surfaces that carry
// the new session payload, and the parent email that replaces the Sunday
// content delivery.
//
// Driven where it can be driven (the player's My Training page and the
// parent's progress page, rendered as real signed in users against the real
// local database) and asserted purely where that is stronger (the email body,
// where Hard rule #4 and Hard rule #8 live).
//
// Run:  node scripts/verify-coaching-session.mjs
// Needs: local Supabase up + a dev server (BASE_URL, default :3100).

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";

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
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_KEY) {
  console.error("No SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0;
const failures = [];
function ok(label, cond, detail = "") {
  if (cond) { passed++; console.log(`  PASS  ${label}`); }
  else { failures.push(`${label}${detail ? ` — ${detail}` : ""}`); console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`); }
}
function eq(label, a, b) {
  ok(label, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

// A routine with real newlines. The whole point of the pre-wrap rules.
const ROUTINE = "Every day until Thursday:\n1. 20 min edit course\n2. 10 box fight games\n3. One ranked session, no building unless you have to";
const NOTE = "You keep pre building before you have a read on where they are. Slow the first two builds down.";
const SUMMARY = "Working on planning before acting under pressure. (Fortnite term: pre building.)";

const TAG = `verifycoach-${randomUUID().slice(0, 8)}`;
const made = { authUsers: [], coaches: [], families: [], players: [], parents: [], subs: [], curricula: [], slots: [] };

async function seed() {
  const coachEmail = `${TAG}-coach@example.test`;
  const coachPw = `Vc-${randomUUID()}`;
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
  if (family.error) throw new Error(`families: ${family.error.message}`);
  made.families.push(family.data.id);

  // Parent and player each get their own auth user, because both pages are
  // rendered as the real signed in role and each resolves through its own
  // lookup in requireParentSession / requirePlayerSession.
  const parentEmail = `${TAG}-parent@example.test`;
  const parentPw = `Vp-${randomUUID()}`;
  const pu = await db.auth.admin.createUser({ email: parentEmail, password: parentPw, email_confirm: true });
  if (pu.error) throw new Error(`parent auth: ${pu.error.message}`);
  made.authUsers.push(pu.data.user.id);
  const parent = await db.from("parents").insert({
    family_id: family.data.id, first_name: "Verify", email: parentEmail,
    auth_user_id: pu.data.user.id,
  }).select("id").single();
  if (parent.error) throw new Error(`parents: ${parent.error.message}`);
  made.parents.push(parent.data.id);

  const kidEmail = `${TAG}-kid@example.test`;
  const kidPw = `Vk-${randomUUID()}`;
  const ku = await db.auth.admin.createUser({ email: kidEmail, password: kidPw, email_confirm: true });
  if (ku.error) throw new Error(`kid auth: ${ku.error.message}`);
  made.authUsers.push(ku.data.user.id);
  const player = await db.from("players").insert({
    // Columns read off information_schema: players has no display_name.
    family_id: family.data.id, first_name: "Jaxon", age: 14,
    auth_user_id: ku.data.user.id,
  }).select("id").single();
  if (player.error) throw new Error(`players: ${player.error.message}`);
  made.players.push(player.data.id);

  const sub = await db.from("subscriptions").insert({
    player_id: player.data.id, status: "active", lifecycle_state: "ACTIVE",
    tier: "monthly", cycle_lessons_delivered: 0, auto_renew_enabled: true,
  }).select("id").single();
  if (sub.error) throw new Error(`subscriptions: ${sub.error.message}`);
  made.subs.push(sub.data.id);

  const cur = await db.from("curricula").insert({
    player_id: player.data.id, created_by: coach.data.id, status: "active",
  }).select("id").single();
  if (cur.error) throw new Error(`curricula: ${cur.error.message}`);
  made.curricula.push(cur.data.id);

  const slotIds = [];
  for (let w = 1; w <= 3; w++) {
    const at = new Date(Date.now() - (4 - w) * 24 * 3600 * 1000).toISOString();
    const sl = await db.from("curriculum_slots").insert({
      curriculum_id: cur.data.id, week_number: w, live_call_at: at,
      live_call_event_id: `${TAG}-evt-${w}`,
    }).select("id").single();
    if (sl.error) throw new Error(`slot ${w}: ${sl.error.message}`);
    made.slots.push(sl.data.id);
    slotIds.push(sl.data.id);
  }

  return { coachUser: TAG, coachPw, parentEmail, parentPw, kidEmail, kidPw, slotIds, subId: sub.data.id };
}

async function cleanup() {
  for (const id of made.slots) await db.from("notification_log").delete().eq("related_entity_id", id);
  for (const id of made.slots) await db.from("curriculum_slots").delete().eq("id", id);
  for (const id of made.curricula) await db.from("curricula").delete().eq("id", id);
  for (const id of made.subs) await db.from("subscriptions").delete().eq("id", id);
  for (const id of made.players) await db.from("players").delete().eq("id", id);
  for (const id of made.parents) await db.from("parents").delete().eq("id", id);
  for (const id of made.families) await db.from("families").delete().eq("id", id);
  for (const id of made.coaches) await db.from("coaches").delete().eq("id", id);
  for (const id of made.authUsers) await db.auth.admin.deleteUser(id);
}

// Each role gets its own cookie jar so signing in as the kid does not evict
// the coach session.
function jar() {
  let cookie = "";
  return {
    get: () => cookie,
    absorb(res) {
      const sc = res.headers.getSetCookie?.() ?? [];
      if (!sc.length) return;
      const m = new Map(cookie ? cookie.split("; ").map((c) => { const i = c.indexOf("="); return [c.slice(0, i), c.slice(i + 1)]; }) : []);
      for (const c of sc) { const pair = c.split(";")[0]; const i = pair.indexOf("="); m.set(pair.slice(0, i), pair.slice(i + 1)); }
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
async function get(j, path) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: j.get() ? { cookie: j.get() } : {}, redirect: "manual",
  });
  j.absorb(res);
  return { status: res.status, url: res.headers.get("location"), html: await res.text() };
}

// Sign a parent or player in by letting @supabase/ssr serialize the session
// cookie itself, then handing those cookies to the request jar.
//
// Two earlier attempts failed and both are worth recording. Hand rolling the
// cookie 307'd both pages to /login, which reads exactly like the pages being
// broken when the harness was. Driving /auth/callback also fails, but for a
// more interesting reason: it is a CLIENT component page, not a route handler,
// so it establishes the session in the browser with JavaScript and a fetch can
// never complete it. (CLAUDE.md calls it `auth/callback/route.ts`. It is
// `page.tsx`.)
//
// Using the library's own cookie adapter means the format is whatever the app
// itself would write, so this keeps working if that format changes.
async function signInAsUser(j, email, password) {
  const written = [];
  const client = createServerClient(SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        for (const c of cookies) written.push(c);
      },
    },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signInWithPassword(${email}): ${error.message}`);
  if (written.length === 0) throw new Error(`no cookies written for ${email}`);
  j.absorb({
    headers: {
      getSetCookie: () => written.map((c) => `${c.name}=${c.value}`),
    },
  });
  return written.map((c) => c.name);
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
  console.log("\nA. the email body: Hard rule #4 and #8, asserted purely");
  // buildSessionRecapEmail has no imports, so Node 24 strips its types and
  // loads it directly. No transpile, no alias resolution, no dev server.
  const { buildSessionRecapEmail } = await import("../src/lib/coaching/session-recap-copy.ts");

  const built = buildSessionRecapEmail({
    parentEmail: "p@example.test", parentFirstName: "Sarah", kidFirstName: "Jaxon",
    parentSummary: SUMMARY, hasRoutine: true, slotId: fx.slotIds[0],
  });
  ok("the parent legible summary IS in the email", built.bodyHtml.includes("planning before acting"));
  ok("coach_note is NOT in the email", !built.bodyHtml.includes("pre building before you have a read"));
  ok("the routine text is NOT in the email", !built.bodyHtml.includes("box fight games"));
  ok("it says a routine exists and points at the dashboard",
     built.bodyHtml.includes("routine to work on") && built.bodyHtml.includes("/portal/progress"));
  const dashless = ![built.bodyHtml, built.subject, built.headline].some((t) => /[\u2014\u2013]/.test(t));
  ok("no em or en dashes anywhere (Hard rule #8)", dashless);

  const noSummary = buildSessionRecapEmail({
    parentEmail: "p@example.test", parentFirstName: "Sarah", kidFirstName: "Jaxon",
    parentSummary: null, hasRoutine: true, slotId: fx.slotIds[0],
  });
  ok("with no parent_summary it still sends something, quoting nothing",
     noSummary.bodyHtml.includes("/portal/progress") && !noSummary.bodyHtml.includes("planning before acting"));

  const escaped = buildSessionRecapEmail({
    parentEmail: "p@example.test", parentFirstName: "Sarah", kidFirstName: "Jaxon",
    parentSummary: 'Worked on <script>alert(1)</script> & spacing', hasRoutine: false, slotId: fx.slotIds[0],
  });
  ok("the summary is html escaped", !escaped.bodyHtml.includes("<script>") && escaped.bodyHtml.includes("&lt;script&gt;"));

  const multi = buildSessionRecapEmail({
    parentEmail: "p@example.test", parentFirstName: "Sarah", kidFirstName: "Jaxon",
    parentSummary: "First line.\nSecond line.", hasRoutine: false, slotId: fx.slotIds[0],
  });
  ok("a multi line summary keeps its breaks in the inbox", multi.bodyHtml.includes("First line.<br/>Second line."));

  // -------------------------------------------------------------------------
  console.log("\nB. Tim marks the call done with advice plus routine");
  const coach = jar();
  const si = await post(coach, "/api/auth/sign-in-coach-password", { username: fx.coachUser, password: fx.coachPw });
  eq("coach signed in", si.status, 200);

  const mo = await post(coach, "/api/admin/calendar/mark-outcome", {
    outcome: "done", slot_id: fx.slotIds[0],
    coach_note: NOTE, training_routine: ROUTINE, parent_summary: SUMMARY,
  });
  eq("mark done returns 200", mo.status, 200);
  eq("cycle still advances (Phase 1 intact)", mo.json?.cycle, "advanced");

  const stored = await db.from("curriculum_slots")
    .select("coach_note, training_routine, parent_summary, training_routine_at, parent_summary_at")
    .eq("id", fx.slotIds[0]).single();
  ok("routine stored with its newlines intact",
     (stored.data?.training_routine ?? "").includes("\n2. 10 box fight games"));
  ok("parent_summary stored", (stored.data?.parent_summary ?? "") === SUMMARY);
  ok("training_routine_at stamped", !!stored.data?.training_routine_at);
  ok("parent_summary_at stamped", !!stored.data?.parent_summary_at);

  const log = await db.from("notification_log")
    .select("trigger, recipient_type, channel")
    .eq("related_entity_id", fx.slotIds[0]);
  ok("a session_recap email to the parent was logged",
     (log.data ?? []).some((r) => r.trigger === "session_recap" && r.recipient_type === "parent"),
     JSON.stringify(log.data));

  // -------------------------------------------------------------------------
  console.log("\nC. no email when Tim wrote nothing");
  const bare = await post(coach, "/api/admin/calendar/mark-outcome", {
    outcome: "done", slot_id: fx.slotIds[1],
  });
  eq("bare mark done still returns 200", bare.status, 200);
  const bareLog = await db.from("notification_log").select("id").eq("related_entity_id", fx.slotIds[1]);
  eq("no recap email was sent for an unwritten session", (bareLog.data ?? []).length, 0);

  // -------------------------------------------------------------------------
  console.log("\nD. the player's My Training page");
  const kid = jar();
  const kidCookies = await signInAsUser(kid, fx.kidEmail, fx.kidPw);
  ok("the player's session cookie was produced by @supabase/ssr itself",
     kidCookies.some((n) => n.startsWith("sb-")), kidCookies.join(","));

  const tr = await get(kid, "/play/training");
  ok("my training renders for the player (not a redirect to login)",
     tr.status === 200 && !String(tr.url ?? "").includes("/login"),
     `status ${tr.status} url ${tr.url}`);
  if (tr.status === 200) {
    ok("the routine is on the page", tr.html.includes("box fight games"));
    // The CSS assertion in F proves pre-wrap is declared; this proves the
    // newlines actually reach the markup for it to act on. Both are needed:
    // pre-wrap on collapsed text does nothing, and newlines without pre-wrap
    // render as spaces.
    ok("the routine's newlines survive into the markup",
       /1\. 20 min edit course\n/.test(tr.html));
    ok("the advice is on the page", tr.html.includes("Slow the first two builds down"));
    ok("the routine block is labelled for the player", tr.html.includes("Your routine"));
    ok("parent_summary is NOT shown to the player",
       !tr.html.includes("planning before acting"));
    ok("the parent visibility line is present", /parent can see all of this/i.test(tr.html));
  }

  // -------------------------------------------------------------------------
  console.log("\nE. the parent's progress page");
  const par = jar();
  await signInAsUser(par, fx.parentEmail, fx.parentPw);

  const pg = await get(par, "/portal/progress");
  ok("progress renders for the parent",
     pg.status === 200 && !String(pg.url ?? "").includes("/login"),
     `status ${pg.status} url ${pg.url}`);
  if (pg.status === 200) {
    ok("the parent legible summary is on the page", pg.html.includes("planning before acting"));
    ok("the routine is on the page read only", pg.html.includes("box fight games"));
    ok("the note written for the player is on the page too",
       pg.html.includes("Slow the first two builds down"));
    ok("no form or composer wraps the routine for the parent",
       !/name="training_routine"/.test(pg.html));
  }

  // -------------------------------------------------------------------------
  // The surfaces the content removal rewrote. A 307 to /login proves only that
  // the auth gate ran; the render never happened. These are the pages whose
  // bodies were rewritten away from lessons, so each one is rendered as a real
  // signed-in user and checked for the two failure shapes that a production
  // build cannot catch: a 500 from the render path, and content that still
  // promises the old product.
  // -------------------------------------------------------------------------
  console.log("\nE2. the rewritten surfaces render for a real user");

  const GONE = [
    "Sunday lesson drop",
    "slides and voiceover",
    "Slides and voiceover",
    "PDF lesson",
    "lesson library",
    "Lesson library",
    "4 week plan",
  ];

  for (const [who, j, path] of [
    ["player", kid, "/play"],
    ["parent", par, "/portal"],
    ["parent", par, "/portal/sessions"],
    ["parent", par, "/portal/billing"],
    ["parent", par, "/portal/membership"],
    ["parent", par, "/portal/coaches"],
  ]) {
    const r = await get(j, path);
    ok(`${path} renders for the ${who}`,
       r.status === 200 && !String(r.url ?? "").includes("/login"),
       `status ${r.status} url ${r.url}`);
    if (r.status === 200) {
      const leaks = GONE.filter((g) => r.html.includes(g));
      ok(`${path} no longer promises the content product`, leaks.length === 0,
         leaks.join(" | "));
    }
  }

  // -------------------------------------------------------------------------
  console.log("\nF. source invariants");
  const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const trainingCss = readFileSync("src/app/play/training/training.module.css", "utf8");
  ok("My Training preserves newlines in the routine body",
     /\.body\s*\{[^}]*white-space:\s*pre-wrap/.test(trainingCss));
  const progressCss = readFileSync("src/app/portal/progress/progress.module.css", "utf8");
  ok("the parent routine body preserves newlines too",
     /\.routineBody\s*\{[^}]*white-space:\s*pre-wrap/.test(progressCss));
  const trainingSrc = strip(readFileSync("src/app/play/training/page.tsx", "utf8"));
  ok("My Training does not read parent_summary at all",
     !trainingSrc.includes("parent_summary"));
  ok("My Training does not read the lessons table",
     !/from\("lessons"\)/.test(trainingSrc));
  const shellSrc = readFileSync("src/app/play/PlayShell.tsx", "utf8");
  ok("the nav offers My training", shellSrc.includes('"/play/training"'));
  const copySrc = strip(readFileSync("src/lib/coaching/session-recap-copy.ts", "utf8"));
  ok("the copy module never receives the routine text, only whether one exists",
     copySrc.includes("hasRoutine") && !/trainingRoutine\s*:/.test(copySrc));
  ok("the copy module imports nothing, so its rules stay checkable",
     !/^\s*import\s/m.test(copySrc));

  // -------------------------------------------------------------------------
  // G. Tim can actually WRITE a routine.
  //
  // This is the half the rest of the suite cannot see, and it shipped broken
  // once: the route accepted all three fields from the additive phase onward
  // and the only form that calls it asked for coach_note alone, so
  // training_routine and parent_summary were reachable by nothing. Everything
  // above proves a routine RENDERS once it is in the database. These prove
  // there is a door.
  // -------------------------------------------------------------------------
  console.log("\nG. the coach-facing write-up form");

  const calSrc = strip(readFileSync("src/app/admin/calendar/CalendarClient.tsx", "utf8"));

  // The body sent on "It happened" must carry all three.
  // The end anchor is searched FROM the start anchor on purpose. Searching the
  // whole file finds CoachCancelForm's fetch first, which is EARLIER, so the
  // slice came back empty and three passing properties reported as failures.
  const doneAt = calSrc.indexOf('if (outcome === "done") {');
  ok("the done branch exists at all", doneAt >= 0);
  const doneBody = calSrc.slice(doneAt, calSrc.indexOf("const res = await fetch", doneAt));
  ok("and the slice is not empty, so the three assertions below can fail",
     doneBody.length > 50);
  ok("the done branch sends coach_note", /body\.coach_note\s*=/.test(doneBody));
  ok("the done branch sends training_routine", /body\.training_routine\s*=/.test(doneBody));
  ok("the done branch sends parent_summary", /body\.parent_summary\s*=/.test(doneBody));

  // ...from real controls, not from a constant. A state setter per field is
  // what distinguishes "the field is sent" from "the field is hardcoded".
  for (const setter of ["setCoachNote", "setRoutine", "setParentSummary"]) {
    ok(`${setter} is wired to an input`,
       new RegExp(`onChange=\\{\\(e\\) => ${setter}\\(e\\.target\\.value\\)\\}`).test(calSrc));
  }

  // mark-outcome is write once, so a form offered on a settled session would
  // silently discard whatever Tim typed. Both halves are asserted: the form is
  // gated on delivered_at, and an already_marked response is surfaced rather
  // than reported as a success.
  ok("the outcome form is not offered once the session is settled",
     /isPaid && event\.delivered_at \?/.test(calSrc));
  ok("an already-settled response is reported honestly, not as a fresh save",
     /r\.already_marked/.test(calSrc) && /already settled/.test(calSrc));

  // And what he wrote comes back when he reopens the card.
  ok("the modal renders the write-up it stored",
     /event\.coach_note \|\| event\.training_routine \|\| event\.parent_summary/.test(calSrc));
  ok("the routine keeps its line breaks for Tim too",
     /whiteSpace:\s*"pre-wrap"/.test(calSrc));

  const calPageSrc = strip(readFileSync("src/app/admin/calendar/page.tsx", "utf8"));
  ok("the calendar selects the three write-up columns",
     /coach_note, training_routine, parent_summary/.test(calPageSrc));

  // A routine is written as lines, so every surface that shows it in full must
  // keep them. There are four, and one of them silently did not.
  const clientsSrc = readFileSync("src/app/admin/clients/ClientsClient.tsx", "utf8");
  ok("the client card keeps the routine's line breaks too",
     /whiteSpace:\s*"pre-wrap"/.test(clientsSrc));
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
