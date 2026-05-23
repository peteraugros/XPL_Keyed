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

// "Wednesday, May 27 at 4:00pm" — lowercased am/pm to match the rest of
// the parent-facing surfaces. Server timezone, matching how /portal
// renders the same field.
function formatCallDateTime(iso: string): string {
  const d = new Date(iso);
  const datePart = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(d);
  const timeRaw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
  const timePart = timeRaw.replace(/\s?(AM|PM)/i, (_m, ap: string) =>
    ap.toLowerCase(),
  );
  return `${datePart} at ${timePart}`;
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

  // Resolve the single curriculum + its slot. The slot's live_call_at
  // was populated by the Calendly webhook BEFORE Stripe ran (new
  // pre-pay-schedule order). lesson_id is NULL — Tim assigns it after
  // payment via the existing admin lesson-swap UI.
  const curriculumResp = await supabase
    .from("curricula")
    .select("id")
    .eq("player_id", sub.player_id)
    .eq("curriculum_type" as never, "single_session")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curr = curriculumResp.data as { id: string } | null;
  let callAtIso: string | null = null;
  if (curr) {
    const slotResp = await supabase
      .from("curriculum_slots")
      .select("live_call_at")
      .eq("curriculum_id", curr.id)
      .limit(1)
      .maybeSingle();
    const slot = slotResp.data as { live_call_at: string | null } | null;
    callAtIso = slot?.live_call_at ?? null;
  }

  const callDateTime = callAtIso ? formatCallDateTime(callAtIso) : null;

  const headline = callDateTime
    ? `${escapeHtml(player.first_name)}'s session is locked in`
    : `${escapeHtml(player.first_name)}'s session is paid`;
  const bodyHtml = `<p>Hi ${escapeHtml(parent.first_name)},</p>
<p>Payment received. ${escapeHtml(player.first_name)}'s single coaching session is locked in${callDateTime ? ` for <strong>${escapeHtml(callDateTime)}</strong>` : ""}.</p>
<p>The call happens on Discord. Tim will send ${escapeHtml(player.first_name)} the XPL Keyed server invite before we start.</p>
<p>Tap below to open your dashboard. The session details, your intake note, and the message thread with Tim live there.</p>
<p style="font-size:13px;color:rgba(255,255,255,0.6);">After the call, the lesson slides and voiceover land in the player view so ${escapeHtml(player.first_name)} can review.</p>`;

  const result = await sendParentMagicLink(supabase, parent.email, {
    next: "/portal",
    subject: callDateTime
      ? `${player.first_name}'s session is set for ${callDateTime}`
      : `${player.first_name}'s session is paid`,
    headline,
    bodyHtml,
    ctaLabel: "Open dashboard",
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
