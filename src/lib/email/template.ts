// Node-runtime branded email template, mirrors supabase/functions/_shared/resend.ts.
// Two copies exist because Edge Functions (Deno) can't import from `src/`.
// Keep the inline styles in sync if either is edited.
//
// All copy passed into bodyHtml / ctaLabel / headline must be dash-free
// per Hard rule #8 (no em, en, or hyphen anywhere a user reads it).

export function brandedEmailHtml(opts: {
  headline: string;
  bodyHtml: string;
  ctaLabel?: string;
  ctaHref?: string;
}): string {
  const cta =
    opts.ctaLabel && opts.ctaHref
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
