// /admin/dad — Tim ↔ Dad operator channel.
//
// Per Coach Dashboard Spec/dad-admin-spec.md + admin-modes.md. The
// channel is shared across both Focused and Command modes; living on
// its own page keeps Home compact and gives the conversation a stable
// URL Tim can bookmark.

import { requireCoachSession } from "../_lib/session";
import TimDadChannel, { type TimDadMessage } from "@/components/TimDadChannel";
import styles from "../page.module.css";

export const dynamic = "force-dynamic";

export default async function AdminDadPage() {
  const { supabase } = await requireCoachSession();

  const lookup = await supabase
    .from("tim_dad_messages")
    .select("id, sender_role, body, created_at")
    .order("created_at", { ascending: true })
    .limit(200);
  const messages = (lookup.data ?? []) as TimDadMessage[];

  return (
    <div className={styles.homeFrame}>
      <section className={styles.block}>
        <h2 className={styles.blockHeader}>Dad</h2>
        <TimDadChannel initialMessages={messages} viewerRole="tim" />
      </section>
    </div>
  );
}
