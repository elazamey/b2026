import type { FindingsPack } from "../loop/findings-pack.js";

export type AgentProvider = "arena" | "manual" | "future";

export const REPAIR_TASK_SCHEMA = "guardian.repair-task/v1";

export interface RepairConstraints {
  may_declare_safe_to_merge: boolean;
  may_modify_contract: boolean;
  must_create_new_commit: boolean;
  merge_authority: "guardian";
}

export const REPAIR_CONSTRAINTS: RepairConstraints = {
  may_declare_safe_to_merge: false,
  may_modify_contract: false,
  must_create_new_commit: true,
  merge_authority: "guardian",
};

export interface RepairTask {
  schema: typeof REPAIR_TASK_SCHEMA;
  provider: AgentProvider;
  channel: "github-bus" | "local-file";
  decision_id: string;
  repository: string;
  commit_sha: string;
  contract_hash: string;
  findings: FindingsPack;
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
