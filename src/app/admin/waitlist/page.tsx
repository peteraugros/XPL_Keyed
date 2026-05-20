// /admin/waitlist — full waitlist view + manual ops.
//
// Tim's view of every family on the list. Read-only for MVP except for
// two manual escape hatches: Remove (bad contact, family asked off) and
// Skip in queue (rare; cron does FIFO by default).
//
// Crons that already run:
//   * cron-waitlist-offer-lifecycle (offers a 48hr slot when one opens,
//     reminds at 24hr, expires at 48hr, promotes the next family)
//   * cron-waitlist-freshness-check (60d "still interested?", 14d quiet
//     auto-remove)
// So most of this page is read-only telemetry of what those crons are
// already doing.

import { requireCoachSession } from "../_lib/session";
import { createServiceRoleClient } from "@/lib/supabase/server";
import WaitlistClient from "./WaitlistClient";

export const dynamic = "force-dynamic";

export type WaitlistEntry = {
  id: string;
  parent_email: string;
  parent_first_name: string | null;
  kid_first_name: string;
  kid_age: number | null;
  status: string;
  created_at: string;
  offered_at: string | null;
  offer_expires_at: string | null;
  reminder_24hr_sent_at: string | null;
  last_freshness_check_at: string | null;
  freshness_response: string | null;
  removed_at: string | null;
  removed_reason: string | null;
};

export default async function WaitlistPage() {
  await requireCoachSession();

  const supabase = createServiceRoleClient();
  const lookup = await supabase
    .from("waitlist_entries")
    .select(
      "id, parent_email, parent_first_name, kid_first_name, kid_age, status, created_at, offered_at, offer_expires_at, reminder_24hr_sent_at, last_freshness_check_at, freshness_response, removed_at, removed_reason",
    )
    .order("created_at", { ascending: true });

  const entries = (lookup.data ?? []) as WaitlistEntry[];

  const open = entries.filter((e) => e.status === "waiting" || e.status === "offered");
  const closed = entries.filter((e) => e.status !== "waiting" && e.status !== "offered");

  return <WaitlistClient open={open} closed={closed} />;
}
