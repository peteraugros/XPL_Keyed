// POST /api/curriculum/[token]/approve
//
// Phase 2 entry point for the post-acceptance flow. Replaces the Stripe
// checkout call that used to fire from the curriculum approval page.
//
// What this does:
//   1. Validate the token + curriculum is pending_approval.
//   2. Transition the family's subscription to lifecycle_state=
//      ACCEPTED_PENDING_SCHEDULING, set scheduling_started_at=NOW(),
//      waiting_on='PARENT'.
//   3. Generate a Supabase magic link for the parent that redirects to
//      /portal/sessions with the session cookie set.
//   4. Return { redirect_url } so the client can browser-redirect into
//      the signed-in scheduling surface.
//
// Curricula.status stays 'pending_approval' until payment lands at the
// end of /portal/sessions. The lifecycle_state is the canonical signal
// for "where in the conversion funnel is this family right now."

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type CurriculumLookup = { id: string; status: string; player_id: string };
type PlayerLookup = { id: string; family_id: string };
type ParentLookup = { id: string; email: string };
type SubscriptionLookup = { id: string; lifecycle_state: string };

// Lifecycle states where the parent has already started the scheduling
// flow. Re-clicking the email link should resume them, not reset.
const SCHEDULING_STATES = new Set([
  "ACCEPTED_PENDING_SCHEDULING",
  "SCHEDULING_IN_PROGRESS",
  "PENDING_PAYMENT",
  "ACTIVE",
]);

export async function POST(
  _req: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params;
  if (!token || token.length < 32) {
    return NextResponse.json({ error: "invalid_token" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // ---- 1. Resolve curriculum + everything we need --------------------------
  const curriculumLookup = await supabase
    .from("curricula")
    .select("id, status, player_id")
    .eq("approval_token", token)
    .maybeSingle();
  const curriculum = curriculumLookup.data as CurriculumLookup | null;
  if (!curriculum) {
    return NextResponse.json({ error: "curriculum_not_found" }, { status: 404 });
  }
  if (curriculum.status !== "pending_approval") {
    // Already approved or stale token. Send the parent to /portal where
    // their current state will render correctly.
    return NextResponse.json({
      redirect_url: `${APP_URL}/portal`,
      already_approved: true,
    });
  }

  const playerLookup = await supabase
    .from("players")
    .select("id, family_id")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerLookup.data as PlayerLookup | null;
  if (!player) {
    return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  }

  const parentLookup = await supabase
    .from("parents")
    .select("id, email")
    .eq("family_id", player.family_id)
    .maybeSingle();
  const parent = parentLookup.data as ParentLookup | null;
  if (!parent) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }

  const subscriptionLookup = await supabase
    .from("subscriptions")
    .select("id, lifecycle_state")
    .eq("player_id", player.id)
    .maybeSingle();
  const subscription = subscriptionLookup.data as SubscriptionLookup | null;
  if (!subscription) {
    return NextResponse.json({ error: "subscription_not_found" }, { status: 404 });
  }

  // ---- 2. Idempotent lifecycle transition ----------------------------------
  // If the parent has already started the scheduling flow, skip the
  // lifecycle reset (would step backwards from SCHEDULING_IN_PROGRESS to
  // ACCEPTED_PENDING_SCHEDULING). Generate the magic link and resume.
  if (!SCHEDULING_STATES.has(subscription.lifecycle_state)) {
    const stamp = new Date().toISOString();
    const subUpdate = await supabase
      .from("subscriptions")
      .update({
        lifecycle_state: "ACCEPTED_PENDING_SCHEDULING",
        waiting_on: "PARENT",
        scheduling_started_at: stamp,
      } as never)
      .eq("id", subscription.id);
    if (subUpdate.error) {
      console.error("[curriculum/approve] subscription update failed", subUpdate.error);
      return NextResponse.json({ error: "lifecycle_update_failed" }, { status: 500 });
    }
  }

  // ---- 3. Generate a magic link signed in as the parent --------------------
  const linkResult = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: parent.email,
    options: { redirectTo: `${APP_URL}/auth/callback?next=/portal/sessions` },
  });
  if (linkResult.error || !linkResult.data.properties?.action_link) {
    console.error("[curriculum/approve] generateLink failed", linkResult.error);
    return NextResponse.json({ error: "generate_link_failed" }, { status: 502 });
  }

  return NextResponse.json({
    redirect_url: linkResult.data.properties.action_link,
  });
}
