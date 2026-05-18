"use client";

// /auth/callback — magic-link landing.
//
// Supabase's verify endpoint hands credentials back to us in one of three
// shapes depending on the configured flow:
//
//   1. PKCE       -> ?code=<...>                              (query)
//   2. OTP        -> ?token_hash=<...>&type=<...>             (query)
//   3. Implicit   -> #access_token=<...>&refresh_token=<...>  (hash fragment)
//
// The browser strips the hash before the request reaches a server route
// handler, so we can't handle case (3) server-side at all. This page is a
// Client Component that handles all three on the client. The browser
// supabase client persists the session into cookies via @supabase/ssr's
// cookie adapter, so the next request (Server Component or Route Handler)
// sees a logged-in session.
//
// On success we router.replace(next). On any failure we redirect back to
// /login with an error code; the original `next` is preserved so the
// user keeps their intended destination across a retry.

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.startsWith("/\\")) return null;
  return next;
}

export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Signing you in...");

  useEffect(() => {
    let cancelled = false;

    async function run() {
      const url = new URL(window.location.href);
      const nextParam = url.searchParams.get("next");
      const next = safeNextPath(nextParam) ?? "/portal";

      // Hard navigation rather than Next.js soft routing — guarantees the
      // destination Server Component re-reads cookies fresh and prevents
      // the callback page from re-rendering in a loop while the auth
      // state propagates.
      function go(path: string) {
        if (cancelled) return;
        window.location.replace(path);
      }

      const supabase = createClient();

      // Hash fragment looks like "#access_token=...&refresh_token=...&..."
      const hash = window.location.hash.startsWith("#")
        ? window.location.hash.slice(1)
        : window.location.hash;
      const hashParams = new URLSearchParams(hash);
      const access_token = hashParams.get("access_token");
      const refresh_token = hashParams.get("refresh_token");

      const code = url.searchParams.get("code");
      const token_hash = url.searchParams.get("token_hash");
      const type = url.searchParams.get("type");

      try {
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) {
            console.error("[auth/callback] exchangeCodeForSession failed", error);
            return go(`/login?error=exchange_failed&next=${encodeURIComponent(next)}`);
          }
          return go(next);
        }

        if (token_hash) {
          const otpType = (type ?? "magiclink") as
            | "magiclink"
            | "signup"
            | "recovery"
            | "invite"
            | "email_change"
            | "email";
          const { error } = await supabase.auth.verifyOtp({
            token_hash,
            type: otpType,
          });
          if (error) {
            console.error("[auth/callback] verifyOtp failed", error);
            return go(`/login?error=verify_failed&next=${encodeURIComponent(next)}`);
          }
          return go(next);
        }

        if (access_token && refresh_token) {
          const { error } = await supabase.auth.setSession({
            access_token,
            refresh_token,
          });
          if (error) {
            console.error("[auth/callback] setSession failed", error);
            return go(`/login?error=set_session_failed&next=${encodeURIComponent(next)}`);
          }
          // Strip the hash from history so a refresh doesn't try to re-set.
          window.history.replaceState(null, "", url.pathname + url.search);
          return go(next);
        }

        setMessage("That sign in link was missing credentials. Redirecting...");
        return go(`/login?error=missing_code&next=${encodeURIComponent(next)}`);
      } catch (err) {
        console.error("[auth/callback] unexpected error", err);
        return go(`/login?error=unexpected&next=${encodeURIComponent(next)}`);
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
    // Run exactly once on mount. The dance is one-shot per page load; a
    // re-run would re-consume the same code/token_hash and fail.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      style={{
        minHeight: "100dvh",
        background: "#0B1538",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Inter, system-ui, sans-serif",
        padding: "24px",
        textAlign: "center",
      }}
    >
      <div>
        <div
          style={{
            fontFamily: "'Anton', Impact, sans-serif",
            fontSize: "20px",
            letterSpacing: "2px",
            color: "#C7FF3D",
            marginBottom: "16px",
          }}
        >
          XPL KEYED
        </div>
        <div style={{ fontSize: "15px", color: "rgba(255,255,255,0.85)" }}>
          {message}
        </div>
      </div>
    </div>
  );
}
