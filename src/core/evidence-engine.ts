import type { DecisionRecord } from "../types.js";
import { canonicalJson, sha256Prefixed } from "../util/hash.js";

export function evidenceHash(record: Omit<DecisionRecord, "evidence_hash"> | DecisionRecord): string {
  const payload = {
    repository: record.repository,
    commit: record.commit,
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
