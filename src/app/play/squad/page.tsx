// /play/squad — kid's message thread with Tim.
//
// Sidebar item is "Chat" — match it here. No section eyebrow, no card
// chrome around the thread, just title + thin intro + the thread itself.

import { requirePlayerSession } from "../_lib/session";
import MessageThread from "@/components/MessageThread";
import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

type MessageRow = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
};

export default async function SquadPage() {
  const { supabase, player } = await requirePlayerSession();

  const msgResp = await supabase
    .from("messages")
    .select("id, sender_role, body, created_at")
    .eq("player_id", player.id)
    .order("created_at", { ascending: true })
    .limit(500);

  const messages = (msgResp.data ?? []) as MessageRow[];

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <h1 className={styles.title}>Chat</h1>
        <p className={styles.intro}>
          Message Tim about anything game related. Your parents can see
          every message you send.
        </p>
      </section>

      <MessageThread
        initialMessages={messages}
        viewerRole="player"
        kidFirstName={player.first_name}
        endpoint="/api/play/message"
      />
    </div>
  );
}
