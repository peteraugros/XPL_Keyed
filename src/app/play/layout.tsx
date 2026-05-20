// Wraps every /play/* route in the kid-side sidebar shell. Auth + role
// gate lives in requirePlayerSession; non players are redirected before
// the shell renders. Pages call the same helper for their own data;
// React's cache() de duplicates the queries within a single request.

import { requirePlayerSession } from "./_lib/session";
import PlayShell from "./PlayShell";

export const dynamic = "force-dynamic";

export default async function PlayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { player } = await requirePlayerSession();
  return <PlayShell playerFirstName={player.first_name}>{children}</PlayShell>;
}
