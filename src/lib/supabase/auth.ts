// Magic-link helpers used by the auth routes and the intake submit flow.
//
// The pattern: we never let Supabase's email pipeline deliver magic links.
// Instead we call `auth.admin.generateLink`, capture the action_link, and
// hand the URL to Resend ourselves. Two reasons:
//
//   1. Parent emails own a single branded voice (Hard rule #8 + the dunning
//      stack). Resend renders the template; Supabase's stock email never
//      reaches a parent inbox.
//   2. Kids under 13 don't have an inbox. Each player has a synthetic
//      `kid+<uuid>@xplkeyed.internal` auth identity at intake time, and the
//      kid's magic link is delivered to the parent's real address. The
//      parent forwards, hands the device over, or just clicks for them.
//      The override is enforced here: `sendPlayerMagicLink` reads the
//      player's auth.users email (synthetic) to generate the link, then
//      sends to `parents.email` (real). No code path in the app should
//      ever email a synthetic address.
//
// Both helpers return an `ok` / `code` shape so route handlers can map to
// HTTP status codes without leaking detail to the client.

import { brandedEmailHtml } from "@/lib/email/template";
import { sendBrandedEmail } from "@/lib/email/send";
import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceRoleClient = ReturnType<typeof createServiceRoleClient>;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export type MagicLinkResult =
  | { ok: true }
  | { ok: false; code: "not_found" | "no_auth_user" | "generate_failed" | "send_failed" };

export async function sendParentMagicLink(
  supabase: ServiceRoleClient,
  parentEmail: string,
  opts: {
    next?: string;
    subject?: string;
    headline?: string;
    bodyHtml?: string;
    ctaLabel?: string;
  } = {},
): Promise<MagicLinkResult> {
  const next = safeNextPath(opts.next) ?? "/portal";
  const lookup = await supabase
    .from("parents")
    .select("email, first_name")
    .ilike("email", parentEmail)
    .maybeSingle();

  if (lookup.error) {
    console.error("[auth] parent lookup failed", lookup.error);
    return { ok: false, code: "generate_failed" };
  }
  if (!lookup.data) return { ok: false, code: "not_found" };

  const linkResult = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: lookup.data.email,
    options: { redirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (linkResult.error || !linkResult.data.properties?.action_link) {
    console.error("[auth] parent generateLink failed", linkResult.error);
    return { ok: false, code: "generate_failed" };
  }

  return await deliver({
    to: lookup.data.email,
    subject: opts.subject ?? "Sign in to XPL Keyed",
    headline: opts.headline ?? `Welcome back, ${escapeHtml(lookup.data.first_name)}`,
    bodyHtml:
      opts.bodyHtml ??
      `<p>Tap the button to sign in to your XPL Keyed dashboard. The link is good for one hour.</p>`,
    ctaLabel: opts.ctaLabel ?? "Open your dashboard",
    ctaHref: linkResult.data.properties.action_link,
    recipientType: "parent",
  });
}

export async function sendCoachMagicLink(
  supabase: ServiceRoleClient,
  coachEmail: string,
  opts: { next?: string } = {},
): Promise<MagicLinkResult> {
  const next = safeNextPath(opts.next) ?? "/admin";

  const lookup = await supabase
    .from("coaches")
    .select("email, display_name, is_active")
    .ilike("email", coachEmail)
    .maybeSingle();

  if (lookup.error) {
    console.error("[auth] coach lookup failed", lookup.error);
    return { ok: false, code: "generate_failed" };
  }
  const coach = lookup.data as
    | { email: string; display_name: string; is_active: boolean }
    | null;
  if (!coach || !coach.is_active) return { ok: false, code: "not_found" };

  const linkResult = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: coach.email,
    options: { redirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (linkResult.error || !linkResult.data.properties?.action_link) {
    console.error("[auth] coach generateLink failed", linkResult.error);
    return { ok: false, code: "generate_failed" };
  }

  return await deliver({
    to: coach.email,
    subject: "Sign in to XPL Keyed admin",
    headline: `Welcome back, ${escapeHtml(coach.display_name)}`,
    bodyHtml: `<p>Tap the button to open the coach admin. The link is good for one hour.</p>`,
    ctaLabel: "Open admin",
    ctaHref: linkResult.data.properties.action_link,
    recipientType: "coach",
  });
}

export async function sendPlayerMagicLink(
  supabase: ServiceRoleClient,
  parentEmail: string,
  opts: { next?: string; playerFirstName?: string } = {},
): Promise<MagicLinkResult> {
  const next = safeNextPath(opts.next) ?? "/play";

  // Resolve parent.email -> family_id -> player.auth_user_id.
  // Multi-kid: if playerFirstName is provided, case-insensitive match
  // within the family; ties broken by oldest. If omitted, falls back
  // to the family's oldest player (single-kid families are this case).
  const parentRow = await supabase
    .from("parents")
    .select("family_id, email")
    .ilike("email", parentEmail)
    .maybeSingle();

  if (parentRow.error) {
    console.error("[auth] parent lookup failed", parentRow.error);
    return { ok: false, code: "generate_failed" };
  }
  if (!parentRow.data) return { ok: false, code: "not_found" };

  let playersQuery = supabase
    .from("players")
    .select("first_name, auth_user_id")
    .eq("family_id", parentRow.data.family_id)
    .order("created_at", { ascending: true })
    .limit(1);
  const nameFilter = opts.playerFirstName?.trim();
  if (nameFilter) {
    playersQuery = playersQuery.ilike("first_name", nameFilter);
  }
  const playerRow = await playersQuery.maybeSingle();

  if (playerRow.error) {
    console.error("[auth] player lookup failed", playerRow.error);
    return { ok: false, code: "generate_failed" };
  }
  if (!playerRow.data) return { ok: false, code: "not_found" };
  if (!playerRow.data.auth_user_id) return { ok: false, code: "no_auth_user" };

  // Pull the synthetic email off the auth.users row — we never store it in
  // public.players so there's no risk of it leaking via a select policy.
  const authUser = await supabase.auth.admin.getUserById(playerRow.data.auth_user_id);
  if (authUser.error || !authUser.data.user?.email) {
    console.error("[auth] kid auth lookup failed", authUser.error);
    return { ok: false, code: "no_auth_user" };
  }
  const syntheticEmail = authUser.data.user.email;

  const linkResult = await supabase.auth.admin.generateLink({
    type: "magiclink",
    email: syntheticEmail,
    options: { redirectTo: `${APP_URL}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (linkResult.error || !linkResult.data.properties?.action_link) {
    console.error("[auth] kid generateLink failed", linkResult.error);
    return { ok: false, code: "generate_failed" };
  }

  return await deliver({
    to: parentRow.data.email,
    subject: `Sign in link for ${playerRow.data.first_name}`,
    headline: `${escapeHtml(playerRow.data.first_name)}'s sign in link`,
    bodyHtml: `<p>This link signs ${escapeHtml(playerRow.data.first_name)} in to their XPL Keyed quest log. Hand them the device or forward this email. The link is good for one hour.</p>
<p style="font-size:13px;color:rgba(255,255,255,0.6);">You have full read access to ${escapeHtml(playerRow.data.first_name)}'s messages and lessons from your own parent dashboard. This link is only for the player view.</p>`,
    ctaLabel: `Open ${escapeHtml(playerRow.data.first_name)}'s portal`,
    ctaHref: linkResult.data.properties.action_link,
    // Magic link is delivered to the parent's inbox but signs the
    // synthetic player auth user in. Audit-wise this is a 'player'
    // signal — that's whose session lands.
    recipientType: "player",
  });
}

// Restricts `next` to same-origin pathnames. Blocks `//evil.com` and full
// URLs so the callback can't be turned into an open redirect.
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next) return null;
  if (!next.startsWith("/")) return null;
  if (next.startsWith("//")) return null;
  if (next.startsWith("/\\")) return null;
  return next;
}

async function deliver(opts: {
  to: string;
  subject: string;
  headline: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaHref: string;
  recipientType: "parent" | "player" | "coach";
}): Promise<MagicLinkResult> {
  // Every magic-link email gets a bookmark/login fallback footer so the
  // recipient has a durable way back even if this email is deleted. Display
  // text is always xplkeyed.com/login (brand-stable); the href points at
  // APP_URL so dev environments still work.
  const loginDisplay = APP_URL.replace(/^https?:\/\//, "");
  const bodyWithFooter = `${opts.bodyHtml}
<p style="margin-top:24px;font-size:13px;color:rgba(255,255,255,0.6);border-top:1px solid rgba(255,255,255,0.12);padding-top:16px;">Need to come back later? Sign in any time at <a href="${APP_URL}/login" style="color:#C7FF3D;">${loginDisplay}/login</a>.</p>`;
  const r = await sendBrandedEmail({
    to: opts.to,
    subject: opts.subject,
    html: brandedEmailHtml({
      headline: opts.headline,
      bodyHtml: bodyWithFooter,
      ctaLabel: opts.ctaLabel,
      ctaHref: opts.ctaHref,
    }),
    trigger: "magic_link",
    recipientType: opts.recipientType,
  });
  return r.ok ? { ok: true } : { ok: false, code: "send_failed" };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
