import { MAX_REPAIR_ATTEMPTS, REPAIR_BUDGET } from "../loop/budget.js";

export type AgentProvider = "arena" | "manual" | "future";

export const REPAIR_TASK_SCHEMA = "guardian.repair-task/v2";

export { MAX_REPAIR_ATTEMPTS, REPAIR_BUDGET };

export interface RepairConstraints {
  may_declare_safe_to_merge: boolean;
  may_modify_contract: boolean;
  may_merge: boolean;
  must_create_new_commit: boolean;
  max_attempts: number;
  max_runtime_seconds: number;
  max_diff_lines: number;
  max_files_changed: number;
  max_tokens_per_cycle: number;
  merge_authority: "guardian";
}

export const REPAIR_CONSTRAINTS: RepairConstraints = {
  may_declare_safe_to_merge: false,
  may_modify_contract: false,
  may_merge: false,
  must_create_new_commit: true,
  max_attempts: REPAIR_BUDGET.max_attempts,
  max_runtime_seconds: REPAIR_BUDGET.max_runtime_seconds,
  max_diff_lines: REPAIR_BUDGET.max_diff_lines,
  max_files_changed: REPAIR_BUDGET.max_files_changed,
  max_tokens_per_cycle: REPAIR_BUDGET.max_tokens_per_cycle,
  merge_authority: "guardian",
};

export interface RepairViolation {
  rule_id: string;
  file?: string;
  line?: number;
  expected?: string;
  forbidden?: string;
}

export interface RepairTask {
  schema: typeof REPAIR_TASK_SCHEMA;
  task_id: string;
  provider: AgentProvider;
  channel: "github-bus" | "local-file";
  decision_id: string;
  repository: string;
  commit_sha: string;
  contract_hash: string;
  attempt: number;
  original_decision_id: string | null;
  violations: RepairViolation[];
  repair_plan: string[];
  constraints: RepairConstraints;
}

export interface DispatchResult {
  provider: AgentProvider;
  written?: string;
  channel: RepairTask["channel"];
}

export interface AgentAdapter {
  readonly provider: AgentProvider;
  dispatch(task: RepairTask): Promise<DispatchResult>;
}

export function assertRepairTaskSafe(task: RepairTask): void {
  if (task.constraints.may_declare_safe_to_merge) {
    throw new Error("Adapter cannot accept a task that may declare SAFE_TO_MERGE.");
  }
  if (task.constraints.may_modify_contract) {
    throw new Error("Adapter cannot accept a task that may modify the contract.");
  }
  if (task.constraints.may_merge) {
    throw new Error("Adapter cannot accept a task that may merge.");
  }
  if (task.constraints.merge_authority !== "guardian") {
    throw new Error("Adapter cannot accept merge authority.");
  }
  if (task.constraints.max_attempts !== REPAIR_BUDGET.max_attempts) {
    throw new Error("Adapter cannot accept a raised repair budget.");
  }
  if (task.constraints.max_runtime_seconds !== REPAIR_BUDGET.max_runtime_seconds) {
    throw new Error("Adapter cannot accept a raised repair timeout.");
  }
  if (task.constraints.max_diff_lines !== REPAIR_BUDGET.max_diff_lines) {
    throw new Error("Adapter cannot accept a raised diff budget.");
  }
  if (task.constraints.max_files_changed !== REPAIR_BUDGET.max_files_changed) {
    throw new Error("Adapter cannot accept a raised file budget.");
  }
  if (task.constraints.max_tokens_per_cycle !== REPAIR_BUDGET.max_tokens_per_cycle) {
    throw new Error("Adapter cannot accept a raised token budget.");
  }
}
