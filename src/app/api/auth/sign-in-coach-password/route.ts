// POST /api/auth/sign-in-coach-password
//
// Hidden password-auth path for coaches (currently just Tim). Surfaces
// behind the triple-tap-the-brand mechanic on /login.
//
// Maps username → coach.email → signInWithPassword. Cookie session is
// set by the @supabase/ssr server client automatically. Returns { ok }
// with the redirect URL the client should jump to.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    username: z.string().trim().min(1).max(64),
    password: z.string().min(1).max(256),
    next: z.string().optional(),
  })
  .strict();

type CoachLookup = { email: string; is_active: boolean };

export async function POST(req: Request) {
  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  // Resolve username -> coach email via service role (RLS hides coach
  // rows from anon).
  const service = createServiceRoleClient();
  const coachRow = await service
    .from("coaches")
    .select("email, is_active")
    .ilike("username", body.username.trim())
    .maybeSingle();
  const coach = coachRow.data as CoachLookup | null;

  // No-enumeration: same error shape whether username is unknown or
  // password is wrong. Slight defense against credential probing.
  const FAIL = NextResponse.json(
    { error: "invalid_credentials" },
    { status: 401 },
  );

  if (!coach || !coach.is_active) {
    return FAIL;
  }

  // signInWithPassword runs through the cookie-bound client so the
  // session cookies are set on the response automatically.
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: coach.email,
    password: body.password,
  });
  if (error || !data.session) {
    return FAIL;
  }

  const next = safeNextPath(body.next) ?? "/admin";
  return NextResponse.json({ ok: true, next });
}
