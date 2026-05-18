// POST /api/admin/stuck
//
// Tim's "Stuck" button. Routes a task from Tim's queue to Dad's queue.
// Per Coach Dashboard Spec/backend-spec.md section 3 + 7.
//
// What this does:
//   1. Writes a row to stuck_events (the audit log / pattern history).
//   2. Flips the source object's waiting_on from TIM to DAD. This makes
//      the task immediately disappear from derived_tasks_view (which
//      filters waiting_on='TIM'), so Tim's Home stops surfacing it.
//   3. Fires a Discord DM to Peter (the configured operator user id).
//      Currently goes to DISCORD_TIM_USER_ID env until a DAD user id
//      env var is added — flagged as a follow-up.
//
// Resolution flow (Dad acts on Stuck): NOT built in this commit. Dad's
// admin doesn't exist yet. When it does, it reads stuck_events with
// resolved_at IS NULL, lets Dad pick handled_directly / returned_to_tim
// / no_action_needed, writes resolution_*, and (for return_to_tim)
// flips waiting_on back to TIM.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { sendDirectMessage } from "@/lib/discord/bot";
import type { TablesInsert } from "@/types/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OBJECT_TYPES = [
  "message_thread",
  "trial_decision",
  "checklist_item",
  "curriculum_approval",
  "cancellation_event",
  "dunning",
  "other",
] as const;

const BodySchema = z.object({
  object_type: z.enum(OBJECT_TYPES),
  object_id: z.string().uuid(),
  client_name: z.string().trim().min(1).max(120),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: "invalid_body", detail: (err as z.ZodError).issues },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const userResult = await supabase.auth.getUser();
  if (!userResult.data.user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const coachLookup = await supabase
    .from("coaches")
    .select("id, display_name, is_active")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as
    | { id: string; display_name: string; is_active: boolean }
    | null;
  if (!coach || !coach.is_active) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // ---- 1. Insert stuck_events row ----------------------------------------
  const stuckRow: TablesInsert<"stuck_events"> = {
    tim_user_id: coach.id,
    object_type: body.object_type,
    object_id: body.object_id,
    reason: body.reason ?? null,
  };
  const stuckInsert = await supabase
    .from("stuck_events")
    .insert(stuckRow as never)
    .select("id")
    .single();
  const stuckData = stuckInsert.data as { id: string } | null;
  if (stuckInsert.error || !stuckData) {
    console.error("[admin/stuck] insert failed", stuckInsert.error);
    return NextResponse.json({ error: "stuck_insert_failed" }, { status: 500 });
  }

  // ---- 2. Flip the source object's waiting_on -> DAD ---------------------
  // Each object_type maps to a different table. We update by object_id.
  let flipError: unknown = null;
  switch (body.object_type) {
    case "message_thread": {
      const r = await supabase
        .from("messages")
        .update({ waiting_on: "DAD" } as never)
        .eq("id", body.object_id);
      flipError = r.error;
      break;
    }
    case "trial_decision":
    case "dunning": {
      const r = await supabase
        .from("subscriptions")
        .update({ waiting_on: "DAD" } as never)
        .eq("id", body.object_id);
      flipError = r.error;
      break;
    }
    case "curriculum_approval": {
      const r = await supabase
        .from("curricula")
        .update({ waiting_on: "DAD" } as never)
        .eq("id", body.object_id);
      flipError = r.error;
      break;
    }
    case "cancellation_event": {
      const r = await supabase
        .from("cancellation_events")
        .update({ waiting_on: "DAD" } as never)
        .eq("id", body.object_id);
      flipError = r.error;
      break;
    }
    case "checklist_item":
    case "other":
      // No table mapping yet; the stuck_events row is the source of truth.
      break;
  }
  if (flipError) {
    console.error("[admin/stuck] waiting_on flip failed", flipError);
    // Don't bail — the stuck_events row exists; Dad sees it; the task
    // may still surface for Tim until the flip retries. Log + return ok.
  }

  // ---- 3. Fire Discord DM to the operator (currently Tim's id env) -------
  // TODO: rename DISCORD_TIM_USER_ID to DISCORD_OPERATOR_USER_ID (or add
  // a separate DISCORD_DAD_USER_ID) once Peter's Discord identity is wired.
  // For now, the only operator id we have goes here.
  const dadDiscordId = process.env.DISCORD_DAD_USER_ID ?? process.env.DISCORD_TIM_USER_ID;
  if (dadDiscordId) {
    try {
      await sendDirectMessage(
        dadDiscordId,
        `Tim is stuck on ${body.object_type.replace(/_/g, " ")} for ${body.client_name}.${body.reason ? ` Reason: ${body.reason}` : ""} Open the admin to handle.`,
      );
    } catch (err) {
      console.error("[admin/stuck] Discord DM failed", err);
      // Non-fatal — the stuck row is written; the DM is observability.
    }
  } else {
    console.warn("[admin/stuck] no DISCORD_DAD_USER_ID / DISCORD_TIM_USER_ID set; skipping DM");
  }

  return NextResponse.json({ ok: true, stuck_id: stuckData.id });
}
