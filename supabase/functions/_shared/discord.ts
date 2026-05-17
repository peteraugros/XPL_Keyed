// Discord REST helpers shared across cron Edge Functions.
//
// Per `decision_tim_notifications`: bot is outbound only, no persistent gateway.
// Speaks as "XPL Keyed Bot", never as Tim (honest framing per CLAUDE.md
// "Discord bot architecture").

const DISCORD_API = "https://discord.com/api/v10";

export async function dmTim(
  botToken: string,
  timUserId: string,
  content: string,
): Promise<void> {
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
