// Discord REST helpers. The bot is outbound-only (no persistent gateway).
// Used by Next.js API routes; the parallel Edge Function copy in
// `supabase/functions/_shared/discord.ts` is used by cron triggers.

const DISCORD_API = "https://discord.com/api/v10";

// ---------------------------------------------------------------------------
// A value that is PRESENT but not USABLE is not configured.
// ---------------------------------------------------------------------------
// Both Discord vars ship as the literal "..." in .env.local.example, and "..."
// is TRUTHY. So every `if (!process.env.DISCORD_BOT_TOKEN) return;` guard in
// this codebase passed while the value was junk, and the app then called
// Discord with a bogus token and failed at the network rather than skipping
// cleanly. A guard that only asks "is it set" cannot see that.
//
// Measured 2026-09-20: DISCORD_BOT_TOKEN, DISCORD_TIM_USER_ID and
// DISCORD_GUILD_ID were all literally "..." on Railway AND in .env.local, so
// Discord has never once been configured in any environment. Everything else
// on Railway (29 of 32 vars) is real, so this is specific rather than general.
//
// Shape is checked, not just presence, because that is the only test that
// separates a real credential from a plausible looking one.
const BOT_TOKEN_RE = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}$/;
const SNOWFLAKE_RE = /^\d{15,21}$/;

/** The bot token, or null when it is absent, blank or a placeholder. */
export function discordBotToken(): string | null {
  const t = process.env.DISCORD_BOT_TOKEN?.trim();
  return t && BOT_TOKEN_RE.test(t) ? t : null;
}

/** A Discord user id, or null unless it is a real numeric snowflake. */
export function discordUserId(raw: string | undefined | null): string | null {
  const v = raw?.trim();
  return v && SNOWFLAKE_RE.test(v) ? v : null;
}

/**
 * Whether a DM to `userId` can actually be delivered. Call this instead of
 * testing the env vars directly; skipping is normal and must stay silent
 * enough not to be mistaken for a failure.
 */
export function discordReady(userId: string | undefined | null): boolean {
  return discordBotToken() !== null && discordUserId(userId) !== null;
}

function authHeader() {
  const token = discordBotToken();
  if (!token) {
    // Refused here as well as at the call sites, so a future caller that
    // forgets to check gets a named reason rather than a 401 from Discord.
    throw new Error(
      "discord_not_configured: DISCORD_BOT_TOKEN is absent or a placeholder",
    );
  }
  return {
    Authorization: `Bot ${token}`,
    "Content-Type": "application/json",
  };
}

async function createDmChannel(userId: string): Promise<string> {
  const res = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ recipient_id: userId }),
  });
  if (!res.ok) throw new Error(`Discord createDM failed: ${res.status}`);
  const channel = (await res.json()) as { id: string };
  return channel.id;
}

export async function sendDirectMessage(userId: string, content: string) {
  const channelId = await createDmChannel(userId);
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discord sendDM failed: ${res.status} ${await res.text()}`);
  }
}

export async function sendChannelMessage(channelId: string, content: string) {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: authHeader(),
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    throw new Error(`Discord sendChannel failed: ${res.status} ${await res.text()}`);
  }
}
