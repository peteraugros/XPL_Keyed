// Wraps every /admin/* route in AdminShell. Auth + role gate runs in
// requireCoachSession so non-coaches never reach the shell. Pages call
// the same helper for their data; React's cache() deduplicates.

import { requireCoachSession } from "./_lib/session";
import AdminShell from "./_components/AdminShell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { coach } = await requireCoachSession();
  return (
    <AdminShell coachName={coach.display_name} isDad={coach.is_dad}>
      {children}
    </AdminShell>
  );
}
