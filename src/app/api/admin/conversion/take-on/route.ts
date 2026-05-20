// POST /api/admin/conversion/take-on
//
// Tim's Stage C "Take Jake on" action. Inputs:
//   - player_id (which kid)
//   - personalization_note (2 sentences Tim writes for the parent email)
//   - 4 weeks, each with:
//       - kid_facing_title (Fortnite term, e.g. "Tunneling")
//       - parent_facing_skill (translation, e.g. "Defensive building under pressure")
//       - is_vod_review (bool)
//
// Behavior:
//   1. Insert one stub `lessons` row per non-VOD week (Tim authors real
//      slides + talking points later; the curriculum can ship a paid Sunday
//      delivery with a stub blocking the parent's approval, but the bigger
//      gate is parent approval + Stripe payment which gives Tim time).
//   2. Insert the `curricula` row with status='pending_approval', a fresh
//      random approval_token, and the personalization_note.
//   3. Insert 4 `curriculum_slots` rows honoring the lesson_xor_vod CHECK
//      constraint: regular weeks point at the stub lesson; VOD weeks set
//      is_vod_review=true + vod_url (defaults to the kid's latest trial
//      VOD if one exists; Tim can override later) + vod_talking_points=[].
//   4. Send the parent a branded "Your custom curriculum is ready" email
//      with a link to /curriculum/<approval_token>.
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

const WeekSchema = z.object({
  kid_facing_title: z.string().trim().min(1).max(120),
  parent_facing_skill: z.string().trim().min(1).max(240),
  is_vod_review: z.boolean(),
});

const BodySchema = z.object({
  player_id: z.string().uuid(),
  personalization_note: z.string().trim().min(1).max(500),
  weeks: z.array(WeekSchema).length(4),
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
  const trialVodUrl = (trialVodLookup.data as { url: string } | null)?.url ?? null;

  // ---- 1. Create stub lesson rows for the non-VOD weeks ------------------
  const stubLessonIds: (string | null)[] = [null, null, null, null];
  for (let i = 0; i < 4; i++) {
    const week = body.weeks[i];
    if (week.is_vod_review) continue;
    const stub = await supabase
      .from("lessons")
      .insert({
        author_id: coach.id,
        title: `${player.first_name} W${i + 1}: ${week.kid_facing_title}`,
        fortnite_label: week.kid_facing_title,
        parent_label: week.parent_facing_skill,
        parent_skill_description: week.parent_facing_skill,
        topic: "game_sense",
        difficulty_level: "intermediate",
        duration_minutes: 30,
        slides: [],
        parent_talking_points: [],
        is_published: false,
      } as never)
      .select("id")
      .single();
    const stubData = stub.data as { id: string } | null;
    if (stub.error || !stubData) {
      console.error("[take-on] stub lesson insert failed", stub.error);
      return NextResponse.json({ error: "lesson_insert_failed" }, { status: 500 });
    }
    stubLessonIds[i] = stubData.id;
  }

  // ---- 2. Create the curriculum row --------------------------------------
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

  // ---- 3. Create 4 curriculum_slots -------------------------------------
  // The lesson_xor_vod CHECK constraint requires lesson_id XOR vod_url.
  // VOD weeks default vod_url to the trial VOD if we have one (Tim can
  // override later). Without a trial VOD, fall back to a placeholder so
  // the insert satisfies NOT NULL; Tim sees the placeholder in admin and
  // updates the slot before that week is delivered.
  const VOD_PLACEHOLDER = "https://xplkeyed.com/admin/needs-vod";
  for (let i = 0; i < 4; i++) {
    const week = body.weeks[i];
    const slotPayload: Record<string, unknown> = {
      curriculum_id: curriculumId,
      week_number: i + 1,
      is_vod_review: week.is_vod_review,
    };
    if (week.is_vod_review) {
      slotPayload.lesson_id = null;
      slotPayload.vod_url = trialVodUrl ?? VOD_PLACEHOLDER;
      slotPayload.vod_talking_points = [];
    } else {
      slotPayload.lesson_id = stubLessonIds[i];
      slotPayload.vod_url = null;
    }
    const slot = await supabase
      .from("curriculum_slots")
      .insert(slotPayload as never);
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
  const weeksHtml = body.weeks
    .map((w, i) => {
      const skill = w.is_vod_review
        ? `Review and break down ${player.first_name}'s game clip together.`
        : `${escapeHtml(w.parent_facing_skill)}`;
      const fortniteTerm = w.is_vod_review
        ? "VOD review"
        : escapeHtml(w.kid_facing_title);
      return `<li style="margin-bottom:10px;">
        <strong>Week ${i + 1}.</strong> ${skill}
        <em style="color:rgba(255,255,255,0.55);"> (Fortnite term: ${fortniteTerm}.)</em>
      </li>`;
    })
    .join("");

  // Inline CTA button — same style as the template's bottom CTA so a
  // pre-sold parent can tap straight from above the fold without
  // scrolling past the curriculum + billing terms first.
  const inlineCta = `<p style="margin:20px 0;text-align:center;"><a href="${approvalUrl}" style="display:inline-block;background:#C7FF3D;color:#0B1538;padding:14px 26px;border-radius:6px;font-weight:600;text-decoration:none;letter-spacing:0.5px;font-size:15px;">Reserve lesson times</a></p>`;

  const html = brandedEmailHtml({
    headline: `${player.first_name} is in.`,
    bodyHtml: `<p>Hi ${escapeHtml(parent.first_name)},</p>
<p>Great session with ${escapeHtml(player.first_name)} today. I want to take them on as a student.</p>
<p>The next step is on your end: reserve your first 4 weekly coaching sessions. Once those are on the calendar I'll charge the first cycle and ${escapeHtml(player.first_name)}'s portal will light up with everything.</p>
${inlineCta}
<p>It is $56 for 4 lessons (one per week). Cancel any time. Up to 2 cancellations per 4 lesson cycle. A 3rd cancel ends the subscription.</p>
<p><strong>Tim's Note:</strong> ${escapeHtml(body.personalization_note)}</p>
<p>Here is the 4 week plan I drafted specifically for ${escapeHtml(player.first_name)}:</p>
<ul style="padding-left:18px;">${weeksHtml}</ul>
<p style="margin-top:24px;">Talk soon,<br/>${escapeHtml(coach.display_name)}<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
    ctaLabel: "Reserve lesson times",
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
