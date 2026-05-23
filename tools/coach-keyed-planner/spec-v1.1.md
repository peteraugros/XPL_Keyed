# Coach Keyed's Lesson Planner — Spec v1.1

## Purpose

A single-file HTML tool that helps a young coach turn a tangled rough-draft lesson video into a clean, structured outline he can re-record from. The tool teaches three meta-skills through its workflow — atomicity (one idea per lesson), prerequisite awareness (some lessons require others first), and audience modeling (define what beginners don't know) — without ever lecturing the user. Constraints are the curriculum.

The tool produces beat sheets, not scripts. The user's voice and improvisational confidence are preserved. The tool enforces sequence and completeness, not phrasing.

## Replaces

The previously discussed "lesson maker" concept. Content authorship stays with the user. The planner is a structural and reflective tool only.

## Core Philosophy

- The tool does the boring work (sequencing, saving, assembling output). The user does the thinking work (identifying, narrowing, defining, writing bullets).
- No AI-generated content. No auto-fill of reflective steps. Automation is limited to persistence, output formatting, and surfacing patterns for human judgment.
- Constraints feel like game rules, not criticism. The tool says "pick one" — not "you picked too many."
- The Re-record step produces a beat sheet (headers, goals, bullets, term definitions, timing). Never a word-for-word script.
- Beat sheets are working documents, not frozen artifacts. Everything stays editable.

## User Flow — Seven Steps

The seven steps are locked in sequence. Each step unlocks the next only when its required fields are complete. A left-rail progress tracker shows all seven; completed steps are checkmarked; future steps are visible but not clickable.

### Step 1: Rough Draft (Intake)

**Prompt:** "What did you cover in your rough draft? Paste a transcript if you have one, or just bullet-point what you said."

**Helper text:** "Doesn't need to be perfect. You just need enough raw material to look at and analyze."

**Field:** Large textarea. Required to proceed. No minimum length enforced — trust the user.

**Design rationale:** The transcript was a false constraint. What's actually needed is raw material for analysis. Bullet notes work. A pasted YouTube auto-caption works. "What I remember saying" works. Lower friction at the entry point dramatically increases the chance Tim actually uses the tool.

### Step 2: Watch

**Prompt:** "Read your rough draft back. Out loud is better. Then answer:"

**Fields:**

- "What clip is this lesson about? What happened in the gameplay?" (textarea, required)
- "What's the main thing you were trying to teach?" (single line, required)

**Purpose:** Force articulation of raw material before analysis. The "out loud" instruction matters and should be visible in the UI, not buried.

### Step 3: Identify

**Prompt:** "Look at your rough draft. List every separate thing you ended up teaching. Be honest — most rough drafts end up teaching more than one thing."

**Field:** Dynamic list. User can add items via "Add another" button. Up/down arrows on each item for reordering (no drag — clearer on touch and for younger users). Minimum 2 items required to proceed. Each item has a short name (e.g., "Diagonal Pressure") and an optional one-line description.

Once at least 2 items exist, the dependency question appears:

> "Look at your list. Could a beginner understand item 1 without already knowing items 2 and 3?"
>
> Buttons:
> - "Yes — these are independent skills" → continues to Standard Narrow flow
> - "No — they build on each other" → triggers Capstone Mode

**Note on wording:** The dependency question is the single most important interaction in the tool. The phrasing above is v1; revisit after one real session with Tim. If "could a beginner understand" feels too abstract, fall back to "Does item 1 use words or ideas from items 2 and 3?"

### Step 4: Narrow

Two variants depending on the answer to the dependency question.

**Standard Mode (independent skills):**

Prompt: "Pick ONE skill to teach in this video. The others get saved as future lessons."

User selects one item from the Identify list. The unselected items move to the Future Lessons queue (see Home Screen — this queue is surfaced as the primary CTA next session, not buried).

**Capstone Mode (dependent skills):**

Prompt: "It looks like you've actually planned a series. Let's put these in teaching order. Which one would a beginner need to learn first?"

User reorders items using up/down arrows.

Once ordered, the tool displays:

> You just designed a [N]-part series:
>
> - Lesson 1: [first item] — foundation
> - Lesson 2: [second item] — builds on Lesson 1
> - ...
> - Lesson [N]: Putting It All Together — your original rough draft, re-recorded
>
> The planner will help you make Lesson 1 first. Lessons 2 through [N] are saved to your curriculum. When you finish Lesson 1, come back and the planner will be ready for Lesson 2.

User clicks "Start Lesson 1" to proceed. The capstone lesson is automatically added as the final item in the curriculum.

### Step 5: Write (Beat Sheet Builder)

**Prompt:** "Build your beat sheet. Bullets, not sentences. You're a coach — you talk in your own voice from the bullets."

**Sections (each is a collapsible card):**

- **Hook** — One sentence that grabs attention. "What if you could ___?"
- **Goal** — "Today I'll teach you ___. By the end you'll know how to ___."
- **Demonstration** — Notes on the clip to show. What to point to. When to pause.
- **Breakdown** — 3-5 bullets explaining what's happening and why. The "why" prompt is explicit on each bullet: "Why does this work?"
- **Common Mistake** — What beginners do wrong, and why the right way is better.
- **Practice Setup** — How to practice this in Creative mode.
- **Summary** — 2-3 bullets restating the key idea.
- **Outro** — Short and clean. "Next lesson: ___."

**Required field across all sections: Terms to Define.** Any Fortnite-specific word he plans to use, with a one-line beginner-friendly definition. Minimum 1 term required (most lessons will have several). The definitions get woven into the final beat sheet.

### Step 6: Review (Surface, Don't Judge)

The tool assembles everything into a preview of the final beat sheet, then presents a self-attestation checklist.

**Checklist (all must be acknowledged by user):**

- [ ] **One idea?** Does this video teach ONE thing, or did multiple things sneak back in?
- [ ] **Beginner-friendly definitions?** Two-column view appears here:

  | Terms you defined | Words used inside your definitions |
  |---|---|
  | diagonal pressure | right-hand peek, wall, edit |
  | right-hand peek | diagonal pressure, peek angle |
  | ... | ... |

  "Look for overlaps. If you defined a term using another term you also defined, a true beginner might be lost. That's okay — just decide if this lesson assumes earlier lessons, or if you should reword."

  Two buttons: "I'll revise" (returns to Step 5) or "This lesson assumes prerequisites — that's fine" (logs the dependency).

- [ ] **Why, not just what?** For each mechanic, did you explain why it works, not just what it is?
- [ ] **Pacing reasonable?** Estimated read-time appears here (word count of bullets × 1.3 for natural delivery pauses — tunable after 3-4 real lessons). If over 5 minutes, the tool gently suggests trimming.

**Design rationale:** Earlier spec proposed automated string-matching to detect jargon-density. That's fragile — it misses variations and can false-positive. The two-column surface-and-let-user-judge approach is more honest to the tool's philosophy: surface patterns, leave judgment to the human.

### Step 7: Re-record (Output)

A clean, printable beat sheet displayed in large readable type. Sections clearly separated. Term definitions appear inline in boxes within their relevant sections. Estimated section timings shown.

**Buttons:**

- **Print** — opens print dialog with print-optimized CSS
- **Copy to Clipboard** — full beat sheet as formatted text
- **Save Lesson** — saves and returns to home. Lesson remains fully editable from the home screen.
- **Start Next Lesson** — appears if the user is in a curriculum (Capstone Mode); jumps to Step 1 for the next lesson in the series.

**Edit-after-save:** Beat sheets stay editable forever. Reopening a saved lesson from the home screen jumps back into Step 5 (Write) with all fields populated. The user can update bullets, add terms, re-export. Status tracking (Draft / Recorded / Published) is informational only — it never locks the underlying content.

## Retrospective Loop

After a lesson has been saved at least once, the next time the user opens the tool, before the home screen appears, a small modal prompts:

> **How did [Lesson Name] go?**
>
> Anything to remember for next time? Two sentences max.
>
> [textarea]
>
> [Skip] [Save Note]

Skippable. Notes are attached to the lesson and visible on its detail view.

After 3 retrospectives exist, a new home-screen card appears: **"Coaching Journal"** — shows the last 3 retrospectives in a row. Pattern recognition across his own notes is where the meta-skill calcifies. He'll start seeing his own repeated observations and self-correct.

## Home Screen

When the user opens the tool, they see:

**Primary CTA (most prominent):**

- If a lesson is in progress → "Continue [Lesson Name]"
- Else if a Future Lesson is queued → "Next up: [Lesson Name]" (from the curriculum or Future Lessons queue)
- Else → "Start New Lesson"

**Secondary actions:**

- **Start New Lesson** (always available; warns if it would interrupt in-progress work)
- **My Curriculum** — list of all lessons (Draft / Recorded / Published), in curriculum order if applicable. Each entry is clickable to open and edit.
- **Coaching Journal** (appears after 3 retrospectives)

**Design rationale:** The Future Lessons queue was identified as a potential graveyard. The fix is making it the primary CTA next session, so saved-for-later items stay in his face as next-up work. No expiration — punishing slow pace is wrong for a kid building a habit.

## Branding & Tone

- Header: "Coach Keyed's Lesson Planner"
- Subhead: "Turn your rough drafts into real lessons."
- Aesthetic: pro tool, not kid app. Clean, dark or neutral palette. Sharp typography via system font stack (`ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`). Visual discipline comes from tight letter-spacing, strong weight contrast, and generous size hierarchy — not exotic fonts.
- Subtle Fortnite-adjacent accents (an angular accent line, a restrained gradient) but no mascots, cartoon characters, or excessive emoji.
- Button language: "Lock it in," "Save this lesson," "Start the series," "I'm ready to record." Never "Submit" or "Next."

## Technical Requirements

- Single HTML file. Inline CSS and JS. Double-click to open.
- localStorage persistence. All lesson data, curriculum, future lessons queue, retrospectives, and in-progress work persist across sessions. Single root key: `coachKeyedPlanner`.
- No external dependencies. No CDN, no internet fonts. Works offline.
- No backend. Everything client-side.
- Responsive. Desktop and tablet primary. Phone should not break.
- Export. Beat sheet exports via clipboard (formatted text) and browser print.

## State Model (rough)

```
{
  currentLessonId: string | null,
  lessons: {
    [id]: {
      title,
      status,                  // 'draft' | 'recorded' | 'published'
      roughDraft,              // Step 1 content (transcript OR bullets)
      watchNotes: { clipDescription, mainGoal },
      identifyList: [{ name, description }],
      isCapstone: boolean,
      narrowChoice: string | null,    // for Standard Mode
      curriculumOrder: [] | null,     // for Capstone Mode
      beatSheet: {
        hook, goal, demonstration,
        breakdown: [{ bullet, why }],
        commonMistake, practiceSetup,
        summary, outro
      },
      terms: [{ word, definition }],
      reviewChecks: { ... },
      retrospectives: [{ date, note }],
      prerequisiteOf: [lessonId] | null,
      createdAt, updatedAt, completedAt
    }
  },
  curriculum: [ordered list of lessonIds],
  futureLessons: [lessonId or { name, description, fromLesson }]
}
```

**Field naming note:** Generic field names (`hook`, `goal`, `terms`, `common_mistake`, `practice_setup`, `summary`) are deliberately chosen to be forward-compatible with any future curriculum schema (chess, other domains). No active effort to build bridges to other systems; just not actively painting into a corner.

## Out of Scope for v1

- Video upload and auto-transcription. The Step 1 change (accept bullet notes) makes this unnecessary for v1. Revisit only if real usage shows transcript creation is still a blocker.
- Multi-user / cloud sync. It's his tool, on his machine.
- Direct YouTube integration.
- AI-generated suggestions for any reflective field.
- Mobile-first design.
- Integration with any other app or content system.

## Open Questions to Resolve Before Build

- ~~**Tim's age**~~ **LOCKED: 14 (2026-05-23).** Tone calibrated for a teen coach: pro-direct, no patronizing applause on the Capstone reveal, dependency question uses "words or ideas from" (would've been too abstract at 12), journal prompt is open-ended ("anything to remember for next time?") because he can self-direct.
- **Dependency question wording** — current build leads with "Does the first item use words or ideas from the other items?" — lock or swap after one real session.

## Success Criteria

- Tim can complete a full lesson plan in 20-30 minutes without dad sitting next to him.
- The Capstone detection correctly catches his original rough draft as a 4-part series on first run.
- The beat sheet he produces is structurally complete (all sections filled, terms defined) but still in his own voice — when he reads from it, he sounds like himself, not like he's reading a script.
- After 3-4 lessons, he stops needing the explicit prompts and starts thinking in the structure naturally.
- The Coaching Journal shows recognizable patterns in his self-observations within 5 lessons.

---

## Open items from review (not yet folded into spec)

Five small things flagged in Claude's review of v1.1 that should be resolved before build:

1. **camelCase vs snake_case drift.** State model uses camelCase; field-naming note shows snake_case. Pick one. For localStorage JSON read only by JS, camelCase is the lower-friction default.

2. **Retrospective prompt needs a status guard.** "How did [Lesson Name] go?" only makes sense if `status !== 'draft'`. Otherwise the prompt fires for a lesson he never recorded.

3. **Dependency question wording — pick the concrete one as primary.** The fallback "Does item 1 use words or ideas from items 2 and 3?" is sharper than "Could a beginner understand…". Swap them: lead concrete, keep abstract as the v2 fallback.

4. **`prerequisiteOf` direction is ambiguous.** If Lesson 1 is the foundation for Lessons 2 + 3, is `prerequisiteOf` on Lesson 1 = `[2, 3]` (it IS a prerequisite of those) or on each of Lessons 2 + 3 = `[1]` (they HAVE prerequisite 1)? Pick one. Curriculum order already encodes this for Capstone Mode, so it may be derivable rather than stored.

5. **Soft-cap the retrospective note.** "Two sentences max" is in the copy but not enforced. Soft-cap around ~280 chars with a visible counter.
