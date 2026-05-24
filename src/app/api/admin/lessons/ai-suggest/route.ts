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
  // Planner helpers (Path B). Tim-facing output (Fortnite vocabulary
  // ok). All still respect the no-dashes rule + the editable-suggestion
  // principle: the planner UI drops these into editable fields, never
  // auto-overwrites.
  z.object({
    kind: z.literal("read_summary"),
    rough_draft: z.string().min(20).max(20000),
  }),
  z.object({
    kind: z.literal("identify_breakdown"),
    rough_draft: z.string().min(20).max(20000),
  }),
  z.object({
    kind: z.literal("narrow_recommend"),
    items: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(200),
        description: z.string().max(400).optional(),
      }),
    ).min(2).max(12),
  }),
  z.object({
    kind: z.literal("write_structure"),
    rough_draft: z.string().min(20).max(20000),
    main_goal: z.string().max(400).optional(),
    clip_description: z.string().max(800).optional(),
    chosen_skill: z.object({
      name: z.string().min(1).max(200),
      description: z.string().max(400).optional(),
    }),
  }),
]);

const MODEL = "claude-opus-4-7";

// Used for parent-facing copy (parent_translation, talking_points).
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

// Used for the planner helpers (read_summary, identify_breakdown,
// narrow_recommend, write_structure). Tim-facing output — Fortnite
// vocabulary is welcome. No dash rule still applies (clean prose).
// Critically: these are SUGGESTIONS that drop into editable fields.
// Tim always finalizes the wording himself.
const PLANNER_SYSTEM_PROMPT = `You are helping Tim, a 14-year-old Unreal-ranked Fortnite coach, plan the structure of his own coaching video. You are a writing assistant ghostwriting in Tim's voice. Tim is the coach.

This is for HIS use in drafting his own lesson, NOT for parent-facing copy. You can use Fortnite terms freely (tunneling, edit, box fight, peek, third party, etc.) — Tim's audience is players, not parents.

HARD RULES:

1. WRITE IN FIRST PERSON SINGULAR. Tim's voice. "I noticed...", "I'm going to show you...", "I won this fight by...", "I want to teach...". NEVER write as if addressing Tim ("you said", "you taught", "you should"). NEVER write in third person ("the clip shows", "Tim taught"). The output drops directly into Tim's beat sheet — he reads it aloud or paraphrases it on camera, so it has to sound like things Tim would actually say.

   The one exception: when Tim is speaking TO the viewer inside the video (hook, goal, outro), it's natural to say "I'll show YOU..." or "by the end YOU'll know how to...". That "you" addresses the viewer, not Tim. Still first-person from Tim's side.

2. No dash characters in output. No em dashes (—), no en dashes (–), no hyphens (-) inside sentences. Use periods, commas, "to", spaces, or closed compounds. Hyphens are only allowed inside genuinely idiomatic compounds (e.g. "right-hand peek" is a real Fortnite term and fine).

3. You are NEVER a coach giving lesson advice. You are a ghostwriter for Tim. You break apart what TIM said, you don't add insight he didn't already have. If the rough draft doesn't say something, don't invent it. Stay close to his actual words and reasoning.

4. Output is always SUGGESTIONS the user will edit. Bullets and short phrases preferred over long prose.

5. Be specific to what's in the rough draft. Don't generalize. If Tim talked about tunneling, talk about tunneling; don't talk about "movement skills."

6. Return ONLY valid JSON. No prose before or after the JSON. No markdown fences.`;

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

// Step 2: Read. Given the rough draft transcript, surface (a) what
// gameplay clip the lesson is about, (b) what's happening in it, (c)
// the main thing Tim is trying to teach. All in Tim's first-person
// voice, pulled from what HE said. Tim edits before locking in.
const READ_SUMMARY_USER = (roughDraft: string) => `Here is the rough draft transcript of my coaching lesson (I'm Tim):

"""
${roughDraft}
"""

Ghostwrite both fields in my voice — first person singular. Use what I actually said in the draft; don't invent. Output JSON in this exact shape:

{
  "clip_description": "1 to 2 sentences in my voice describing the clip and what I did in it. Example: 'I won a 1v1 in Zero Build by holding pressure on the right side and forcing the other guy off high ground.' Fortnite terms welcome.",
  "main_goal": "1 short sentence in my voice stating what I'm teaching. Starts with 'I'm teaching' or 'I want to show' or similar. No more than 15 words. Example: 'I'm teaching how to use diagonal pressure to win a 1v1.'"
}

If I didn't say something, leave that field as an empty string. Don't invent.`;

// Step 3: Identify. Break the transcript into distinct teaching points.
// Each one is a thing Tim ended up teaching, in Tim's voice. This is
// the atomicity step.
const IDENTIFY_BREAKDOWN_USER = (roughDraft: string) => `Here is the rough draft transcript of my Fortnite coaching lesson (I'm Tim):

"""
${roughDraft}
"""

Identify every distinct teaching point I ended up making. Most rough drafts cover more than one. Be honest — if it's really one, return one. If it's five, return five.

Output JSON in this shape:

{
  "items": [
    { "name": "Short skill name, 2 to 5 words, Fortnite vocabulary ok", "description": "1 short sentence in MY voice describing what the skill is. Example: 'I hold pressure on the right side so they can't push my low ground.' First person." },
    ...
  ]
}

Constraints:
- Between 1 and 8 items.
- Each name is a noun phrase a Fortnite player would recognize (e.g. "Tunneling," "Right hand peek," "Pre edits during fights"). Names don't need to be in first person — they're just labels.
- Descriptions ARE in first person, pulled from what I actually said. If I didn't elaborate, the description can be very short.
- Don't invent points I didn't make.`;

// Step 4: Narrow. Given the identified skills, recommend which one a
// beginner should learn first, and rank them in teaching order.
// Reasoning is in Tim's first-person voice — like he's thinking aloud
// about how to sequence the series.
const NARROW_RECOMMEND_USER = (
  items: Array<{ id: string; name: string; description?: string }>,
) => `Here are the teaching points I identified in my rough draft (I'm Tim):

${items.map((it, i) => `${i + 1}. id="${it.id}" — ${it.name}${it.description ? `: ${it.description}` : ""}`).join("\n")}

Rank these from "what a beginner needs first" to "most advanced / depends on the others." A skill is a prerequisite of another if you can't do the second one without already knowing the first.

Output JSON in this shape:

{
  "ranked_ids": ["id1", "id2", "id3", ...],
  "reasoning": {
    "id1": "1 short sentence in MY voice on why I'd teach this first. Example: 'I'd start here because everything else builds on knowing where to position.'",
    "id2": "1 short sentence in my voice on why this comes next. Example: 'Once I've got positioning down, I can start working on the actual fight.'",
    ...
  },
  "recommended_first_id": "id_of_the_one_a_beginner_should_learn_first"
}

Constraints:
- Use the exact ids provided. Don't invent new ones.
- ranked_ids must include every input id exactly once.
- recommended_first_id must be the first item in ranked_ids.
- Reasoning is 1 short sentence per item, FIRST PERSON ("I'd teach", "I want to cover", "once I've got"). Fortnite vocabulary ok. No dashes.`;

// Step 5: Write. The biggest helper. Given the rough draft + watch
// notes + the one chosen skill, draft a beat-sheet structure in Tim's
// first-person voice. Tim edits every section.
const WRITE_STRUCTURE_USER = (
  roughDraft: string,
  mainGoal: string | undefined,
  clipDescription: string | undefined,
  chosenSkillName: string,
  chosenSkillDescription: string | undefined,
) => `I'm making a coaching video on a single skill (I'm Tim). Ghostwrite the beat sheet in my voice — first person singular throughout.

ROUGH DRAFT (what I said in my first take):
"""
${roughDraft}
"""

CONTEXT:
- Main goal: ${mainGoal ?? "(not yet set)"}
- Clip description: ${clipDescription ?? "(not yet set)"}
- Skill this video focuses on: ${chosenSkillName}
- Skill description: ${chosenSkillDescription ?? "(none)"}

Draft a beat sheet structured for a 3 to 5 minute Fortnite coaching video. Pull from MY rough draft; don't invent insight I didn't have. Output JSON in this exact shape:

{
  "hook": "One sentence in my voice that grabs the viewer. First person, addressed to the viewer is fine. Examples: 'I used to die every time I got pushed. Here's what changed.' or 'Watch this clip. I'm going to show you what I did right.'",
  "goal": "What I'm teaching and what the viewer will be able to do by the end. Example: 'Today I'm teaching you diagonal pressure. By the end you'll know how to win the 1v1 instead of trading.' First person on my side.",
  "demonstration": "Notes IN MY VOICE on the clip I'm about to show. What I want to point to. When I pause. 2 to 4 short lines, newline-separated. Example: 'I show the moment they push my low ground; I pause when I take the right edit; I rewind to show how I held the angle.'",
  "breakdown": [
    { "bullet": "Short first-person beat. Example: 'I take the right edit and hold the angle so they can't see my next move.'", "why": "Why does this work? In my voice. Example: 'It forces them to either commit or back off, and either way I win tempo.'" },
    ...3 to 5 items
  ],
  "common_mistake": "What beginners do wrong, and why the right way is better. In my voice. Example: 'Most beginners W-key into the box thinking they have momentum. I do the opposite. I hold the edit and let them come to me.'",
  "practice_setup": "How I'd practice this in Creative mode. 1 to 3 short bullets in first person. Example: 'I run boxfight 1v1 in Creative with bots set to aggressive.'",
  "summary": "2 to 3 bullets restating the key idea in my voice. Newline-separated. Example: 'I hold the angle, I don't push first, I let them swing first.'",
  "outro": "Short and clean. First person. Example: 'Next lesson I'll show you how to follow up the trade once you've won the angle.'",
  "terms": [
    { "word": "A Fortnite term a beginner might not know that appeared in this lesson", "definition": "1 line, plain English, beginner-friendly. Definitions don't need to be first person — they're glossary entries." },
    ...as many as the draft mentions, usually 2 to 6
  ]
}

Constraints:
- BULLETS, not sentences. I talk from bullets, I don't read scripts.
- FIRST PERSON throughout (except glossary definitions). "I" not "you" when describing what I did or what I'm teaching.
- When addressing the viewer inside the hook/goal/outro, "you" addresses THE VIEWER — that's natural and fine.
- Pull breakdown items from what I actually said. If I gave 3 beats, give 3 items. Don't pad.
- terms should include any Fortnite-specific word a 10yo brand new to ranked play might not know (tunneling, third party, edit, box, peek, height, ramp rush, etc).
- No dashes anywhere.`;

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

  // Dispatch by kind. Each branch builds (system, user, maxTokens).
  // Parent-facing kinds use SYSTEM_PROMPT (warm-parent rules);
  // planner kinds use PLANNER_SYSTEM_PROMPT (Tim-facing, structural).
  let system: string;
  let userPrompt: string;
  let maxTokens = 1024;
  switch (body.kind) {
    case "parent_translation":
      system = SYSTEM_PROMPT;
      userPrompt = PARENT_TRANSLATION_USER(body.fortnite_label, body.topic, body.difficulty);
      break;
    case "talking_points":
      system = SYSTEM_PROMPT;
      userPrompt = TALKING_POINTS_USER(
        body.fortnite_label,
        body.parent_label,
        body.parent_skill_description,
        body.topic,
        body.difficulty,
      );
      break;
    case "read_summary":
      system = PLANNER_SYSTEM_PROMPT;
      userPrompt = READ_SUMMARY_USER(body.rough_draft);
      maxTokens = 512;
      break;
    case "identify_breakdown":
      system = PLANNER_SYSTEM_PROMPT;
      userPrompt = IDENTIFY_BREAKDOWN_USER(body.rough_draft);
      maxTokens = 1024;
      break;
    case "narrow_recommend":
      system = PLANNER_SYSTEM_PROMPT;
      userPrompt = NARROW_RECOMMEND_USER(body.items);
      maxTokens = 1024;
      break;
    case "write_structure":
      system = PLANNER_SYSTEM_PROMPT;
      userPrompt = WRITE_STRUCTURE_USER(
        body.rough_draft,
        body.main_goal,
        body.clip_description,
        body.chosen_skill.name,
        body.chosen_skill.description,
      );
      maxTokens = 2048;
      break;
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
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

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // fallthrough
  }
  // Defensive: extract first {...} block.
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {
      // ignore
    }
  }
  return null;
}

// Recursive dash-stripper. Walks objects + arrays. Stripping em/en
// dashes only (the worst offenders); ASCII hyphens left alone since
// many are legitimate inside compound words.
function stripDashes(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(/\s*[—–―]\s*/g, ". ")
      .replace(/\.\s*\./g, ".")
      .trim();
  }
  if (Array.isArray(value)) {
    return value.map(stripDashes);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripDashes(v);
    }
    return out;
  }
  return value;
}
