// Immediate Week 1 lesson delivery. Called from the Stripe webhook on
// checkout.session.completed when shouldDeliverWeek1Immediately is true.
//
// Mirrors the Sunday cron's per-subscription delivery flow but Node-side
// + scoped to a single curriculum_slot. Idempotent: filters by
// delivered_at IS NULL so re-triggering is safe (the Sunday cron uses
// the same guard).

import { brandedEmailHtml } from "@/lib/email/template";
import { sendBrandedEmail } from "@/lib/email/send";
import { createServiceRoleClient } from "@/lib/supabase/server";

type TalkingPoint = { category?: string; text: string };

type SlotLookup = {
  id: string;
  week_number: number;
  is_vod_review: boolean;
  lesson_id: string | null;
  vod_url: string | null;
  vod_talking_points: TalkingPoint[] | null;
};
type LessonLookup = {
  parent_label: string;
  parent_skill_description: string;
  fortnite_label: string;
  parent_talking_points: TalkingPoint[] | null;
};
type SubscriptionLookup = {
  id: string;
  cycle_lessons_delivered: number;
  player_id: string;
};
type PlayerLookup = { first_name: string; family_id: string };
type ParentLookup = { email: string };

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const SIGNATURE = `<p style="margin-top:24px;">Talk soon,<br/>Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`;

function renderLessonEmail(opts: {
  kidName: string;
  parentLabel: string;
  parentSkillDescription: string;
  fortniteLabel: string;
  talkingPoints: TalkingPoint[];
  portalUrl: string;
}): string {
  const bullets = opts.talkingPoints
    .map((tp) => `<li style="margin:8px 0;"><em>"${tp.text}"</em></li>`)
    .join("");
  return brandedEmailHtml({
    headline: `${opts.kidName}'s lesson is ready`,
    bodyHtml: `<p>This week's lesson for ${opts.kidName} is ready in the portal.</p><p><strong>${opts.parentLabel}.</strong> ${opts.parentSkillDescription}. <em>(Fortnite term: ${opts.fortniteLabel}.)</em></p><h2 style="font-family:'Anton',Impact,sans-serif;font-size:18px;letter-spacing:1px;margin:28px 0 8px;color:#C7FF3D;">🤫 For your back pocket</h2><ul style="margin:0;padding-left:20px;">${bullets}</ul>${SIGNATURE}`,
    ctaLabel: "Open lesson",
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
    bodyHtml: `<p>This week I reviewed ${opts.kidName}'s own gameplay frame by frame. The breakdown is in the portal.</p><h2 style="font-family:'Anton',Impact,sans-serif;font-size:18px;letter-spacing:1px;margin:28px 0 8px;color:#C7FF3D;">🤫 For your back pocket</h2><ul style="margin:0;padding-left:20px;">${bullets}</ul>${SIGNATURE}`,
    ctaLabel: "Open VOD review",
    ctaHref: opts.portalUrl,
  });
}

export async function deliverWeekOneImmediately(
  subscriptionId: string,
): Promise<{ ok: true; delivered_slot_id: string } | { ok: false; reason: string }> {
  const supabase = createServiceRoleClient();

  const subResp = await supabase
    .from("subscriptions")
    .select("id, cycle_lessons_delivered, player_id")
    .eq("id", subscriptionId)
    .maybeSingle();
  const sub = subResp.data as SubscriptionLookup | null;
  if (!sub) return { ok: false, reason: "subscription_not_found" };

  const playerResp = await supabase
    .from("players")
    .select("first_name, family_id")
    .eq("id", sub.player_id)
    .maybeSingle();
  const player = playerResp.data as PlayerLookup | null;
  if (!player) return { ok: false, reason: "player_not_found" };

  const parentResp = await supabase
    .from("parents")
    .select("email")
    .eq("family_id", player.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = parentResp.data as ParentLookup | null;
  if (!parent) return { ok: false, reason: "parent_not_found" };

  const curriculumResp = await supabase
    .from("curricula")
    .select("id")
    .eq("player_id", sub.player_id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curriculum = curriculumResp.data as { id: string } | null;
  if (!curriculum) return { ok: false, reason: "no_active_curriculum" };

  const slotResp = await supabase
    .from("curriculum_slots")
    .select(
      "id, week_number, is_vod_review, lesson_id, vod_url, vod_talking_points",
    )
    .eq("curriculum_id", curriculum.id)
    .is("delivered_at", null)
    .order("week_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  const slot = slotResp.data as SlotLookup | null;
  if (!slot) return { ok: false, reason: "no_undelivered_slot" };

  // Render. VOD-review slots use the kid's clip; regular slots use the
  // lesson row.
  let html: string;
  if (slot.is_vod_review) {
    html = renderVodEmail({
      kidName: player.first_name,
      talkingPoints: (slot.vod_talking_points ?? []) as TalkingPoint[],
      portalUrl: `${APP_URL}/portal`,
    });
  } else if (slot.lesson_id) {
    const lessonResp = await supabase
      .from("lessons")
      .select(
        "parent_label, parent_skill_description, fortnite_label, parent_talking_points",
      )
      .eq("id", slot.lesson_id)
      .maybeSingle();
    const lesson = lessonResp.data as LessonLookup | null;
    if (!lesson) return { ok: false, reason: "lesson_not_found" };
    html = renderLessonEmail({
      kidName: player.first_name,
      parentLabel: lesson.parent_label,
      parentSkillDescription: lesson.parent_skill_description,
      fortniteLabel: lesson.fortnite_label,
      talkingPoints: (lesson.parent_talking_points ?? []) as TalkingPoint[],
      portalUrl: `${APP_URL}/portal`,
    });
  } else {
    return { ok: false, reason: "slot_has_no_lesson_or_vod" };
  }

  const r = await sendBrandedEmail({
    to: parent.email,
    subject: `${player.first_name}'s week ${slot.week_number} lesson is ready`,
    html,
    trigger: "lesson_delivery_week1",
    recipientType: "parent",
    relatedEntityType: "curriculum_slot",
    relatedEntityId: slot.id,
  });
  if (!r.ok) {
    return { ok: false, reason: "send_failed" };
  }

  const stamp = new Date().toISOString();
  await supabase
    .from("curriculum_slots")
    .update({ delivered_at: stamp } as never)
    .eq("id", slot.id);
  await supabase
    .from("subscriptions")
    .update({ cycle_lessons_delivered: (sub.cycle_lessons_delivered ?? 0) + 1 } as never)
    .eq("id", sub.id);

  return { ok: true, delivered_slot_id: slot.id };
}
