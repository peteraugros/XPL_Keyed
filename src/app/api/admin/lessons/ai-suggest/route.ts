// POST /api/admin/lessons/ai-suggest
//
// Coach-gated. Tim taps "Help me word this" in the lesson-authoring
// form and we ask Claude to draft the field per the strict patterns
// in our Hard Rules:
//
//   kind='parent_translation' — Hard rule #4. Generates parent_label
//   (real-world skill phrase) + parent_skill_description (one to two
//   sentence email blurb) from the Fortnite term + topic + difficulty.
//
//   kind='talking_points' — generates 5 lines for the "🤫 For your back
//   pocket" mechanic. One per category: informed_observer,
//   co_conspirator, cultural_literacy, good_question, strategic_note.
//   Tone rules: parent asks (doesn't perform), Tim is the co-conspirator
//   (never lectures the parent), never make the parent the butt of a
//   joke, never script slang the parent has to pronounce.
//
// Output: JSON suggestions Tim can paste/edit. We never silently
// replace his text — the form treats AI output as a draft.

import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("parent_translation"),
    fortnite_label: z.string().min(1).max(200),
    topic: z.string().max(60).optional(),
    difficulty: z.string().max(60).optional(),
  }),
  z.object({
    kind: z.literal("talking_points"),
    fortnite_label: z.string().min(1).max(200),
    parent_label: z.string().max(300).optional(),
    parent_skill_description: z.string().max(800).optional(),
    topic: z.string().max(60).optional(),
    difficulty: z.string().max(60).optional(),
  }),
]);

const MODEL = "claude-opus-4-7";

const SYSTEM_PROMPT = `You are helping Tim, a 14-year-old Unreal-ranked Fortnite coach, draft copy for parent-facing lesson materials at XPL Keyed.

HARD RULES (these are inviolable):

1. No dash characters in your output. No em dashes (—), no en dashes (–), no hyphens (-) inside sentences. Use periods, commas, "to", spaces, or closed compounds instead. Hyphens are ONLY allowed inside compound proper-noun-style terms that are clearly idiomatic (e.g. "self-aware" is fine; "30-min" is not, write "30 min"). When in doubt, rewrite without the dash. This is the most important rule.

2. Parent-facing copy uses the parent-translation rule: the real-world skill comes FIRST, with the Fortnite term in italicized parens. Example: "Staying calm in a fast fight. *(Fortnite term: tunneling.)*"

3. WRITE FOR A REGULAR PARENT, NOT A PSYCHOLOGY TEXTBOOK. Imagine you're chatting at school dropoff with another parent who doesn't game. Plain English. Short words. Warm tone, not clinical.

   BANNED VOCABULARY (do not use these words or phrases — they sound academic and cold):
   - spatial planning, spatial reasoning, spatial awareness
   - sequenced execution, multi step execution, sequencing
   - executive function, cognitive, cognition
   - pattern recognition, decision making (as a noun phrase)
   - filtering, processing, parsing
   - under cognitive load, under time stress, threat assessment
   - working memory, motor planning, neural

   USE PLAIN LANGUAGE INSTEAD:
   - "thinking ahead" / "planning a few steps out"
   - "staying calm when things get fast"
   - "noticing what's happening around them"
   - "reading what someone is about to do"
   - "quick reactions when something surprises you"
   - "making smart choices when there's a lot going on"
   - "keeping focus when it's stressful"
   - "spotting what matters and ignoring the rest"

4. Tim is the co-conspirator with the parent. Never lecture the parent on parenting. Never make the parent the butt of a joke. Never script slang the parent has to pronounce.

5. Parent asks, doesn't perform. A question that signals curiosity (good) vs a phrase that's trying to sound like the kid (bad).

6. Avoid generic words like "valuable," "important," "critical." Be specific about the skill.

7. Tone: confident, plain, dash-free, warm. Short sentences. The parent should feel "oh, that makes sense" not "wow that sounds smart."

Return ONLY valid JSON. No prose before or after the JSON. No markdown fences.`;

const PARENT_TRANSLATION_USER = (
  fortniteLabel: string,
  topic: string | undefined,
  difficulty: string | undefined,
) => `Generate the parent translation pair for a lesson.

INPUTS:
- Fortnite term (kid-facing label): "${fortniteLabel}"
- Topic: ${topic ?? "(unspecified)"}
- Difficulty: ${difficulty ?? "(unspecified)"}

REFERENCE EXAMPLES (do not copy verbatim, follow the warmth and the plain language):

- Fortnite "Tunneling"
  parent_label: "Staying calm when a fight gets fast"
  parent_skill_description: "Helps your kid keep their head when someone's pushing them, and make a plan instead of panicking."

- Fortnite "Box fighting"
  parent_label: "Reading what someone is about to do"
  parent_skill_description: "Teaches your kid to pick up on small signals and stay one step ahead of the other player."

- Fortnite "Editing"
  parent_label: "Quick thinking with your hands"
  parent_skill_description: "Builds the kind of fast reactions where your brain and your hands stay in sync."

- Fortnite "Game sense"
  parent_label: "Noticing what's going on around you"
  parent_skill_description: "Helps your kid pay attention to the whole picture, not just the one thing right in front of them."

OUTPUT (strict JSON, dash-free):
{
  "parent_label": "...",
  "parent_skill_description": "..."
}

Constraints:
- parent_label: a short phrase a parent would actually say at dinner. 4 to 8 words. No Fortnite jargon. No psychology vocabulary.
- parent_skill_description: ONE sentence, 12 to 22 words. Plain language. Starts with "Helps your kid" or "Teaches your kid" or "Builds" or similar warm verb. No Fortnite jargon. No banned vocabulary from the system rules. No dashes anywhere.`;

const TALKING_POINTS_USER = (
  fortniteLabel: string,
  parentLabel: string | undefined,
  parentSkill: string | undefined,
  topic: string | undefined,
  difficulty: string | undefined,
) => `Generate 5 lines for the "For your back pocket" section of a parent email.

LESSON CONTEXT:
- Fortnite term: "${fortniteLabel}"
- Parent label: ${parentLabel ?? "(generate inline)"}
- Parent skill description: ${parentSkill ?? "(generate inline)"}
- Topic: ${topic ?? "(unspecified)"}
- Difficulty: ${difficulty ?? "(unspecified)"}

CATEGORIES + WHAT EACH ONE IS:

1. informed_observer — Something specific the parent can NOTICE during the kid's gameplay this week. A behavior to watch for. Builds the parent's pattern recognition.

2. co_conspirator — A line from Tim that the PARENT delivers. Frames Tim as in on the joke with parent. Example pattern: "Tim told me to ask if you've stopped W-keying yet. He says it's still a problem." The parent isn't pretending to know the game; they're carrying a message.

3. cultural_literacy — One Fortnite term the parent can drop naturally that sounds authentic and not forced. Avoid slang. Tactical terms only.

4. good_question — A question the parent ASKS the kid that signals real curiosity. Not a quiz. Not performative. Example: "How was your endgame today, were you sweating or cracked?"

5. strategic_note — An actually impressive observation about strategy at the kid's level. The parent isn't claiming to be a player, but is genuinely engaging with the strategic thinking. Specific. Avoid generic praise.

REFERENCE LINES (do not copy verbatim, follow the tone):
- "Hey Jake, Tim said you're working on tunneling this week. That's where you build cover while still tracking the other guy, right? Show me what one looks like?"
- "Tim told me to ask if you've stopped W keying yet. He says it's still a problem."
- "How was your endgame today, were you sweating or cracked?"

OUTPUT (strict JSON, dash-free, one line per category):
{
  "informed_observer": "...",
  "co_conspirator": "...",
  "cultural_literacy": "...",
  "good_question": "...",
  "strategic_note": "..."
}

Constraints per line:
- 1 to 2 sentences max.
- No dashes anywhere.
- Use the kid's hypothetical name as a placeholder when natural; the form will let Tim swap.`;

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ai_not_configured" }, { status: 503 });
  }

  // Coach gate
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachRow = await supabase
    .from("coaches")
    .select("id")
    .eq("auth_user_id", userData.user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!coachRow.data) {
    return NextResponse.json({ error: "not_a_coach" }, { status: 403 });
  }

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const userPrompt =
    body.kind === "parent_translation"
      ? PARENT_TRANSLATION_USER(body.fortnite_label, body.topic, body.difficulty)
      : TALKING_POINTS_USER(
          body.fortnite_label,
          body.parent_label,
          body.parent_skill_description,
          body.topic,
          body.difficulty,
        );

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    });
    // Concatenate any text blocks (typical: 1 block). Use a narrow
    // cast via `as` here — the SDK's ContentBlock union has multiple
    // shapes (text / thinking / tool_use / ...) and a type guard on
    // type='text' is enough for our read.
    const text = resp.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();

    const parsed = safeJsonParse(text);
    if (!parsed) {
      console.warn("[ai-suggest] non-json reply, returning raw text", { text });
      return NextResponse.json({ error: "ai_returned_non_json", raw: text }, { status: 502 });
    }

    // Last-mile dash strip (defensive — the model occasionally slips a hyphen
    // even with the rule). Replace em/en dashes with periods + add a space;
    // hyphens are trickier (often legitimate inside proper nouns), so we
    // leave those to Tim's editorial pass.
    const scrubbed = stripDashes(parsed);

    return NextResponse.json({ ok: true, suggestion: scrubbed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    console.error("[ai-suggest] anthropic error", msg);
    return NextResponse.json({ error: "ai_call_failed", detail: msg }, { status: 502 });
  }
}

function safeJsonParse(text: string): Record<string, string> | null {
  // Attempt direct parse first.
  try {
    const v = JSON.parse(text) as unknown;
    if (v && typeof v === "object") return v as Record<string, string>;
  } catch {
    // fallthrough
  }
  // Defensive: extract first {...} block.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]) as Record<string, string>;
    } catch {
      // ignore
    }
  }
  return null;
}

function stripDashes(obj: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v !== "string") {
      out[k] = String(v);
      continue;
    }
    // Replace em + en dashes (and the rare horizontal bar) with ". ".
    // Leave plain ASCII hyphens alone — they're often inside valid words.
    out[k] = v
      .replace(/\s*[—–―]\s*/g, ". ")
      .replace(/\.\s*\./g, ".") // collapse "..." that the replace might produce
      .trim();
  }
  return out;
}
