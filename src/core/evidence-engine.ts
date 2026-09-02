import type { DecisionRecord } from "../types.js";
import { canonicalJson, sha256Prefixed } from "../util/hash.js";

export function evidenceHash(
  record: Omit<DecisionRecord, "evidence_hash"> | DecisionRecord,
): string {
  const payload = {
    schema_version: "schema_version" in record ? record.schema_version : "0.2",
    repository: record.repository,
    commit: record.commit,
    commit_sha: record.commit_sha ?? null,
    pull_request: record.pull_request?.number ?? null,
    contract_path: record.contract_path,
    contract_hash: record.contract_hash,
    engine_version: record.engine_version,
    result: record.result,
    checks: record.checks,
    violations: record.violations,
    evidence: record.evidence,
    lineage: record.lineage
      ? {
          original_decision_id: record.lineage.original_decision_id,
          parent_decision_id: record.lineage.parent_decision_id,
          repair_attempt: record.lineage.repair_attempt,
          parent_commit_sha: record.lineage.parent_commit_sha,
          new_commit_sha: record.lineage.new_commit_sha,
          contract_hash_locked: record.lineage.contract_hash_locked,
        }
      : null,
  };
  return sha256Prefixed(canonicalJson(payload));
}

export function countEvidenceChecks(record: DecisionRecord): number {
  return Object.keys(record.checks).length + record.violations.length;
}
