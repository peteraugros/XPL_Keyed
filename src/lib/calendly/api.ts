// Calendly REST helpers. Outbound only (cancelling events we already
// know about). Inbound interaction stays on the webhook + embed widget.
//
// Auth: CALENDLY_PAT (Personal Access Token, scopes Scheduling+Webhooks)
// stored in .env.local. Same token used to register webhooks.

const CALENDLY_API_BASE = "https://api.calendly.com";

function pat(): string {
  const token = process.env.CALENDLY_PAT;
  if (!token) throw new Error("CALENDLY_PAT is not set");
  return token;
}

// live_call_event_id holds the full Calendly event URI
// (https://api.calendly.com/scheduled_events/<uuid>). Some legacy rows
// might hold just the uuid. Normalize to the full URI.
function eventUri(eventIdOrUri: string): string {
  if (eventIdOrUri.startsWith("http")) return eventIdOrUri;
  return `${CALENDLY_API_BASE}/scheduled_events/${eventIdOrUri}`;
}

export async function cancelCalendlyEvent(
  eventIdOrUri: string,
  reason: string,
): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  // Skip sentinel rows ("cancelled:..." / "auto:..." / "manual:..."). Nothing
  // to cancel on Calendly's side; the local state is what matters.
  if (
    eventIdOrUri.startsWith("cancelled:") ||
    eventIdOrUri.startsWith("auto:") ||
    eventIdOrUri.startsWith("manual:")
  ) {
    return { ok: true };
  }

  const url = `${eventUri(eventIdOrUri)}/cancellation`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pat()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason }),
  });
  if (res.ok) return { ok: true };
  // 404 = event already cancelled. Treat as success (idempotent).
  if (res.status === 404) return { ok: true };
  const body = await res.text().catch(() => "(no body)");
  return { ok: false, status: res.status, body };
}
