// GET /api/admin/clients/[player_id]/sessions.ics
//
// Returns a single iCalendar (.ics) file containing 4 VEVENTs for the
// kid's 4 booked curriculum_slots. Tim downloads + opens it to add all
// 4 sessions to his personal Google Calendar in one tap.
//
// Used primarily for the auto-book path, where slots have sentinel
// live_call_event_id values like "auto:<slot_id>" — Calendly never
// synced these to Tim's calendar. The single-booking path doesn't need
// this download (Calendly's native sync handles it) but the file
// renders fine either way; safe to download even if some slots are
// already on Tim's calendar.
//
// Auth: coach-gated. Service-role lookup of player + curriculum scoped
// by coach.is_active.

import { NextResponse } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlotRow = {
  id: string;
  week_number: number;
  live_call_at: string | null;
};
type PlayerRow = { id: string; first_name: string };

function pad(n: number, w = 2): string {
  return String(n).padStart(w, "0");
}

// iCal datetime in UTC: 20260523T203000Z
function toIcalUtc(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

// 75 octet line limit per RFC 5545. Folds with "\r\n " (CRLF + space).
function fold(line: string): string {
  if (line.length <= 75) return line;
  const out: string[] = [];
  let i = 0;
  while (i < line.length) {
    const chunk = line.slice(i, i + 75);
    out.push(out.length === 0 ? chunk : " " + chunk);
    i += 75;
  }
  return out.join("\r\n");
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

export async function GET(
  _req: Request,
  context: { params: Promise<{ player_id: string }> },
) {
  const { player_id } = await context.params;

  // Coach gate. The cookie-bound client is used to verify the requester is
  // a coach; the service-role client is used for cross-family reads.
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return new NextResponse("unauthorized", { status: 401 });
  const coachLookup = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!coachLookup.data) return new NextResponse("forbidden", { status: 403 });

  const service = createServiceRoleClient();

  const playerResp = await service
    .from("players")
    .select("id, first_name")
    .eq("id", player_id)
    .maybeSingle();
  const player = playerResp.data as PlayerRow | null;
  if (!player) return new NextResponse("player_not_found", { status: 404 });

  const curriculumResp = await service
    .from("curricula")
    .select("id")
    .eq("player_id", player_id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const curriculum = curriculumResp.data as { id: string } | null;
  if (!curriculum) return new NextResponse("no_active_curriculum", { status: 404 });

  const slotsResp = await service
    .from("curriculum_slots")
    .select("id, week_number, live_call_at")
    .eq("curriculum_id", curriculum.id)
    .not("live_call_at", "is", null)
    .order("week_number", { ascending: true });
  const slots = (slotsResp.data ?? []) as SlotRow[];
  if (slots.length === 0) return new NextResponse("no_booked_slots", { status: 404 });

  const now = new Date();
  const calLines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//XPL Keyed//Coaching Sessions//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
  ];

  for (const s of slots) {
    if (!s.live_call_at) continue;
    const start = new Date(s.live_call_at);
    // 30 min sessions per the spec.
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const summary = `XPL Keyed: ${player.first_name}, session ${s.week_number}`;
    const desc = `30 minute coaching call on Discord with ${player.first_name}. Afterwards Tim writes up the advice and a training routine.`;
    calLines.push(
      "BEGIN:VEVENT",
      fold(`UID:${s.id}@xplkeyed.com`),
      fold(`DTSTAMP:${toIcalUtc(now)}`),
      fold(`DTSTART:${toIcalUtc(start)}`),
      fold(`DTEND:${toIcalUtc(end)}`),
      fold(`SUMMARY:${escapeText(summary)}`),
      fold(`DESCRIPTION:${escapeText(desc)}`),
      fold(`LOCATION:Discord (XPL Keyed coaching server)`),
      "END:VEVENT",
    );
  }

  calLines.push("END:VCALENDAR");

  const body = calLines.join("\r\n") + "\r\n";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="${player.first_name.toLowerCase()}-sessions.ics"`,
      "Cache-Control": "no-store",
    },
  });
}
