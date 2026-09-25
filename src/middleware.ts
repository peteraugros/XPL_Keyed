import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on every route except static assets, the service worker, and /api.
  // A route handler CAN write cookies, so createClient() refreshes a stale
  // session by itself; sending /api through here too only multiplied the
  // parallel refreshes of one token that Supabase was refusing with 409.
  // /auth stays in: it is where sign-in lands.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/|api/).*)"],
};
