// POST /api/intake/submit
//
// Final step of Stage A intake. Receives all 4-level form data, creates the
// two auth.users rows (real for parent, synthetic for kid), calls rpc_intake
// to atomically write the family graph, then emails the parent a branded
// magic link.
//
// Rollback discipline: if rpc_intake fails for any reason after one or both
// auth.users rows exist, those rows are deleted via the admin API to avoid
// orphaning auth identities. Treat the rollback errors as observability-only
// (log + continue) — leaving an orphan auth user is preferable to surfacing a
// confusing second error to the parent.
//
// Synthetic kid email is "kid+<uuid>@xplkeyed.internal". No magic link is
// sent to the kid in Task 5; Task 6 wires the email-interception layer that
// routes kid magic links to parent inboxes.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendParentMagicLink } from "@/lib/supabase/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYNTHETIC_KID_DOMAIN = "xplkeyed.internal";

const BodySchema = z.object({
  intake_id: z.string().uuid(),
  parent_first_name: z.string().trim().min(1).max(80),
  parent_email: z.string().trim().email().max(254),
  kid_first_name: z.string().trim().min(1).max(80),
  kid_age: z.number().int().min(8).max(18),
  kid_fortnite_username: z.string().trim().min(1).max(80),
  kid_discord_username: z.string().trim().min(1).max(80),
  kid_current_rank: z.string().trim().min(1).max(40),
  kid_platform: z.string().trim().min(1).max(40),
  kid_hours_per_week: z.number().int().min(0).max(168),
});

type Body = z.infer<typeof BodySchema>;

export async function POST(req: Request) {
  let body: Body;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const supabase = createServiceRoleClient();

  // ---- 1. Create parent auth.users ---------------------------------------
  const parentCreate = await supabase.auth.admin.createUser({
    email: body.parent_email,
    email_confirm: true,
    user_metadata: { role: "parent", first_name: body.parent_first_name },
  });

  if (parentCreate.error || !parentCreate.data.user) {
    const msg = parentCreate.error?.message ?? "";
    const conflict = msg.toLowerCase().includes("already") || msg.toLowerCase().includes("registered");
    return NextResponse.json(
      { error: conflict ? "parent_email_already_registered" : "auth_create_failed", detail: msg },
      { status: conflict ? 409 : 500 },
    );
  }
  const parentAuthUserId = parentCreate.data.user.id;

  // ---- 2. Create kid synthetic auth.users --------------------------------
  const syntheticEmail = `kid+${crypto.randomUUID()}@${SYNTHETIC_KID_DOMAIN}`;
  const kidCreate = await supabase.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    user_metadata: {
      role: "player",
      first_name: body.kid_first_name,
      synthetic: true,
    },
  });

  if (kidCreate.error || !kidCreate.data.user) {
    await rollbackAuthUsers(supabase, [parentAuthUserId]);
    return NextResponse.json(
      { error: "auth_create_failed", detail: kidCreate.error?.message ?? "" },
      { status: 500 },
    );
  }
  const kidAuthUserId = kidCreate.data.user.id;

  // ---- 3. Atomic family/parents/players/subscription/quest writes --------
  const rpcResult = await supabase.rpc("rpc_intake", {
    p_intake_id: body.intake_id,
    p_parent_auth_user_id: parentAuthUserId,
    p_parent_first_name: body.parent_first_name,
    p_parent_email: body.parent_email,
    p_kid_auth_user_id: kidAuthUserId,
    p_kid_first_name: body.kid_first_name,
    p_kid_age: body.kid_age,
    p_kid_fortnite_username: body.kid_fortnite_username,
    p_kid_discord_username: body.kid_discord_username,
    p_kid_current_rank: body.kid_current_rank,
    p_kid_platform: body.kid_platform,
    p_kid_hours_per_week: body.kid_hours_per_week,
  });

  if (rpcResult.error) {
    await rollbackAuthUsers(supabase, [parentAuthUserId, kidAuthUserId]);
    const msg = rpcResult.error.message ?? "";
    let status = 500;
    let code: string = "rpc_failed";
    if (msg.includes("coppa_verification_required")) {
      status = 403;
      code = "coppa_verification_required";
    } else if (msg.includes("parent_email_already_registered")) {
      status = 409;
      code = "parent_email_already_registered";
    }
    return NextResponse.json({ error: code, detail: msg }, { status });
  }

  // ---- 4. Welcome email via the magic-link helper ------------------------
  // Failure is logged and swallowed — the family graph is written; the parent
  // can always request a fresh link from /login.
  const welcomeResult = await sendParentMagicLink(supabase, body.parent_email, {
    next: "/portal",
    subject: "Your XPL Keyed dashboard is ready",
    headline: "Welcome to XPL Keyed",
    bodyHtml: `<p>Hi ${escapeHtml(body.parent_first_name)},</p>
<p>${escapeHtml(body.kid_first_name)}'s free trial is set up. Tap the button to open your parent dashboard. You can review the trial prep, see what Tim watches before the call, and book the call if you have not already.</p>
<p style="font-size:13px;color:rgba(255,255,255,0.6);">This link signs you in. Keep it private. Questions? Reply to this email.</p>`,
    ctaLabel: "Open your dashboard",
  });
  if (!welcomeResult.ok) {
    console.error("[intake/submit] welcome email failed", welcomeResult.code);
  }

  const payload = rpcResult.data as {
    family_id: string;
    parent_id: string;
    player_id: string;
    subscription_id: string;
  };

  return NextResponse.json({
    ok: true,
    family_id: payload.family_id,
    player_id: payload.player_id,
    parent_email: body.parent_email,
  });
}

async function rollbackAuthUsers(
  supabase: ReturnType<typeof createServiceRoleClient>,
  userIds: string[],
) {
  for (const id of userIds) {
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) console.error("[intake/submit] rollback deleteUser failed", id, error);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
