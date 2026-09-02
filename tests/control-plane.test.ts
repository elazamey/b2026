import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { FileDecisionStore } from "../src/store/file-store.ts";
import type { CheckResult, DecisionRecord } from "../src/types.ts";
import type { SqlExecutor, SqlResult, SqlValue } from "../src/store/sql.ts";
import {
  CONTROL_PLANE_CAPABILITIES,
  FileControlPlaneReader,
  MemoryControlPlaneReader,
  TursoControlPlaneReader,
  assertReadOnlySql,
  handleControlPlaneRequest,
} from "../src/control-plane/index.ts";
import { ReadOnlySqlError } from "../src/control-plane/readonly.ts";

function check(
  name: CheckResult["name"],
  status: CheckResult["status"],
  failId?: string,
): CheckResult {
  return {
    name,
    status,
    findings:
      status === "FAIL" && failId
        ? [{ id: failId, rule: name, severity: "error", message: `${name} failed`, file: "src/x.ts" }]
        : [],
    evidence: { violations: status === "FAIL" ? 1 : 0 },
    duration_ms: 1,
  };
}

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["security"] },
  });
  const fail = overrides.result === "REJECTED";
  const record = decide({
    checks: [
      check("architecture", "PASS"),
      check("dependencies", "PASS"),
      check("security", fail ? "FAIL" : "PASS", fail ? "SEC-001" : undefined),
      check("boundaries", "PASS"),
      check("tests", "PASS"),
      check("build", "SKIP"),
    ],
    contract,
    repository: overrides.repository ?? "elazamey/b2026",
    commit: "abc1234",
    commitSha: overrides.commit_sha ?? "abc1234deadbeef",
    contractHash: overrides.contract_hash ?? "sha256:contract",
    contractPath: "architecture.yaml",
  });
  return { ...record, ...overrides };
}

class SelectSql implements SqlExecutor {
  constructor(private readonly records: DecisionRecord[]) {}
  async execute(sql: string, args: SqlValue[] = []): Promise<SqlResult> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("SELECT record_json FROM decisions WHERE decision_id")) {
      const match = this.records.find((row) => row.decision_id === String(args[0]));
      return {
        rows: match ? [{ record_json: JSON.stringify(match) }] : [],
        affected: 0,
      };
    }
    if (s.startsWith("SELECT record_json FROM decisions")) {
      return {
        rows: this.records.map((row) => ({ record_json: JSON.stringify(row) })),
        affected: 0,
      };
    }
    throw new Error(`unexpected sql: ${s}`);
  }
}

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("v0.6 read-only Control Plane", () => {
  it("never claims the ability to decide, merge, or edit the contract", () => {
    assert.equal(CONTROL_PLANE_CAPABILITIES.may_decide, false);
    assert.equal(CONTROL_PLANE_CAPABILITIES.may_merge, false);
    assert.equal(CONTROL_PLANE_CAPABILITIES.may_edit_contract, false);
    assert.equal(CONTROL_PLANE_CAPABILITIES.may_rewrite_decision, false);
    assert.equal(CONTROL_PLANE_CAPABILITIES.may_chat, false);
  });

  it("shows commit_sha, contract_hash, evidence_hash, and result from recorded history", async () => {
    const rejected = makeDecision({ result: "REJECTED" });
    const reader = new MemoryControlPlaneReader([rejected]);
    const page = await handleControlPlaneRequest(
      { method: "GET", url: `/decision/${rejected.decision_id}` },
      reader,
    );
    assert.equal(page.status, 200);
    assert.match(page.body, /REJECTED/);
    assert.match(page.body, /abc1234deadbeef/);
    assert.match(page.body, /sha256:contract/);
    assert.match(page.body, new RegExp(rejected.evidence_hash));
    assert.match(page.body, /Read only/i);
    assert.doesNotMatch(page.body, /<form/i);
    assert.doesNotMatch(page.body, /name="result"/);
    assert.doesNotMatch(page.body, /Approve merge/i);
  });

  it("exposes the documented routes", async () => {
    const record = makeDecision({ result: "REJECTED" });
    const reader = new MemoryControlPlaneReader([record]);
    for (const path of [
      "/",
      "/repositories",
      `/repository/${record.repository}`,
      "/decisions",
      `/decision/${record.decision_id}`,
      "/findings",
      "/audit",
    ]) {
      const response = await handleControlPlaneRequest({ method: "GET", url: path }, reader);
      assert.equal(response.status, 200, path);
    }
  });

  it("rejects mutations and leaves the sealed result unchanged", async () => {
    const record = makeDecision({ result: "REJECTED" });
    const reader = new MemoryControlPlaneReader([record]);
    const before = await reader.getDecision(record.decision_id);
    const response = await handleControlPlaneRequest(
      { method: "POST", url: `/decision/${record.decision_id}`, headers: { accept: "application/json" } },
      reader,
    );
    assert.equal(response.status, 405);
    assert.match(response.body, /cannot change Guardian decisions/);
    const after = await reader.getDecision(record.decision_id);
    assert.equal(after?.result, "REJECTED");
    assert.equal(after?.result, before?.result);
    assert.equal(after?.evidence_hash, before?.evidence_hash);
    assert.equal(reader.writable, false);
  });

  it("refuses write SQL even if a Turso executor would accept it", async () => {
    assert.throws(() => assertReadOnlySql("UPDATE decisions SET result = 'SAFE_TO_MERGE'"), ReadOnlySqlError);
    assert.throws(() => assertReadOnlySql("INSERT INTO decisions (decision_id) VALUES ('x')"), ReadOnlySqlError);
    assert.throws(() => assertReadOnlySql("DELETE FROM decisions"), ReadOnlySqlError);
    const rejected = makeDecision({ result: "REJECTED" });
    const reader = new TursoControlPlaneReader(new SelectSql([rejected]));
    const snapshot = await reader.snapshot();
    assert.equal(snapshot.writable, false);
    assert.equal(snapshot.kind, "turso");
    assert.equal(snapshot.decisions[0]?.result, "REJECTED");
    assert.equal(snapshot.decisions[0]?.commit_sha, "abc1234deadbeef");
    assert.equal(snapshot.decisions[0]?.contract_hash, "sha256:contract");
    assert.equal(snapshot.decisions[0]?.evidence_hash, rejected.evidence_hash);
  });

  it("reads the local ledger without opening a write API", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-plane-"));
    dirs.push(root);
    const store = new FileDecisionStore(root);
    const record = makeDecision({ result: "SAFE_TO_MERGE" });
    await store.saveDecision(record);
    const reader = new FileControlPlaneReader(root);
    const snapshot = await reader.snapshot();
    assert.equal(snapshot.kind, "local-ledger");
    assert.equal(snapshot.decisions[0]?.decision_id, record.decision_id);
    assert.equal(snapshot.repositories[0]?.id, "elazamey/b2026");
    const json = await handleControlPlaneRequest(
      { method: "GET", url: "/decisions?format=json" },
      reader,
    );
    const payload = JSON.parse(json.body) as { writable: boolean; capabilities: { may_decide: boolean } };
    assert.equal(payload.writable, false);
    assert.equal(payload.capabilities.may_decide, false);
  });

  it("does not import the decision engine", () => {
    const dir = join(import.meta.dirname, "../src/control-plane");
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".ts")) continue;
      const source = readFileSync(join(dir, name), "utf8");
      assert.doesNotMatch(source, /decision-engine/);
      assert.doesNotMatch(source, /verification-engine/);
      assert.doesNotMatch(source, /saveDecision/);
    }
  });
});
