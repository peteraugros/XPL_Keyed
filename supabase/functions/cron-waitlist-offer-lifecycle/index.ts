// Edge Function — waitlist_offer_lifecycle
//
// Fired every minute by pg_cron. Per CLAUDE.md "Capacity & waitlist":
// each offered spot has a 48hr decision window with a reminder at 24hr.
//   * 24hr reminder if status='offered' and reminder hasn't gone yet
//   * 48hr expiry: status='offered' AND offer_expires_at <= NOW()
//     → mark expired, then offer the slot to the next-in-line waiting family
//       (FIFO, oldest created_at first). No reorder controls for MVP.
//
// Idempotency: reminder_24hr_sent_at, status transitions ('offered' → 'expired'),
// new offer rows have their own offered_at + offer_expires_at + offer_token.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendEmail, brandedEmailHtml } from "../_shared/resend.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL")!;
const NEXT_PUBLIC_APP_URL = Deno.env.get("NEXT_PUBLIC_APP_URL") ?? "https://xplkeyed.com";

const OFFER_WINDOW_MS = 48 * 3_600_000;

function offerBody(kidName: string, bookUrl: string, headline: string, lede: string) {
  return brandedEmailHtml({
    headline,
    bodyHtml: `<p>${lede}</p><p>This link expires in 48 hours. Book your free 30 minute call to claim the spot for ${kidName}.</p>`,
    ctaLabel: "Book free call",
    ctaHref: bookUrl,
  });
}

function reminderBody(kidName: string, bookUrl: string) {
  return brandedEmailHtml({
    headline: `Spot for ${kidName} is still open`,
    bodyHtml: `<p>The spot we offered yesterday is still open, but it goes to the next family tomorrow.</p>`,
    ctaLabel: "Book free call",
    ctaHref: bookUrl,
  });
}

function expiryBody(kidName: string) {
  return brandedEmailHtml({
    headline: `Spot passed to the next family`,
    bodyHtml: `<p>We've passed the spot to the next family. ${kidName} is still on the list for the next opening.</p>`,
  });
}

Deno.serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const now = new Date();
  const stamp = now.toISOString();
  const twentyFourHoursAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();

  // --- 24hr reminders ----------------------------------------------------
  const { data: reminderTargets } = await supabase
    .from("waitlist_entries")
    .select("id, parent_email, kid_first_name, offer_token")
    .eq("status", "offered")
    .lte("offered_at", twentyFourHoursAgo)
    .is("reminder_24hr_sent_at", null);

  let reminded = 0;
  for (const entry of reminderTargets ?? []) {
    await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
      to: entry.parent_email,
      subject: `Spot for ${entry.kid_first_name} closes in 24 hours`,
      html: reminderBody(
        entry.kid_first_name,
        `${NEXT_PUBLIC_APP_URL}/offer/${entry.offer_token}`,
      ),
    });
    await supabase
      .from("waitlist_entries")
      .update({ reminder_24hr_sent_at: stamp })
      .eq("id", entry.id);
    reminded++;
  }

  // --- 48hr expiries + next-in-line offer --------------------------------
  const { data: expiringTargets } = await supabase
    .from("waitlist_entries")
    .select("id, parent_email, kid_first_name")
    .eq("status", "offered")
    .lte("offer_expires_at", stamp);

  let expired = 0;
  let promoted = 0;

  for (const entry of expiringTargets ?? []) {
    await supabase
      .from("waitlist_entries")
      .update({ status: "expired", expired_at: stamp })
      .eq("id", entry.id);

    await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
      to: entry.parent_email,
      subject: `Spot passed to the next family`,
      html: expiryBody(entry.kid_first_name),
    }).catch(() => {/* expiry email failure is non-blocking */});
    expired++;

    // Promote next-in-line: oldest waiting family gets a fresh offer.
    const { data: next } = await supabase
      .from("waitlist_entries")
      .select("id, parent_email, kid_first_name")
      .eq("status", "waiting")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!next) continue;

    const offerToken = crypto.randomUUID();
    const offerExpires = new Date(now.getTime() + OFFER_WINDOW_MS).toISOString();

    await supabase
      .from("waitlist_entries")
      .update({
        status: "offered",
        offered_at: stamp,
        offer_token: offerToken,
        offer_expires_at: offerExpires,
        reminder_24hr_sent_at: null,
      })
      .eq("id", next.id);

    await sendEmail(RESEND_API_KEY, RESEND_FROM_EMAIL, {
      to: next.parent_email,
      subject: `A spot opened in Tim's coaching roster`,
      html: offerBody(
        next.kid_first_name,
        `${NEXT_PUBLIC_APP_URL}/offer/${offerToken}`,
        `A spot opened for ${next.kid_first_name}`,
        `Tim's roster is capped at 12 students and one just opened up.`,
      ),
    });
    promoted++;
  }

  return new Response(
    JSON.stringify({ reminded, expired, promoted }),
    { headers: { "Content-Type": "application/json" } },
  );
});
