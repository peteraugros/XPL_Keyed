// Old-brand copy must not survive on any surface a person reads.
//
// 🔴 THIS EXISTS BECAUSE THE SWEEP THAT WAS SUPPOSED TO CATCH IT HAD A HOLE.
// The rename missed 7 instances of the old nickname "Keyed". A first search
// looked for the SENTENCES I expected rather than the WORD and found 4. A
// second searched for the word but excluded every line containing
// `className=`, in order to filter out `className="keyed"`, and that
// exclusion silently discarded most of the page's copy, which lives inside
// styled divs. Two survived to production and were found by reading the LIVE
// page rather than the source.
//
// The fix is to strip only the IDENTIFIER forms and then search, never to drop
// whole lines. A filter that removes lines removes the copy on them too.
//
// ⚠️ Identifiers are deliberately allowed and must stay allowed: `xpl-keyed` is
// Tim's Calendly ACCOUNT SLUG (renaming it breaks every booking),
// `xplkeyed.internal` is the synthetic auth domain that live kid identities
// carry, and `className="keyed"` is a CSS hook.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const IDENTIFIERS = /className="[^"]*"|xpl-keyed|xplkeyed\.internal|XPL_Keyed|\.keyed\b|"keyed"/g;
const BANNED = [/\bKeyed\b/, /\bXPL Keyed\b/];

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk("src")) {
  readFileSync(file, "utf8").split("\n").forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return;
    const stripped = line.replace(IDENTIFIERS, "");
    if (BANNED.some((re) => re.test(stripped))) hits.push(`${file}:${i + 1}: ${t.slice(0, 100)}`);
  });
}

if (hits.length) {
  console.error(`FAIL: ${hits.length} old-brand string(s) in copy\n` + hits.join("\n"));
  process.exit(1);
}
console.log("ok: no old-brand copy in src");
