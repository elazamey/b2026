import { evidenceHash } from "../core/evidence-engine.js";
import type { CheckResult, DecisionRecord, VerificationReport } from "../types.js";
import type { RepairCycle } from "../loop/cycles.js";
import { checkEvidenceHash, manifestBodyHash } from "./hash.js";
import {
  EVIDENCE_MANIFEST_SCHEMA,
  type CheckProof,
  type EvidenceManifest,
  type ManifestRepairCycle,
} from "./types.js";

export function proofForCheck(check: CheckResult): CheckProof {
  const payload = {
    rule_id: check.name,
    status: check.status,
    evidence: {
      ...check.evidence,
      findings: check.findings,
    },
  };
  return {
    ...payload,
    evidence_hash: checkEvidenceHash(payload),
  };
}

export function snapshotRepairCycle(cycle: RepairCycle | null | undefined): ManifestRepairCycle | null {
  if (!cycle) return null;
  return {
    cycle_id: cycle.cycle_id,
    attempt: cycle.attempt,
    status: cycle.status,
    failure_class: cycle.failure_class,
    parent_decision_id: cycle.parent_decision_id,
    source_commit: cycle.source_commit,
    resulting_commit: cycle.resulting_commit,
    resulting_decision_id: cycle.resulting_decision_id,
  };
}

export function buildEvidenceManifest(
  report: VerificationReport,
  cycle?: RepairCycle | null,
): EvidenceManifest {
  return buildEvidenceManifestFromDecision(report.decision, report.checks, cycle);
}

export function buildEvidenceManifestFromDecision(
  decision: DecisionRecord,
  checks: CheckResult[],
  cycle?: RepairCycle | null,
): EvidenceManifest {
  const body: Omit<EvidenceManifest, "manifest_hash"> = {
    schema: EVIDENCE_MANIFEST_SCHEMA,
    decision_id: decision.decision_id,
    repository: decision.repository,
    commit_sha: decision.commit_sha ?? decision.commit,
    contract_hash: decision.contract_hash,
    engine_version: decision.engine_version,
    schema_version: decision.schema_version,
    timestamp: decision.timestamp,
    result: decision.result,
    checks: checks.map(proofForCheck),
    repair_cycle: snapshotRepairCycle(cycle),
    evidence_hash: decision.evidence_hash || evidenceHash(decision),
  };
  return {
    ...body,
    manifest_hash: manifestBodyHash(body),
  };
}
