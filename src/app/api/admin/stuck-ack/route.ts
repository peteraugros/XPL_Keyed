// POST /api/admin/stuck-ack
//
// Tim acknowledges that he saw the Dad-returned banner on his /admin.
// Stamps stuck_events.tim_seen_at so the banner doesn't keep showing.
//
// Inputs:
//   * stuck_ids — array of UUIDs (Tim can dismiss all current banners
//     at once, or one at a time; the array lets either work).

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  stuck_ids: z.array(z.string().uuid()).min(1).max(50),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const coachLookup = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const ack = await supabase
    .from("stuck_events")
    .update({ tim_seen_at: new Date().toISOString() } as never)
    .in("id", body.stuck_ids);
  if (ack.error) {
    console.error("[admin/stuck-ack] update failed", ack.error);
    return NextResponse.json({ error: "ack_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
