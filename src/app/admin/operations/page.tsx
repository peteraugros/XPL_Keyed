import StubPage from "../_components/StubPage";

export const dynamic = "force-dynamic";

export default function OperationsPage() {
  return (
    <StubPage
      eyebrow="Operations"
      title="Platform health"
      intro="Real time status of every system XPL Keyed depends on. Today the integrations are healthy by virtue of not breaking; this surface gives Tim a glance check."
      comingSoon={[
        "Stripe webhook delivery success rate (last 24 hours)",
        "Discord bot heartbeat and rate limit headroom",
        "Calendly webhook delivery and signing key freshness",
        "Resend bounce rate and domain reputation",
        "Recent cron run history with green / yellow / red status",
      ]}
    />
  );
}
