// LessonView
// ----------
// Shared rendering component for the published lesson experience.
// Used today by the admin preview page (/admin/lessons/[id]/preview);
// designed to be reused on future public routes /portal/lessons/[id]
// (parent view) and /play/lessons/[id] (kid view) without changes.
//
// Two viewer modes:
//   - "kid": Fortnite-vocabulary title, video embed up top, glossary
//     of terms they might not know, key beats from the beat sheet.
//   - "parent": Real-world skill name (parent_label) leading the
//     header with the Fortnite term in italicized parens (Hard rule
//     #4), parent_skill_description as the "what this teaches" line,
//     and the "🤫 For your back pocket" talking points block.
//
// The same lesson row drives both views — the layout decides what to
// emphasize and what to hide.

import styles from "./preview.module.css";

export type ViewerMode = "kid" | "parent";

export type LessonForView = {
  id: string;
  title: string;
  fortniteLabel: string | null;
  parentLabel: string | null;
  parentSkillDescription: string | null;
  topic: string | null;
  difficultyLevel: string | null;
  durationMinutes: number | null;
  videoUrl: string | null;
  beatSheet: {
    hook?: string;
    goal?: string;
    demonstration?: string;
    breakdown?: Array<{ bullet: string; why: string }>;
    commonMistake?: string;
    practiceSetup?: string;
    summary?: string;
    outro?: string;
  } | null;
  terms: Array<{ word: string; definition: string }> | null;
  parentTalkingPoints: Array<{ category: string; text: string }> | null;
};

// Same logic as PlannerClient's videoEmbedUrl — duplicated here to
// keep this component self-contained (the planner is admin-only;
// this view will eventually run on parent/kid routes).
function videoEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  const yt = trimmed.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/,
  );
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vm = trimmed.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  const lm = trimmed.match(/loom\.com\/(?:share|embed)\/([A-Za-z0-9]+)/);
  if (lm) return `https://www.loom.com/embed/${lm[1]}`;
  return null;
}

const TALKING_POINT_LABELS: Record<string, string> = {
  informed_observer: "Watch for",
  co_conspirator: "Drop this line",
  cultural_literacy: "Word to know",
  good_question: "Ask them",
  strategic_note: "Strategic note",
};

export default function LessonView({
  lesson,
  mode,
}: {
  lesson: LessonForView;
  mode: ViewerMode;
}) {
  const embedUrl = videoEmbedUrl(lesson.videoUrl);
  const terms = (lesson.terms ?? []).filter(
    (t) => t.word.trim() && t.definition.trim(),
  );
  const beat = lesson.beatSheet ?? {};
  const breakdown = (beat.breakdown ?? []).filter((b) => b.bullet.trim());
  const ttps = (lesson.parentTalkingPoints ?? []).filter((tp) => tp.text?.trim());

  if (mode === "parent") {
    return (
      <article className={styles.lessonView}>
        <header className={styles.lessonHeader}>
          <div className={styles.eyebrow}>
            {lesson.topic ? lesson.topic.replace(/_/g, " ") : "Lesson"}
            {lesson.difficultyLevel ? ` · ${lesson.difficultyLevel}` : ""}
            {lesson.durationMinutes ? ` · ${lesson.durationMinutes} min` : ""}
          </div>
          <h1 className={styles.lessonTitleParent}>
            {lesson.parentLabel || lesson.title}
          </h1>
          {lesson.fortniteLabel ? (
            <p className={styles.fortniteTermLine}>
              <em>(Fortnite term: {lesson.fortniteLabel}.)</em>
            </p>
          ) : null}
          {lesson.parentSkillDescription ? (
            <p className={styles.lessonSubParent}>
              {lesson.parentSkillDescription}
            </p>
          ) : null}
        </header>

        {lesson.videoUrl ? (
          embedUrl ? (
            <div className={styles.videoFrame}>
              <iframe
                src={embedUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
                title={lesson.title}
              />
            </div>
          ) : (
            <a
              href={lesson.videoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.videoFallback}
            >
              Watch this week&apos;s lesson →
            </a>
          )
        ) : (
          <div className={styles.videoMissing}>
            Video not attached yet. Tim will add it before this lesson ships.
          </div>
        )}

        {ttps.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>🤫 For your back pocket</h2>
            <p className={styles.sectionLead}>
              Things you can say or notice with your kid this week.
            </p>
            <ul className={styles.talkingPoints}>
              {ttps.map((tp, i) => (
                <li key={i} className={styles.talkingPoint}>
                  <span className={styles.talkingPointEyebrow}>
                    {TALKING_POINT_LABELS[tp.category] ?? tp.category}
                  </span>
                  <span className={styles.talkingPointText}>{tp.text}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {terms.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Words you might hear</h2>
            <p className={styles.sectionLead}>
              If your kid uses one of these, you&apos;ll know what they mean.
            </p>
            <dl className={styles.glossary}>
              {terms.map((t) => (
                <div key={t.word} className={styles.glossaryRow}>
                  <dt className={styles.glossaryTerm}>{t.word}</dt>
                  <dd className={styles.glossaryDef}>{t.definition}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}
      </article>
    );
  }

  // mode === "kid"
  return (
    <article className={styles.lessonView}>
      <header className={styles.lessonHeader}>
        <div className={styles.eyebrow}>
          {lesson.topic ? lesson.topic.replace(/_/g, " ") : "Lesson"}
          {lesson.difficultyLevel ? ` · ${lesson.difficultyLevel}` : ""}
          {lesson.durationMinutes ? ` · ${lesson.durationMinutes} min` : ""}
        </div>
        <h1 className={styles.lessonTitleKid}>
          {lesson.fortniteLabel || lesson.title}
        </h1>
        {beat.hook ? (
          <p className={styles.kidHook}>{beat.hook}</p>
        ) : null}
      </header>

      {lesson.videoUrl ? (
        embedUrl ? (
          <div className={styles.videoFrame}>
            <iframe
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
              title={lesson.title}
            />
          </div>
        ) : (
          <a
            href={lesson.videoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.videoFallback}
          >
            Watch the lesson →
          </a>
        )
      ) : (
        <div className={styles.videoMissing}>
          Video not posted yet. Check back soon.
        </div>
      )}

      {beat.goal ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>What you&apos;ll learn</h2>
          <p className={styles.kidParagraph}>{beat.goal}</p>
        </section>
      ) : null}

      {terms.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Quick glossary</h2>
          <dl className={styles.glossary}>
            {terms.map((t) => (
              <div key={t.word} className={styles.glossaryRow}>
                <dt className={styles.glossaryTerm}>{t.word}</dt>
                <dd className={styles.glossaryDef}>{t.definition}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}

      {breakdown.length > 0 ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>The key beats</h2>
          <ol className={styles.beats}>
            {breakdown.map((b, i) => (
              <li key={i} className={styles.beat}>
                <span className={styles.beatBullet}>{b.bullet}</span>
                {b.why?.trim() ? (
                  <span className={styles.beatWhy}>{b.why}</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {beat.commonMistake ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Common mistake</h2>
          <p className={styles.kidParagraph}>{beat.commonMistake}</p>
        </section>
      ) : null}

      {beat.practiceSetup ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Practice this in Creative</h2>
          <p className={styles.kidParagraph}>{beat.practiceSetup}</p>
        </section>
      ) : null}

      {beat.summary ? (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recap</h2>
          <p className={styles.kidParagraph}>{beat.summary}</p>
        </section>
      ) : null}

      {beat.outro ? (
        <section className={styles.section}>
          <p className={styles.outro}>{beat.outro}</p>
        </section>
      ) : null}
    </article>
  );
}
