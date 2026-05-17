// Edge Function — waitlist_freshness_check
//
// Fired daily at 17:00 UTC by pg_cron. Per CLAUDE.md "Periodic list freshening":
// every 60 days, ask waiting families "still interested?". If no reply within
// 14 days, quietly remove the entry to keep the list from rotting with ghosts.
//
// Two stages:
//   1. Send freshness email: status='waiting' AND
//      (last_freshness_check_at IS NULL AND created_at <= NOW() - 60d) OR
//      (last_freshness_check_at <= NOW() - 60d AND freshness_response = 'yes')
//      → set last_freshness_check_at = NOW(), clear freshness_response
//   2. Auto-remove: status='waiting' AND last_freshness_check_at <= NOW() - 14d
//      AND freshness_response IS NULL
//      → set status='removed', removed_reason='no_freshness_response'

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, brandedEmailHtml } from "../_shared/resend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const NEXT_PUBLIC_APP_URL = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "https://xplkeyed.com";

function freshnessBody(kidName: string, yesUrl: string, stopUrl: string) {
  return brandedEmailHtml({
    headline: `Still interested in coaching for ${kidName}?`,
    bodyHtml: `<p>You've been on Tim's waitlist for a while. We want to keep the list honest, so we check in every 60 days.</p><p>Reply YES to stay on the list, or click the link below to be removed.</p><p style="margin:24px 0;"><a href="${yesUrl}" style="display:inline-block;background:#C7FF3D;color:#0B1538;padding:14px 22px;border-radius:6px;font-weight:600;text-decoration:none;letter-spacing:0.5px;margin-right:12px;">Yes, keep me on</a><a href="${stopUrl}" style="display:inline-block;color:#fff;padding:14px 22px;border:1.5px solid rgba(255,255,255,0.4);border-radius:6px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">Remove me</a></p>`,
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();
  const stamp = now.toISOString();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 86_400_000).toISOString();

  // --- Stage 1: send freshness email -------------------------------------
  // Two query variants OR'd together via separate queries (Supabase JS .or()
  // syntax gets brittle for compound NULL checks). Union in code.
  const { data: neverChecked } = await supabase
    .from("waitlist_entries")
    .select("id, parent_email, kid_first_name")
    .eq("status", "waiting")
    .is("last_freshness_check_at", null)
    .lte("created_at", sixtyDaysAgo);

  const { data: previouslyChecked } = await supabase
    .from("waitlist_entries")
    .select("id, parent_email, kid_first_name")
    .eq("status", "waiting")
    .lte("last_freshness_check_at", sixtyDaysAgo)
    .eq("freshness_response", "yes");

  const toCheck = [...(neverChecked ?? []), ...(previouslyChecked ?? [])];

  let asked = 0;
  for (const entry of toCheck) {
    await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
      to: entry.parent_email,
      subject: `Still on the waitlist for ${entry.kid_first_name}?`,
      html: freshnessBody(
        entry.kid_first_name,
        `${NEXT_PUBLIC_APP_URL}/waitlist/${entry.id}/keep`,
        `${NEXT_PUBLIC_APP_URL}/waitlist/${entry.id}/stop`,
      ),
    });
    await supabase
      .from("waitlist_entries")
      .update({ last_freshness_check_at: stamp, freshness_response: null })
      .eq("id", entry.id);
    asked++;
  }

  // --- Stage 2: auto-remove silent families -----------------------------
  const { data: silentEntries } = await supabase
    .from("waitlist_entries")
    .select("id")
    .eq("status", "waiting")
    .lte("last_freshness_check_at", fourteenDaysAgo)
    .is("freshness_response", null);

  let removed = 0;
  for (const entry of silentEntries ?? []) {
    await supabase
      .from("waitlist_entries")
      .update({
        status: "removed",
        removed_at: stamp,
        removed_reason: "no_freshness_response",
      })
      .eq("id", entry.id);
    removed++;
  }

  return new Response(
    JSON.stringify({ asked, removed }),
    { headers: { "Content-Type": "application/json" } },
  );
});
