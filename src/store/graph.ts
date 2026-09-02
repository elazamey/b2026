import type { DecisionRecord } from "../types.js";

export interface PersistGraph {
  repository: { id: string; created_at: string; updated_at: string };
  contract: {
    hash: string;
    repository_id: string;
    path: string;
    recorded_at: string;
  };
  scan: {
    id: string;
    repository_id: string;
    decision_id: string;
    commit_sha: string;
    contract_hash: string;
    engine_version: string;
    schema_version: string;
    timestamp: string;
    result: string;
    evidence_hash: string;
  };
  findings: Array<{
    scan_id: string;
    finding_id: string;
    rule: string;
    severity: string;
    message: string;
    file: string | null;
    line: number | null;
    repair: string | null;
  }>;
  decision: {
    decision_id: string;
    repository_id: string;
    scan_id: string;
    commit_sha: string;
    contract_hash: string;
    engine_version: string;
    schema_version: string;
    timestamp: string;
    result: string;
    evidence_hash: string;
    record_json: string;
  };
  evidence: {
    evidence_hash: string;
    decision_id: string;
    payload_json: string;
  };
}

export function toPersistGraph(record: DecisionRecord): PersistGraph {
  const scanId = `scan_${record.decision_id}`;
  const commitSha = record.commit_sha ?? record.commit;
  return {
    repository: {
      id: record.repository,
      created_at: record.timestamp,
      updated_at: record.timestamp,
    },
    contract: {
      hash: record.contract_hash,
      repository_id: record.repository,
      path: record.contract_path,
      recorded_at: record.timestamp,
    },
    scan: {
      id: scanId,
      repository_id: record.repository,
      decision_id: record.decision_id,
      commit_sha: commitSha,
      contract_hash: record.contract_hash,
      engine_version: record.engine_version,
      schema_version: record.schema_version,
      timestamp: record.timestamp,
      result: record.result,
      evidence_hash: record.evidence_hash,
    },
    findings: record.violations.map((finding) => ({
      scan_id: scanId,
      finding_id: finding.id,
      rule: finding.rule,
      severity: finding.severity,
      message: finding.message,
      file: finding.file ?? null,
      line: finding.line ?? null,
      repair: finding.repair ?? null,
    })),
    decision: {
      decision_id: record.decision_id,
      repository_id: record.repository,
      scan_id: scanId,
      commit_sha: commitSha,
      contract_hash: record.contract_hash,
      engine_version: record.engine_version,
      schema_version: record.schema_version,
      timestamp: record.timestamp,
      result: record.result,
      evidence_hash: record.evidence_hash,
      record_json: JSON.stringify(record),
    },
    evidence: {
      evidence_hash: record.evidence_hash,
      decision_id: record.decision_id,
      payload_json: JSON.stringify(record.evidence),
    },
  };
}

export function parseRecordJson(json: string): DecisionRecord | null {
  try {
    return JSON.parse(json) as DecisionRecord;
  } catch {
    return null;
  }
}
