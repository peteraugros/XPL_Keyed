// POST /api/portal/billing-portal
//
// Parent-initiated. Creates a Stripe BillingPortal session for the
// authed parent's family and returns the URL for client redirect.
//
// The Stripe BillingPortal is Stripe-hosted UI that lets the customer
// update payment methods, view invoices, and cancel the subscription.
// We hand them off there rather than rebuilding those flows in-app.
//
// Auth posture: the cookie-bound session resolves to a parent row; we
// derive the family and require it has a stripe_customer_id (set by the
// curriculum checkout endpoint on first conversion). A family with no
// Stripe Customer hasn't paid yet — we 409 with a helpful message.

import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

type ParentLookup = { family_id: string };
type FamilyLookup = { stripe_customer_id: string | null };

export async function POST() {
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parentRow = await supabase
    .from("parents")
    .select("family_id")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const parent = parentRow.data as ParentLookup | null;
  if (!parent) {
    return NextResponse.json({ error: "not_a_parent" }, { status: 403 });
  }

  const familyRow = await supabase
    .from("families")
    .select("stripe_customer_id")
    .eq("id", parent.family_id)
    .maybeSingle();
  const family = familyRow.data as FamilyLookup | null;
  if (!family || !family.stripe_customer_id) {
    return NextResponse.json(
      { error: "no_stripe_customer" },
      { status: 409 },
    );
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: family.stripe_customer_id,
    return_url: `${APP_URL}/portal`,
  });

  return NextResponse.json({ url: session.url });
}
