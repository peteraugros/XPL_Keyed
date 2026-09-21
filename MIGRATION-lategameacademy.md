# Domain move: xplkeyed.com to lategameacademy.com

**Started 2026-09-20. FINISHED AND PROVEN END TO END 2026-09-21.**
Every step is done and every one was read back rather than assumed. Nothing here
is outstanding work any more.

**Kept rather than deleted, on purpose.** What is left in this file is the
reasoning, and three of those notes are landmines that would cost a real outage
if someone rediscovered them the hard way: the two SPF records, the Calendly
account slug, and the `xplkeyed.internal` auth domain that two live kid
identities still carry.

Full rebrand was chosen, not just a domain swap: the product becomes
**Late Game Academy** and the sender becomes **tim@lategameacademy.com**.

---

## Proven end to end, 2026-09-21

One real production email closes the whole chain at once. A coach magic link
was requested from `https://lategameacademy.com/api/auth/send-magic-link` and
read back out of Resend:

```
from:    Late Game Academy <tim@lategameacademy.com>
subject: Sign in to Late Game Academy admin
status:  delivered
link:    https://fmsekesjdkjpvvleefpu.supabase.co/auth/v1/verify
         ?redirect_to=https://lategameacademy.com/auth/callback?next=%2Fadmin
```

That single message proves four separate things: `RESEND_FROM_EMAIL` reached the
container, `NEXT_PUBLIC_APP_URL` reached the container, the rebranded copy is
what is running, and the mail actually lands. **And note the `redirect_to`
carries a query string**, which is precisely the case an exact path allow list
entry would have missed, so the wildcard added in step 4 is doing real work
rather than sitting there.

Alongside it:

- Deploy `c87a011` reported SUCCESS, checked by commit hash rather than by a
  status line.
- `https://lategameacademy.com/login` renders LATE GAME ACADEMY and contains
  zero occurrences of the old name.
- `manifest.json` reads `Late Game Academy` / `Late Game`, the icon glyph is L.
- A genuinely signed Stripe event to the new webhook URL returned 200 and a
  forged one returned 400, so the check is enforcing rather than waving things
  through.
- `https://xplkeyed.com` still returns 200, so links already in inboxes live.

---

## DONE and verified

**1. DNS and Railway.** `lategameacademy.com` serves the real app.
`CNAME @ -> ad0i1x86.up.railway.app` plus the `_railway-verify` TXT, both in
Cloudflare. Proven by headers, not by a status page: `x-railway-request-id` and
`x-railway-edge: lax1` come back, so traffic genuinely reaches Railway, and
`/api/stripe-webhook` answers 400 to a bad signature, which is the app's own
verification running.

⚠️ **Left PROXIED (orange cloud) on purpose.** Earlier guidance in this session
said grey was required for Railway to issue a certificate. That was wrong:
Cloudflare's Universal SSL terminated TLS at the edge and proxied through
cleanly. Do not "fix" it to grey.

⚠️ The Railway CLI printed the verify TXT as `railway-verify=railway-verify=...`,
which is doubled. The correct value has ONE prefix and is what the DASHBOARD
shows. The live record is right.

**2. Resend sending.** `lategameacademy.com` verified, and **proven with a real
send**: a message from `Late Game Academy <tim@lategameacademy.com>` to
peteraugros@gmail.com came back `last_event: delivered`.

⚠️ **The new domain is on a DIFFERENT Resend stack than the old one.**
`xplkeyed.com` sends through Amazon SES; `lategameacademy.com` uses
`send.lategameacademy.com CNAME send.forge.rmta.net`. This is current Resend,
not a fault. Do not try to make it match the old domain.

**3. Email Routing. DONE and proven.** `tim@lategameacademy.com` -> 
`timothyaugros2384@gmail.com`, rule Active, and a real message to that address
came back `delivered`. **This is the first time that contact address has ever
been able to receive mail.**

⚠️ **Catch-all is DISABLED with action Drop.** Mail to anything other than
`tim@` is silently discarded, so only advertise `tim@`. Switch it to forward if
a misaddressed parent email should not vanish.

⚠️ **A bounce puts an address on RESEND'S SUPPRESSION LIST and later sends come
back `suppressed`, which looks like a routing fault and is not.** The first test
bounced (no rule yet), which suppressed the address; the fix was
`DELETE https://api.resend.com/suppressions/{id}`. **Check
`GET /suppressions` first if a real email ever silently fails.** One stale entry
remains: `peteraugors+sarah@gmail.com`, a typo of Peter's address.

⚠️ **Open question, deliberately not decided:** the destination is a 14 year
old's personal Gmail, so Instagram account recovery for the business account
lands there. Adding Peter as a second destination was offered and not chosen.

**3a. Email Routing DNS.** Root MX records live
(`route1/2/3.mx.cloudflare.net`), root SPF added.

🔵 **The two SPF records do NOT collide, and that was checked rather than
assumed.** Resend's SPF is on the `send.` SUBDOMAIN and Cloudflare's is on the
ROOT. Had Resend used the root, adding Email Routing would have created a
second root SPF record, and **two SPF records mean both are ignored**, which
degrades sending deliverability silently. Before changing anything about SPF on
this domain, re-check that they are still on different names.

---

## The six steps, and what each one turned out to need

**4. Supabase auth. DONE and proven.** Both
`https://lategameacademy.com/auth/callback` and
`https://lategameacademy.com/**` are on the allow list, the old entries kept.

🔴 **THE WILDCARD IS THE ONE THAT MATTERS AND THE EXACT PATH IS NOT ENOUGH.**
The app sends `${APP_URL}/auth/callback?next=<path>`, and an exact path entry
does NOT match a URL carrying a query string: Supabase silently falls back to
the Site URL. Tested before and after; with only the exact entry, every magic
link after the cutover would have landed on the old domain with no error
anywhere. A negative control (`evil-example.test`) is correctly rejected, so
the list is genuinely enforcing.

⚠️ Leave the **Site URL** on `https://xplkeyed.com` until step 6.

**4-OLD. Supabase auth (original instruction, kept for the reasoning).** Dashboard -> project `xpl-keyed-prod` -> Authentication ->
URL Configuration. **ADD** `https://lategameacademy.com/auth/callback`, keep the
old one. Magic links already in inboxes point at the old domain and die if it is
removed.

**5. Stripe. EDIT the existing webhook endpoint's URL. Do NOT add a second one.**
✅ **Already de-risked 2026-09-20**: the new domain verified a genuinely signed
event with the LIVE secret (200) and refused a forged one (400), so the endpoint
is known to work before the switch.
The route verifies against a single `STRIPE_WEBHOOK_SECRET`, and a second
endpoint gets its own secret, so its events would fail signature verification
and be dropped silently. Editing the URL keeps the secret. Change it to
`https://lategameacademy.com/api/stripe-webhook`. The 5 events stay as they are:
checkout.session.completed, payment_intent.succeeded,
payment_intent.payment_failed, invoice.paid, invoice.payment_failed.
A brief gap is safe: Stripe retries for up to 3 days, and as of 2026-09-20 a
redelivery can no longer double provision a cycle.

**5. Stripe webhook. DONE via the API 2026-09-20.** Endpoint
`we_1TZeMiLQGJ57M1t9f3JpICRH` now points at
`https://lategameacademy.com/api/stripe-webhook`. Same endpoint id, so the
signing secret is unchanged and `STRIPE_WEBHOOK_SECRET` needed no edit. All 5
events intact, still exactly one endpoint. Verified by reading Stripe back AND
by delivering a genuinely signed event to the new URL, which returned 200.

**5b. Stripe statement descriptor. DONE 2026-09-21, from the dashboard.**
Now reads `LATE GAME ACADEMY` with prefix `LGA`, verified by reading the account
back through the API.

⚠️ **Kept because the reason matters next time: the API REFUSES this edit.**
`403 You cannot use this method on your own account: you may only use it on
connected accounts.` Stripe allows editing your own account settings only from
the dashboard, so no amount of scripting gets there.

**AND FOR A WHILE NOBODY COULD SIGN INTO THAT ACCOUNT. Resolved 2026-09-21.**
`acct_1TY0tWLQGJ57M1t9`
is a STANDALONE standard account (`controller: {type: account}`), not a
connected account under Elementsofchess, and Peter's login does not list it.
Its contact email is `elementsofchess.platform@gmail.com`, which is the address
to try. **This matters well beyond the rename: disputes, refunds and payouts
for Tim's business all live in an account nobody can open, and a dispute has a
response deadline.**

**5b-OLD. Statement descriptor, original note.**
Stripe Settings -> Business -> Public details. It currently reads **`XPL KEYED`**,
which is the literal text printed on a parent's bank statement. After the
rebrand they pay Late Game Academy and see XPL KEYED, and an unrecognised
charge is the leading cause of disputes. Max 22 characters; LATE GAME ACADEMY
is 17. The `statement_descriptor_prefix` is `XPL` and wants the same treatment.
⚠️ Not in the repo, so no amount of grepping finds it.

⚠️ **Checkout branding is empty** (no logo, no icon, no primary colour). Not a
regression, never set. Worth doing sometime, not part of this move.

⚠️ **The XPL Keyed Stripe account is `acct_1TY0tWLQGJ57M1t9`, display name
XPL_Keyed**, under the same login as Elementsofchess. One Stripe login holds
several accounts; use the switcher at the top left.

**6. Railway env, the actual cutover. DONE 2026-09-21.** All three set on
service `Late Game Academy` and read back from Railway rather than trusted to
the dashboard:
```
NEXT_PUBLIC_APP_URL = https://lategameacademy.com
RESEND_FROM_EMAIL   = tim@lategameacademy.com
VAPID_SUBJECT       = mailto:tim@lategameacademy.com
```
The eight held commits were pushed immediately afterwards so the name and the
URL changed in the same deploy, rather than the site spending time on the new
domain still calling itself XPL Keyed.

⚠️ **The order mattered more than it looks.** `NEXT_PUBLIC_*` values are inlined
by Next at BUILD time, including in server code, so a build that ran before the
variables were saved would have compiled the old URL in and no restart would
have fixed it. The variables were saved first and the push triggered the build
that carries them.

**Leave `xplkeyed.com` attached to Railway afterwards.** Old links keep working.

---

## The held commits, now pushed

**`e78a9ec` through `c87a011`, eight commits, PUSHED 2026-09-21.**
They were held because pushing deploys immediately and would have put the new
name live at the old URL before the domain was ready. 61 brand strings across 44 files, the wordmark, the email sender
name, the parent facing contact address.

🔴 **Three things it deliberately did NOT rename. A blind replace breaks two.**
- `calendly.com/xpl-keyed` is Tim's Calendly ACCOUNT SLUG in 5 booking links.
  Renaming it here breaks every booking. It changes only if Tim renames the
  account inside Calendly.
- `xplkeyed.internal` is the synthetic auth domain for kid identities. **Two
  real production identities carry it.** Changing the constant splits old kids
  from new ones.
- The Railway service name and package name are identifiers, not copy.

---

## Known broken, and this move fixes it

**`tim@xplkeyed.com` has NEVER been able to receive mail.** `xplkeyed.com` has
no MX records at all, and **11 places in the app tell parents to email that
address.** Those messages have gone nowhere for the life of the product. Step 3b
is the first time that contact address becomes true.

---

## The last three, all closed

**1. Supabase Site URL. DONE 2026-09-21**, now `https://lategameacademy.com`.
It was deliberately left until step 6 landed so that nothing pointed at the new
domain before the new domain was ready.

Read back with controls rather than taken on trust, because a negative is only
worth anything if the probe could have said otherwise:

```
explicit new domain -> itself          (the field reflects what is passed)
explicit OLD domain -> itself          (old links in old inboxes still work)
disallowed host     -> lategameacademy.com   (this IS the Site URL)
no redirect_to      -> lategameacademy.com
```

The second line is the one to notice. `xplkeyed.com` is still on the allow list
on purpose, so every magic link already sitting in a parent's inbox continues to
resolve. Removing it is what would break them, not leaving it.

**2. Stripe. DONE 2026-09-21, and the access gap closed with it.** Read back
from the API rather than trusted to the dashboard:

```
acct_1TY0tWLQGJ57M1t9
business_profile.name                      = Late Game Academy
settings.payments.statement_descriptor     = LATE GAME ACADEMY
settings.card_payments.descriptor_prefix    = LGA
```

That is what prints on a parent's bank statement, so the leading cause of
disputes is now removed. **The larger win is that somebody got into the account
at all**: disputes, refunds and payouts for Tim's business all live there, and a
dispute has a response deadline. Write down how that sign in works before it is
needed under time pressure.

**3. `xplkeyed.com` is deliberately still attached, and that is the finished
state rather than a loose end.** It still serves, it is still on the Supabase
allow list, and both are on purpose: old links in old inboxes keep working.
Retire it only once nothing points at it, and not on the same day as anything
else.

**The one thing genuinely not checked: nobody has looked at the L icon on a
phone.** Everything else in this move was measured.

---

## Open decisions for Tim

**The app icon is now the letter L, chosen as a placeholder.** Both
`public/icons/icon.svg` and `icon-maskable.svg` carry it. ⚠️ **It has not been
looked at on a real phone**, and it should be: an L is roughly 43% less ink than
a K at the same size, so it reads lighter in a home screen grid. It also had to
be nudged off centre by hand (`x=250` and `x=252` rather than 256), because an L
is visually left heavy and `text-anchor="middle"` centres the glyph BOX rather
than the ink; the offsets were measured from a render, not guessed. If Tim wants
LG or A instead, only those two files change.

**Cloudflare security settings differ between the zones.** `xplkeyed.com`
refuses a scripted user agent with 403 while `lategameacademy.com`, a fresh
zone, allows it. Stripe's own user agent passes on both, so nothing is broken,
but the new zone is currently more permissive than the one it replaces. Worth
matching after the move.

**DMARC is not set on either domain.** Optional, improves deliverability, and
best added after Email Routing so the reports have an inbox to land in.

## Verify it from a terminal

```sh
dig +short MX lategameacademy.com                       # routing
dig +short TXT send.lategameacademy.com                 # Resend SPF (subdomain)
dig +short TXT lategameacademy.com                      # Cloudflare SPF (root)
curl -sI https://lategameacademy.com | grep x-railway   # reaching Railway
```
