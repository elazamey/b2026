import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolve } from "node:path";
import { loadContract } from "../src/core/contract-engine.ts";
import { verify } from "../src/core/verification-engine.ts";

const fixtures = resolve(import.meta.dirname, "fixtures");

describe("verification against fixtures", () => {
  it("marks a compliant repository SAFE TO MERGE", () => {
    const root = resolve(fixtures, "pass-project");
    const report = verify({ root, contract: loadContract(resolve(root, "architecture.yaml")) });
    assert.equal(report.decision.result, "SAFE_TO_MERGE");
    assert.equal(report.decision.summary.violation_count, 0);
    for (const name of ["architecture", "dependencies", "security", "boundaries", "tests"]) {
      assert.equal(report.decision.checks[name], "PASS", name);
    }
    assert.match(report.decision.evidence_hash, /^sha256:[a-f0-9]{64}$/);
    assert.match(report.decision.decision_id, /^dg_/);
  });

  it("rejects a repository that violates the contract and records evidence", () => {
    const root = resolve(fixtures, "fail-project");
    const report = verify({ root, contract: loadContract(resolve(root, "architecture.yaml")) });
    assert.equal(report.decision.result, "REJECTED");
    assert.ok(report.decision.summary.violation_count > 0);

    const ids = new Set(report.decision.violations.map((finding) => finding.id));
    assert.equal(ids.has("ARCH-001"), true, "missing required path");
    assert.equal(ids.has("ARCH-002"), true, "forbidden path present");
    assert.equal(ids.has("DEP-001"), true, "forbidden dependency");
    assert.equal(ids.has("DEP-002"), true, "allowlist violation");
    assert.equal(ids.has("SEC-001") || ids.has("SEC-002"), true, "security finding");
    assert.equal(ids.has("BND-001"), true, "boundary violation");
    assert.equal(ids.has("QUAL-001"), true, "missing tests");

    const boundary = report.decision.violations.find((finding) => finding.id === "BND-001");
    assert.ok(boundary?.file?.includes("src/components/User.ts"));
    assert.ok(boundary?.repair);
  });
});
