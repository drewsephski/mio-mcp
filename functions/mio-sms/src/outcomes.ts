export const outcomeNames = ["answered", "created_note", "updated_note", "archived_note", "deleted_note", "created_reminder", "updated_reminder", "canceled_reminder", "clarification", "no_action", "failed", "reminder_rejected"] as const;
export type Outcome = typeof outcomeNames[number];
export function committedOutcomes(actions: ReadonlySet<Outcome>): Outcome[] {
  return actions.size ? [...actions].sort() : ["no_action"];
}
