import StubPage from "../_components/StubPage";

export const dynamic = "force-dynamic";

export default function ProgressPage() {
  return (
    <StubPage
      eyebrow="Program"
      title="Progress"
      intro="A dedicated space for what your child is working on, what they have moved through, and what Tim is watching for."
      comingSoon={[
        "Rank progression over time",
        "Coach notes from each lesson",
        "Cycle history with the topics covered",
        "Milestones and goals your child has set",
        "Attendance and prep completion streaks",
      ]}
    />
  );
}
