import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { writeLedgerBundle, readLedger } from "../src/ledger/decision-ledger.ts";
import { applyGithubProvenance } from "../src/integrations/github.ts";
import { LEDGER_SCHEMA_VERSION } from "../src/types.ts";
import type { CheckResult, LedgerIndex } from "../src/types.ts";

function check(name: CheckResult["name"], status: CheckResult["status"]): CheckResult {
  return {
    name,
    status,
    findings: [],
    evidence: { violations: 0 },
    duration_ms: 1,
  };
}

const dirs: string[] = [];

after(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("decision ledger", () => {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["architecture"] },
  });

  it("writes pretty JSON, latest.json, and an auditable index", () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-ledger-"));
    dirs.push(root);
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
      commitSha: "abc1234deadbeef",
      contractHash: "sha256:abc",
      contractPath: "architecture.yaml",
    });
    applyGithubProvenance(record, {
      token: "ghs_test",
      apiUrl: "https://api.github.com",
      serverUrl: "https://github.com",
      repository: "owner/repo",
      owner: "owner",
      repo: "repo",
      eventName: "pull_request",
      sha: "abc1234deadbeef",
      ref: "refs/pull/12/merge",
      actor: "octocat",
      runId: "99",
      runUrl: "https://github.com/owner/repo/actions/runs/99",
      inActions: true,
      pullRequest: {
        number: 12,
        url: "https://github.com/owner/repo/pull/12",
        head_sha: "abc1234deadbeef",
        head_ref: "feat/x",
        base_ref: "main",
      },
    });

    const written = writeLedgerBundle({ root, record });
    const stored = readLedger(written.decisionPath);
    assert.equal(stored.schema_version, LEDGER_SCHEMA_VERSION);
    assert.equal(stored.pull_request?.number, 12);
    assert.equal(stored.github?.actor, "octocat");
    assert.match(stored.contract_hash, /^sha256:/);
    assert.match(stored.evidence_hash, /^sha256:/);
    assert.equal(stored.timestamp, record.timestamp);

    const raw = readFileSync(written.decisionPath, "utf8");
    assert.match(raw, /\n  "decision_id":/);

    const latest = readLedger(written.latestPath);
    assert.equal(latest.decision_id, record.decision_id);

    const index = JSON.parse(readFileSync(written.indexPath, "utf8")) as LedgerIndex;
    assert.equal(index.entries[0]?.decision_id, record.decision_id);
    assert.equal(index.entries[0]?.pull_request, 12);
    assert.equal(index.entries[0]?.result, "SAFE_TO_MERGE");
  });
});
