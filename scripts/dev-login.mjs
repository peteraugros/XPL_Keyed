// npm run dev:login
//
// Makes local sign in possible. On a fresh local database there are ZERO rows
// in auth.users and coaches.auth_user_id is NULL, so the coach panel refuses
// every password because there is no account behind the username, which looks
// exactly like a wrong password.
//
// Creates (or repairs) the auth user for each active coach, sets a known dev
// password, and links coaches.auth_user_id. Idempotent.
//
// LOCAL ONLY. It sets a known password, so pointing it at a hosted project
// would hand out a coach account.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = {};
for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}
const URL = env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const KEY = env.SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:|$)/.test(URL)) {
  console.error(`\nREFUSING: this sets a KNOWN password and Supabase is not local.`);
  console.error(`  NEXT_PUBLIC_SUPABASE_URL = ${URL || "(unset)"}`);
  process.exit(2);
}
if (!KEY) { console.error("\nREFUSING: SUPABASE_SERVICE_ROLE_KEY missing."); process.exit(2); }

const PASSWORD = process.env.DEV_PASSWORD ?? "devpassword123";
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const coaches = await db.from("coaches").select("id, username, email, is_active").eq("is_active", true);
if (coaches.error) { console.error("coaches:", coaches.error.message); process.exit(1); }
if (!coaches.data?.length) { console.error("No active coach rows. Apply migrations/seed first."); process.exit(1); }

console.log(`local dev login  (${URL})\n`);

for (const c of coaches.data) {
  // Find an existing auth user for this email rather than assuming there is none.
  let userId = null;
  const list = await db.auth.admin.listUsers({ page: 1, perPage: 200 });
  const found = (list.data?.users ?? []).find(
    (u) => (u.email ?? "").toLowerCase() === c.email.toLowerCase(),
  );

  if (found) {
    userId = found.id;
    const upd = await db.auth.admin.updateUserById(userId, {
      password: PASSWORD, email_confirm: true,
    });
    if (upd.error) { console.error(`  ${c.username}: ${upd.error.message}`); continue; }
    console.log(`  ${c.username}: auth user existed, password reset`);
  } else {
    const made = await db.auth.admin.createUser({
      email: c.email, password: PASSWORD, email_confirm: true,
    });
    if (made.error) { console.error(`  ${c.username}: ${made.error.message}`); continue; }
    userId = made.data.user.id;
    console.log(`  ${c.username}: auth user created`);
  }

  // The link is the part that is easy to miss: without it the password check
  // passes and every page still treats you as nobody.
  const link = await db.from("coaches").update({ auth_user_id: userId }).eq("id", c.id);
  if (link.error) { console.error(`  ${c.username}: link failed ${link.error.message}`); continue; }

  const back = await db.from("coaches").select("auth_user_id").eq("id", c.id).single();
  if (back.data?.auth_user_id !== userId) { console.error(`  ${c.username}: link did not stick`); continue; }
  console.log(`  ${c.username}: linked to coaches.auth_user_id  OK`);
}

const port = process.env.PORT ?? "3100";
console.log(`
Sign in as the coach (this is also the admin surface):

  1. open   http://localhost:${port}/login?coach=1
     ?coach=1 opens the hidden panel directly, and deliberately skips the
     already-signed-in redirect so it also works for switching accounts.
     Without it, click the "XPL KEYED" wordmark to reveal the same panel.

  2. username  ${coaches.data.map((c) => c.username).join(" / ")}
     password  ${PASSWORD}

  3. you land on /admin

Parents and players do NOT use a password. They use a magic link, and locally
the mail is caught by Inbucket rather than sent:  http://127.0.0.1:54424
`);
