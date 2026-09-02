import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { GATE_CHECK_NAME, gateConclusion, renderGateOutput } from "../src/gate/check-run.ts";
import { createGithubClient, type FetchLike } from "../src/integrations/github-api.ts";
import { emitGithub } from "../src/integrations/github.ts";
import type { CheckResult, VerificationReport } from "../src/types.ts";

function check(name: CheckResult["name"], status: CheckResult["status"]): CheckResult {
  return {
    name,
    status,
    findings:
      status === "FAIL"
        ? [{ id: "SEC-001", rule: name, severity: "error", message: "failed" }]
        : [],
    evidence: { violations: status === "FAIL" ? 1 : 0 },
    duration_ms: 1,
  };
}

function report(fail: boolean): VerificationReport {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["security"] },
  });
  const checks = [
    check("architecture", "PASS"),
    check("dependencies", "PASS"),
    check("security", fail ? "FAIL" : "PASS"),
    check("boundaries", "PASS"),
    check("tests", "PASS"),
    check("build", "SKIP"),
  ];
  const decision = decide({
    checks,
    contract,
    repository: "owner/repo",
    commit: "abc1234",
    commitSha: "abc1234deadbeef",
    contractHash: "sha256:locked",
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

describe("Required GitHub gate", () => {
  it("maps only SAFE_TO_MERGE to a successful required check", () => {
    assert.equal(GATE_CHECK_NAME, "ai-guardian");
    assert.equal(gateConclusion("SAFE_TO_MERGE"), "success");
    assert.equal(gateConclusion("REJECTED"), "failure");
    const passing = renderGateOutput(report(false));
    const failing = renderGateOutput(report(true));
    assert.equal(passing.title, "SAFE TO MERGE");
    assert.equal(failing.title, "REJECTED");
    assert.match(failing.summary, /must fail/);
  });

  it("posts a Check Run named ai-guardian and does not let adapters change the conclusion", async () => {
    const calls: Array<{ url: string; body: string }> = [];
    const fetchLike: FetchLike = async (url, init) => {
      calls.push({ url, body: init?.body ?? "" });
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({
            id: 99,
            html_url: "https://github.com/owner/repo/runs/99",
            name: "ai-guardian",
            conclusion: "failure",
          });
        },
      };
    };
    const failing = report(true);
    assert.equal(failing.decision.result, "REJECTED");
    await emitGithub(failing, {
      comment: false,
      gate: true,
      context: {
        token: "ghs_test",
        apiUrl: "https://api.github.com",
        serverUrl: "https://github.com",
        repository: "owner/repo",
        owner: "owner",
        repo: "repo",
        eventName: "pull_request",
        sha: "abc1234deadbeef",
        ref: "refs/pull/1/merge",
        actor: "octocat",
        runId: "1",
        runUrl: "https://github.com/owner/repo/actions/runs/1",
        inActions: true,
        pullRequest: {
          number: 1,
          url: "https://github.com/owner/repo/pull/1",
          head_sha: "abc1234deadbeef",
          head_ref: "feat",
          base_ref: "main",
        },
      },
      fetch: fetchLike,
    });
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.url ?? "", /check-runs/);
    const payload = JSON.parse(calls[0]?.body ?? "{}") as {
      name: string;
      conclusion: string;
      head_sha: string;
    };
    assert.equal(payload.name, "ai-guardian");
    assert.equal(payload.conclusion, "failure");
    assert.equal(payload.head_sha, "abc1234deadbeef");
    assert.equal(failing.decision.result, "REJECTED");
    assert.equal(failing.decision.github?.check_name, "ai-guardian");
  });

  it("creates a client that can post the named gate", async () => {
    const fetchLike: FetchLike = async (_url, init) => {
      const body = JSON.parse(init?.body ?? "{}") as { name: string };
      assert.equal(body.name, GATE_CHECK_NAME);
      return {
        ok: true,
        status: 201,
        async text() {
          return JSON.stringify({ id: 1, html_url: "u", name: GATE_CHECK_NAME, conclusion: "success" });
        },
      };
    };
    const client = createGithubClient({
      token: "t",
      owner: "o",
      repo: "r",
      fetch: fetchLike,
    });
    const run = await client.createCheckRun({
      name: GATE_CHECK_NAME,
      head_sha: "abc",
      conclusion: "success",
      title: "SAFE TO MERGE",
      summary: "ok",
    });
    assert.equal(run.name, "ai-guardian");
  });
});
