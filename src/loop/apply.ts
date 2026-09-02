import { evidenceHash } from "../core/evidence-engine.js";
import type { DecisionRecord, VerificationReport } from "../types.js";
import { detectContractBypass } from "./contract-guard.js";
import { buildLineage, isRepairAttempt } from "./lineage.js";

export function applyRepairLoop(
  report: VerificationReport,
  input: {
    previous: DecisionRecord | null;
    parentCommitSha?: string;
  },
): VerificationReport {
  const currentSha = report.decision.commit_sha ?? report.decision.commit;
  if (
    !isRepairAttempt({
      previous: input.previous,
      parentCommitSha: input.parentCommitSha,
      currentCommitSha: currentSha,
    }) ||
    !input.previous
  ) {
    return report;
  }

  const lineage = buildLineage({
    previous: input.previous,
    currentCommitSha: currentSha,
  });
  report.decision.lineage = lineage;

  const bypass = detectContractBypass(lineage, report.decision.contract_hash);
  if (bypass) {
    report.decision.violations = [...report.decision.violations, bypass];
    report.decision.result = "REJECTED";
    report.decision.summary.violation_count = report.decision.violations.length;
    if (report.decision.checks.architecture === "PASS") {
      report.decision.checks = {
        ...report.decision.checks,
        architecture: "FAIL",
      };
    }
  }

  report.decision.evidence_hash = evidenceHash(report.decision);
  return report;
}
