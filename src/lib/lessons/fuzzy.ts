// Tiny fuzzy search for the lesson picker. No external dep — at our
// scale (single-digit to low-hundreds of lessons) this is plenty.
// Tolerates partial phrases, related terminology, and one-character
// misspellings per word.
//
// Algorithm:
//   1. Tokenize the query into lowercase words (whitespace split,
//      drop empties, drop tokens shorter than 2 chars).
//   2. For each lesson, build a searchable haystack from the
//      caller-supplied fields (title, fortnite_label, parent_label,
//      topic, etc) — lowercased + space-joined.
//   3. For each query token:
//        - Exact substring in haystack: score 30
//        - Edit-distance ≤ 1 to any word in haystack: score 10
//        - Otherwise: lesson is excluded (all tokens must match
//          somewhere — substring OR fuzzy)
//   4. Lessons get a per-field bonus: title hits weigh more than
//      description hits.
//   5. Sort by total score desc, then by tiebreak (caller's choice,
//      typically updated_at desc for recency).

export type SearchableLesson = {
  id: string;
  // High-weight fields (title-like): hits here score more.
  primary: string;
  // Lower-weight fields: descriptions, topic, etc.
  secondary?: string;
};

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

// Levenshtein distance, classic DP. Returns minimum edits to transform
// a into b. Caps at threshold + 1 for early exit on long strings.
function editDistance(a: string, b: string, threshold: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > threshold) return threshold + 1;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  let prev = new Array(bl + 1);
  let curr = new Array(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;
  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,        // deletion
        curr[j - 1] + 1,    // insertion
        prev[j - 1] + cost, // substitution
      );
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > threshold) return threshold + 1;
    [prev, curr] = [curr, prev];
  }
  return prev[bl];
}

function scoreTokenAgainstField(token: string, fieldWords: string[]): number {
  // Substring match wins.
  for (const w of fieldWords) {
    if (w.includes(token) || token.includes(w)) return 1;
  }
  // Edit-distance fuzzy (≤1 for tokens up to length 5, ≤2 for longer).
  // Keeps "piece" matching "pieces", "tunneling" matching "tunneling"
  // with one typo, etc. Not over-aggressive — three-character tokens
  // would match too much, so we skip fuzzy for those.
  if (token.length < 4) return 0;
  const threshold = token.length >= 7 ? 2 : 1;
  for (const w of fieldWords) {
    if (w.length < 3) continue;
    if (editDistance(token, w, threshold) <= threshold) return 0.5;
  }
  return 0;
}

export type FuzzyMatch<T extends SearchableLesson> = {
  lesson: T;
  score: number;
};

export function fuzzyFilter<T extends SearchableLesson>(
  query: string,
  lessons: T[],
): FuzzyMatch<T>[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) {
    return lessons.map((l) => ({ lesson: l, score: 0 }));
  }
  const matches: FuzzyMatch<T>[] = [];
  for (const lesson of lessons) {
    const primary = (lesson.primary ?? "").toLowerCase();
    const secondary = (lesson.secondary ?? "").toLowerCase();
    const primaryWords = primary.split(/[\s.,;:!?()"-]+/).filter(Boolean);
    const secondaryWords = secondary.split(/[\s.,;:!?()"-]+/).filter(Boolean);
    let total = 0;
    let allMatched = true;
    for (const token of tokens) {
      const pScore = scoreTokenAgainstField(token, primaryWords);
      const sScore = scoreTokenAgainstField(token, secondaryWords);
      if (pScore === 0 && sScore === 0) {
        allMatched = false;
        break;
      }
      // Primary hits weigh 3x secondary — title matches dominate.
      total += pScore * 3 + sScore;
    }
    if (allMatched) matches.push({ lesson, score: total });
  }
  matches.sort((a, b) => b.score - a.score);
  return matches;
}
