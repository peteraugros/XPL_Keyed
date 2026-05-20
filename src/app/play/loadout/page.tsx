// /play/loadout — kid's own profile. Kid can edit IGN, Discord, rank,
// platform, hours_per_week directly. First name + age are locked here
// (parent-controlled).
//
// RLS note: players_self_update is keyed on auth_user_id = auth.uid().
// In the kid's session that resolves to the synthetic kid auth user,
// which IS the row being updated. So the cookie client can UPDATE
// directly — no service role needed.

import { requirePlayerSession } from "../_lib/session";
import LoadoutClient from "./LoadoutClient";
import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

type PlayerFull = {
  id: string;
  first_name: string;
  age: number;
  fortnite_username: string | null;
  discord_username: string | null;
  current_rank: string | null;
  platform: string | null;
  hours_per_week: number | null;
};

export default async function LoadoutPage() {
  const { supabase, player } = await requirePlayerSession();

  const fullResp = await supabase
    .from("players")
    .select(
      "id, first_name, age, fortnite_username, discord_username, current_rank, platform, hours_per_week",
    )
    .eq("id", player.id)
    .maybeSingle();

  const full = (fullResp.data as PlayerFull | null) ?? {
    id: player.id,
    first_name: player.first_name,
    age: player.age,
    fortnite_username: player.fortnite_username,
    discord_username: player.discord_username,
    current_rank: null,
    platform: null,
    hours_per_week: null,
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Profile</div>
        <h1 className={styles.title}>Loadout</h1>
        <p className={styles.intro}>
          Your IGN, your rank, your platform. Update anything when
          it changes. Tim sees the latest before every call.
        </p>
      </section>

      <LoadoutClient initialPlayer={full} />
    </div>
  );
}
