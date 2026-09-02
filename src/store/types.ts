import type { DecisionRecord } from "../types.js";

export type RemoteStorageStatus = "persisted" | "unavailable" | "skipped" | "exists";

export interface DecisionStorage {
  local: true;
  turso?: RemoteStorageStatus;
}

export interface SaveResult {
  record: DecisionRecord;
  created: boolean;
  storage: DecisionStorage;
}

export interface DecisionStore {
  saveDecision(decision: DecisionRecord): Promise<SaveResult>;
  getDecision(id: string): Promise<DecisionRecord | null>;
  getLatest(repository: string): Promise<DecisionRecord | null>;
}

export const IMMUTABLE_DECISION_FIELDS = [
  "decision_id",
  "result",
  "contract_hash",
  "evidence_hash",
  "commit_sha",
  "engine_version",
  "schema_version",
] as const;

export function mergeProjections(
  existing: DecisionRecord,
  incoming: DecisionRecord,
): DecisionRecord {
  return {
    ...existing,
    github: incoming.github ?? existing.github,
    storage: incoming.storage ?? existing.storage,
  };
}

export function immutableSlice(record: DecisionRecord) {
  return {
    decision_id: record.decision_id,
    result: record.result,
    contract_hash: record.contract_hash,
    evidence_hash: record.evidence_hash,
    commit_sha: record.commit_sha ?? null,
    engine_version: record.engine_version,
    schema_version: record.schema_version,
  };
}
