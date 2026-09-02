import type { DecisionRecord } from "../types.js";
import type { RepairViolation } from "./types.js";

export type { RepairViolation };

export function slimViolations(decision: DecisionRecord): RepairViolation[] {
  return decision.violations.map((item) => {
    const row: RepairViolation = { rule_id: item.id };
    if (item.file) row.file = item.file;
    if (typeof item.line === "number") row.line = item.line;
    if (item.expected) row.expected = item.expected;
    const forbidden = item.actual ?? item.message;
    if (forbidden) row.forbidden = forbidden;
    return row;
  });
}
