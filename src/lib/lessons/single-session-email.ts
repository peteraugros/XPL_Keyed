// $24 single coaching session post-payment email. Fired by the Stripe
// webhook's checkout.session.completed handler when metadata.kind ===
// 'single_session'. Sends the parent a magic-link email pointing at
// /portal/sessions where the SchedulerWizard handles the one-slot
// booking.

import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendParentMagicLink } from "@/lib/supabase/auth";

type PlayerLookup = { family_id: string; first_name: string };
type ParentLookup = { email: string; first_name: string };

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function sendSingleSessionPaidEmail(subscriptionId: string) {
  const supabase = createServiceRoleClient();

  // Resolve subscription → player → family → parent.
  const subResp = await supabase
    .from("subscriptions")
    .select("player_id")
    .eq("id", subscriptionId)
    .maybeSingle();
  const sub = subResp.data as { player_id: string } | null;
  if (!sub) {
    console.warn("[single-session-email] subscription not found", subscriptionId);
    return;
  }

  const playerResp = await supabase
    .from("players")
    .select("family_id, first_name")
    .eq("id", sub.player_id)
    .maybeSingle();
  const player = playerResp.data as PlayerLookup | null;
  if (!player) {
    console.warn("[single-session-email] player not found", sub.player_id);
    return;
  }

  const parentResp = await supabase
    .from("parents")
    .select("email, first_name")
    .eq("family_id", player.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = parentResp.data as ParentLookup | null;
  if (!parent) {
    console.warn(
      "[single-session-email] parent not found for family",
      player.family_id,
    );
    return;
  }

  // Lesson label from the single slot. Two-step lookup keeps the typing
  // shape simple (Supabase JS's nested embed types are fragile through
  // curricula!inner filters). At our scale the extra round trip is fine.
  // `curriculum_type` was added by migration 0200 but isn't in the
  // regenerated TS types yet (next gen:types run will tighten this).
  // Cast the column name through `as never` until then.
  const curriculumResp = await supabase
    .from("curricula")
    .select("id")
    .eq("player_id", sub.player_id)
    .eq("curriculum_type" as never, "single_session")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curr = curriculumResp.data as { id: string } | null;
  let lessonLabel = "your single session";
  if (curr) {
    const slotResp = await supabase
      .from("curriculum_slots")
      .select("lesson_id")
      .eq("curriculum_id", curr.id)
      .limit(1)
      .maybeSingle();
    const slot = slotResp.data as { lesson_id: string | null } | null;
    if (slot?.lesson_id) {
      const lessonResp = await supabase
        .from("lessons")
        .select("parent_label")
        .eq("id", slot.lesson_id)
        .maybeSingle();
      const lesson = lessonResp.data as { parent_label: string } | null;
      if (lesson?.parent_label) lessonLabel = lesson.parent_label;
    }
  }

  const headline = `${escapeHtml(player.first_name)}'s session is paid`;
  const bodyHtml = `<p>Hi ${escapeHtml(parent.first_name)},</p>
<p>Payment received. ${escapeHtml(player.first_name)}'s single coaching session is on the books.</p>
<p>Topic: <strong>${escapeHtml(lessonLabel)}</strong>.</p>
<p>Last step: pick the time that works. Tap below to sign in and open the scheduling page. Sessions run on Discord; Tim will send the server invite to ${escapeHtml(player.first_name)}'s Discord handle before the call.</p>
<p style="font-size:13px;color:rgba(255,255,255,0.6);">After the call, the lesson slides and voiceover land in the player view so ${escapeHtml(player.first_name)} can review.</p>`;

  const result = await sendParentMagicLink(supabase, parent.email, {
    next: "/portal/sessions",
    subject: `${player.first_name}'s single session is paid. Last step: pick a time.`,
    headline,
    bodyHtml,
    ctaLabel: "Pick the time",
  });

  if (!result.ok) {
    // Was silently swallowed before. Log loudly so Railway captures
    // it and we know whether the issue is parent lookup, magic-link
    // generation, or the actual Resend send.
    console.error(
      "[single-session-email] sendParentMagicLink failed",
      {
        subscriptionId,
        parentEmail: parent.email,
        code: result.code,
      },
    );
  } else {
    console.log(
      "[single-session-email] magic link sent",
      { subscriptionId, parentEmail: parent.email },
    );
  }
}
