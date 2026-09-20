// Tasks that cannot be cleared from Tim's queue without resolving them.
//
// Background. task_dismissals lets Tim clear a task WITHOUT changing the
// underlying state, which is the right default: most tasks are nudges and
// "not needed right now" is a legitimate answer. The dismiss route accepted
// `task_type: z.string()` with no allow list, and DismissButton rendered for
// every task type, so every task was dismissible.
//
// That became unsafe the moment a completed call was made the only thing
// that advances the billing cycle. cron-auto-renew-detection fires the next
// $56 charge on cycle_lessons_delivered = 4, and only mark-outcome moves it,
// so `call_outcome_pending` stopped being a tidiness nudge and became the
// thing standing between Tim forgetting and a family silently never being
// billed again.
//
// Note what "protected" means here, because it is narrower than it sounds.
// The task only EXISTS while a call is unsettled: derived_tasks_view's
// unmarked_call CTE requires no live_call_completed_at, no no_show_at and no
// coach_cancels row. So marking the outcome is what clears it, and there is
// nothing to dismiss afterwards. Protecting it does not create a task Tim
// can never get rid of; it removes the one exit that resolved nothing.
//
// Enforced in TWO places on purpose, from this one list:
//   * src/app/api/admin/tasks/dismiss/route.ts  (the rule)
//   * src/app/admin/AdminClient.tsx             (the affordance)
// A hidden button is not a rule, and a rule with a visible button that fails
// is a worse experience than no button. One constant so they cannot drift.

export const PROTECTED_TASK_TYPES = ["call_outcome_pending"] as const;

export type ProtectedTaskType = (typeof PROTECTED_TASK_TYPES)[number];

export function isProtectedTask(taskType: string): boolean {
  return (PROTECTED_TASK_TYPES as readonly string[]).includes(taskType);
}
