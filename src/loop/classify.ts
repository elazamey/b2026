import type { DecisionResult } from "../types.js";
import { REPAIR_BUDGET, type RepairBudget } from "./budget.js";

export type CycleStatus =
  | "RUNNING"
  | "TIMEOUT"
  | "BUDGET_EXCEEDED"
  | "PROVIDER_ERROR"
  | "PATCH_REJECTED"
  | "RECHECK_FAILED"
  | "COMPLETED";

export type FailureClass = "agent" | "guardian" | "infrastructure";

export interface RepairUsage {
  runtime_seconds: number;
  files_changed: number;
  diff_lines: number;
  tokens: number | null;
}

export const EMPTY_USAGE: RepairUsage = {
  runtime_seconds: 0,
  files_changed: 0,
  diff_lines: 0,
  tokens: null,
};

export function failureClassOf(status: CycleStatus): FailureClass | null {
  switch (status) {
    case "TIMEOUT":
    case "BUDGET_EXCEEDED":
    case "PATCH_REJECTED":
      return "agent";
    case "PROVIDER_ERROR":
      return "infrastructure";
    case "RECHECK_FAILED":
    case "COMPLETED":
      return "guardian";
    default:
      return null;
  }
}

export function isAbuseStop(status: CycleStatus | undefined): boolean {
  return status === "TIMEOUT" || status === "BUDGET_EXCEEDED";
}

export function classifyCycle(input: {
  guardianResult: DecisionResult;
  usage?: RepairUsage;
  budget?: RepairBudget;
  contractMutated?: boolean;
  providerError?: boolean;
}): CycleStatus {
  const usage = input.usage ?? EMPTY_USAGE;
  const budget = input.budget ?? REPAIR_BUDGET;
  if (input.providerError) return "PROVIDER_ERROR";
  if (usage.runtime_seconds > budget.max_runtime_seconds) return "TIMEOUT";
  if (usage.files_changed > budget.max_files_changed) return "BUDGET_EXCEEDED";
  if (usage.diff_lines > budget.max_diff_lines) return "BUDGET_EXCEEDED";
  if (usage.tokens != null && usage.tokens > budget.max_tokens_per_cycle) return "BUDGET_EXCEEDED";
  if (input.contractMutated) return "PATCH_REJECTED";
  if (input.guardianResult === "REJECTED") return "RECHECK_FAILED";
  return "COMPLETED";
}
