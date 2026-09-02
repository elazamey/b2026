import type { DecisionRecord, RepairLineage } from "../types.js";

export type { RepairLineage };

export function isRepairAttempt(input: {
  previous: DecisionRecord | null;
  parentCommitSha?: string;
  currentCommitSha?: string;
}): boolean {
  const previous = input.previous;
  if (!previous || previous.result !== "REJECTED") return false;
  const parent = input.parentCommitSha;
  const current = input.currentCommitSha;
  if (!parent || !current) return false;
  if (parent === current) return false;
  const previousSha = previous.commit_sha ?? previous.commit;
  return parent === previousSha || parent === previous.commit;
}

export function buildLineage(input: {
  previous: DecisionRecord;
  currentCommitSha: string;
}): RepairLineage {
  const original =
    input.previous.lineage?.original_decision_id ?? input.previous.decision_id;
  const attempt = (input.previous.lineage?.repair_attempt ?? 0) + 1;
  return {
    original_decision_id: original,
    parent_decision_id: input.previous.decision_id,
    repair_attempt_id: `rpr_${attempt}`,
    repair_attempt: attempt,
    parent_commit_sha: input.previous.commit_sha ?? input.previous.commit,
    new_commit_sha: input.currentCommitSha,
    contract_hash_locked:
      input.previous.lineage?.contract_hash_locked ?? input.previous.contract_hash,
  };
}
