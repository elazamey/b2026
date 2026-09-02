import { evidenceHash } from "../core/evidence-engine.js";
import type { DecisionRecord } from "../types.js";
import { checkEvidenceHash, manifestBodyHash } from "./hash.js";
import type { EvidenceManifest, EvidenceVerification } from "./types.js";

export function verifyEvidence(
  manifest: EvidenceManifest,
  decision?: DecisionRecord | null,
): EvidenceVerification {
  const mismatches: string[] = [];

  for (const check of manifest.checks) {
    const expected = checkEvidenceHash({
      rule_id: check.rule_id,
      status: check.status,
      evidence: check.evidence,
    });
    if (expected !== check.evidence_hash) {
      mismatches.push(`${check.rule_id}: Evidence hash mismatch`);
    }
  }

  const expectedManifest = manifestBodyHash(manifest);
  if (expectedManifest !== manifest.manifest_hash) {
    mismatches.push("manifest_hash: Evidence hash mismatch");
  }

  if (decision) {
    if (decision.decision_id !== manifest.decision_id) {
      mismatches.push("decision_id: Evidence hash mismatch");
    }
    if (decision.result !== manifest.result) {
      mismatches.push("result: Evidence hash mismatch");
    }
    if (decision.contract_hash !== manifest.contract_hash) {
      mismatches.push("contract_hash: Evidence hash mismatch");
    }
    const bound = decision.evidence_hash || evidenceHash(decision);
    if (bound !== manifest.evidence_hash) {
      mismatches.push("evidence_hash: Evidence hash mismatch");
    }
    const recomputed = evidenceHash(decision);
    if (recomputed !== decision.evidence_hash) {
      mismatches.push("decision.evidence_hash: Evidence hash mismatch");
    }
  }

  if (mismatches.length === 0) {
    return { verdict: "VALID", mismatches };
  }
  return {
    verdict: "INVALID",
    reason: "Evidence hash mismatch",
    mismatches,
  };
}
