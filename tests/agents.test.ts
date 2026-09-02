import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { ArenaAdapter } from "../src/agents/arena-adapter.ts";
import { ManualAdapter } from "../src/agents/manual-adapter.ts";
import { buildRepairTask } from "../src/agents/task.ts";
import { dispatchRepairTask } from "../src/agents/dispatch.ts";
import { REPAIR_CONSTRAINTS } from "../src/agents/types.ts";
import type { CheckResult, DecisionRecord } from "../src/types.ts";

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
        ? [{ id, rule: name, severity: "error", message: `${name} failed` }]
        : [],
    evidence: { violations: status === "FAIL" ? 1 : 0 },
    duration_ms: 1,
  };
}

function decision(fail: boolean): DecisionRecord {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["security"] },
  });
  return decide({
    checks: [
      check("architecture", "PASS"),
      check("dependencies", "PASS"),
      check("security", fail ? "FAIL" : "PASS", fail ? "SEC-001" : undefined),
      check("boundaries", "PASS"),
      check("tests", "PASS"),
      check("build", "SKIP"),
    ],
    contract,
    repository: "owner/repo",
    commit: "abc1234",
    commitSha: "abc1234deadbeef",
    contractHash: "sha256:locked",
    contractPath: "architecture.yaml",
  });
}

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("Agent adapters", () => {
  it("never grants merge authority to Arena or a human", () => {
    assert.equal(REPAIR_CONSTRAINTS.merge_authority, "guardian");
    assert.equal(REPAIR_CONSTRAINTS.may_declare_safe_to_merge, false);
    assert.equal(REPAIR_CONSTRAINTS.may_modify_contract, false);
    const rejected = decision(true);
    const task = buildRepairTask(rejected, "arena");
    assert.equal(task.constraints.merge_authority, "guardian");
    assert.equal(task.findings.repair.allowed, true);
    assert.equal(task.channel, "github-bus");
  });

  it("does not dispatch a repair when the Guardian already passed", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-agent-"));
    dirs.push(root);
    const passed = decision(false);
    const dispatched = await dispatchRepairTask({ root, decision: passed });
    assert.equal(dispatched.task, null);
    assert.equal(dispatched.results.length, 0);
    assert.equal(passed.result, "SAFE_TO_MERGE");
  });

  it("writes a local repair task and treats Arena as a GitHub-bus provider", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-agent-"));
    dirs.push(root);
    const rejected = decision(true);
    const original = rejected.result;
    const dispatched = await dispatchRepairTask({
      root,
      decision: rejected,
      providers: ["manual", "arena"],
    });
    assert.equal(rejected.result, original);
    assert.equal(rejected.result, "REJECTED");
    assert.ok(dispatched.task);
    const written = dispatched.results.find((item) => item.provider === "manual")?.written;
    assert.ok(written);
    const stored = JSON.parse(readFileSync(written, "utf8")) as { constraints: { merge_authority: string } };
    assert.equal(stored.constraints.merge_authority, "guardian");
    assert.equal(
      dispatched.results.find((item) => item.provider === "arena")?.channel,
      "github-bus",
    );
  });

  it("refuses an Arena task that would allow declaring SAFE_TO_MERGE", async () => {
    const adapter = new ArenaAdapter();
    const rejected = decision(true);
    const task = buildRepairTask(rejected, "arena");
    await assert.rejects(
      () =>
        adapter.dispatch({
          ...task,
          constraints: { ...task.constraints, may_declare_safe_to_merge: true },
        }),
      /SAFE_TO_MERGE/,
    );
  });

  it("keeps the Manual adapter replaceable without touching Core", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-agent-"));
    dirs.push(root);
    const rejected = decision(true);
    const task = buildRepairTask(rejected, "manual");
    const result = await new ManualAdapter(root).dispatch(task);
    assert.equal(result.provider, "manual");
    assert.equal(result.channel, "local-file");
  });
});
