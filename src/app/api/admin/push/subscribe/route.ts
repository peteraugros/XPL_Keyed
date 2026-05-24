// Store a Web Push subscription for the currently authenticated coach.
// Called by AdminShell after the browser grants Notification permission
// and subscribes to the push manager.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscribeBody = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  userAgent?: string;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data: coach } = await svc
    .from("coaches")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!coach) return NextResponse.json({ error: "Not a coach" }, { status: 403 });

  let body: SubscribeBody;
  try {
    body = (await req.json()) as SubscribeBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { endpoint, keys, userAgent } = body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    return NextResponse.json({ error: "Missing subscription fields" }, { status: 400 });
  }

  // push_subscriptions is not yet in the generated types (migration pending
  // npm run gen:types). Cast through `as never` — same pattern used for other
  // new tables before a types regen.
  await (svc.from as (t: string) => ReturnType<typeof svc.from>)("push_subscriptions")
    .upsert(
      {
        coach_id: (coach as { id: string }).id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        user_agent: userAgent ?? null,
      } as never,
      { onConflict: "coach_id,endpoint" },
    );

  return NextResponse.json({ ok: true });
}
