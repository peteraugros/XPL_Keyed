// /portal/messages — parent's read only message audit.
//
// Parent has visibility into every message between their kid and Tim
// (Hard rule: parent read access to ALL messages). MessageThread renders
// in parent mode with no composer endpoint — parent never writes, just
// reads.

import { requireParentSession } from "../_lib/session";
import MessageThread from "@/components/MessageThread";
import styles from "../_components/inner-page.module.css";

export const dynamic = "force-dynamic";

type MessageRow = {
  id: string;
  sender_role: "coach" | "player" | "bot";
  body: string;
  created_at: string;
};

export default async function MessagesPage() {
  const { supabase, player } = await requireParentSession();

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
        <div className={styles.eyebrow}>Communication</div>
        <h1 className={styles.title}>Messages</h1>
        <p className={styles.intro}>
          Every message between {player.first_name} and Tim. Read only on
          your end. If you want Tim to know something, have {player.first_name} message him
          from the player view. Nothing happens off platform.
        </p>
      </section>

      <section className={styles.card}>
        <div className={styles.cardEyebrow}>Between {player.first_name} and Tim</div>
        <h2 className={styles.cardTitle}>Full thread</h2>
        <MessageThread
          initialMessages={messages}
          viewerRole="parent"
          kidFirstName={player.first_name}
          endpoint={null}
        />
      </section>
    </div>
  );
}
