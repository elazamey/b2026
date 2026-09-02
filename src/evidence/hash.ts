import { canonicalJson, sha256Prefixed } from "../util/hash.js";
import type { CheckProof, EvidenceManifest } from "./types.js";

export function checkEvidenceHash(proof: Omit<CheckProof, "evidence_hash">): string {
  return sha256Prefixed(
    canonicalJson({
      rule_id: proof.rule_id,
      status: proof.status,
      evidence: proof.evidence,
    }),
  );
}

export function manifestBodyHash(manifest: Omit<EvidenceManifest, "manifest_hash"> | EvidenceManifest): string {
  const { manifest_hash: _ignored, ...body } = manifest as EvidenceManifest;
  return sha256Prefixed(canonicalJson(body));
}
