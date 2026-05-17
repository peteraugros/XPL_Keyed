// Browser Supabase client. Use this in Client Components and useEffect hooks.
// Server-side code should use `@/lib/supabase/server` instead.

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/db";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
