// GET /api/portal/sessions/resolve-event?uri=<calendly_event_uri>
//
// Looks up a Calendly event by URI and returns its start_time. Used by
// the reschedule modal: Calendly's event_scheduled postMessage only
// gives us the event URI, but we need the start time to commit the
// reschedule. We do the lookup server-side so the CALENDLY_PAT never
// reaches the browser.

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // Auth: must be a signed-in parent. We don't validate ownership of
  // the event because the URI itself isn't sensitive and the actual
  // commit (POST /reschedule) does its own ownership chain check.
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const uri = url.searchParams.get("uri");
  if (!uri || !uri.startsWith("https://api.calendly.com/scheduled_events/")) {
    return NextResponse.json({ error: "invalid_uri" }, { status: 400 });
  }

  const token = process.env.CALENDLY_PAT;
  if (!token) {
    return NextResponse.json({ error: "calendly_not_configured" }, { status: 500 });
  }

  const res = await fetch(uri, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    return NextResponse.json(
      { error: "calendly_fetch_failed", status: res.status },
      { status: 502 },
    );
  }
  const body = (await res.json()) as {
    resource?: { start_time?: string };
  };
  const startTime = body.resource?.start_time;
  if (!startTime) {
    return NextResponse.json({ error: "no_start_time" }, { status: 502 });
  }
  return NextResponse.json({ start_time: startTime });
}
