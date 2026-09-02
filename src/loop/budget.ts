export const REPAIR_BUDGET = {
  max_attempts: 3,
  max_runtime_seconds: 900,
  max_diff_lines: 500,
  max_files_changed: 50,
  max_tokens_per_cycle: 32_000,
} as const;

export type RepairBudget = typeof REPAIR_BUDGET;

export const MAX_REPAIR_ATTEMPTS = REPAIR_BUDGET.max_attempts;
