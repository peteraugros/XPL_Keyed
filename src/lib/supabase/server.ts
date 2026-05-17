// Server-side Supabase client. Use in Server Components, Server Actions,
// Route Handlers. Reads session from cookies via @supabase/ssr.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/db";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component is a no-op; middleware
            // refreshes the session. This catch silences that case.
          }
        },
      },
    },
  );
}

// Service-role client for trusted server tasks (webhooks, cron, admin RPCs).
// NEVER use this in route handlers reached by untrusted requests without
// explicit authorization checks — it bypasses RLS.
import { createClient as createAdminClient } from "@supabase/supabase-js";

export function createServiceRoleClient() {
  return createAdminClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
