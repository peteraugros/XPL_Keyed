// POST /api/intake/request-verification
//
// Fires from the under-13 COPPA gate at the L1 -> L2 boundary of the intake
// form. Receives a client-generated intake_id (UUID, opaque to the user),
// parent_first_name, and parent_email. Stores a fresh token in
// pending_intake_verifications and emails the parent a verification link.
//
// Re-requests with the same intake_id overwrite the prior token and reset
// verified_at to NULL — this is the path for "parent changed mind on email."
//
// No rate-limiting at MVP (1 to 10 clients). Resend's per-recipient limits
// are the backstop. Revisit if the form is ever scraped.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resend, FROM_EMAIL } from "@/lib/email/resend";
import { brandedEmailHtml } from "@/lib/email/template";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const TOKEN_TTL_HOURS = 24;

const BodySchema = z.object({
  intake_id: z.string().uuid(),
  parent_first_name: z.string().trim().min(1).max(80),
  parent_email: z.string().trim().email().max(254),
});

export async function POST(req: Request) {
  let parsed: z.infer<typeof BodySchema>;
  try {
    parsed = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_HOURS * 3600 * 1000).toISOString();

  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("pending_intake_verifications")
    .upsert(
      {
        intake_id: parsed.intake_id,
        parent_first_name: parsed.parent_first_name,
        parent_email: parsed.parent_email,
        token,
        verified_at: null,
        expires_at: expiresAt,
      },
      { onConflict: "intake_id" },
    );

  if (error) {
    console.error("[intake/request-verification] upsert failed", error);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  const verifyUrl = `${APP_URL}/intake/verify?t=${token}`;
  const html = brandedEmailHtml({
    headline: "Confirm your child's coaching trial",
    bodyHtml: `<p>Hi ${escapeHtml(parsed.parent_first_name)},</p>
<p>Your child is starting a free trial with XPL Keyed. Because your child is under 13, we need you to confirm before we go any further.</p>
<p>Tap the button below from the same device where the form was started. The link is good for 24 hours.</p>
<p style="font-size:13px;color:rgba(255,255,255,0.6);">If you did not start this trial, you can ignore this email. No account is created until you click.</p>`,
    ctaLabel: "Confirm and continue",
    ctaHref: verifyUrl,
  });

  try {
    await resend.emails.send({
      from: FROM_EMAIL,
      to: parsed.parent_email,
      subject: "Confirm your child's coaching trial",
      html,
    });
  } catch (err) {
    console.error("[intake/request-verification] resend failed", err);
    return NextResponse.json({ error: "email_send_failed" }, { status: 502 });
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
