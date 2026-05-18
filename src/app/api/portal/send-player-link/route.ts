// POST /api/portal/send-player-link
//
// Parent-initiated. The parent dashboard surfaces a "Send Jake's sign-in
// link to my email" CTA — this endpoint backs that button.
//
// Flow:
//   1. Validate the cookie-bound session resolves to a parent row.
//   2. Re-read the parent's family + email server-side (don't trust the
//      client to claim a family_id).
//   3. Call sendPlayerMagicLink with the parent's real email. The helper
//      resolves the player from the family, generates a magic link for
//      the player's synthetic auth identity, and sends to the parent's
//      inbox via the override pattern.
//
// We do NOT accept a target email from the request body. The link is
// always sent to the parent on the session — keeps the trust gate tight.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { sendPlayerMagicLink } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ParentLookup = { email: string };

export async function POST() {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parentRow = await supabase
    .from("parents")
    .select("email")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) {
    return NextResponse.json({ error: "not_a_parent" }, { status: 403 });
  }

  // sendPlayerMagicLink needs the service-role client to read the
  // synthetic kid email off auth.users (cookie-bound client can't see
  // arbitrary auth.users rows). The helper itself only touches the
  // parent's own family graph, so privilege escalation is bounded.
  const admin = createServiceRoleClient();
  const result = await sendPlayerMagicLink(admin, parent.email, { next: "/play" });

  if (!result.ok) {
    // not_found / no_auth_user: silently 200 the same way /api/auth/send-magic-link
    // does — but here the parent IS authed, so a missing player means
    // something is genuinely wrong on the family. Surface as 500.
    if (result.code === "not_found" || result.code === "no_auth_user") {
      console.error("[portal/send-player-link] family integrity", result.code);
      return NextResponse.json({ error: "player_lookup_failed" }, { status: 500 });
    }
    return NextResponse.json({ error: result.code }, { status: 502 });
  }

  return NextResponse.json({ ok: true, sent_to: parent.email });
}
