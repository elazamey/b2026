import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionRecord, Finding } from "../types.js";

export const FINDINGS_SCHEMA = "guardian.findings/v1";

export interface RepairPolicy {
  allowed: boolean;
  forbidden: string[];
  required: string[];
}

export interface FindingsPack {
  schema: typeof FINDINGS_SCHEMA;
  decision_id: string;
  result: DecisionRecord["result"];
  repository: string;
  commit_sha: string;
  contract_hash: string;
  engine_version: string;
  timestamp: string;
  original_decision_id: string | null;
  repair_attempt_id: string | null;
  parent_commit_sha: string | null;
  violations: Finding[];
  repair: RepairPolicy;
}

export const FORBIDDEN_REPAIR_ACTIONS = [
  "modify architecture.yaml",
  "change contract_hash to bypass a finding",
  "declare SAFE_TO_MERGE",
  "amend or rewrite the rejected commit",
  "override the Guardian decision",
];

export const REQUIRED_REPAIR_ACTIONS = [
  "create a new commit",
  "keep architecture.yaml unchanged",
  "push so GitHub re-runs Guardian",
];

export function buildFindingsPack(decision: DecisionRecord): FindingsPack {
  const rejected = decision.result === "REJECTED";
  return {
    schema: FINDINGS_SCHEMA,
    decision_id: decision.decision_id,
    result: decision.result,
    repository: decision.repository,
    commit_sha: decision.commit_sha ?? decision.commit,
    contract_hash: decision.contract_hash,
    engine_version: decision.engine_version,
    timestamp: decision.timestamp,
    original_decision_id: decision.lineage?.original_decision_id ?? null,
    repair_attempt_id: decision.lineage?.repair_attempt_id ?? null,
    parent_commit_sha: decision.lineage?.parent_commit_sha ?? null,
    violations: decision.violations,
    repair: {
      allowed: rejected,
      forbidden: FORBIDDEN_REPAIR_ACTIONS,
      required: rejected ? REQUIRED_REPAIR_ACTIONS : ["stop — Guardian already allowed merge"],
    },
  };
}

export function writeFindingsPack(root: string, pack: FindingsPack): string {
  const dir = resolve(root, ".guardian", "findings");
  mkdirSync(dir, { recursive: true });
  const latest = resolve(dir, "latest.json");
  const named = resolve(dir, `${pack.decision_id}.json`);
  const body = `${JSON.stringify(pack, null, 2)}\n`;
  writeFileSync(latest, body, "utf8");
  writeFileSync(named, body, "utf8");
  return latest;
}
