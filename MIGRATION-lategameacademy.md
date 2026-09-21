# Domain move: xplkeyed.com to lategameacademy.com

**Started 2026-09-20. PAUSED at step 3, waiting on Tim.**
Delete this file when the move is finished.

Full rebrand was chosen, not just a domain swap: the product becomes
**Late Game Academy** and the sender becomes **tim@lategameacademy.com**.

---

## Where it stopped

**Waiting on Tim to click one link.** Cloudflare emailed a verification link to
`timothyaugros2384@gmail.com`. Until he clicks it, that destination stays
`Pending` and no mail routes. He was asleep at his mum's on the 20th.

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

**3a. Email Routing, partially.** Enabled, root MX records live
(`route1/2/3.mx.cloudflare.net`), root SPF added.

🔵 **The two SPF records do NOT collide, and that was checked rather than
assumed.** Resend's SPF is on the `send.` SUBDOMAIN and Cloudflare's is on the
ROOT. Had Resend used the root, adding Email Routing would have created a
second root SPF record, and **two SPF records mean both are ignored**, which
degrades sending deliverability silently. Before changing anything about SPF on
this domain, re-check that they are still on different names.

---

## REMAINING, in order

**3b. Finish Email Routing.**
- Tim clicks the Cloudflare verification link in `timothyaugros2384@gmail.com`
  (check spam; it comes from Cloudflare, not from our domain).
- Routing rules -> Create address: `tim` @ `lategameacademy.com` -> send to that
  Gmail.
- Consider the **catch-all** to the same inbox so `hello@`, `support@` etc do
  not bounce on a new domain.
- ⚠️ **Open question, deliberately not decided:** the destination is a 14 year
  old's personal Gmail, so Instagram account recovery for the business account
  lands there. Adding Peter as a second destination was offered and not chosen.

**4. Supabase auth.** Dashboard -> project `xpl-keyed-prod` -> Authentication ->
URL Configuration. **ADD** `https://lategameacademy.com/auth/callback`, keep the
old one. Magic links already in inboxes point at the old domain and die if it is
removed.

**5. Stripe. EDIT the existing webhook endpoint's URL. Do NOT add a second one.**
The route verifies against a single `STRIPE_WEBHOOK_SECRET`, and a second
endpoint gets its own secret, so its events would fail signature verification
and be dropped silently. Editing the URL keeps the secret. Change it to
`https://lategameacademy.com/api/stripe-webhook`. The 5 events stay as they are:
checkout.session.completed, payment_intent.succeeded,
payment_intent.payment_failed, invoice.paid, invoice.payment_failed.
A brief gap is safe: Stripe retries for up to 3 days, and as of 2026-09-20 a
redelivery can no longer double provision a cycle.

**6. Railway env, the actual cutover.** Only after 3b is routing mail:
```
NEXT_PUBLIC_APP_URL = https://lategameacademy.com
RESEND_FROM_EMAIL   = tim@lategameacademy.com
VAPID_SUBJECT       = mailto:tim@lategameacademy.com
```
**Then push the held commit** so the name and the URL change together.

**Leave `xplkeyed.com` attached to Railway afterwards.** Old links keep working.

---

## The held commit

**`e78a9ec` "Rebrand to Late Game Academy" is COMMITTED AND NOT PUSHED.**
Pushing deploys immediately and puts the new name live at the old URL, which is
why it is held. 61 brand strings across 44 files, the wordmark, the email sender
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

## Verify it from a terminal

```sh
dig +short MX lategameacademy.com                       # routing
dig +short TXT send.lategameacademy.com                 # Resend SPF (subdomain)
dig +short TXT lategameacademy.com                      # Cloudflare SPF (root)
curl -sI https://lategameacademy.com | grep x-railway   # reaching Railway
```
