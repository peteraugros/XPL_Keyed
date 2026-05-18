// POST /api/auth/send-magic-link
//
// Single dispatch point for both auth surfaces:
//   role=parent  -> sign in to /portal
//   role=player  -> kid's session, delivered to parent inbox per the
//                   override pattern in src/lib/supabase/auth.ts.
//
// No-enumeration policy: unknown emails and families with no eligible
// player still return 200 ok. The user sees "check your inbox" either way;
// if nothing arrives, the existing "Trouble signing in?" support copy
// covers it. We don't want an attacker to be able to enumerate parent
// emails by toggling the response code.
//
// generateLink + Resend can fail for boring reasons (Resend rate limit,
// Supabase Auth timeout). Those surface as 502 so the UI can offer a
// retry instead of stranding the user on a fake success.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  safeNextPath,
  sendCoachMagicLink,
  sendParentMagicLink,
  sendPlayerMagicLink,
} from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(["parent", "player", "coach"]),
  next: z.string().max(512).optional(),
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

  const supabase = createServiceRoleClient();
  const next = safeNextPath(body.next) ?? undefined;

  const result =
    body.role === "parent"
      ? await sendParentMagicLink(supabase, body.email, { next })
      : body.role === "player"
        ? await sendPlayerMagicLink(supabase, body.email, { next })
        : await sendCoachMagicLink(supabase, body.email, { next });

  // No-enumeration: missing parent or missing player both look like success.
  if (!result.ok && (result.code === "not_found" || result.code === "no_auth_user")) {
    return NextResponse.json({ ok: true });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.code }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
