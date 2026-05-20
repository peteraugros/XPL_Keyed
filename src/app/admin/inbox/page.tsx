import StubPage from "../_components/StubPage";

export const dynamic = "force-dynamic";

export default function InboxPage() {
  return (
    <StubPage
      eyebrow="Inbox"
      title="Inbox"
      intro="Every conversation across every client in one place. Today you see per kid threads on the Clients page; this is the batch surface."
      comingSoon={[
        "Cross-client message list with newest unread on top",
        "Reply inline without leaving the inbox",
        "Filter by waiting on Tim vs waiting on parent or kid",
        "Search by client name or message body",
      ]}
    />
  );
}
