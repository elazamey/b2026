import type { DecisionRecord } from "../types.js";
import { buildFindingsPack } from "../loop/findings-pack.js";
import {
  REPAIR_CONSTRAINTS,
  REPAIR_TASK_SCHEMA,
  type AgentProvider,
  type RepairTask,
} from "./types.js";

export function buildRepairTask(
  decision: DecisionRecord,
  provider: AgentProvider,
): RepairTask {
  const findings = buildFindingsPack(decision);
  return {
    schema: REPAIR_TASK_SCHEMA,
    provider,
    channel: provider === "manual" ? "local-file" : "github-bus",
    decision_id: decision.decision_id,
    repository: decision.repository,
    commit_sha: decision.commit_sha ?? decision.commit,
    contract_hash: decision.contract_hash,
    findings,
    constraints: REPAIR_CONSTRAINTS,
  };
}
