// /portal/settings — read + edit profile info.
//
// Two scopes:
//   * Parent — first_name only. Email change isn't surfaced here because
//     it has to go through Supabase auth (would orphan the magic link
//     unless done carefully). Route that to Tim by email.
//   * Player — first_name, fortnite_username, discord_username,
//     current_rank, platform, hours_per_week. The parent edits these
//     on the kid's behalf.
//
// RLS note: parents_self_update lets parents update their own row through
// the cookie client. players_self_update is keyed on the player's own
// auth_user_id and doesn't grant the parent UPDATE access. So the API
// endpoint uses the service role client for player edits, with an
// explicit family-scope check.

import { requireParentSession } from "../_lib/session";
import SettingsClient from "./SettingsClient";
import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

type ParentLookup = {
  first_name: string;
  email: string;
};
type PlayerLookup = {
  id: string;
  first_name: string;
  age: number;
  fortnite_username: string | null;
  discord_username: string | null;
  current_rank: string | null;
  platform: string | null;
  hours_per_week: number | null;
};

export default async function SettingsPage() {
  const { supabase, parent, player } = await requireParentSession();

  // Re-fetch the full player row (requireParentSession returns a subset)
  // so the form can prefill rank, platform, hours_per_week.
  const playerResp = await supabase
    .from("players")
    .select(
      "id, first_name, age, fortnite_username, discord_username, current_rank, platform, hours_per_week",
    )
    .eq("id", player.id)
    .maybeSingle();

  const fullPlayer = (playerResp.data as PlayerLookup | null) ?? {
    id: player.id,
    first_name: player.first_name,
    age: 0,
    fortnite_username: null,
    discord_username: player.discord_username,
    current_rank: null,
    platform: null,
    hours_per_week: null,
  };

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>Account</div>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.intro}>
          Update your contact name and {fullPlayer.first_name}&apos;s player
          profile. Email and age changes go through Tim directly.
        </p>
      </section>

      <SettingsClient
        initialParent={{
          first_name: parent.first_name,
          email: parent.email,
        }}
        initialPlayer={fullPlayer}
      />
    </div>
  );
}
