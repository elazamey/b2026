import type { DecisionRecord, Finding } from "../types.js";

export type ControlPlaneKind = "turso" | "local-ledger" | "memory";

export interface DecisionSummary {
  decision_id: string;
  repository: string;
  commit_sha: string;
  contract_hash: string;
  evidence_hash: string;
  result: DecisionRecord["result"];
  timestamp: string;
  engine_version: string;
  violation_count: number;
  original_decision_id?: string;
  repair_attempt_id?: string;
}

export interface RepositorySummary {
  id: string;
  decision_count: number;
  latest_result: DecisionRecord["result"] | null;
  latest_timestamp: string | null;
}

export interface FindingRow extends Finding {
  decision_id: string;
  repository: string;
  commit_sha: string;
}

export interface AuditEntry {
  timestamp: string;
  decision_id: string;
  repository: string;
  result: DecisionRecord["result"];
  commit_sha: string;
  contract_hash: string;
  evidence_hash: string;
  original_decision_id?: string;
  repair_attempt_id?: string;
  parent_commit_sha?: string;
  new_commit_sha?: string;
}

export interface ControlPlaneSnapshot {
  kind: ControlPlaneKind;
  writable: false;
  repositories: RepositorySummary[];
  decisions: DecisionSummary[];
  findings: FindingRow[];
  audit: AuditEntry[];
}

export interface ControlPlaneReader {
  readonly kind: ControlPlaneKind;
  readonly writable: false;
  snapshot(): Promise<ControlPlaneSnapshot>;
  getDecision(id: string): Promise<DecisionRecord | null>;
}

export const CONTROL_PLANE_CAPABILITIES = {
  may_decide: false,
  may_merge: false,
  may_edit_contract: false,
  may_rewrite_decision: false,
  may_chat: false,
  may_manage_agents: false,
} as const;
