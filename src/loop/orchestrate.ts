import type { DecisionRecord } from "../types.js";
import { MAX_REPAIR_ATTEMPTS } from "./budget.js";
import { isAbuseStop, type CycleStatus } from "./classify.js";

export { MAX_REPAIR_ATTEMPTS, REPAIR_BUDGET } from "./budget.js";

export type OrchestrationStatus = "dispatch" | "passed" | "exhausted" | "timeout" | "budget";

export type DispatchStop = "passed" | "exhausted" | "timeout" | "budget" | "provider";

export function repairAttemptNumber(decision: DecisionRecord): number {
  return decision.lineage?.repair_attempt ?? 0;
}

export function shouldDispatchRepair(
  decision: DecisionRecord,
  lastCycleStatus?: CycleStatus,
): boolean {
  if (decision.result !== "REJECTED") return false;
  if (isAbuseStop(lastCycleStatus)) return false;
  return repairAttemptNumber(decision) < MAX_REPAIR_ATTEMPTS;
}

export function orchestrationStatus(
  decision: DecisionRecord,
  lastCycleStatus?: CycleStatus,
): OrchestrationStatus {
  if (decision.result === "SAFE_TO_MERGE") return "passed";
  if (lastCycleStatus === "TIMEOUT") return "timeout";
  if (lastCycleStatus === "BUDGET_EXCEEDED") return "budget";
  if (repairAttemptNumber(decision) >= MAX_REPAIR_ATTEMPTS) return "exhausted";
  return "dispatch";
}

export function dispatchStopReason(
  decision: DecisionRecord,
  lastCycleStatus?: CycleStatus,
): DispatchStop {
  if (decision.result !== "REJECTED") return "passed";
  if (lastCycleStatus === "TIMEOUT") return "timeout";
  if (lastCycleStatus === "BUDGET_EXCEEDED") return "budget";
  if (lastCycleStatus === "PROVIDER_ERROR") return "provider";
  return "exhausted";
}
