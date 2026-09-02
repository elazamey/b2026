import type { DecisionRecord } from "../types.js";

export const MAX_REPAIR_ATTEMPTS = 3;

export type OrchestrationStatus = "dispatch" | "passed" | "exhausted";

export function repairAttemptNumber(decision: DecisionRecord): number {
  return decision.lineage?.repair_attempt ?? 0;
}

export function shouldDispatchRepair(decision: DecisionRecord): boolean {
  if (decision.result !== "REJECTED") return false;
  return repairAttemptNumber(decision) < MAX_REPAIR_ATTEMPTS;
}

export function orchestrationStatus(decision: DecisionRecord): OrchestrationStatus {
  if (decision.result === "SAFE_TO_MERGE") return "passed";
  if (repairAttemptNumber(decision) >= MAX_REPAIR_ATTEMPTS) return "exhausted";
  return "dispatch";
}
