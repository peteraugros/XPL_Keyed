// POST /api/tim-dad-message
//
// Shared endpoint for the Tim ↔ Dad channel. sender_role is derived from
// the authed coach's is_dad flag, not from the request body — Tim can't
// spoof Dad-sender messages and vice versa.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
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
    .select("id, is_active, is_dad")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as
    | { id: string; is_active: boolean; is_dad: boolean }
    | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const row: TablesInsert<"tim_dad_messages"> = {
    sender_role: coach.is_dad ? "dad" : "tim",
    body: parsed.body,
  };
  const insert = await supabase
    .from("tim_dad_messages")
    .insert(row as never)
    .select("id, sender_role, body, created_at")
    .single();
  const data = insert.data as
    | { id: string; sender_role: "tim" | "dad"; body: string; created_at: string }
    | null;
  if (insert.error || !data) {
    console.error("[tim-dad-message] insert failed", insert.error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: data });
}
