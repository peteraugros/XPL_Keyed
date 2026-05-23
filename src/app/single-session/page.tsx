// /single-session
//
// $24 single coaching session entry. Pure client-rendered after the
// design pivot 2026-05-23: the parent no longer picks a lesson from
// a catalog. They provide info; Tim picks (or builds) the lesson
// after payment lands. The form is now a 4-level gamified flow
// mirroring /intake's UX shape.
//
// COPPA gate for under-13 reuses the existing
// /api/intake/request-verification + /intake/verify infrastructure
// (the verify route's `return_to` allow-list includes
// /single-session).

import SingleSessionClient from "./SingleSessionClient";

export const dynamic = "force-dynamic";

export default function SingleSessionPage() {
  return <SingleSessionClient />;
}
