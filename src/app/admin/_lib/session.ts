// Shared coach auth + role gate. Wrapped in React's cache() so the
// layout and the page in a single request hit the DB once.
//
// Coach gate has a unique branch: the seed migration leaves
// coaches.auth_user_id NULL, and the first time a coach signs in we
// auto-link the row by matching coach.email to user.email and writing
// auth_user_id. That has to happen via service role because the
// cookie-bound client can't UPDATE a coach row it doesn't yet own
// under the coaches_self_select RLS.

import { cache } from "react";
import { redirect as _redirect } from "next/navigation";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

export type CoachRow = {
  id: string;
  email: string;
  display_name: string;
  auth_user_id: string | null;
  is_active: boolean;
  admin_mode: "focused" | "command";
};
type IdLookup = { id: string };

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type CoachSession = {
  supabase: SupabaseServer;
  user: { id: string; email: string | null };
  coach: CoachRow;
};

export const requireCoachSession = cache(async (): Promise<CoachSession> => {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) redirect("/login?next=/admin");

  let coachLookup = await supabase
    .from("coaches")
    .select("id, email, display_name, auth_user_id, is_active, admin_mode")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  let coach = coachLookup.data as CoachRow | null;

  // Auto-link: coach row with matching email but no auth_user_id yet.
  if (!coach && user.email) {
    const adminClient = createServiceRoleClient();
    const unlinkedLookup = await adminClient
      .from("coaches")
      .select("id, email, display_name, auth_user_id, is_active, admin_mode")
      .ilike("email", user.email)
      .is("auth_user_id", null)
      .maybeSingle();
    const unlinked = unlinkedLookup.data as CoachRow | null;
    if (unlinked?.id && unlinked.is_active) {
      const linkResult = await adminClient
        .from("coaches")
        .update({ auth_user_id: user.id } as never)
        .eq("id", unlinked.id);
      if (linkResult.error) {
        console.error("[admin] coach auto-link failed", linkResult.error);
      } else {
        coach = { ...unlinked, auth_user_id: user.id };
      }
    }
  }

  if (!coach || !coach.is_active) {
    // Not a coach. Route to whatever role we are.
    const parentRow = await supabase
      .from("parents")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((parentRow.data as IdLookup | null)?.id) redirect("/portal");

    const playerRow = await supabase
      .from("players")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((playerRow.data as IdLookup | null)?.id) redirect("/play");

    redirect("/login?error=no_role");
  }

  return {
    supabase,
    user: { id: user.id, email: user.email ?? null },
    coach,
  };
});
