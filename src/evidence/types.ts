import type { CheckEvidence, CheckStatus, DecisionResult } from "../types.js";

export const EVIDENCE_MANIFEST_SCHEMA = "guardian.evidence-manifest/v1";

export interface CheckProof {
  rule_id: string;
  status: CheckStatus;
  evidence: CheckEvidence;
  evidence_hash: string;
}

export interface ManifestRepairCycle {
  cycle_id: string;
  attempt: number;
  status: string;
  failure_class: string | null;
  parent_decision_id: string;
  source_commit: string;
  resulting_commit: string | null;
  resulting_decision_id: string | null;
}

export interface EvidenceManifest {
  schema: typeof EVIDENCE_MANIFEST_SCHEMA;
  decision_id: string;
  repository: string;
  commit_sha: string;
  contract_hash: string;
  engine_version: string;
  schema_version: string;
  timestamp: string;
  result: DecisionResult;
  checks: CheckProof[];
  repair_cycle: ManifestRepairCycle | null;
  evidence_hash: string;
  manifest_hash: string;
}

export interface EvidenceVerification {
  verdict: "VALID" | "INVALID";
  reason?: string;
  mismatches: string[];
}
