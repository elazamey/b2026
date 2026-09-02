import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { renderPrComment } from "../src/integrations/github-comment.ts";
import {
  COMMENT_MARKER,
  createGithubClient,
  upsertDecisionComment,
  type FetchLike,
} from "../src/integrations/github-api.ts";
import { applyGithubProvenance } from "../src/integrations/github.ts";
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
              file: "src/components/User.ts",
              line: 14,
              repair: "Move data access behind an API boundary.",
            },
          ]
        : [],
    evidence: { violations: status === "FAIL" ? 1 : 0 },
    duration_ms: 1,
  };
}

function reportOf(): VerificationReport {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["architecture", "security"] },
  });
  const checks = [
    check("architecture", "PASS"),
    check("dependencies", "PASS"),
    check("security", "FAIL", "SEC-001"),
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
    contractHash: "sha256:contract",
    contractPath: "architecture.yaml",
  });
  applyGithubProvenance(decision, {
    token: "ghs_test",
    apiUrl: "https://api.github.com",
    serverUrl: "https://github.com",
    repository: "owner/repo",
    owner: "owner",
    repo: "repo",
    eventName: "pull_request",
    sha: "abc1234deadbeef",
    ref: "refs/pull/7/merge",
    actor: "octocat",
    runId: "1",
    runUrl: "https://github.com/owner/repo/actions/runs/1",
    inActions: true,
    pullRequest: {
      number: 7,
      url: "https://github.com/owner/repo/pull/7",
      head_sha: "abc1234deadbeef",
      head_ref: "fix",
      base_ref: "main",
    },
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

describe("PR comment", () => {
  it("renders a markdown table with provenance and the sticky marker", () => {
    const markdown = renderPrComment(reportOf());
    assert.match(markdown, new RegExp(COMMENT_MARKER));
    assert.match(markdown, /REJECTED/);
    assert.match(markdown, /\| Check \| Status \| Findings \|/);
    assert.match(markdown, /SEC-001/);
    assert.match(markdown, /#7/);
    assert.match(markdown, /sha256:contract/);
    assert.match(markdown, /src\/components\/User.ts:14/);
    assert.doesNotMatch(markdown, /State ledger/);
  });

  it("mentions Turso only as a recorded reference, not as the decision authority", () => {
    const report = reportOf();
    report.decision.storage = { local: true, turso: "persisted" };
    const markdown = renderPrComment(report);
    assert.match(markdown, /State ledger \| Turso/);
    assert.match(markdown, /Decision ID/);
    assert.match(markdown, /Deterministic engine decision/);
  });

  it("creates a comment when none exists and updates the sticky one later", async () => {
    const calls: Array<{ method: string; url: string; body?: string }> = [];
    let existing: { id: number; body: string; html_url: string }[] = [];
    const fetchLike: FetchLike = async (url, init) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body });
      if (method === "GET") {
        return json(200, existing);
      }
      if (method === "POST") {
        const created = {
          id: 42,
          body: JSON.parse(init?.body ?? "{}").body,
          html_url: "https://github.com/owner/repo/pull/7#issuecomment-42",
        };
        existing = [created];
        return json(201, created);
      }
      const updated = {
        id: 42,
        body: JSON.parse(init?.body ?? "{}").body,
        html_url: "https://github.com/owner/repo/pull/7#issuecomment-42",
      };
      existing = [updated];
      return json(200, updated);
    };

    const client = createGithubClient({
      token: "ghs_test",
      owner: "owner",
      repo: "repo",
      fetch: fetchLike,
    });
    const body = renderPrComment(reportOf());
    const created = await upsertDecisionComment(client, 7, body);
    assert.equal(created.updated, false);
    assert.equal(created.comment.id, 42);
    const updated = await upsertDecisionComment(client, 7, `${body}\nupdated`);
    assert.equal(updated.updated, true);
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
    assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
    assert.match(calls.find((call) => call.method === "PATCH")?.url ?? "", /comments\/42/);
  });
});

function json(status: number, data: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(data);
    },
  };
}
