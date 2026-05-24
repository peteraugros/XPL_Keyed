// Edge Function — sunday_lesson_delivery
//
// Fired Sundays at 13:00 UTC by pg_cron. Per CLAUDE.md "Stage C conversion":
// each active subscription with an approved curriculum gets one lesson per
// Sunday, in order. The parent receives a branded email with the translation
// pair (parent skill first, Fortnite term in italicized parens) plus the
// "For your back pocket" talking points section.
//
// Pause conditions (skip without advancing cycle):
//   * subscription.status != 'active' (past_due / pending_cancel / canceled)
//   * no active curriculum for the player (parent hasn't approved next plan)
//   * the slot has a coach_cancel row (Tim is out)
//
// Per CLAUDE.md "Billing cycle for monthly tier is every 4 lessons, NOT every
// 30 days." When cycle_lessons_delivered hits 4, the Stripe billing trigger
// fires the next $56 charge — handled by the Stripe layer, not here. This
// function only delivers the lesson and increments the counter.
//
// TODOs flagged inline:
//   * Real HTML email template (lesson images / audio links)
//   * Trigger Stripe to bill next cycle when counter hits 4
//   * VOD-week branch (slot.is_vod_review) renders different body

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmailWithLog, brandedEmailHtml } from "../_shared/resend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const NEXT_PUBLIC_APP_URL = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "https://xplkeyed.com";

interface TalkingPoint {
  category: string;
  text: string;
}

function renderLessonEmail(opts: {
  kidName: string;
  parentLabel: string;
  parentSkillDescription: string;
  fortniteLabel: string;
  talkingPoints: TalkingPoint[];
  videoUrl: string;
  portalUrl: string;
}): string {
  const bullets = opts.talkingPoints
    .map((tp) => `<li style="margin:8px 0;"><em>"${tp.text}"</em></li>`)
    .join("");
  return brandedEmailHtml({
    headline: `${opts.kidName}'s lesson is ready`,
    bodyHtml: `<p>This week's lesson for ${opts.kidName} is up. The video is 3 to 5 minutes; the talking points below are for you.</p><p><strong>${opts.parentLabel}.</strong> ${opts.parentSkillDescription}. <em>(Fortnite term: ${opts.fortniteLabel}.)</em></p><p style="text-align:center;margin:22px 0;"><a href="${opts.videoUrl}" style="display:inline-block;background:#C7FF3D;color:#0B1538;padding:14px 22px;border-radius:6px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">Watch this week's lesson</a></p><h2 style="font-family:'Anton',Impact,sans-serif;font-size:18px;letter-spacing:1px;margin:28px 0 8px;color:#C7FF3D;">🤫 For your back pocket</h2><ul style="margin:0;padding-left:20px;">${bullets}</ul><p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
    ctaLabel: "Open dashboard",
    ctaHref: opts.portalUrl,
  });
}

function renderVodEmail(opts: {
  kidName: string;
  talkingPoints: TalkingPoint[];
  portalUrl: string;
}): string {
  const bullets = opts.talkingPoints
    .map((tp) => `<li style="margin:8px 0;"><em>"${tp.text}"</em></li>`)
    .join("");
  return brandedEmailHtml({
    headline: `${opts.kidName}'s VOD review is ready`,
    bodyHtml: `<p>This week I reviewed ${opts.kidName}'s own gameplay frame by frame. The breakdown is in the portal.</p><h2 style="font-family:'Anton',Impact,sans-serif;font-size:18px;letter-spacing:1px;margin:28px 0 8px;color:#C7FF3D;">🤫 For your back pocket</h2><ul style="margin:0;padding-left:20px;">${bullets}</ul><p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
    ctaLabel: "Open VOD review",
    ctaHref: opts.portalUrl,
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const stamp = new Date().toISOString();

  // Active subscriptions only. Past_due / pending_cancel / canceled all skip
  // delivery (the cycle freezes per dunning + cancel policies).
  const { data: subs, error: subsError } = await supabase
    .from("subscriptions")
    .select(
      "id, player_id, cycle_lessons_delivered, players(first_name, family_id, families(parents(email)))",
    )
    .eq("status", "active");

  if (subsError) return new Response(subsError.message, { status: 500 });
  if (!subs?.length) return new Response("no_active_subs", { status: 200 });

  let delivered = 0;
  let skipped = 0;
  const skipReasons: Record<string, number> = {};

  for (const sub of subs) {
    // deno-lint-ignore no-explicit-any
    const player = (sub as any).players;
    const parentEmail = player?.families?.parents?.[0]?.email;
    const kidName = player?.first_name ?? "your kid";
    if (!parentEmail) {
      skipped++;
      skipReasons["no_parent_email"] = (skipReasons["no_parent_email"] ?? 0) + 1;
      continue;
    }

    // Find the active curriculum for this player.
    const { data: curr } = await supabase
      .from("curricula")
      .select("id")
      .eq("player_id", sub.player_id)
      .eq("status", "active")
      .maybeSingle();

    if (!curr) {
      skipped++;
      skipReasons["no_active_curriculum"] = (skipReasons["no_active_curriculum"] ?? 0) + 1;
      continue;
    }

    // Next undelivered slot, lowest week_number first.
    const { data: slot } = await supabase
      .from("curriculum_slots")
      .select(
        "id, week_number, is_vod_review, lesson_id, vod_url, vod_talking_points, lessons(parent_label, parent_skill_description, fortnite_label, parent_talking_points, video_url, is_published)",
      )
      .eq("curriculum_id", curr.id)
      .is("delivered_at", null)
      .order("week_number", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!slot) {
      skipped++;
      skipReasons["curriculum_complete"] = (skipReasons["curriculum_complete"] ?? 0) + 1;
      continue;
    }

    // Skip if Tim has cancelled this slot.
    const { data: coachCancel } = await supabase
      .from("coach_cancels")
      .select("id")
      .eq("curriculum_slot_id", slot.id)
      .limit(1)
      .maybeSingle();

    if (coachCancel) {
      skipped++;
      skipReasons["coach_cancel"] = (skipReasons["coach_cancel"] ?? 0) + 1;
      continue;
    }

    // Render + send.
    let html: string;
    if (slot.is_vod_review) {
      const vodPoints = (slot.vod_talking_points ?? []) as TalkingPoint[];
      html = renderVodEmail({
        kidName,
        talkingPoints: vodPoints,
        portalUrl: `${NEXT_PUBLIC_APP_URL}/parent/lessons/${slot.id}`,
      });
    } else {
      // deno-lint-ignore no-explicit-any
      const lesson = (slot as any).lessons;
      if (!lesson) {
        skipped++;
        skipReasons["missing_lesson_row"] = (skipReasons["missing_lesson_row"] ?? 0) + 1;
        continue;
      }
      // Video-first lessons require video_url + is_published. Slide-era
      // rows or unpublished drafts skip and surface as "missing video"
      // in admin so Tim catches them before the next Sunday.
      if (!lesson.video_url || !String(lesson.video_url).trim() || !lesson.is_published) {
        skipped++;
        skipReasons["lesson_missing_video"] = (skipReasons["lesson_missing_video"] ?? 0) + 1;
        continue;
      }
      const tps = (lesson.parent_talking_points ?? []) as TalkingPoint[];
      html = renderLessonEmail({
        kidName,
        parentLabel: lesson.parent_label,
        parentSkillDescription: lesson.parent_skill_description,
        fortniteLabel: lesson.fortnite_label,
        talkingPoints: tps,
        videoUrl: String(lesson.video_url).trim(),
        portalUrl: `${NEXT_PUBLIC_APP_URL}/portal`,
      });
    }

    await sendEmailWithLog({
      apiKey: RESEND_API_KEY,
      defaultFrom: RESEND_FROM_EMAIL,
      supabase,
      to: parentEmail,
      subject: `${kidName}'s week ${slot.week_number} lesson is ready`,
      html,
      trigger: "sunday_lesson_delivery",
      recipientType: "parent",
      relatedEntityType: "curriculum_slot",
      relatedEntityId: slot.id,
    });

    // Mark slot delivered, increment cycle counter.
    await supabase
      .from("curriculum_slots")
      .update({ delivered_at: stamp })
      .eq("id", slot.id);
    await supabase
      .from("subscriptions")
      .update({ cycle_lessons_delivered: (sub.cycle_lessons_delivered ?? 0) + 1 })
      .eq("id", sub.id);

    // TODO: when cycle_lessons_delivered + 1 === 4, trigger Stripe to charge
    // the next $56 cycle and reset cycle_lessons_delivered + cycle_cancels_used.
    // Belongs in the Stripe layer (next coding task #3).

    delivered++;
  }

  return new Response(
    JSON.stringify({ delivered, skipped, skipReasons }),
    { headers: { "Content-Type": "application/json" } },
  );
});
