// POST /api/auth/signout
//
// Clears the Supabase session cookie. Intended target for a future "Sign
// out" CTA in the parent dashboard and player portal navs. Idempotent:
// signing out an already signed out client still returns 200.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("[auth/signout] signOut failed", error);
    return NextResponse.json({ error: "signout_failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
