// npm run verify:vodreview
//
// A student can turn one session a cycle into a VOD review. Tim can do it too,
// and his decision must not cost the kid their swap.
//
// Part A is the rules as pure functions. Part B drives the real routes as a
// real student and a real coach, because the rules being right says nothing
// about whether a kid can reach another family's sessions. Part C mutates.
//
// Calendly is never called: slots are seeded with a "manual:" event id, which
// cancelCalendlyEvent skips by design.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3100";
const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!/127\.0\.0\.1|localhost/.test(URL_)) {
  console.error(`\nREFUSING: Supabase is not local (${URL_}).`); process.exit(2);
}
const db = createClient(URL_, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anon = createClient(URL_, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let passed = 0; const failures = [];
const ok = (l, c, d = "") => c
  ? (passed++, console.log(`  PASS  ${l}`))
  : (failures.push(`${l}${d ? ` — ${d}` : ""}`), console.log(`  FAIL  ${l}${d ? ` — ${d}` : ""}`));
const eq = (l, a, b) => ok(l, a === b, `expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
const step = (s) => console.log(`\n${s}`);

const TAG = `vod-${randomUUID().slice(0, 8)}`;
const made = { families: [], players: [], parents: [], subs: [], curricula: [], authUsers: [], coaches: [] };

// The app stores one cookie: sb-127-auth-token = "base64-" + b64(session JSON).
function cookieFor(session) {
  const raw = Buffer.from(JSON.stringify(session)).toString("base64");
  return `sb-127-auth-token=base64-${raw}`;
}
async function studentSession(email, password) {
  const r = await anon.auth.signInWithPassword({ email, password });
  if (r.error) throw new Error(`student sign in: ${r.error.message}`);
  return cookieFor(r.data.session);
}
async function api(path, { method = "POST", cookie, body } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function seedFamily({ slots = 4 } = {}) {
  const pw = `Vod-${randomUUID()}`;
  const email = `${TAG}-${randomUUID().slice(0, 4)}@example.test`;
  const au = await db.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (au.error) throw new Error(`auth: ${au.error.message}`);
  made.authUsers.push(au.data.user.id);

  const fam = await db.from("families").insert({}).select("id").single();
  made.families.push(fam.data.id);
  const par = await db.from("parents").insert({
    family_id: fam.data.id, first_name: "Obs", email: `${TAG}-p-${randomUUID().slice(0,4)}@example.test`,
  }).select("id").single();
  made.parents.push(par.data.id);
  const ply = await db.from("players").insert({
    family_id: fam.data.id, first_name: "Kid", age: 14, auth_user_id: au.data.user.id,
  }).select("id").single();
  if (ply.error) throw new Error(`players: ${ply.error.message}`);
  made.players.push(ply.data.id);

  const sub = await db.from("subscriptions").insert({
    player_id: ply.data.id, status: "active", lifecycle_state: "ACTIVE", tier: "monthly",
    cycle_sessions_delivered: 0, auto_renew_enabled: true,
  }).select("id").single();
  if (sub.error) throw new Error(`subscriptions: ${sub.error.message}`);
  made.subs.push(sub.data.id);

  const coach = await db.from("coaches").select("id").eq("is_active", true).limit(1).single();
  const cur = await db.from("curricula").insert({
    player_id: ply.data.id, created_by: coach.data.id, status: "active",
  }).select("id").single();
  made.curricula.push(cur.data.id);

  const rows = [];
  for (let w = 1; w <= slots; w++) {
    rows.push({
      curriculum_id: cur.data.id, week_number: w,
      live_call_at: new Date(Date.now() + w * 7 * 864e5).toISOString(),
      live_call_event_id: `manual:${TAG}-${w}`,
    });
  }
  const ins = await db.from("curriculum_slots").insert(rows).select("id, week_number");
  if (ins.error) throw new Error(`slots: ${ins.error.message}`);

  return {
    playerId: ply.data.id, subId: sub.data.id, curriculumId: cur.data.id,
    slots: ins.data.sort((a, b) => a.week_number - b.week_number),
    cookie: await studentSession(email, pw),
  };
}
const slot = (id) => db.from("curriculum_slots")
  .select("delivery_mode, vod_review_by, vod_review_at, vod_upload_id, live_call_at, live_call_event_id, delivered_at")
  .eq("id", id).single();
const subOf = (id) => db.from("subscriptions").select("cycle_vod_reviews_used").eq("id", id).single();

async function main() {
  console.log(`VOD review swap  [${TAG}]`);

  // ---------------------------------------------------------------- Part A
  step("A. the rules, as pure functions");
  const m = await import("../src/lib/sessions/vodReview.ts");
  const live = { delivery_mode: "live_call", delivered_at: null, live_call_at: null };
  const done = { delivery_mode: "live_call", delivered_at: "2026-01-01T00:00:00Z", live_call_at: null };
  const already = { delivery_mode: "vod_review", delivered_at: null, live_call_at: null };

  eq("the allowance is one per cycle", m.VOD_REVIEWS_PER_CYCLE, 1);
  ok("a fresh cycle lets the student swap", m.canSwapToVodReview(live, "student", 0).ok);
  ok("a spent allowance refuses", !m.canSwapToVodReview(live, "student", 1).ok);
  eq("and says why", m.canSwapToVodReview(live, "student", 1).reason, "allowance_spent");
  ok("the COACH is never blocked by the kid's allowance",
     m.canSwapToVodReview(live, "coach", 99).ok,
     "Tim deciding a session is better spent on a VOD must not depend on the kid having a swap left");
  ok("a delivered session cannot be changed", !m.canSwapToVodReview(done, "student", 0).ok);
  ok("nor one that is already a VOD review", !m.canSwapToVodReview(already, "student", 0).ok);
  eq("a student swap spends one", m.allowanceAfterSwap(0, "student"), 1);
  eq("a coach swap spends none", m.allowanceAfterSwap(0, "coach"), 0);
  eq("undoing a student swap returns it", m.allowanceAfterUndo(1, "student"), 0);
  eq("undoing a coach swap returns nothing", m.allowanceAfterUndo(1, "coach"), 1);
  eq("and the counter never goes negative", m.allowanceAfterUndo(0, "student"), 0);
  ok("undo is refused once delivered", !m.canUndoVodReview({ ...already, delivered_at: "2026-01-01T00:00:00Z" }).ok);
  ok("every refusal has words for the kid",
     ["already_vod_review","already_delivered","allowance_spent"]
       .every((r) => typeof m.refusalMessage(r) === "string" && m.refusalMessage(r).length > 10));

  // ---------------------------------------------------------------- Part B
  step("B. a student turns one session into a VOD review");
  const a = await seedFamily();
  const r1 = await api(`/api/play/sessions/${a.slots[0].id}/vod-review`, {
    cookie: a.cookie, body: { vod_url: "https://youtu.be/abc12345" },
  });
  eq("accepted", r1.status, 200);
  const s1 = await slot(a.slots[0].id);
  eq("the session is a VOD review", s1.data?.delivery_mode, "vod_review");
  eq("recorded as the student's own call", s1.data?.vod_review_by, "student");
  ok("the VOD they pasted is attached", !!s1.data?.vod_upload_id);
  eq("the live call time is cleared so reminders stop", s1.data?.live_call_at, null);
  ok("Tim's calendar hold is released",
     String(s1.data?.live_call_event_id ?? "").startsWith("cancelled:"),
     String(s1.data?.live_call_event_id));
  eq("the allowance is spent", (await subOf(a.subId)).data?.cycle_vod_reviews_used, 1);

  const vodRow = await db.from("vod_uploads").select("is_initial_trial_vod")
    .eq("id", s1.data.vod_upload_id).single();
  eq("and it is NOT filed as a trial VOD: this family is already a client",
     vodRow.data?.is_initial_trial_vod, false);

  step("B2. once a cycle means once");
  const r2 = await api(`/api/play/sessions/${a.slots[1].id}/vod-review`, { cookie: a.cookie });
  eq("the second swap is refused", r2.status, 409);
  eq("for the right reason", r2.json?.error, "allowance_spent");
  eq("and week 2 is untouched", (await slot(a.slots[1].id)).data?.delivery_mode, "live_call");

  step("B3. Tim can decide, and it does not cost the kid their swap");
  const coachCookie = await coachLogin();
  const r3 = await api(`/api/admin/calendar/${a.slots[1].id}/vod-review`, { cookie: coachCookie });
  eq("accepted", r3.status, 200);
  const s3 = await slot(a.slots[1].id);
  eq("it is a VOD review", s3.data?.delivery_mode, "vod_review");
  eq("recorded as the COACH's decision", s3.data?.vod_review_by, "coach");
  eq("the kid's allowance is unchanged", (await subOf(a.subId)).data?.cycle_vod_reviews_used, 1);

  step("B4. a kid cannot reach another family's session");
  const b = await seedFamily();
  const r4 = await api(`/api/play/sessions/${b.slots[0].id}/vod-review`, { cookie: a.cookie });
  eq("refused as NOT FOUND, never 403: a 403 would confirm the id exists", r4.status, 404);
  eq("and nothing changed", (await slot(b.slots[0].id)).data?.delivery_mode, "live_call");

  step("B5. changing their mind hands the swap back");
  const r5 = await api(`/api/play/sessions/${a.slots[0].id}/vod-review`, { method: "DELETE", cookie: a.cookie });
  eq("accepted", r5.status, 200);
  eq("back to a live call", (await slot(a.slots[0].id)).data?.delivery_mode, "live_call");
  eq("and the allowance is returned", (await subOf(a.subId)).data?.cycle_vod_reviews_used, 0);
  ok("the kid is told the time is gone and needs rebooking", r5.json?.needs_rebooking === true);

  step("B6. a kid cannot reverse Tim's decision");
  const r6 = await api(`/api/play/sessions/${a.slots[1].id}/vod-review`, { method: "DELETE", cookie: a.cookie });
  eq("refused", r6.status, 403);
  eq("for the right reason", r6.json?.error, "coach_decided");
  eq("still a VOD review", (await slot(a.slots[1].id)).data?.delivery_mode, "vod_review");

  step("B7. a delivered session is spent");
  await db.from("curriculum_slots").update({ delivered_at: new Date().toISOString() }).eq("id", a.slots[2].id);
  const r7 = await api(`/api/play/sessions/${a.slots[2].id}/vod-review`, { cookie: a.cookie });
  eq("refused", r7.status, 409);
  eq("for the right reason", r7.json?.error, "already_delivered");

  step("B8. the allowance is PER CYCLE, so the renewal gives it back");
  await db.from("subscriptions").update({ cycle_vod_reviews_used: 1 }).eq("id", a.subId);
  // Asserted at SOURCE, always, not only when an import happens to fail. The
  // earlier version of this ran inside an if-import-failed branch, so it never
  // executed and the whole stage was decoration.
  const src = readFileSync("src/lib/lessons/auto-renew.ts", "utf8");
  ok("provisionNextCycle resets cycle_vod_reviews_used to 0",
     /cycle_vod_reviews_used:\s*0/.test(src),
     "without this the allowance silently becomes once per LIFETIME: the kid is simply never offered it again and nothing says why");
  ok("and it resets it beside the other per cycle counters",
     /cycle_skips_used:\s*0[\s\S]{0,400}cycle_vod_reviews_used:\s*0/.test(src),
     "if it drifts away from cycle_skips_used a later edit can reset one and not the other");

  step("C. teardown");
  await cleanup();
}

async function coachLogin() {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in-coach-password`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: "timothyaugros", password: process.env.DEV_PASSWORD ?? "devpassword123" }),
  });
  if (res.status !== 200) throw new Error(`coach login failed (${res.status}). Run: npm run dev:login`);
  const setc = res.headers.getSetCookie?.() ?? [];
  const c = setc.map((s) => s.split(";")[0]).join("; ");
  if (!c) throw new Error("no coach cookie");
  return c;
}

async function cleanup() {
  for (const id of made.curricula) {
    await db.from("curriculum_slots").delete().eq("curriculum_id", id);
    await db.from("curricula").delete().eq("id", id);
  }
  for (const id of made.subs) await db.from("subscriptions").delete().eq("id", id);
  for (const id of made.players) {
    await db.from("vod_uploads").delete().eq("player_id", id);
    await db.from("players").delete().eq("id", id);
  }
  for (const id of made.parents) await db.from("parents").delete().eq("id", id);
  for (const id of made.families) await db.from("families").delete().eq("id", id);
  for (const id of made.authUsers) await db.auth.admin.deleteUser(id).catch(() => {});
}

main()
  .catch((e) => { failures.push(`suite error: ${e.message}`); console.error(e); })
  .finally(async () => {
    await cleanup().catch(() => {});
    console.log(`\n${passed} passed, ${failures.length} failed`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = failures.length ? 1 : 0;
  });
