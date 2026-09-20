// POST /api/admin/conversion/take-on
//
// Tim's Stage C "Take Jake on" action. Inputs:
//   - player_id (which kid)
//   - personalization_note (2 sentences Tim writes for the parent email)
//
// Behavior (rewritten Phase 3 of the content-to-coaching simplification):
//   1. Insert the `curricula` row with status='pending_approval', a fresh
//      random approval_token, and the personalization_note.
//   2. Insert 4 BARE `curriculum_slots` rows. No lesson, no VOD. A session is
//      a call plus what Tim writes on it afterwards (coach_note +
//      training_routine), so there is nothing to attach up front.
//   3. Send the parent a branded email with a link to
//      /curriculum/<approval_token>.
//
// WHAT THIS USED TO DO, and why it stopped: it inserted one stub `lessons`
// row per non-VOD week so the slot could satisfy the lesson_xor_vod CHECK,
// then Tim was chased to author slides into each stub (the
// lesson_authoring_needed task, removed in the same phase). There is no
// lesson library any more, so a stub row would be a row nothing can ever
// fill.
//
// Phase 3 needed no constraint work, because lesson_xor_vod already permitted
// a bare slot (20260523000000_lesson_xor_vod_allow_tbd added that third state
// for single session purchases). Phase 5 then dropped the constraint and all
// three columns it governed, so a session row is simply a session now.
//
// RLS: coach has full access via *_coach_all policies. The defensive
// coach lookup also catches unauth + non-coach callers early.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { brandedEmailHtml } from "@/lib/email/template";
import { sendBrandedEmail } from "@/lib/email/send";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// The old body carried a 4 week content plan (a kid facing lesson title, a
// parent facing skill translation, and a VOD review flag per week). Phase 3
// stopped reading it and Phase 4 stopped sending it, so it is gone. Zod strips
// unknown keys, so an old client posting `weeks` is accepted and ignored
// rather than rejected. Do not add it back: what a session covers is decided
// on the call.
const BodySchema = z.object({
  player_id: z.string().uuid(),
  personalization_note: z.string().trim().min(1).max(500),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const coachLookup = await supabase
    .from("coaches")
    .select("id, is_active, display_name")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as
    | { id: string; is_active: boolean; display_name: string }
    | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Resolve player + family + parent + latest trial VOD up front.
  const playerLookup = await supabase
    .from("players")
    .select("id, family_id, first_name")
    .eq("id", body.player_id)
    .maybeSingle();
  const player = playerLookup.data as
    | { id: string; family_id: string; first_name: string }
    | null;
  if (!player) {
    return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  }

  const parentLookup = await supabase
    .from("parents")
    .select("first_name, email")
    .eq("family_id", player.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = parentLookup.data as { first_name: string; email: string } | null;
  if (!parent) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }

  const trialVodLookup = await supabase
    .from("vod_uploads")
    .select("url")
    .eq("player_id", player.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  // Read for the log line only. Its former job was to seed a VOD review
  // week's vod_url, and Tim authored VOD reviews are gone. The kid's trial
  // clip itself is KEPT and still matters: it is how Tim prepares for the
  // first call, which is prep, not a deliverable.
  void trialVodLookup;

  // ---- 1. Create the curriculum row --------------------------------------
  // ---- (curriculum row) --------------------------------------
  const approvalToken = crypto.randomBytes(32).toString("hex");
  // waiting_on='PARENT' per backend-spec section 2: Tim sent the plan,
  // parent now needs to approve (and pay).
  const curriculumInsert = await supabase
    .from("curricula")
    .insert({
      player_id: player.id,
      created_by: coach.id,
      status: "pending_approval",
      approval_token: approvalToken,
      personalization_note: body.personalization_note,
      waiting_on: "PARENT",
    } as never)
    .select("id")
    .single();
  const curriculumData = curriculumInsert.data as { id: string } | null;
  if (curriculumInsert.error || !curriculumData) {
    console.error("[take-on] curriculum insert failed", curriculumInsert.error);
    return NextResponse.json({ error: "curriculum_insert_failed" }, { status: 500 });
  }
  const curriculumId = curriculumData.id;

  // ---- 4 bare sessions ---------------------------------------------------
  // A session carries its call time (set later, when the parent schedules)
  // and what Tim writes on it afterwards. There is nothing else to attach.
  //
  // Phase 5 dropped lesson_id, is_vod_review and vod_url, so the three NULLs
  // that used to be written here are gone with the columns. The lesson_xor_vod
  // CHECK they were satisfying went with them too.
  for (let i = 0; i < 4; i++) {
    const slot = await supabase.from("curriculum_slots").insert({
      curriculum_id: curriculumId,
      week_number: i + 1,
    } as never);
    if (slot.error) {
      console.error("[take-on] slot insert failed", slot.error);
      return NextResponse.json({ error: "slot_insert_failed" }, { status: 500 });
    }
  }

  // Flip the subscription off Tim's queue — the ball is in the parent's
  // court now. lifecycle_state advances to TRIAL_DONE (the call happened
  // and Tim made his decision); the curriculum's pending_approval status
  // is the source of truth for "waiting on parent to subscribe."
  const subUpdate = await supabase
    .from("subscriptions")
    .update({
      waiting_on: "SYSTEM",
      lifecycle_state: "TRIAL_DONE",
    } as never)
    .eq("player_id", player.id);
  if (subUpdate.error) {
    console.error("[take-on] subscription waiting_on update failed", subUpdate.error);
    // Non-fatal — the curriculum is written and the email goes out.
    // Tim can manually correct waiting_on if needed.
  }

  // ---- 4. Send conversion email -----------------------------------------
  // Email CTA deep-links into /curriculum/<token>/start, which transitions
  // the lifecycle + signs the parent in + redirects to /portal/sessions in
  // one click. The /curriculum/<token> overview page still exists but is
  // not linked from the email — it became a redundant extra step.
  const approvalUrl = `${APP_URL}/curriculum/${approvalToken}/start`;
  // What the parent is buying, stated as what actually happens. There is no
  // 4 week content plan to preview any more: this used to render one <li> per
  // week with a lesson title and its Hard rule #4 translation, drawn from a
  // `weeks` field that no longer exists. The unit is a coaching SESSION now.
  //
  // Hard rule #4 still applies to every line below, and it is easier to keep
  // here than it was before: describing calls and a routine needs no Fortnite
  // vocabulary at all, so there is nothing to translate.
  //
  // Hard rule #8: no dash characters.
  const whatYouGetHtml = `<ul style="padding-left:18px;">
    <li style="margin-bottom:10px;"><strong>Four coaching calls.</strong> Thirty minutes each, one a week, on Discord. You are welcome to listen in.</li>
    <li style="margin-bottom:10px;"><strong>Personal advice after every call.</strong> I write up what I saw and what to change, in ${escapeHtml(player.first_name)}'s own language.</li>
    <li style="margin-bottom:10px;"><strong>A training routine between calls.</strong> Specific practice to work on, so the week between sessions counts.</li>
    <li style="margin-bottom:10px;"><strong>A plain summary for you.</strong> What each session worked on and why, without the game jargon.</li>
  </ul>`;

  // Inline CTA button — same style as the template's bottom CTA so a
  // pre-sold parent can tap straight from above the fold without
  // scrolling past the billing terms first.
  const inlineCta = `<p style="margin:20px 0;text-align:center;"><a href="${approvalUrl}" style="display:inline-block;background:#C7FF3D;color:#0B1538;padding:14px 26px;border-radius:6px;font-weight:600;text-decoration:none;letter-spacing:0.5px;font-size:15px;">Reserve session times</a></p>`;

  const html = brandedEmailHtml({
    headline: `${player.first_name} is in.`,
    bodyHtml: `<p>Hi ${escapeHtml(parent.first_name)},</p>
<p>Great session with ${escapeHtml(player.first_name)} today. I want to take them on as a student.</p>
<p>The next step is on your end: reserve your first 4 weekly coaching sessions. Once those are on the calendar I'll charge the first cycle and ${escapeHtml(player.first_name)}'s portal will light up.</p>
${inlineCta}
<p><strong>Tim's Note:</strong> ${escapeHtml(body.personalization_note)}</p>
<p>Here is what you get:</p>
${whatYouGetHtml}
<p>It is $56 for 4 sessions, one a week. Cancel any time. Up to 2 cancellations per 4 session cycle. A 3rd cancel ends the subscription.</p>
<p style="margin-top:24px;">Talk soon,<br/>${escapeHtml(coach.display_name)}<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
    ctaLabel: "Reserve session times",
    ctaHref: approvalUrl,
  });

  const emailResult = await sendBrandedEmail({
    to: parent.email,
    subject: `Congratulations, you are in`,
    html,
    trigger: "stage_c_take_on",
    recipientType: "parent",
    relatedEntityType: "curriculum",
    relatedEntityId: curriculumId,
  });
  if (!emailResult.ok) {
    // The curriculum is written; the email is the discoverability channel.
    // Log + return ok-with-warning so Tim can manually share the link
    // if the email send fails.
    return NextResponse.json({
      ok: true,
      warning: "email_send_failed",
      approval_url: approvalUrl,
    });
  }

  return NextResponse.json({ ok: true, approval_url: approvalUrl });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
