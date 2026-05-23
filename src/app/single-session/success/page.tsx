// /single-session/success
//
// Landing page after Stripe Checkout completes. Server Component so
// we can pull the customer email out of the Stripe Checkout Session
// (Stripe replaces {CHECKOUT_SESSION_ID} in success_url at redirect
// time) and personalize the "we emailed you at X" line — matches the
// trial intake's SuccessCard treatment.
//
// The real activation work (curriculum + subscription updates,
// scheduling email send) happens in the Stripe webhook, not here.

import { stripe } from "@/lib/stripe/server";
import SuccessClient from "./SuccessClient";

export const dynamic = "force-dynamic";

export default async function SingleSessionSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;

  // Best-effort email lookup. Failure is non-fatal — we just render the
  // generic body without the address personalization.
  let parentEmail: string | null = null;
  if (session_id) {
    try {
      const session = await stripe.checkout.sessions.retrieve(session_id);
      parentEmail =
        session.customer_details?.email ?? session.customer_email ?? null;
    } catch (err) {
      console.error("[single-session/success] session retrieve failed", err);
    }
  }

  return <SuccessClient parentEmail={parentEmail} />;
}
