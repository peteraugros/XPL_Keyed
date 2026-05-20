// Shared auth + role gate for every /play/* page. Wrapped in React's
// cache() so the layout and the page in a single request hit the DB
// once. Mirror of requireParentSession over in /portal but inverted —
// the player is the source of truth, and parents/coaches/orphans get
// redirected.

import { cache } from "react";
import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

type PlayerLookup = {
  id: string;
  family_id: string;
  first_name: string;
  fortnite_username: string | null;
  discord_username: string | null;
  age: number;
};
type IdLookup = { id: string };

type SupabaseServer = Awaited<ReturnType<typeof createClient>>;

export type PlayerSession = {
  supabase: SupabaseServer;
  user: { id: string };
  player: PlayerLookup;
};

export const requirePlayerSession = cache(async (): Promise<PlayerSession> => {
  const supabase = await createClient();

  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) redirect("/login?next=/play");

  const playerRow = await supabase
    .from("players")
    .select("id, family_id, first_name, fortnite_username, discord_username, age")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (playerRow.error) {
    console.error("[play] player lookup failed", playerRow.error);
    redirect("/login?error=play_lookup");
  }

  const player = playerRow.data as PlayerLookup | null;
  if (!player) {
    const parentRow = await supabase
      .from("parents")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((parentRow.data as IdLookup | null)?.id) redirect("/portal");

    const coachRow = await supabase
      .from("coaches")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if ((coachRow.data as IdLookup | null)?.id) redirect("/admin");

    redirect("/login?error=no_role");
  }

  return { supabase, user: { id: user.id }, player };
});
