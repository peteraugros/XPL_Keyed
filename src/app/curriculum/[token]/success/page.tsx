// /curriculum/[token]/success
//
// Celebratory landing after Stripe checkout. The Stripe webhook is the
// canonical source of truth for state changes (subscription.status='active',
// curricula.status='active', cycle anchor). This page just renders the
// welcome moment.
//
// Server Component fetches the kid's first name via the token so the
// modal copy can be personalized ("Jake receives his first PDF lesson
// today" rather than generic "your child").

import { createServiceRoleClient } from "@/lib/supabase/server";
import { shouldDeliverWeek1Immediately } from "@/lib/lessons/timing";
import SuccessClient from "./SuccessClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CurriculumLookup = { id: string; player_id: string };
type PlayerLookup = { first_name: string };
type Week1Lookup = { live_call_at: string | null };

export default async function CurriculumSuccessPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = createServiceRoleClient();

  // Best effort lookups. If anything fails we fall back to safe defaults
  // — the success page should still render cleanly even if a token
  // doesn't resolve.
  let kidFirstName: string | null = null;
  let immediateDelivery = false;
  try {
    const curriculumLookup = await supabase
      .from("curricula")
      .select("id, player_id")
      .eq("approval_token", token)
      .maybeSingle();
    const curriculum = curriculumLookup.data as CurriculumLookup | null;
    if (curriculum) {
      const playerLookup = await supabase
        .from("players")
        .select("first_name")
        .eq("id", curriculum.player_id)
        .maybeSingle();
      const player = playerLookup.data as PlayerLookup | null;
      kidFirstName = player?.first_name ?? null;

      const week1Lookup = await supabase
        .from("curriculum_slots")
        .select("live_call_at")
        .eq("curriculum_id", curriculum.id)
        .eq("week_number", 1)
        .maybeSingle();
      const week1 = week1Lookup.data as Week1Lookup | null;
      if (week1?.live_call_at) {
        immediateDelivery = shouldDeliverWeek1Immediately(
          new Date(),
          new Date(week1.live_call_at),
        );
      }
    }
  } catch (err) {
    console.error("[curriculum/success] lookup failed", err);
  }

  return (
    <SuccessClient
      kidFirstName={kidFirstName}
      immediateDelivery={immediateDelivery}
    />
  );
}
