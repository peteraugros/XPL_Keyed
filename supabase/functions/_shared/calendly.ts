// Shared Calendly REST helpers for Deno Edge Functions.
// Mirrors src/lib/calendly/api.ts (Node) — same logic, Deno env access.

const CALENDLY_API_BASE = "https://api.calendly.com";

function eventUri(id: string): string {
  return id.startsWith("http") ? id : `${CALENDLY_API_BASE}/scheduled_events/${id}`;
}

// Cancels a single Calendly event. Non-fatal: logs and returns on failure so
// the caller can still clear the DB record. Idempotent on 404.
export async function cancelCalendlyEvent(
  eventIdOrUri: string,
  reason: string,
): Promise<void> {
  if (
    !eventIdOrUri ||
    eventIdOrUri.startsWith("cancelled:") ||
    eventIdOrUri.startsWith("auto:") ||
    eventIdOrUri.startsWith("manual:")
  ) return;

  const pat = Deno.env.get("CALENDLY_PAT");
  if (!pat) {
    console.warn("[calendly] CALENDLY_PAT not set; skipping cancel for", eventIdOrUri);
    return;
  }

  try {
    const res = await fetch(`${eventUri(eventIdOrUri)}/cancellation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${pat}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason }),
    });
    if (res.ok || res.status === 404) return;
    const body = await res.text().catch(() => "(no body)");
    console.warn(`[calendly] cancel failed ${eventIdOrUri}: ${res.status} ${body}`);
  } catch (err) {
    console.warn("[calendly] cancel threw for", eventIdOrUri, err);
  }
}

// Cancels all booked (non-null, non-sentinel) Calendly events for a curriculum.
// deno-lint-ignore no-explicit-any
export async function cancelCurriculumEvents(
  supabase: any,
  curriculumId: string,
  reason: string,
): Promise<void> {
  const { data } = await supabase
    .from("curriculum_slots")
    .select("live_call_event_id")
    .eq("curriculum_id", curriculumId)
    .not("live_call_event_id", "is", null);
  const ids = ((data ?? []) as Array<{ live_call_event_id: string }>)
    .map((r) => r.live_call_event_id)
    .filter(Boolean);
  await Promise.all(ids.map((id) => cancelCalendlyEvent(id, reason)));
}
