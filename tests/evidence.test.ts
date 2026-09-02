import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { applyRepairLoop } from "../src/loop/apply.ts";
import { buildRepairCycle } from "../src/loop/cycles.ts";
import {
  buildEvidenceManifest,
  readEvidenceManifest,
  verifyEvidence,
  writeEvidenceManifest,
} from "../src/evidence/index.ts";
import type { CheckResult, VerificationReport } from "../src/types.ts";

function check(name: CheckResult["name"], status: CheckResult["status"], id?: string): CheckResult {
  return {
    name,
    status,
    findings:
      status === "FAIL" && id
        ? [{ id, rule: name, severity: "error", message: `${name} failed`, file: "src/x.ts", line: 3 }]
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

function report(fail: boolean, sha = "abc1234deadbeef"): VerificationReport {
  const checks = [
    check("architecture", "PASS"),
    check("dependencies", "PASS"),
    check("security", fail ? "FAIL" : "PASS", fail ? "SEC-001" : undefined),
    check("boundaries", "PASS"),
    check("tests", "PASS"),
    check("build", "SKIP"),
  ];
  const decision = decide({
    checks,
    contract,
    repository: "owner/repo",
    commit: sha.slice(0, 7),
    commitSha: sha,
    contractHash: "sha256:contract",
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

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("v0.9.2 evidence hardening", () => {
  it("verifies a fresh proof bundle as VALID", () => {
    const scanned = report(false);
    const manifest = buildEvidenceManifest(scanned);
    const proof = verifyEvidence(manifest, scanned.decision);
    assert.equal(proof.verdict, "VALID");
    assert.equal(manifest.result, "SAFE_TO_MERGE");
    assert.equal(manifest.evidence_hash, scanned.decision.evidence_hash);
    assert.equal(manifest.checks.length, 6);
    assert.equal(manifest.repair_cycle, null);
    assert.match(manifest.manifest_hash, /^sha256:/);
  });

  it("returns INVALID Evidence hash mismatch when evidence is tampered", () => {
    const scanned = report(true);
    const manifest = buildEvidenceManifest(scanned);
    assert.equal(verifyEvidence(manifest, scanned.decision).verdict, "VALID");
    const security = manifest.checks.find((item) => item.rule_id === "security");
    assert.ok(security);
    security.evidence = { ...security.evidence, violations: 99 };
    const proof = verifyEvidence(manifest, scanned.decision);
    assert.equal(proof.verdict, "INVALID");
    assert.equal(proof.reason, "Evidence hash mismatch");
    assert.equal(scanned.decision.result, "REJECTED");
  });

  it("does not let a tampered manifest convert REJECTED to SAFE_TO_MERGE", () => {
    const scanned = report(true);
    const manifest = buildEvidenceManifest(scanned);
    manifest.result = "SAFE_TO_MERGE";
    const proof = verifyEvidence(manifest, scanned.decision);
    assert.equal(proof.verdict, "INVALID");
    assert.equal(proof.reason, "Evidence hash mismatch");
    assert.equal(scanned.decision.result, "REJECTED");
  });

  it("detects a check status rewrite", () => {
    const scanned = report(true);
    const manifest = buildEvidenceManifest(scanned);
    const security = manifest.checks.find((item) => item.rule_id === "security");
    assert.ok(security);
    security.status = "PASS";
    const proof = verifyEvidence(manifest, scanned.decision);
    assert.equal(proof.verdict, "INVALID");
    assert.match(proof.mismatches.join("\n"), /Evidence hash mismatch/);
  });

  it("binds the sealed decision hash and flags ledger drift", () => {
    const scanned = report(false);
    const manifest = buildEvidenceManifest(scanned);
    const drifted = { ...scanned.decision, evidence_hash: "sha256:tampered" };
    const proof = verifyEvidence(manifest, drifted);
    assert.equal(proof.verdict, "INVALID");
    assert.equal(proof.reason, "Evidence hash mismatch");
    assert.equal(scanned.decision.result, "SAFE_TO_MERGE");
  });

  it("includes the repair cycle in the hashed manifest", () => {
    const first = report(true, "abc1234deadbeef");
    const second = applyRepairLoop(report(false, "c2deadbeefcafebabe"), {
      previous: first.decision,
      parentCommitSha: "abc1234deadbeef",
    });
    const cycle = buildRepairCycle({
      previous: first.decision,
      current: second.decision,
      repairProvider: "arena",
    });
    const manifest = buildEvidenceManifest(second, cycle);
    assert.equal(manifest.repair_cycle?.status, "COMPLETED");
    assert.equal(verifyEvidence(manifest, second.decision).verdict, "VALID");
    assert.ok(manifest.repair_cycle);
    manifest.repair_cycle.status = "TIMEOUT";
    const proof = verifyEvidence(manifest, second.decision);
    assert.equal(proof.verdict, "INVALID");
    assert.equal(second.decision.result, "SAFE_TO_MERGE");
  });

  it("persists evidence_manifest.json and re-reads VALID", () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-evidence-"));
    dirs.push(root);
    const scanned = report(false);
    const manifest = buildEvidenceManifest(scanned);
    const path = writeEvidenceManifest(root, manifest);
    assert.match(path, /evidence_manifest\.json$/);
    const loaded = readEvidenceManifest(root);
    assert.ok(loaded);
    assert.equal(verifyEvidence(loaded, scanned.decision).verdict, "VALID");
  });

  it("does not import the decision engine or CLI", () => {
    const dir = join(import.meta.dirname, "../src/evidence");
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, name), "utf8");
      assert.doesNotMatch(source, /decision-engine/);
      assert.doesNotMatch(source, /src\/cli/);
      assert.doesNotMatch(source, /src\/gemini/);
    }
  });
});
