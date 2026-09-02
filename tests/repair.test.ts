import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { applyRepairLoop } from "../src/loop/apply.ts";
import { buildRepairCycle, readLatestCycle, writeRepairCycle } from "../src/loop/cycles.ts";
import { classifyCycle } from "../src/loop/classify.ts";
import { parseNumstat } from "../src/loop/diff.ts";
import { REPAIR_BUDGET } from "../src/loop/budget.ts";
import {
  MAX_REPAIR_ATTEMPTS,
  orchestrationStatus,
  shouldDispatchRepair,
} from "../src/loop/orchestrate.ts";
import { ArenaAdapter } from "../src/agents/arena-adapter.ts";
import { ManualAdapter } from "../src/agents/manual-adapter.ts";
import { dispatchRepairTask } from "../src/agents/dispatch.ts";
import { buildRepairTask } from "../src/agents/task.ts";
import { slimViolations } from "../src/agents/violations.ts";
import { REPAIR_CONSTRAINTS, REPAIR_TASK_SCHEMA } from "../src/agents/types.ts";
import type { CheckResult, Finding, VerificationReport } from "../src/types.ts";

function check(
  name: CheckResult["name"],
  status: CheckResult["status"],
  extra?: Partial<Finding>,
): CheckResult {
  return {
    name,
    status,
    findings:
      status === "FAIL"
        ? [
            {
              id: extra?.id ?? "SEC-001",
              rule: name,
              severity: "error",
              message: extra?.message ?? `${name} failed`,
              file: extra?.file,
              line: extra?.line,
              expected: extra?.expected,
              actual: extra?.actual,
              repair: extra?.repair ?? "Fix the finding in application code.",
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

function report(input: { sha: string; fail?: boolean; contractHash?: string }): VerificationReport {
  const checks = [
    check("architecture", "PASS"),
    check("dependencies", "PASS"),
    check(
      "security",
      input.fail ? "FAIL" : "PASS",
      input.fail
        ? {
            id: "SEC-001",
            file: "src/secrets.ts",
            line: 9,
            expected: "No hardcoded credentials",
            actual: "const key = \"sk-live\"",
            message: "Hardcoded credential",
          }
        : undefined,
    ),
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

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("v0.9 Controlled Repair Orchestration", () => {
  it("freezes hard barriers the agent cannot raise", () => {
    assert.equal(MAX_REPAIR_ATTEMPTS, 3);
    assert.equal(REPAIR_CONSTRAINTS.max_attempts, 3);
    assert.equal(REPAIR_CONSTRAINTS.may_merge, false);
    assert.equal(REPAIR_CONSTRAINTS.may_modify_contract, false);
    assert.equal(REPAIR_CONSTRAINTS.may_declare_safe_to_merge, false);
    assert.equal(REPAIR_CONSTRAINTS.merge_authority, "guardian");
    assert.equal(REPAIR_CONSTRAINTS.max_runtime_seconds, 900);
    assert.equal(REPAIR_CONSTRAINTS.max_diff_lines, 500);
    assert.equal(REPAIR_CONSTRAINTS.max_files_changed, 50);
    assert.equal(REPAIR_CONSTRAINTS.max_tokens_per_cycle, 32_000);
    assert.equal(REPAIR_BUDGET.max_attempts, 3);
  });

  it("hands the agent a verifiable task, not the full report", () => {
    const rejected = report({ sha: "tasksha1", fail: true }).decision;
    const task = buildRepairTask(rejected, "arena", { repairPlan: ["remove the secret"] });
    assert.equal(task.schema, REPAIR_TASK_SCHEMA);
    assert.equal(task.task_id, `repair_${rejected.decision_id}`);
    assert.equal(task.decision_id, rejected.decision_id);
    assert.equal(task.commit_sha, "tasksha1");
    assert.deepEqual(task.violations, [
      {
        rule_id: "SEC-001",
        file: "src/secrets.ts",
        line: 9,
        expected: "No hardcoded credentials",
        forbidden: "const key = \"sk-live\"",
      },
    ]);
    assert.deepEqual(task.repair_plan, ["remove the secret"]);
    assert.equal("findings" in task, false);
    assert.equal("result" in task, false);
    assert.equal(JSON.stringify(task).includes("Fix the finding in application code"), false);
  });

  it("lets the agent repair repeatedly but never convert REJECTED to PASS", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-orch-"));
    dirs.push(root);
    const d1 = report({ sha: "commit1deadbeef", fail: true });
    const first = await dispatchRepairTask({ root, decision: d1.decision });
    assert.ok(first.task);
    assert.equal(d1.decision.result, "REJECTED");

    const d2 = applyRepairLoop(report({ sha: "commit2deadbeef", fail: true }), {
      previous: d1.decision,
      parentCommitSha: "commit1deadbeef",
    });
    const second = await dispatchRepairTask({ root, decision: d2.decision });
    assert.ok(second.task);
    assert.equal(d2.decision.result, "REJECTED");
    assert.notEqual(d2.decision.decision_id, d1.decision.decision_id);

    const d3 = applyRepairLoop(report({ sha: "commit3deadbeef", fail: true }), {
      previous: d2.decision,
      parentCommitSha: "commit2deadbeef",
    });
    const third = await dispatchRepairTask({ root, decision: d3.decision });
    assert.ok(third.task);
    assert.equal(d3.decision.lineage?.repair_attempt, 2);

    const d4 = applyRepairLoop(report({ sha: "commit4deadbeef", fail: true }), {
      previous: d3.decision,
      parentCommitSha: "commit3deadbeef",
    });
    assert.equal(d4.decision.lineage?.repair_attempt, 3);
    assert.equal(shouldDispatchRepair(d4.decision), false);
    assert.equal(orchestrationStatus(d4.decision), "exhausted");
    const stopped = await dispatchRepairTask({ root, decision: d4.decision });
    assert.equal(stopped.task, null);
    assert.equal(stopped.stopped, "exhausted");
    assert.equal(d4.decision.result, "REJECTED");
    assert.equal(d1.decision.result, "REJECTED");
    assert.equal(d1.decision.lineage, undefined);
  });

  it("writes an independent cycle ledger per attempt", () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-cycle-"));
    dirs.push(root);
    const d1 = report({ sha: "c1cycle", fail: true }).decision;
    const d2 = applyRepairLoop(report({ sha: "c2cycle", fail: true }), {
      previous: d1,
      parentCommitSha: "c1cycle",
    }).decision;
    const d3 = applyRepairLoop(report({ sha: "c3cycle", fail: false }), {
      previous: d2,
      parentCommitSha: "c2cycle",
    }).decision;

    const first = buildRepairCycle({ previous: d1, current: d2, repairProvider: "arena" });
    const second = buildRepairCycle({ previous: d2, current: d3, repairProvider: "arena" });
    assert.ok(first);
    assert.ok(second);
    assert.equal(first.parent_decision_id, d1.decision_id);
    assert.equal(first.source_commit, "c1cycle");
    assert.equal(first.resulting_commit, "c2cycle");
    assert.equal(first.resulting_decision_id, d2.decision_id);
    assert.equal(first.status, "RECHECK_FAILED");
    assert.equal(first.failure_class, "guardian");
    assert.equal(second.parent_decision_id, d2.decision_id);
    assert.equal(second.resulting_decision_id, d3.decision_id);
    assert.notEqual(first.resulting_decision_id, second.resulting_decision_id);
    assert.equal(second.status, "COMPLETED");
    assert.equal(second.failure_class, "guardian");
    assert.equal(d3.result, "SAFE_TO_MERGE");
    assert.equal(d1.result, "REJECTED");

    writeRepairCycle(root, first);
    writeRepairCycle(root, second);
    const listed = readdirSync(join(root, ".guardian", "repairs"));
    assert.equal(listed.some((name) => name.startsWith("R1-")), true);
    assert.equal(listed.some((name) => name.startsWith("R2-")), true);
  });

  it("rejects adapter tasks that claim merge or a raised budget", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-barrier-"));
    dirs.push(root);
    const rejected = report({ sha: "barrier1", fail: true }).decision;
    const task = buildRepairTask(rejected, "arena");
    await assert.rejects(
      () => new ArenaAdapter().dispatch({ ...task, constraints: { ...task.constraints, may_merge: true } }),
      /may merge/,
    );
    await assert.rejects(
      () =>
        new ManualAdapter(root).dispatch({
          ...task,
          provider: "manual",
          constraints: { ...task.constraints, max_attempts: 99 },
        }),
      /repair budget/,
    );
  });

  it("keeps slim violations specific and verifiable", () => {
    const rejected = report({ sha: "slimsha1", fail: true }).decision;
    const slim = slimViolations(rejected);
    assert.deepEqual(Object.keys(slim[0] ?? {}).sort(), ["expected", "file", "forbidden", "line", "rule_id"]);
  });

  it("does not import Gemini from the loop or adapters", () => {
    for (const dir of ["loop", "agents"]) {
      const path = join(import.meta.dirname, "../src", dir);
      for (const name of readdirSync(path)) {
        if (!name.endsWith(".ts")) continue;
        const source = readFileSync(join(path, name), "utf8");
        assert.doesNotMatch(source, /src\/gemini/);
      }
    }
  });
});

describe("v0.9.1 budget timeout and abuse controls", () => {
  it("keeps timeout as an agent failure, not a Guardian rejection", () => {
    const d1 = report({ sha: "t1deadbeef", fail: true }).decision;
    const d2 = applyRepairLoop(report({ sha: "t2deadbeef", fail: true }), {
      previous: d1,
      parentCommitSha: "t1deadbeef",
    }).decision;
    const cycle = buildRepairCycle({
      previous: d1,
      current: d2,
      usage: { runtime_seconds: 901, files_changed: 1, diff_lines: 4, tokens: null },
    });
    assert.ok(cycle);
    assert.equal(d2.result, "REJECTED");
    assert.equal(cycle.status, "TIMEOUT");
    assert.equal(cycle.failure_class, "agent");
    assert.equal(cycle.resulting_result, "REJECTED");
    assert.notEqual(cycle.status, "RECHECK_FAILED");
  });

  it("keeps an oversized patch as BUDGET_EXCEEDED without flipping result", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-budget-"));
    dirs.push(root);
    const d1 = report({ sha: "b1deadbeef", fail: true }).decision;
    const d2 = applyRepairLoop(report({ sha: "b2deadbeef", fail: true }), {
      previous: d1,
      parentCommitSha: "b1deadbeef",
    }).decision;
    const cycle = buildRepairCycle({
      previous: d1,
      current: d2,
      usage: { runtime_seconds: 12, files_changed: 51, diff_lines: 10, tokens: null },
    });
    assert.ok(cycle);
    writeRepairCycle(root, cycle);
    assert.equal(d2.result, "REJECTED");
    assert.equal(cycle.status, "BUDGET_EXCEEDED");
    assert.equal(cycle.failure_class, "agent");
    const dispatched = await dispatchRepairTask({ root, decision: d2 });
    assert.equal(dispatched.task, null);
    assert.equal(dispatched.stopped, "budget");
    assert.equal(d2.result, "REJECTED");
  });

  it("keeps provider error as infrastructure, not Guardian rejection", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-provider-"));
    dirs.push(root);
    const rejected = report({ sha: "p1deadbeef", fail: true }).decision;
    const original = rejected.result;
    const dispatched = await dispatchRepairTask({
      root,
      decision: rejected,
      providers: ["future"],
    });
    assert.equal(dispatched.stopped, "provider");
    assert.equal(rejected.result, original);
    assert.equal(rejected.result, "REJECTED");
    const latest = readLatestCycle(root);
    assert.equal(latest?.status, "PROVIDER_ERROR");
    assert.equal(latest?.failure_class, "infrastructure");
    assert.equal(latest?.resulting_result, null);
  });

  it("classifies contract mutation as PATCH_REJECTED", () => {
    const d1 = report({ sha: "m1deadbeef", fail: true }).decision;
    const bypass = applyRepairLoop(
      report({ sha: "m2deadbeef", fail: false, contractHash: "sha256:weakened" }),
      { previous: d1, parentCommitSha: "m1deadbeef" },
    ).decision;
    const cycle = buildRepairCycle({ previous: d1, current: bypass, repairProvider: "arena" });
    assert.ok(cycle);
    assert.equal(bypass.result, "REJECTED");
    assert.equal(cycle.status, "PATCH_REJECTED");
    assert.equal(cycle.failure_class, "agent");
    assert.equal(cycle.resulting_result, "REJECTED");
  });

  it("does not confuse Guardian rejection with infrastructure failure", () => {
    assert.equal(
      classifyCycle({
        guardianResult: "REJECTED",
        usage: { runtime_seconds: 1, files_changed: 1, diff_lines: 1, tokens: null },
      }),
      "RECHECK_FAILED",
    );
    assert.equal(classifyCycle({ guardianResult: "SAFE_TO_MERGE", providerError: true }), "PROVIDER_ERROR");
    assert.equal(
      classifyCycle({
        guardianResult: "SAFE_TO_MERGE",
        usage: { runtime_seconds: 1, files_changed: 1, diff_lines: 501, tokens: null },
      }),
      "BUDGET_EXCEEDED",
    );
  });

  it("parses git numstat into files and diff lines", () => {
    assert.deepEqual(parseNumstat("10\t2\tsrc/a.ts\n3\t1\tsrc/b.ts\n-\t-\tbin.dat\n"), {
      files_changed: 3,
      diff_lines: 16,
    });
  });

  it("refuses a raised timeout or diff budget", async () => {
    const rejected = report({ sha: "raise1", fail: true }).decision;
    const task = buildRepairTask(rejected, "arena");
    await assert.rejects(
      () =>
        new ArenaAdapter().dispatch({
          ...task,
          constraints: { ...task.constraints, max_runtime_seconds: 9_999 },
        }),
      /timeout/,
    );
    await assert.rejects(
      () =>
        new ArenaAdapter().dispatch({
          ...task,
          constraints: { ...task.constraints, max_diff_lines: 50_000 },
        }),
      /diff budget/,
    );
  });
});
