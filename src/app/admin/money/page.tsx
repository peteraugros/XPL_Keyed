import StubPage from "../_components/StubPage";

export const dynamic = "force-dynamic";

export default function MoneyPage() {
  return (
    <StubPage
      eyebrow="Money"
      title="Revenue and billing health"
      intro="The financial surface. Revenue MTD on Home is stubbed today; this page wires up once Stripe webhook data is flowing into our DB."
      comingSoon={[
        "Monthly revenue bar chart with cycle level granularity",
        "Outstanding invoices and dunning queue",
        "Payment method health: cards expiring soon, recent declines",
        "Operator payout history once the platform fee is in place",
      ]}
    />
  );
}
