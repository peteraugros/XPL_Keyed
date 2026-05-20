// Branded email send + notification_log audit write.
//
// Wraps the Resend SDK so every system-fired email lands in our audit
// trail without each caller needing to remember the second insert.
// Used everywhere except the Deno Edge Functions (which have their own
// Resend helper at supabase/functions/_shared/resend.ts — those need
// a parallel audit-write helper, deferred for a separate session).
//
// On send failure: still writes the notification_log row with
// status='failed' + error_message so Tim/Peter can see attempted-but-
// failed sends on the Dad admin recent-activity panel. Doesn't throw
// — caller's main flow keeps going.

import { resend, FROM_EMAIL } from "./resend";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type EmailTrigger =
  | "magic_link"
  | "coppa_verification"
  | "branded_booking_confirmation"
  | "stage_c_take_on"
  | "stage_c_decline"
  | "lesson_delivery_week1"
  | "auto_renew_off"
  | "coach_cancel"
  | "coach_cancel_late"
  | "no_show"
  | "parent_cancel_notification"
  | "other";

export type RecipientType = "coach" | "parent" | "player";

export type EntityType =
  | "curriculum_slot"
  | "subscription"
  | "cancellation_event"
  | "waitlist_entry"
  | "curriculum"
  | "intake"
  | "trial_call"
  | "no_show";

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  trigger: EmailTrigger;
  recipientType: RecipientType;
  recipientId?: string | null;
  relatedEntityType?: EntityType | null;
  relatedEntityId?: string | null;
};

const FROM_STRIPPED = `XPL Keyed <${FROM_EMAIL.replace(/^.*<|>$/g, "")}>`;

export async function sendBrandedEmail(args: SendArgs): Promise<{ ok: boolean }> {
  const service = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  let status: "sent" | "failed" = "sent";
  let errorMessage: string | null = null;

  // Skip the actual send if Resend isn't configured. Still log the
  // skip so the audit trail is honest.
  if (!process.env.RESEND_API_KEY) {
    status = "failed";
    errorMessage = "resend_not_configured";
  } else {
    try {
      await resend.emails.send({
        from: FROM_STRIPPED,
        to: args.to,
        subject: args.subject,
        html: args.html,
      });
    } catch (err) {
      status = "failed";
      errorMessage = err instanceof Error ? err.message : String(err);
      console.error("[email/send] resend failed", args.trigger, errorMessage);
    }
  }

  // Audit write. Best-effort — if the insert itself fails (e.g.
  // service-role unavailable in some weird local config), we log and
  // continue. The email itself already went out.
  try {
    await service.from("notification_log").insert({
      channel: "email",
      trigger: args.trigger,
      recipient_type: args.recipientType,
      recipient_id: args.recipientId ?? null,
      related_entity_type: args.relatedEntityType ?? null,
      related_entity_id: args.relatedEntityId ?? null,
      status,
      sent_at: status === "sent" ? nowIso : null,
      error_message: errorMessage,
    } as never);
  } catch (logErr) {
    console.error("[email/send] notification_log insert failed", logErr);
  }

  return { ok: status === "sent" };
}
