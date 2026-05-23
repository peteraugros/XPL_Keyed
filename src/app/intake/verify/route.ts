// GET /intake/verify?t=<token>
//
// Magic-link landing for the under-13 COPPA gate. Validates the token,
// marks pending_intake_verifications.verified_at, and redirects back to
// /intake with the intake_id surfaced so the form on the same device can
// unlock Level 2.
//
// Failure modes redirect with a coppa_error query param the intake page
// surfaces inline:
//   - expired:    token expired or already used
//   - not_found:  token doesn't match any pending row
//
// Tokens are single-shot in the sense that re-clicking does no harm: the
// route is idempotent — a verified row stays verified, the redirect still
// fires. The intake form trusts its own localStorage state for replay
// protection; the token only proves parent-email control.

import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

// Allow-list mirror of /api/intake/request-verification's
// ALLOWED_RETURN_PATHS. Any new caller of the COPPA gate must
// register its path in both places.
const ALLOWED_RETURN_PATHS = new Set(["/intake", "/single-session"]);

function safeReturnPath(input: string | null): string {
  if (input && ALLOWED_RETURN_PATHS.has(input)) return input;
  return "/intake";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t");
  const returnTo = safeReturnPath(url.searchParams.get("return_to"));

  if (!token || token.length !== 64) {
    return NextResponse.redirect(`${APP_URL}${returnTo}?coppa_error=not_found`);
  }

  const supabase = createServiceRoleClient();

  const { data: row, error } = await supabase
    .from("pending_intake_verifications")
    .select("intake_id, verified_at, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    console.error("[intake/verify] lookup failed", error);
    return NextResponse.redirect(`${APP_URL}${returnTo}?coppa_error=server`);
  }

  if (!row) {
    return NextResponse.redirect(`${APP_URL}${returnTo}?coppa_error=not_found`);
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return NextResponse.redirect(`${APP_URL}${returnTo}?coppa_error=expired`);
  }

  if (!row.verified_at) {
    const { error: updateErr } = await supabase
      .from("pending_intake_verifications")
      .update({ verified_at: new Date().toISOString() })
      .eq("token", token);
    if (updateErr) {
      console.error("[intake/verify] update failed", updateErr);
      return NextResponse.redirect(`${APP_URL}${returnTo}?coppa_error=server`);
    }
  }

  return NextResponse.redirect(
    `${APP_URL}${returnTo}?verified=${row.intake_id}`,
  );
}
