import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import type { CheckResult } from "../src/types.ts";

function check(name: CheckResult["name"], status: CheckResult["status"], id?: string): CheckResult {
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
            },
          ]
        : [],
    evidence: { violations: status === "FAIL" ? 1 : 0 },
    duration_ms: 1,
  };
}

describe("decision-engine", () => {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["architecture", "security"] },
  });

  it("allows merge only when required checks pass", () => {
    const record = decide({
      checks: [
        check("architecture", "PASS"),
        check("dependencies", "PASS"),
        check("security", "PASS"),
        check("boundaries", "SKIP"),
        check("tests", "SKIP"),
        check("build", "SKIP"),
      ],
      contract,
      repository: "owner/repo",
      commit: "abc1234",
      contractHash: "sha256:abc",
      contractPath: "architecture.yaml",
    });
    assert.equal(record.result, "SAFE_TO_MERGE");
    assert.equal(record.violations.length, 0);
  });

  it("rejects when a required check fails, ignoring optional failures", () => {
    const record = decide({
      checks: [
        check("architecture", "PASS"),
        check("dependencies", "FAIL", "DEP-001"),
        check("security", "FAIL", "SEC-001"),
        check("boundaries", "PASS"),
        check("tests", "PASS"),
        check("build", "PASS"),
      ],
      contract,
      repository: "owner/repo",
      commit: "abc1234",
      contractHash: "sha256:abc",
      contractPath: "architecture.yaml",
    });
    assert.equal(record.result, "REJECTED");
    assert.equal(record.violations.every((finding) => finding.id === "SEC-001"), true);
    assert.equal(record.engine_version, "0.3.0");
    assert.equal(record.schema_version, "0.2");
    assert.equal(record.pull_request, null);
  });
});
