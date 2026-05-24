// Web push helper. Node.js only (Next.js route handlers + API routes).
// Deno edge functions use their own implementation in
// supabase/functions/cron-twenty-min-pre-call-reminder and
// supabase/functions/cron-call-outcome-push.
//
// push_subscriptions is not yet in the generated DB types (migration pending
// npm run gen:types after the migration runs). All queries cast through
// `as never` at the boundary — same pattern used for other new tables.

import webpush from "web-push";
import { createServiceRoleClient } from "@/lib/supabase/server";

let _vapidSet = false;

function ensureVapid() {
  if (_vapidSet) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const sub = process.env.VAPID_SUBJECT;
  if (pub && priv && sub) {
    webpush.setVapidDetails(sub, pub, priv);
    _vapidSet = true;
  }
}

export type PushPayload = {
  title: string;
  body?: string;
  url?: string;
  tag?: string;
};

type SubRow = { id: string; endpoint: string; p256dh: string; auth: string };

// Send a push notification to every browser/device registered for a coach.
// Expired subscriptions (push gateway returns 410/404) are pruned automatically.
export async function sendPushToCoach(
  coachId: string,
  payload: PushPayload,
): Promise<void> {
  ensureVapid();
  if (!_vapidSet) {
    console.warn("[push] VAPID keys not configured, skipping");
    return;
  }

  const svc = createServiceRoleClient();
  const tbl = (svc.from as (t: string) => ReturnType<typeof svc.from>)("push_subscriptions");
  const { data: subs } = await tbl
    .select("id, endpoint, p256dh, auth" as never)
    .eq("coach_id" as never, coachId);

  if (!subs?.length) return;

  const json = JSON.stringify(payload);
  const expired: string[] = [];

  await Promise.allSettled(
    (subs as unknown as SubRow[]).map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          json,
        );
      } catch (err: unknown) {
        const code = (err as { statusCode?: number }).statusCode;
        if (code === 410 || code === 404) {
          expired.push(sub.id);
        } else {
          console.error("[push] send failed", sub.endpoint, code, err);
        }
      }
    }),
  );

  if (expired.length > 0) {
    const delTbl = (svc.from as (t: string) => ReturnType<typeof svc.from>)("push_subscriptions");
    await delTbl.delete().in("id" as never, expired);
  }
}

// Resolve Tim's coach ID: first active non-dad coach row.
// Callers that don't have the coach ID from a session can use this.
export async function getActiveCoachId(): Promise<string | null> {
  const svc = createServiceRoleClient();
  const { data } = await svc
    .from("coaches")
    .select("id")
    .eq("is_active", true)
    .eq("is_dad", false)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}
