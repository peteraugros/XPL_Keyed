import StubPage from "../_components/StubPage";

export const dynamic = "force-dynamic";

export default function AnnouncementsPage() {
  return (
    <StubPage
      eyebrow="Communication"
      title="Announcements"
      intro="Platform wide news that affects every family. Things like holiday weeks, scheduled coach time off, or tournament weeks where the rhythm changes."
      comingSoon={[
        "Holiday and break weeks announced in advance",
        "Tournament weeks where Tim's availability shifts",
        "New features and changes to your dashboard",
        "Family events and community moments",
      ]}
    />
  );
}
