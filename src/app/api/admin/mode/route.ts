// POST /api/admin/mode
//
// Toggles the coach's admin mode preference between 'focused' and
// 'command'. Persists on the coaches row per
// Coach Dashboard Spec/CEO/admin-modes.md section 3.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  mode: z.enum(["focused", "command"]),
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

  const updateResult = await supabase
    .from("coaches")
    .update({ admin_mode: body.mode } as never)
    .eq("auth_user_id", userResult.data.user.id);

  if (updateResult.error) {
    console.error("[admin/mode] update failed", updateResult.error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, mode: body.mode });
}
