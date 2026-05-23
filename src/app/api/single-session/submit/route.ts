// POST /api/single-session/submit
//
// $24 single coaching session checkout entry point. Mirrors the trial
// /api/intake/submit endpoint structure but:
//   * Creates the curriculum with curriculum_type='single_session' and
//     a single curriculum_slot pre-bound to the parent's lesson choice
//     (no Stage C "Take on" needed — the purchase IS the take-on).
//   * Sets the subscription to lifecycle_state='PENDING_PAYMENT' +
//     auto_renew_enabled=FALSE + auto_renew_off_acknowledged_at=NOW()
//     so the auto-renew cron never fires and the
//     subscription_auto_renew_off task never surfaces in /admin.
//   * Skips the Stage C / curriculum-approval handshake. Stripe
//     Checkout completion alone activates the curriculum + slot via
//     the stripe-webhook handler (see /api/stripe-webhook).
//
// Stripe Checkout success redirects to /single-session/success.

import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { z } from "zod";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const PRICE_CENTS = 2400; // $24

const BodySchema = z.object({
  intake_id: z.string().uuid(),
  kid_first_name: z.string().trim().min(1).max(60),
  kid_age: z.number().int().min(8).max(18),
  kid_fortnite_username: z.string().trim().min(1).max(32),
  kid_discord_username: z.string().trim().min(1).max(32),
  kid_rank: z.string().trim().min(1).max(32),
  kid_platform: z.string().trim().min(1).max(32),
  kid_hours_per_week: z.number().int().min(0).max(168),
  parent_first_name: z.string().trim().min(1).max(80),
  parent_email: z.string().trim().email().max(254),
  what_to_help_with: z.string().trim().min(1).max(1000),
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

  const supabase = createServiceRoleClient();

  // No lesson validation step — single-session sales no longer ask the
  // parent to pick from a catalog. Tim assigns a lesson after payment
  // via the existing /admin lesson-swap flow.

  // ---- 1. COPPA gate for under-13. ------------------------------------
  if (parsed.kid_age < 13) {
    const verResp = await supabase
      .from("pending_intake_verifications")
      .select("verified_at, expires_at, parent_email")
      .eq("intake_id", parsed.intake_id)
      .maybeSingle();
    const row = verResp.data as
      | { verified_at: string | null; expires_at: string; parent_email: string }
      | null;
    if (!row || !row.verified_at) {
      return NextResponse.json(
        { error: "coppa_verification_required" },
        { status: 403 },
      );
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return NextResponse.json(
        { error: "coppa_verification_expired" },
        { status: 403 },
      );
    }
    if (row.parent_email.toLowerCase() !== parsed.parent_email.toLowerCase()) {
      return NextResponse.json(
        { error: "coppa_email_mismatch" },
        { status: 403 },
      );
    }
  }

  // ---- 3. Create parent + synthetic kid auth users. -------------------
  // Mirrors /api/intake/submit pattern. Synthetic kid email lets the kid
  // log into /play via magic-link-to-parent override; the real address
  // never receives mail.
  const parentAuth = await supabase.auth.admin.createUser({
    email: parsed.parent_email,
    email_confirm: true,
  });
  if (parentAuth.error || !parentAuth.data.user) {
    const msg = parentAuth.error?.message ?? "parent_auth_failed";
    const code = parentAuth.error?.code ?? null;
    if (code === "email_exists" || /already.*registered/i.test(msg)) {
      return NextResponse.json(
        { error: "parent_email_already_registered" },
        { status: 409 },
      );
    }
    console.error("[single-session/submit] parent auth.createUser failed", parentAuth.error);
    return NextResponse.json({ error: "parent_auth_failed" }, { status: 500 });
  }

  const kidSyntheticEmail = `kid+${crypto.randomUUID()}@xplkeyed.internal`;
  const kidAuth = await supabase.auth.admin.createUser({
    email: kidSyntheticEmail,
    email_confirm: true,
  });
  if (kidAuth.error || !kidAuth.data.user) {
    console.error("[single-session/submit] kid auth.createUser failed", kidAuth.error);
    await supabase.auth.admin.deleteUser(parentAuth.data.user.id).catch(() => null);
    return NextResponse.json({ error: "kid_auth_failed" }, { status: 500 });
  }

  // ---- 4. Insert family / parent / player / subscription. -------------
  // No RPC — direct service-role inserts. If any step fails, roll back
  // both auth users + any earlier inserts.
  const cleanupOnError = async () => {
    await supabase.auth.admin
      .deleteUser(parentAuth.data.user!.id)
      .catch(() => null);
    await supabase.auth.admin
      .deleteUser(kidAuth.data.user!.id)
      .catch(() => null);
  };

  const familyInsert = await supabase
    .from("families")
    .insert({} as never)
    .select("id")
    .single();
  const family = familyInsert.data as { id: string } | null;
  if (familyInsert.error || !family) {
    console.error("[single-session/submit] family insert failed", familyInsert.error);
    await cleanupOnError();
    return NextResponse.json({ error: "family_insert_failed" }, { status: 500 });
  }

  const parentInsert = await supabase
    .from("parents")
    .insert({
      family_id: family.id,
      first_name: parsed.parent_first_name,
      email: parsed.parent_email,
      auth_user_id: parentAuth.data.user.id,
      email_verified_at:
        parsed.kid_age < 13 ? new Date().toISOString() : null,
    } as never)
    .select("id")
    .single();
  if (parentInsert.error) {
    console.error("[single-session/submit] parent insert failed", parentInsert.error);
    await cleanupOnError();
    return NextResponse.json({ error: "parent_insert_failed" }, { status: 500 });
  }

  const playerInsert = await supabase
    .from("players")
    .insert({
      family_id: family.id,
      first_name: parsed.kid_first_name,
      age: parsed.kid_age,
      fortnite_username: parsed.kid_fortnite_username,
      discord_username: parsed.kid_discord_username,
      current_rank: parsed.kid_rank,
      platform: parsed.kid_platform,
      hours_per_week: parsed.kid_hours_per_week,
      auth_user_id: kidAuth.data.user.id,
    } as never)
    .select("id")
    .single();
  const player = playerInsert.data as { id: string } | null;
  if (playerInsert.error || !player) {
    console.error("[single-session/submit] player insert failed", playerInsert.error);
    await cleanupOnError();
    return NextResponse.json({ error: "player_insert_failed" }, { status: 500 });
  }

  const now = new Date().toISOString();

  // tier='single_lesson' matches the existing CHECK constraint on
  // subscriptions.tier (set when the schema was first written for
  // the originally-specced $14 single lesson). The user-facing
  // naming is "single coaching session" per the 2026-05-22 design
  // pivot — that distinction lives in copy only. DB tier label
  // stays as the originally-reserved value.
  const subInsert = await supabase
    .from("subscriptions")
    .insert({
      player_id: player.id,
      tier: "single_lesson",
      status: "trial",
      lifecycle_state: "PENDING_PAYMENT",
      waiting_on: "PARENT",
      auto_renew_enabled: false,
      auto_renew_off_acknowledged_at: now,
      payment_pending_at: now,
    } as never)
    .select("id")
    .single();
  const subscription = subInsert.data as { id: string } | null;
  if (subInsert.error || !subscription) {
    console.error("[single-session/submit] subscription insert failed", subInsert.error);
    await cleanupOnError();
    return NextResponse.json(
      { error: "subscription_insert_failed" },
      { status: 500 },
    );
  }

  // Pick any active coach as the curriculum creator (n=1: that's Tim).
  const coachLookup = await supabase
    .from("coaches")
    .select("id")
    .eq("is_active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const coach = coachLookup.data as { id: string } | null;
  if (!coach) {
    console.error("[single-session/submit] no active coach found");
    await cleanupOnError();
    return NextResponse.json({ error: "no_active_coach" }, { status: 500 });
  }

  const approvalToken = crypto.randomBytes(32).toString("hex");
  const currInsert = await supabase
    .from("curricula")
    .insert({
      player_id: player.id,
      created_by: coach.id,
      status: "pending_approval",
      approval_token: approvalToken,
      personalization_note: parsed.what_to_help_with,
      curriculum_type: "single_session",
      waiting_on: "SYSTEM",
    } as never)
    .select("id")
    .single();
  const curriculum = currInsert.data as { id: string } | null;
  if (currInsert.error || !curriculum) {
    console.error("[single-session/submit] curriculum insert failed", currInsert.error);
    await cleanupOnError();
    return NextResponse.json(
      { error: "curriculum_insert_failed" },
      { status: 500 },
    );
  }

  // Slot created with lesson_id NULL. Tim picks (or builds) the lesson
  // post-payment via the existing /admin lesson-swap surface. Sunday
  // delivery cron will skip a slot with no lesson, so materials only
  // ship once Tim assigns one — which is what we want.
  const slotInsert = await supabase.from("curriculum_slots").insert({
    curriculum_id: curriculum.id,
    week_number: 1,
    is_vod_review: false,
    lesson_id: null,
    live_call_at: null,
    live_call_event_id: null,
  } as never);
  if (slotInsert.error) {
    console.error("[single-session/submit] slot insert failed", slotInsert.error);
    await cleanupOnError();
    return NextResponse.json({ error: "slot_insert_failed" }, { status: 500 });
  }

  // Clean up the pending intake verification row (only present for <13).
  if (parsed.kid_age < 13) {
    await supabase
      .from("pending_intake_verifications")
      .delete()
      .eq("intake_id", parsed.intake_id);
  }

  // ---- 5. Stripe Customer + Checkout Session. -------------------------
  const customer = await stripe.customers.create({
    email: parsed.parent_email,
    name: parsed.parent_first_name,
    metadata: {
      family_id: family.id,
      xpl_keyed_player_id: player.id,
      purchase_kind: "single_session",
    },
  });

  await supabase
    .from("families")
    .update({ stripe_customer_id: customer.id } as never)
    .eq("id", family.id);

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer: customer.id,
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: `${parsed.kid_first_name}'s single coaching session`,
            description: `30 min Discord call with Tim plus lesson materials. Lesson picked by Tim from "${parsed.what_to_help_with.slice(0, 60)}${parsed.what_to_help_with.length > 60 ? "..." : ""}".`,
          },
          unit_amount: PRICE_CENTS,
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      // No setup_future_usage — single charge, no auto-renew.
      metadata: {
        kind: "single_session",
        curriculum_id: curriculum.id,
        subscription_id: subscription.id,
        family_id: family.id,
        player_id: player.id,
      },
    },
    metadata: {
      kind: "single_session",
      curriculum_id: curriculum.id,
      subscription_id: subscription.id,
      family_id: family.id,
      player_id: player.id,
      approval_token: approvalToken,
    },
    // {CHECKOUT_SESSION_ID} is replaced by Stripe at redirect time so
    // the success page can look up customer details (email) without
    // us leaking it through the URL ourselves.
    success_url: `${APP_URL}/single-session/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${APP_URL}/single-session`,
  });

  if (!session.url) {
    return NextResponse.json(
      { error: "session_url_missing" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: session.url });
}
