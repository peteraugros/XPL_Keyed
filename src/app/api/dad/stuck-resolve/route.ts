// POST /api/dad/stuck-resolve
//
// Dad resolves a Stuck. Per Coach Dashboard Spec/dad-admin-spec.md
// section 3 + backend-spec.md section 3.
//
// Inputs:
//   * stuck_id        — the stuck_events row to resolve
//   * resolution_type — 'handled_directly' | 'returned_to_tim' | 'no_action_needed'
//   * resolution_note — optional, only meaningful for returned_to_tim
//
// What this does:
//   1. Validates the caller is a coach with is_dad=true.
//   2. Loads the stuck_events row + reads object_type + object_id.
//   3. Updates stuck_events: resolved_by, resolved_at, resolution_type,
//      resolution_note.
//   4. Flips the source object's waiting_on per resolution_type:
//        * handled_directly -> SYSTEM (Dad acted out of band; nothing
//          for Tim to do)
//        * returned_to_tim  -> TIM (Tim handles it with Dad's note)
//        * no_action_needed -> TIM (Tim handles it; no note, no shame)
//
// Note: this endpoint does NOT itself write a message in the Tim ↔ Dad
// channel for "returned_to_tim" cases. That channel doesn't exist yet.
// For now, the note lives on stuck_events.resolution_note; Tim's admin
// can surface it as a banner on the next view. Future commit wires the
// dedicated Tim ↔ Dad message channel.

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  stuck_id: z.string().uuid(),
  resolution_type: z.enum(["handled_directly", "returned_to_tim", "no_action_needed"]),
  resolution_note: z.string().trim().max(1000).nullable().optional(),
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
    .select("id, is_active, is_dad")
    .eq("auth_user_id", userResult.data.user.id)
    .maybeSingle();
  const coach = coachLookup.data as
    | { id: string; is_active: boolean; is_dad: boolean }
    | null;
  if (!coach || !coach.is_active || !coach.is_dad) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // ---- 1. Fetch the stuck row so we know the source object ---------------
  const stuckLookup = await supabase
    .from("stuck_events")
    .select("id, object_type, object_id, resolved_at")
    .eq("id", body.stuck_id)
    .maybeSingle();
  const stuck = stuckLookup.data as
    | { id: string; object_type: string; object_id: string; resolved_at: string | null }
    | null;
  if (!stuck) {
    return NextResponse.json({ error: "stuck_not_found" }, { status: 404 });
  }
  if (stuck.resolved_at) {
    return NextResponse.json({ error: "already_resolved" }, { status: 409 });
  }

  // ---- 2. Update the stuck row -------------------------------------------
  // RLS for stuck_events allows coach (which includes Dad-coaches) full
  // CRUD via stuck_events_coach_all.
  const stuckUpdate = await supabase
    .from("stuck_events")
    .update({
      resolved_at: new Date().toISOString(),
      resolution_type: body.resolution_type,
      resolution_note: body.resolution_note ?? null,
      // resolved_by references parents(id) in the schema. Dad doesn't
      // have a parents row (he's a coach); leave NULL. The Dad action
      // is captured via coach login + the stuck_events row itself.
      // Future schema cleanup: change FK to point at coaches(id) or a
      // generic users table.
    } as never)
    .eq("id", stuck.id);
  if (stuckUpdate.error) {
    console.error("[dad/stuck-resolve] stuck update failed", stuckUpdate.error);
    return NextResponse.json({ error: "stuck_update_failed" }, { status: 500 });
  }

  // ---- 3. Flip source object's waiting_on --------------------------------
  const newWaitingOn =
    body.resolution_type === "handled_directly" ? "SYSTEM" : "TIM";

  switch (stuck.object_type) {
    case "message_thread": {
      const r = await supabase
        .from("messages")
        .update({ waiting_on: newWaitingOn } as never)
        .eq("id", stuck.object_id);
      if (r.error) console.error("[dad/stuck-resolve] messages flip failed", r.error);
      break;
    }
    case "trial_decision":
    case "dunning": {
      const r = await supabase
        .from("subscriptions")
        .update({ waiting_on: newWaitingOn } as never)
        .eq("id", stuck.object_id);
      if (r.error) console.error("[dad/stuck-resolve] subscriptions flip failed", r.error);
      break;
    }
    case "curriculum_approval": {
      const r = await supabase
        .from("curricula")
        .update({ waiting_on: newWaitingOn } as never)
        .eq("id", stuck.object_id);
      if (r.error) console.error("[dad/stuck-resolve] curricula flip failed", r.error);
      break;
    }
    case "cancellation_event": {
      const r = await supabase
        .from("cancellation_events")
        .update({ waiting_on: newWaitingOn } as never)
        .eq("id", stuck.object_id);
      if (r.error) console.error("[dad/stuck-resolve] cancellation_events flip failed", r.error);
      break;
    }
    case "checklist_item":
    case "other":
      // No source-table mapping for these. stuck_events is the only
      // record. Resolution is recorded; nothing else to flip.
      break;
  }

  return NextResponse.json({ ok: true });
}
