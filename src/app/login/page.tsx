// /login — sign-in surface.
//
// Server Component shell does two things before showing the form:
//
//   1. If the visitor already has a valid session, look up which role
//      they are (parent / player / coach) and 302 them to the right
//      dashboard. This is "browser remembers me" behavior — they hit
//      /login from a bookmark or nav link and land back in their own
//      dashboard with no email round-trip.
//
//   2. Otherwise render the LoginForm Client Component. By default the
//      form shows two role buttons (Parent / Player); the Coach option
//      is hidden from the public-facing UI and only appears when the
//      URL has ?role=coach (Tim's bookmark). Keeps the parent-facing
//      page free of admin-feeling controls.
//
// The auto-redirect only fires when both a session AND a matching role
// row exist. An orphan session (auth user with no parent/player/coach
// row, e.g. left over from a deleted family) falls through to the form
// so the user can re-auth into the right identity.

import { redirect as _redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import LoginForm, { type Role } from "./LoginForm";

export const dynamic = "force-dynamic";

function redirect(url: string): never {
  (_redirect as (u: string) => never)(url);
  throw new Error("redirect did not throw");
}

type IdLookup = { id: string };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const roleParam = (Array.isArray(params.role) ? params.role[0] : params.role) ?? null;
  const errorParam = (Array.isArray(params.error) ? params.error[0] : params.error) ?? null;
  const nextParam = (Array.isArray(params.next) ? params.next[0] : params.next) ?? null;
  const coachParam =
    (Array.isArray(params.coach) ? params.coach[0] : params.coach) ?? null;
  const initialCoachPanel = coachParam === "1";

  // Check session BEFORE rendering the form so a returning user with a
  // valid cookie jumps straight to their dashboard.
  //
  // EXCEPT when ?coach=1 is in the URL or any kind of explicit form
  // intent is signaled. Tim's secret-login panel needs the form to
  // mount even when he's already signed in (switch accounts / try
  // password instead of magic link). Skipping the redirect here means
  // the form renders and the triple-tap / "tim" keyboard / ?coach=1
  // mechanisms all work.
  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  const user = userResult.data.user;

  if (user && !initialCoachPanel) {
    const [parentRow, playerRow, coachRow] = await Promise.all([
      supabase.from("parents").select("id").eq("auth_user_id", user.id).maybeSingle(),
      supabase.from("players").select("id").eq("auth_user_id", user.id).maybeSingle(),
      supabase.from("coaches").select("id").eq("auth_user_id", user.id).maybeSingle(),
    ]);

    if ((parentRow.data as IdLookup | null)?.id) redirect(nextParam ?? "/portal");
    if ((playerRow.data as IdLookup | null)?.id) redirect(nextParam ?? "/play");
    if ((coachRow.data as IdLookup | null)?.id) redirect(nextParam ?? "/admin");
    // Otherwise: orphan session, fall through to render the form.
  }

  const showCoachOption = roleParam === "coach";
  const initialRole: Role =
    roleParam === "coach" || roleParam === "player" || roleParam === "parent"
      ? roleParam
      : "parent";

  return (
    <LoginForm
      initialRole={initialRole}
      showCoachOption={showCoachOption}
      next={nextParam}
      callbackError={errorParam}
      initialCoachPanel={initialCoachPanel}
    />
  );
}
