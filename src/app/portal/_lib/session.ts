// Shared auth + role + family lookup for every /portal/* page.
//
// Wrapped in React's `cache()` so the layout and the page in a single
// request hit the DB once, not twice. The Supabase server client is
// also created inside the cached function, which is fine: it's bound
// to the request's cookies and stateless per query.
//
// Redirect targets (typedRoutes can't always check these because they
// include query strings or point at routes that may not exist yet in
// every checkout). We re-use the same string-cast pattern as page.tsx.

import { cache } from "react";
import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

type ParentLookup = { first_name: string; email: string; family_id: string };
type PlayerLookup = { id: string; first_name: string; discord_username: string | null };
type IdLookup = { id: string };

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type ParentSession = {
  supabase: SupabaseServer;
  user: { id: string; email: string };
  parent: ParentLookup;
  player: PlayerLookup;
};

export const requireParentSession = cache(async (): Promise<ParentSession> => {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) redirect("/login?next=/portal");

  const parentRow = await supabase
    .from("parents")
    .select("first_name, email, family_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (parentRow.error) {
    console.error("[portal] parent lookup failed", parentRow.error);
    redirect("/login?error=portal_lookup");
  }

  const parent = parentRow.data as ParentLookup | null;
  if (!parent) {
    const playerRow = await supabase
      .from("players")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((playerRow.data as IdLookup | null)?.id) redirect("/play");

    const coachRow = await supabase
      .from("coaches")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((coachRow.data as IdLookup | null)?.id) redirect("/admin");

    redirect("/login?error=no_role");
  }

  const playerLookup = await supabase
    .from("players")
    .select("id, first_name, discord_username")
    .eq("family_id", parent.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (playerLookup.error) {
    console.error("[portal] player lookup failed", playerLookup.error);
    redirect("/login?error=portal_player");
  }
  const player = playerLookup.data as PlayerLookup | null;
  if (!player) redirect("/login?error=portal_player");

  return {
    supabase,
    user: { id: user.id, email: user.email ?? parent.email },
    parent,
    player,
  };
});
