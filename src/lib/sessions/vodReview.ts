// Turning a live call into a VOD review.
//
// The product argument, because it decides the rules below. Today a session
// inside the 24 hour window is LOST and burns a skip, and the third skip turns
// off auto renew. So a sudden conflict costs a family a session they paid for
// and moves them toward losing the subscription. A VOD review is the humane
// branch of that exact moment: the kid still gets coached, Tim still delivers
// the same three artifacts, and the session counts.
//
// Peter, on who gets the button: "it should be a student facing action, parents
// are there only to see, for the sake of transparency. students should be able
// to vod review once a month, or tim could decide its necessary and do it too."

/** One student initiated swap per cycle. A cycle is four sessions, about a
 *  month, and is the only clock the portal already speaks (skips are "2 of 2
 *  used this cycle"). A calendar month would be a second time base that can
 *  disagree with the first. */
export const VOD_REVIEWS_PER_CYCLE = 1;

export type VodReviewBy = "student" | "coach";

export type SlotForSwap = {
  delivery_mode: string;
  delivered_at: string | null;
  live_call_at: string | null;
};

export type SwapRefusal =
  | "already_vod_review"
  | "already_delivered"
  | "allowance_spent";

export type SwapDecision =
  | { ok: true }
  | { ok: false; reason: SwapRefusal };

/**
 * May this slot become a VOD review?
 *
 * Deliberately NOT gated on the 24 hour window. That boundary exists because a
 * live call needs a slot in Tim's calendar; a VOD review does not. Blocking it
 * inside 24 hours would refuse the case the feature exists for.
 */
export function canSwapToVodReview(
  slot: SlotForSwap,
  by: VodReviewBy,
  cycleVodReviewsUsed: number,
): SwapDecision {
  if (slot.delivery_mode === "vod_review") {
    return { ok: false, reason: "already_vod_review" };
  }
  // Once Tim has delivered, the session is spent and there is nothing to change.
  if (slot.delivered_at) {
    return { ok: false, reason: "already_delivered" };
  }
  // Tim deciding a session is better spent on a VOD is a coaching judgment.
  // Charging the kid's one swap for his call would punish them for it.
  if (by === "coach") return { ok: true };

  if (cycleVodReviewsUsed >= VOD_REVIEWS_PER_CYCLE) {
    return { ok: false, reason: "allowance_spent" };
  }
  return { ok: true };
}

/** Undo is allowed until Tim has delivered. After that the session is spent. */
export function canUndoVodReview(slot: SlotForSwap): SwapDecision {
  if (slot.delivery_mode !== "vod_review") {
    return { ok: false, reason: "already_vod_review" };
  }
  if (slot.delivered_at) return { ok: false, reason: "already_delivered" };
  return { ok: true };
}

/**
 * A student swap spends the allowance; a coach swap does not. Undoing a
 * student swap gives it back, so a kid who changes their mind is not charged
 * for a decision they reversed before anything happened.
 */
export function allowanceAfterSwap(used: number, by: VodReviewBy): number {
  return by === "student" ? used + 1 : used;
}

export function allowanceAfterUndo(used: number, by: VodReviewBy | null): number {
  if (by !== "student") return used;
  return Math.max(0, used - 1);
}

/** What the kid is told when they cannot. Their words, not the system's. */
export function refusalMessage(reason: SwapRefusal): string {
  switch (reason) {
    case "already_vod_review":
      return "This session is already set up as a VOD review.";
    case "already_delivered":
      return "This session is done, so it cannot be changed.";
    case "allowance_spent":
      return "You have already used your VOD review this cycle. It comes back when your next cycle starts.";
  }
}
