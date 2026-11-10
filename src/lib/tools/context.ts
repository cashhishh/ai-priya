/**
 * Applies tool-emitted UI events to the minimal CallContext the executor needs.
 * Used by the server-side fallback loop and by the client reducer, so both
 * engines track insights / actions / follow-up identically.
 */
import type { ActionItem, CallContext, SellerInsight, UiEvent } from "@/lib/types";

/** Add an insight, or replace an earlier one with the same id (the executor merged them). */
export function upsertInsight(insights: SellerInsight[], insight: SellerInsight): SellerInsight[] {
  return insights.some((i) => i.id === insight.id) ? insights.map((i) => (i.id === insight.id ? insight : i)) : [...insights, insight];
}

export function applyEventToActions(actions: ActionItem[], event: UiEvent): ActionItem[] {
  if (event.type === "action_proposed") {
    // Replace a previous proposal of the same executable type instead of duplicating it.
    // (Same id = the executor matched an untyped duplicate by title.)
    const { id, action_type } = event.action;
    const existing = actions.findIndex((a) => a.id === id || (!!action_type && a.action_type === action_type));
    if (existing >= 0) {
      const merged = { ...event.action, id: actions[existing].id, status: actions[existing].status };
      if (actions[existing].status === "executed") {
        merged.execution_result = actions[existing].execution_result;
        merged.execution_lines = actions[existing].execution_lines;
      }
      return actions.map((a, i) => (i === existing ? merged : a));
    }
    return [...actions, event.action];
  }
  if (event.type === "action_executed") {
    const idx = actions.findIndex((a) => a.action_type === event.action_type);
    if (idx === -1) {
      return [...actions, event.fallback_action];
    }
    return actions.map((a, i) =>
      i === idx ? { ...a, status: "executed", execution_result: event.result, execution_lines: event.lines } : a,
    );
  }
  return actions;
}

export function applyEventToContext(ctx: CallContext, event: UiEvent): CallContext {
  switch (event.type) {
    case "insight_recorded":
      return { ...ctx, insights: upsertInsight(ctx.insights, event.insight) };
    case "action_proposed":
    case "action_executed":
      return { ...ctx, actions: applyEventToActions(ctx.actions, event) };
    case "follow_up_scheduled":
      return { ...ctx, follow_up: event.follow_up };
    case "diagnosis":
      return { ...ctx, diagnosed: true };
    case "escalated":
      return { ...ctx, escalated: true };
    case "offer_declined":
      return { ...ctx, declined_offers: [...new Set([...(ctx.declined_offers ?? []), event.action_type])] };
    default:
      return ctx;
  }
}
