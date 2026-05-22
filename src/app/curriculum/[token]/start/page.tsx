// /curriculum/[token]/start
//
// Deep-link target for the acceptance email CTA. The email already
// shows the curriculum + terms, so this skips the duplicate preview
// and drops the parent into their dashboard with a celebratory
// "Onboarding complete" banner — from there they navigate to
// /portal/sessions to schedule when ready. The hard handoff to the
// scheduler page used to happen directly here; user research said
// that felt jarring without a "you did it" landing.
//
// What this Server Component does on GET:
//   1. Validate the token + look up the curriculum.
//   2. Resolve curriculum -> player -> family -> parent + subscription.
//   3. Transition lifecycle to ACCEPTED_PENDING_SCHEDULING (idempotent —
//      skip if already past TRIAL_DONE).
//   4. Generate a Supabase magic link to /portal?just_accepted=1.
//   5. redirect() to that magic-link URL.
//
// Net effect: one click in the email -> signed in on /portal with a
// "Congratulations / Onboarding complete" celebration banner.

import { redirect } from "next/navigation";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

const SCHEDULING_STATES = new Set([
  "ACCEPTED_PENDING_SCHEDULING",
  "SCHEDULING_IN_PROGRESS",
  "PENDING_PAYMENT",
  "ACTIVE",
]);

type CurriculumLookup = { id: string; status: string; player_id: string };
type PlayerLookup = { id: string; family_id: string };
type ParentLookup = { id: string; email: string };
type SubscriptionLookup = { id: string; lifecycle_state: string };

export default async function CurriculumStartPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!token || token.length < 32) {
    redirect(`/curriculum/${token}` as never);
  }

  const supabase = createServiceRoleClient();

  // Same lookup chain as /api/curriculum/[token]/approve.
  const curriculumLookup = await supabase
    .from("curricula")
    .select("id, status, player_id")
    .eq("approval_token", token)
    .maybeSingle();
  const curriculum = curriculumLookup.data as CurriculumLookup | null;
  if (!curriculum) {
    // Bad token. Send to login as a safe fallback.
    redirect("/login?error=curriculum_not_found" as never);
  }

  // Already past pending approval. Send the parent to their dashboard.
  if (curriculum.status !== "pending_approval") {
    redirect("/portal" as never);
  }

  const playerLookup = await supabase
    .from("players")
    .select("id, family_id")
    .eq("id", curriculum.player_id)
    .maybeSingle();
  const player = playerLookup.data as PlayerLookup | null;
  if (!player) redirect("/login?error=player_not_found" as never);

  const parentLookup = await supabase
    .from("parents")
    .select("id, email")
    .eq("family_id", player.family_id)
    .maybeSingle();
  const parent = parentLookup.data as ParentLookup | null;
  if (!parent) redirect("/login?error=parent_not_found" as never);

  const subscriptionLookup = await supabase
    .from("subscriptions")
    .select("id, lifecycle_state")
    .eq("player_id", player.id)
    .maybeSingle();
  const subscription = subscriptionLookup.data as SubscriptionLookup | null;
  if (!subscription) redirect("/login?error=subscription_not_found" as never);

  // Idempotent lifecycle transition. Don't step backwards if the parent
  // has already moved past acceptance.
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
      console.error("[curriculum/start] subscription update failed", subUpdate.error);
      redirect("/login?error=lifecycle_update_failed" as never);
    }
  }

  // Generate magic link redirecting to /portal with the just-accepted
  // flag so the dashboard shows the "Onboarding complete" celebration
  // banner instead of the pre-acceptance "Review the plan" copy.
  const linkResult = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: parent.email,
    options: { redirectTo: `${APP_URL}/auth/callback?next=/portal?just_accepted=1` },
  });
  if (linkResult.error || !linkResult.data.properties?.action_link) {
    console.error("[curriculum/start] generateLink failed", linkResult.error);
    redirect("/login?error=generate_link_failed&next=/portal" as never);
  }

  redirect(linkResult.data.properties.action_link as never);
}
