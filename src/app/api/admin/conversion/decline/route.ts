// POST /api/admin/conversion/decline
//
// Tim's Stage C "Not the right fit" action. Inputs:
//   - player_id (defensive; we route to subscription via player)
//
// Behavior:
//   1. Set subscriptions.status='declined' (trial-state subscription
//      transitions cleanly; CHECK constraint already permits 'declined').
//   2. Send a kind decline email to the parent with the spec'd free
//      Fortnite-creator recommendations (Mero, Reet, Pandvil).
//
// We deliberately do NOT delete the family graph: the account stays open
// so a kid who circles back later can reactivate without redoing intake.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendBrandedEmail } from "@/lib/email/send";
import { brandedEmailHtml } from "@/lib/email/template";
import type { TablesUpdate } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  player_id: z.string().uuid(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const coachLookup = await supabase
    .from("coaches")
    .select("id, is_active")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as { id: string; is_active: boolean } | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const playerLookup = await supabase
    .from("players")
    .select("id, family_id, first_name")
    .eq("id", body.player_id)
    .maybeSingle();
  const player = playerLookup.data as
    | { id: string; family_id: string; first_name: string }
    | null;
  if (!player) {
    return NextResponse.json({ error: "player_not_found" }, { status: 404 });
  }

  const parentLookup = await supabase
    .from("parents")
    .select("first_name, email")
    .eq("family_id", player.family_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const parent = parentLookup.data as { first_name: string; email: string } | null;
  if (!parent) {
    return NextResponse.json({ error: "parent_not_found" }, { status: 404 });
  }

  // Subscription update via cookie-bound client; coach RLS permits.
  // status='declined' + lifecycle_state='CANCELED' + waiting_on='SYSTEM'
  // per backend-spec section 4 (decline is terminal; no further actions).
  const patch: TablesUpdate<"subscriptions"> = {
    status: "declined",
    lifecycle_state: "CANCELED",
    waiting_on: "SYSTEM",
  };
  const updateResult = await supabase
    .from("subscriptions")
    .update(patch as never)
    .eq("player_id", player.id);
  if (updateResult.error) {
    console.error("[decline] subscription update failed", updateResult.error);
    return NextResponse.json({ error: "subscription_update_failed" }, { status: 500 });
  }

  // Decline email. Free-creator recs per CLAUDE.md Stage C decision tree.
  const html = brandedEmailHtml({
    headline: "Thanks for the call",
    bodyHtml: `<p>Hi ${escapeHtml(parent.first_name)},</p>
<p>Thanks for taking the time. After the call, my honest read is that ${escapeHtml(player.first_name)} would get more out of free creators right now than paid coaching with me. No pressure on either side.</p>
<p><strong>If you want to keep learning, these three creators make some of the best free Fortnite content for improvement:</strong></p>
<ul style="padding-left:18px;">
  <li><strong>Mero</strong>. Tournament VOD reviews and game sense.</li>
  <li><strong>Reet</strong>. Mechanics and edit course breakdowns.</li>
  <li><strong>Pandvil</strong>. Creative maps and structured drills.</li>
</ul>
<p>Your account stays open. If anything changes later, you can come back any time.</p>
<p>Have fun out there.</p>
<p style="margin-top:24px;">Tim<br/><span style="color:rgba(255,255,255,0.6);font-size:13px;">XPL Keyed</span></p>`,
  });

  const r = await sendBrandedEmail({
    to: parent.email,
    subject: `About ${player.first_name}'s coaching call`,
    html,
    trigger: "stage_c_decline",
    recipientType: "parent",
    // No clean subscription_id in scope here (we ran an UPDATE without
    // returning). Recipient_id covers the audit.
    relatedEntityType: null,
    relatedEntityId: null,
  });
  if (!r.ok) {
    // The subscription is already declined. Email failure is observability-only.
    return NextResponse.json({ ok: true, warning: "email_send_failed" });
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
