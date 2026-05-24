// Remove a Web Push subscription for the currently authenticated coach.
// Called when the browser revokes permission or the coach explicitly
// opts out. If no endpoint is supplied, all subscriptions are deleted.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const coachId = (coach as { id: string }).id;
  let endpoint: string | undefined;
  try {
    const body = (await req.json()) as { endpoint?: string };
    endpoint = body.endpoint;
  } catch {
    /* no body is fine — deletes all */
  }

  // push_subscriptions not yet in generated types; cast through string.
  const table = (svc.from as (t: string) => ReturnType<typeof svc.from>)("push_subscriptions");
  const q = table.delete().eq("coach_id" as never, coachId);
  if (endpoint) {
    await (q as typeof q).eq("endpoint" as never, endpoint);
  } else {
    await q;
  }

  return NextResponse.json({ ok: true });
}
