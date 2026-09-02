import type { DecisionRecord } from "../types.js";
import type {
  AuditEntry,
  ControlPlaneKind,
  ControlPlaneSnapshot,
  DecisionSummary,
  FindingRow,
  RepositorySummary,
} from "./types.js";

export function summarizeDecision(record: DecisionRecord): DecisionSummary {
  return {
    decision_id: record.decision_id,
    repository: record.repository,
    commit_sha: record.commit_sha ?? record.commit,
    contract_hash: record.contract_hash,
    evidence_hash: record.evidence_hash,
    result: record.result,
    timestamp: record.timestamp,
    engine_version: record.engine_version,
    violation_count: record.summary.violation_count,
    original_decision_id: record.lineage?.original_decision_id,
    repair_attempt_id: record.lineage?.repair_attempt_id,
  };
}

export function projectRecords(
  kind: ControlPlaneKind,
  records: DecisionRecord[],
): ControlPlaneSnapshot {
  const ordered = [...records].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const decisions = ordered.map(summarizeDecision);
  const byRepo = new Map<string, DecisionRecord[]>();
  for (const record of ordered) {
    const list = byRepo.get(record.repository) ?? [];
    list.push(record);
    byRepo.set(record.repository, list);
  }
  const repositories: RepositorySummary[] = [...byRepo.entries()]
    .map(([id, items]) => {
      const latest = items[0];
      return {
        id,
        decision_count: items.length,
        latest_result: latest?.result ?? null,
        latest_timestamp: latest?.timestamp ?? null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  const findings: FindingRow[] = ordered.flatMap((record) =>
    record.violations.map((finding) => ({
      ...finding,
      decision_id: record.decision_id,
      repository: record.repository,
      commit_sha: record.commit_sha ?? record.commit,
    })),
  );

  const audit: AuditEntry[] = ordered.map((record) => ({
    timestamp: record.timestamp,
    decision_id: record.decision_id,
    repository: record.repository,
    result: record.result,
    commit_sha: record.commit_sha ?? record.commit,
    contract_hash: record.contract_hash,
    evidence_hash: record.evidence_hash,
    original_decision_id: record.lineage?.original_decision_id,
    repair_attempt_id: record.lineage?.repair_attempt_id,
    parent_commit_sha: record.lineage?.parent_commit_sha,
    new_commit_sha: record.lineage?.new_commit_sha,
  }));

  return {
    kind,
    writable: false,
    repositories,
    decisions,
    findings,
    audit,
  };
}
