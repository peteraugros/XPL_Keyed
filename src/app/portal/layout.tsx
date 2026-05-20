// Wraps every /portal/* route in the sidebar shell. Auth + role gate
// lives in requireParentSession; non parents are redirected before the
// shell renders. Pages call the same helper for their own data; React's
// cache() de duplicates the queries within a single request.

import { requireParentSession } from "./_lib/session";
import PortalShell from "./PortalShell";

export const dynamic = "force-dynamic";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { parent, player } = await requireParentSession();

  return (
    <PortalShell parentEmail={parent.email} playerFirstName={player.first_name}>
      {children}
    </PortalShell>
  );
}
