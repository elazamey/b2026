import type { DecisionRecord } from "../types.js";
import { repairAttemptNumber } from "../loop/orchestrate.js";
import { REPAIR_CONSTRAINTS, REPAIR_TASK_SCHEMA, type AgentProvider, type RepairTask } from "./types.js";
import { slimViolations } from "./violations.js";

export function buildRepairTask(
  decision: DecisionRecord,
  provider: AgentProvider,
  options: { repairPlan?: string[] } = {},
): RepairTask {
  const attempt = repairAttemptNumber(decision);
  return {
    schema: REPAIR_TASK_SCHEMA,
    task_id: `repair_${decision.decision_id}`,
    provider,
    channel: provider === "manual" ? "local-file" : "github-bus",
    decision_id: decision.decision_id,
    repository: decision.repository,
    commit_sha: decision.commit_sha ?? decision.commit,
    contract_hash: decision.contract_hash,
    attempt,
    original_decision_id: decision.lineage?.original_decision_id ?? null,
    violations: slimViolations(decision),
    repair_plan: options.repairPlan ?? [],
    constraints: { ...REPAIR_CONSTRAINTS },
  };
}
