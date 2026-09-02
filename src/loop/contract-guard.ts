import type { Finding } from "../types.js";
import type { RepairLineage } from "./lineage.js";

export function contractMutationFinding(input: {
  lockedHash: string;
  currentHash: string;
}): Finding {
  return {
    id: "CTR-001",
    rule: "repair.contract_lock",
    severity: "error",
    message: "architecture.yaml was modified during a repair attempt",
    expected: input.lockedHash,
    actual: input.currentHash,
    repair:
      "Restore architecture.yaml to the locked contract. Fix the original findings without weakening the contract.",
  };
}

export function detectContractBypass(
  lineage: RepairLineage,
  currentContractHash: string,
): Finding | null {
  if (currentContractHash === lineage.contract_hash_locked) return null;
  return contractMutationFinding({
    lockedHash: lineage.contract_hash_locked,
    currentHash: currentContractHash,
  });
}
