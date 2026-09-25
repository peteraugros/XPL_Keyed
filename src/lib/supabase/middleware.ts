// Session refresh helper invoked from `src/middleware.ts`. It must live in src/:
// Next ignores a root middleware.ts in a src/ project, silently, and this one
// sat at the root and never ran, so token refreshes were never saved.
// @supabase/ssr requires this so JWTs don't expire mid-navigation.

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/db";

type CookieToSet = { name: string; value: string; options: CookieOptions };

// REFRESH WHEN THE TOKEN IS NEARLY EXPIRED, NOT ON EVERY REQUEST.
//
// getUser() is a network round trip to Supabase auth. Called on every request,
// one page load fired several at once, and when the token was near expiry they
// all tried to refresh the SAME refresh token in parallel. Supabase answered
// with 504s and 409 "too many concurrent token refresh requests" (production
// logs, 2026-09-25 22:25 UTC), which is what made sign in feel slow.
//
// The expiry is readable locally: @supabase/ssr stores the session in the
// cookie as "base64-" + base64(JSON) carrying `expires_at`. So "does this need
// refreshing" is a decode, not a call, and tokens live an hour.
//
// Not a weakened auth check: middleware never was the authorization boundary.
// Pages and routes still validate through getUser(), and RLS sits underneath.
// The cookie is read for one number only; a forged value can at most cause or
// skip a refresh. Same change Curriculum OS made on 2026-09-09.
const REFRESH_WITHIN_MS = 10 * 60 * 1000;

function chunkIndex(name: string): number {
  const m = /\.(\d+)$/.exec(name);
  return m ? Number(m[1]) : -1;
}

/** null = no session cookie; 0 = present but unreadable (so refresh). */
function msUntilSessionExpiry(request: NextRequest): number | null {
  const parts = request.cookies
    .getAll()
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => chunkIndex(a.name) - chunkIndex(b.name));
  if (parts.length === 0) return null;
  try {
    const raw = parts.map((c) => c.value).join("");
    const json = raw.startsWith("base64-")
      ? Buffer.from(raw.slice("base64-".length), "base64").toString("utf8")
      : raw;
    const expiresAt = (JSON.parse(json) as { expires_at?: number }).expires_at;
    if (typeof expiresAt !== "number" || !Number.isFinite(expiresAt)) return 0;
    return expiresAt * 1000 - Date.now();
  } catch {
    return 0;
  }
}

export async function updateSession(request: NextRequest) {
  const remaining = msUntilSessionExpiry(request);
  if (remaining === null || remaining > REFRESH_WITHIN_MS) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Near expiry, so this does real work: refresh, and setAll writes the new
  // cookie. A failure (Supabase timing out, a corrupted cookie) must not turn
  // every page into a 500; continue, and the page decides who is signed in.
  try {
    await supabase.auth.getUser();
  } catch (err) {
    console.warn("[auth] session refresh failed; continuing", err);
  }

  return response;
}
