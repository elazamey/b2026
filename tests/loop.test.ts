import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { applyRepairLoop } from "../src/loop/apply.ts";
import { isRepairAttempt } from "../src/loop/lineage.ts";
import {
  buildFindingsPack,
  FORBIDDEN_REPAIR_ACTIONS,
} from "../src/loop/findings-pack.ts";
import { renderPrComment } from "../src/integrations/github-comment.ts";
import type { CheckResult, VerificationReport } from "../src/types.ts";

function check(
  name: CheckResult["name"],
  status: CheckResult["status"],
  id?: string,
): CheckResult {
  return {
    name,
    status,
    findings:
      status === "FAIL" && id
        ? [
            {
              id,
              rule: name,
              severity: "error",
              message: `${name} failed`,
              repair: "Fix the finding in application code.",
            },
          ]
        : [],
    evidence: { violations: status === "FAIL" ? 1 : 0 },
    duration_ms: 1,
  };
}

const contract = validateContract({
  version: "1",
  project: { type: "node" },
  merge: { require: ["architecture", "security"] },
});

function report(input: {
  sha: string;
  fail?: boolean;
  contractHash?: string;
}): VerificationReport {
  const checks = [
    check("architecture", "PASS"),
    check("dependencies", "PASS"),
    check("security", input.fail ? "FAIL" : "PASS", input.fail ? "SEC-001" : undefined),
    check("boundaries", "PASS"),
    check("tests", "PASS"),
    check("build", "SKIP"),
  ];
  const decision = decide({
    checks,
    contract,
    repository: "owner/repo",
    commit: input.sha.slice(0, 7),
    commitSha: input.sha,
    contractHash: input.contractHash ?? "sha256:locked",
    contractPath: "architecture.yaml",
  });
  return {
    repository: decision.repository,
    commit: decision.commit,
    contract_hash: decision.contract_hash,
    engine_version: decision.engine_version,
    checks,
    decision,
  };
}

describe("v0.4 Arena repair loop", () => {
  it("does not treat a re-scan of the same commit as a repair", () => {
    const first = report({ sha: "aaa1111", fail: true }).decision;
    assert.equal(
      isRepairAttempt({
        previous: first,
        parentCommitSha: "aaa1111",
        currentCommitSha: "aaa1111",
      }),
      false,
    );
  });

  it("records a new decision for each cycle and never rewrites the original", () => {
    const d1 = report({ sha: "commit1deadbeef", fail: true });
    assert.equal(d1.decision.result, "REJECTED");
    assert.equal(d1.decision.lineage, undefined);

    const d2 = applyRepairLoop(report({ sha: "commit2deadbeef", fail: true }), {
      previous: d1.decision,
      parentCommitSha: "commit1deadbeef",
    });
    assert.equal(d2.decision.result, "REJECTED");
    assert.notEqual(d2.decision.decision_id, d1.decision.decision_id);
    assert.equal(d2.decision.lineage?.original_decision_id, d1.decision.decision_id);
    assert.equal(d2.decision.lineage?.repair_attempt_id, "rpr_1");
    assert.equal(d2.decision.lineage?.parent_commit_sha, "commit1deadbeef");
    assert.equal(d2.decision.lineage?.new_commit_sha, "commit2deadbeef");
    assert.equal(d1.decision.result, "REJECTED");
    assert.equal(d1.decision.lineage, undefined);

    const d3 = applyRepairLoop(report({ sha: "commit3deadbeef", fail: false }), {
      previous: d2.decision,
      parentCommitSha: "commit2deadbeef",
    });
    assert.equal(d3.decision.result, "SAFE_TO_MERGE");
    assert.equal(d3.decision.lineage?.original_decision_id, d1.decision.decision_id);
    assert.equal(d3.decision.lineage?.repair_attempt_id, "rpr_2");
    assert.equal(d3.decision.lineage?.parent_decision_id, d2.decision.decision_id);
    assert.equal(d1.decision.result, "REJECTED");
    assert.notEqual(d3.decision.decision_id, d2.decision.decision_id);
  });

  it("rejects a repair that mutates architecture.yaml even if checks would pass", () => {
    const d1 = report({ sha: "c1lock", fail: true });
    const bypass = applyRepairLoop(
      report({ sha: "c2lock", fail: false, contractHash: "sha256:weakened" }),
      { previous: d1.decision, parentCommitSha: "c1lock" },
    );
    assert.equal(bypass.decision.result, "REJECTED");
    assert.equal(
      bypass.decision.violations.some((finding) => finding.id === "CTR-001"),
      true,
    );
    assert.equal(bypass.decision.lineage?.contract_hash_locked, "sha256:locked");
  });

  it("does not let the agent declare SAFE_TO_MERGE in the findings pack", () => {
    const rejected = report({ sha: "c1pack", fail: true }).decision;
    const pack = buildFindingsPack(rejected);
    assert.equal(pack.repair.allowed, true);
    assert.equal(pack.result, "REJECTED");
    assert.equal(FORBIDDEN_REPAIR_ACTIONS.includes("declare SAFE_TO_MERGE"), true);
    assert.equal(FORBIDDEN_REPAIR_ACTIONS.includes("modify architecture.yaml"), true);
    assert.match(pack.repair.required.join(" "), /new commit/);

    const passed = report({ sha: "c2pack", fail: false }).decision;
    const stop = buildFindingsPack(passed);
    assert.equal(stop.repair.allowed, false);
    assert.equal(stop.result, "SAFE_TO_MERGE");
  });

  it("puts machine-readable findings on the PR comment without changing sticky behavior", () => {
    const markdown = renderPrComment(report({ sha: "c1comment", fail: true }));
    assert.match(markdown, /Repair instructions for coding agents/);
    assert.match(markdown, /architecture.yaml/);
    assert.match(markdown, /guardian.findings\/v1/);
    assert.match(markdown, /<!-- ai-guardian-decision -->/);
  });

  it("does not offer a repair loop after SAFE TO MERGE", () => {
    const markdown = renderPrComment(report({ sha: "c9comment", fail: false }));
    assert.doesNotMatch(markdown, /Repair instructions for coding agents/);
  });
});
