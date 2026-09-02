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
  };
  return sha256Prefixed(canonicalJson(payload));
}

export function countEvidenceChecks(record: DecisionRecord): number {
  return Object.keys(record.checks).length + record.violations.length;
}
