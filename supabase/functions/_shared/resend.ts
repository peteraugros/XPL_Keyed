// Resend API wrapper shared across cron Edge Functions.
//
// All parent-facing email copy must follow Hard rules:
//   #4 — translation rule (parent-facing skill first, Fortnite term in italicized parens)
//   #8 — no dash characters anywhere in rendered text
// Lesson-delivery emails additionally carry the "For your back pocket" section
// (decision_parent_talking_points). Body authoring is per-function.

const RESEND_API = "https://api.resend.com/emails";

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  from?: string;
  replyTo?: string;
}

export async function sendEmail(
  apiKey: string,
  defaultFrom: string,
  opts: SendEmailOptions,
): Promise<{ id: string }> {
  const res = await fetch(RESEND_API, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: opts.from ?? defaultFrom,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      reply_to: opts.replyTo,
    }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${errBody}`);
  }
  return await res.json();
}

// Minimal branded wrapper. Replace with a real template once the design system
// supplies HTML email partials. Keeps the body dash-free per Hard rule #8.
export function brandedEmailHtml(opts: { headline: string; bodyHtml: string; ctaLabel?: string; ctaHref?: string }): string {
  const cta = opts.ctaLabel && opts.ctaHref
    ? `<p style="margin:24px 0;"><a href="${opts.ctaHref}" style="display:inline-block;background:#C7FF3D;color:#0B1538;padding:14px 22px;border-radius:6px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">${opts.ctaLabel}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:24px;background:#0B1538;color:#fff;font-family:Inter,system-ui,sans-serif;line-height:1.55;">
<div style="max-width:560px;margin:0 auto;background:#0F1B47;border-radius:12px;padding:32px;">
<h1 style="font-family:'Anton',Impact,sans-serif;font-size:28px;letter-spacing:1px;margin:0 0 16px;color:#C7FF3D;">${opts.headline}</h1>
<div style="font-size:15px;color:rgba(255,255,255,0.85);">${opts.bodyHtml}</div>
${cta}
<p style="margin-top:32px;font-size:12px;color:rgba(255,255,255,0.5);">XPL Keyed. Independent Fortnite coaching.</p>
</div>
</body></html>`;
}
