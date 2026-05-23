// /single-session
//
// $24 single coaching session checkout flow. One-page form (no
// gamified levels — this is a transactional purchase, not onboarding).
// Reuses the existing pending_intake_verifications table for the
// under-13 COPPA gate, same as /intake.
//
// Flow:
//   1. Parent lands here, sees lesson catalog + intake form.
//   2. Fills kid + parent fields, picks a lesson.
//   3. Submits → /api/single-session/submit:
//      - If kid age < 13 and not verified: creates a verification
//        row, emails parent, returns "check your email" state.
//        Parent clicks email link → /single-session/verify?t=<token>
//        → redirects back to /single-session?verified=<intake_id>.
//      - If verified or 13+: creates family/parent/player/subscription/
//        curriculum/slot, creates Stripe Checkout session, returns
//        URL. Client redirects to Stripe.
//   4. Stripe Checkout success → /single-session/success.
//   5. Stripe webhook flips lifecycle to SCHEDULING_IN_PROGRESS and
//      sends a magic-link "schedule your session" email.

import SingleSessionClient from "./SingleSessionClient";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type CatalogLesson = {
  id: string;
  fortnite_label: string;
  parent_label: string;
  parent_skill_description: string;
  topic: string;
  difficulty_level: string;
  duration_minutes: number | null;
};

export default async function SingleSessionPage({
  searchParams,
}: {
  searchParams: Promise<{ verified?: string; coppa_error?: string }>;
}) {
  const { verified, coppa_error } = await searchParams;

  // Published catalog. Single-session buyers pick from here. Tim
  // never enters a sales loop — the lesson is productized.
  const supabase = createServiceRoleClient();
  const lessonsResp = await supabase
    .from("lessons")
    .select(
      "id, fortnite_label, parent_label, parent_skill_description, topic, difficulty_level, duration_minutes",
    )
    .eq("is_published", true)
    .order("created_at", { ascending: true });
  const lessons = (lessonsResp.data ?? []) as CatalogLesson[];

  return (
    <SingleSessionClient
      catalog={lessons}
      verifiedIntakeId={verified ?? null}
      coppaError={coppa_error ?? null}
    />
  );
}

export type { CatalogLesson };
