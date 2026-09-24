import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on every route except static assets and the service worker.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sw.js|manifest.json|icons/).*)"],
};
