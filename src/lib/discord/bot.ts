// Discord REST helpers. The bot is outbound-only (no persistent gateway).
// Used by Next.js API routes; the parallel Edge Function copy in
// `supabase/functions/_shared/discord.ts` is used by cron triggers.

const DISCORD_API = "https://discord.com/api/v10";

function authHeader() {
  return {
    Authorization: `Bot ${process.env.DISCORD_BOT_TOKEN!}`,
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
