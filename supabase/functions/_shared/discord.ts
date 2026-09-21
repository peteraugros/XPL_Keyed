// Discord REST helpers shared across cron Edge Functions.
//
// Per `decision_tim_notifications`: bot is outbound only, no persistent gateway.
// Speaks as "Late Game Academy Bot", never as Tim (honest framing per CLAUDE.md
// "Discord bot architecture").

const DISCORD_API = "https://discord.com/api/v10";

// ---------------------------------------------------------------------------
// A value that is PRESENT but not USABLE is not configured.
// ---------------------------------------------------------------------------
// DISCORD_BOT_TOKEN and DISCORD_TIM_USER_ID ship as the literal "..." in
// .env.local.example, and "..." is TRUTHY, so a `if (!token) return;` guard
// passes while the value is junk and the call fails at Discord instead of
// being skipped. Measured 2026-09-20: both were literally "..." on Railway and
// in .env.local, so this has never been configured in any environment.
//
// Shape is checked rather than presence, because that is the only test that
// tells a real credential from a plausible looking one.
const BOT_TOKEN_RE = /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{20,}$/;
const SNOWFLAKE_RE = /^\d{15,21}$/;

/**
 * Whether a DM can actually be delivered. Callers check this and SKIP, which
 * is different from a send that failed: a misconfiguration retried on a cron
 * is an endless loop, where a transient Discord error is worth retrying.
 */
export function discordReady(
  botToken: string | undefined | null,
  userId: string | undefined | null,
): boolean {
  return (
    !!botToken && BOT_TOKEN_RE.test(botToken.trim()) &&
    !!userId && SNOWFLAKE_RE.test(userId.trim())
  );
}

export async function dmTim(
  botToken: string,
  timUserId: string,
  content: string,
): Promise<void> {
  // Refused here as well as at the call sites, so a future caller that forgets
  // to check gets a named reason rather than a 401 from Discord.
  if (!discordReady(botToken, timUserId)) {
    throw new Error(
      "discord_not_configured: bot token or user id is absent or a placeholder",
    );
  }
  const dmRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: timUserId }),
  });
  if (!dmRes.ok) {
    const errBody = await dmRes.text().catch(() => "");
    throw new Error(`Discord createDM ${dmRes.status}: ${errBody}`);
  }
  const { id: channelId } = await dmRes.json();

  const msgRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  if (!msgRes.ok) {
    const errBody = await msgRes.text().catch(() => "");
    throw new Error(`Discord send ${msgRes.status}: ${errBody}`);
  }
}

export async function sendChannelMessage(
  botToken: string,
  channelId: string,
  content: string,
): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Discord channel send ${res.status}: ${errBody}`);
  }
}
