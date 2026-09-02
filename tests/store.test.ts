import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { decide } from "../src/core/decision-engine.ts";
import { validateContract } from "../src/core/contract-engine.ts";
import { FileDecisionStore } from "../src/store/file-store.ts";
import { TursoDecisionStore, assertSameSealedDecision } from "../src/store/turso-store.ts";
import { MemoryTursoDriver, SqlTursoDriver } from "../src/store/turso-driver.ts";
import { CompositeDecisionStore } from "../src/store/composite-store.ts";
import { LibsqlHttpClient } from "../src/store/libsql-http.ts";
import { readTursoConfig } from "../src/store/create.ts";
import { immutableSlice } from "../src/store/types.ts";
import { TURSO_SCHEMA_STATEMENTS } from "../src/store/schema.ts";
import type { CheckResult, DecisionRecord } from "../src/types.ts";
import type { DecisionStore } from "../src/store/types.ts";
import type { SqlExecutor, SqlResult, SqlValue } from "../src/store/sql.ts";

function check(name: CheckResult["name"], status: CheckResult["status"]): CheckResult {
  return {
    name,
    status,
    findings: [],
    evidence: { violations: 0 },
    duration_ms: 1,
  };
}

function makeDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  const contract = validateContract({
    version: "1",
    project: { type: "node" },
    merge: { require: ["architecture"] },
  });
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
    contractHash: "sha256:contract",
    contractPath: "architecture.yaml",
  });
  return { ...record, ...overrides };
}

class FakeSql implements SqlExecutor {
  decisions = new Map<
    string,
    { record_json: string; repository_id: string; timestamp: string }
  >();

  async execute(sql: string, args: SqlValue[] = []): Promise<SqlResult> {
    const s = sql.replace(/\s+/g, " ").trim();
    if (s.startsWith("CREATE")) return { rows: [], affected: 0 };
    if (s.startsWith("INSERT INTO decisions")) {
      const id = String(args[0]);
      if (this.decisions.has(id)) return { rows: [], affected: 0 };
      this.decisions.set(id, {
        record_json: String(args[10]),
        repository_id: String(args[1]),
        timestamp: String(args[7]),
      });
      return { rows: [], affected: 1 };
    }
    if (s.startsWith("INSERT INTO")) return { rows: [], affected: 1 };
    if (s.startsWith("SELECT record_json FROM decisions WHERE decision_id")) {
      const row = this.decisions.get(String(args[0]));
      return {
        rows: row ? [{ record_json: row.record_json }] : [],
        affected: 0,
      };
    }
    if (s.startsWith("SELECT record_json FROM decisions WHERE repository_id")) {
      const matches = [...this.decisions.values()]
        .filter((row) => row.repository_id === String(args[0]))
        .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const row = matches[0];
      return {
        rows: row ? [{ record_json: row.record_json }] : [],
        affected: 0,
      };
    }
    if (s.startsWith("UPDATE decisions SET record_json")) {
      const id = String(args[1]);
      const existing = this.decisions.get(id);
      if (existing) existing.record_json = String(args[0]);
      return { rows: [], affected: existing ? 1 : 0 };
    }
    throw new Error(`unexpected sql: ${s}`);
  }
}

const dirs: string[] = [];
after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

describe("v0.3 DecisionStore", () => {
  it("1. local-only check writes and reads the filesystem ledger", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-file-"));
    dirs.push(root);
    const store = new FileDecisionStore(root);
    const decision = makeDecision();
    const saved = await store.saveDecision(decision);
    assert.equal(saved.created, true);
    assert.equal(saved.storage.local, true);
    const loaded = await store.getDecision(decision.decision_id);
    assert.equal(loaded?.evidence_hash, decision.evidence_hash);
    assert.equal((await store.getLatest("owner/repo"))?.decision_id, decision.decision_id);
  });

  it("2. Turso persistence stores the sealed decision", async () => {
    const store = new TursoDecisionStore(new MemoryTursoDriver());
    const decision = makeDecision();
    const saved = await store.saveDecision(decision);
    assert.equal(saved.storage.turso, "persisted");
    const loaded = await store.getDecision(decision.decision_id);
    assert.deepEqual(immutableSlice(loaded!), immutableSlice(decision));
  });

  it("3. Turso unavailable does not change the local decision", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-comp-"));
    dirs.push(root);
    const local = new FileDecisionStore(root);
    const remote: DecisionStore = {
      async saveDecision() {
        throw new Error("network down");
      },
      async getDecision() {
        throw new Error("network down");
      },
      async getLatest() {
        throw new Error("network down");
      },
    };
    const warnings: string[] = [];
    const store = new CompositeDecisionStore(local, remote, (message) => warnings.push(message));
    const decision = makeDecision();
    const saved = await store.saveDecision(decision);
    assert.equal(saved.record.result, "SAFE_TO_MERGE");
    assert.equal(saved.storage.turso, "unavailable");
    assert.equal(saved.storage.local, true);
    assert.match(warnings[0] ?? "", /Turso unavailable/);
    assert.equal((await local.getDecision(decision.decision_id))?.result, "SAFE_TO_MERGE");
  });

  it("4. same sealed fields locally and remotely", async () => {
    const root = mkdtempSync(join(tmpdir(), "guardian-both-"));
    dirs.push(root);
    const local = new FileDecisionStore(root);
    const remote = new TursoDecisionStore(new MemoryTursoDriver());
    const store = new CompositeDecisionStore(local, remote, () => undefined);
    const decision = makeDecision();
    await store.saveDecision(decision);
    const fromLocal = await local.getDecision(decision.decision_id);
    const fromRemote = await remote.getDecision(decision.decision_id);
    assert.ok(fromLocal && fromRemote);
    assertSameSealedDecision(fromLocal, fromRemote);
  });

  it("5-7. contract_hash, commit_sha, and evidence_hash are preserved", async () => {
    const store = new TursoDecisionStore(new MemoryTursoDriver());
    const decision = makeDecision();
    await store.saveDecision(decision);
    const loaded = await store.getDecision(decision.decision_id);
    assert.equal(loaded?.contract_hash, "sha256:contract");
    assert.equal(loaded?.commit_sha, "abc1234deadbeef");
    assert.equal(loaded?.evidence_hash, decision.evidence_hash);
  });

  it("8. duplicate decision_id is idempotent and cannot override the result", async () => {
    const store = new TursoDecisionStore(new MemoryTursoDriver());
    const decision = makeDecision();
    await store.saveDecision(decision);
    const clone = makeDecision({
      decision_id: decision.decision_id,
      result: "REJECTED",
      evidence_hash: "sha256:tampered",
    });
    const second = await store.saveDecision(clone);
    assert.equal(second.created, false);
    assert.equal(second.record.result, "SAFE_TO_MERGE");
    assert.equal(second.record.contract_hash, decision.contract_hash);
    assert.equal(second.record.evidence_hash, decision.evidence_hash);
  });

  it("SqlTursoDriver persists through SQL and is idempotent", async () => {
    const sql = new FakeSql();
    const store = new TursoDecisionStore(new SqlTursoDriver(sql));
    const decision = makeDecision();
    await store.saveDecision(decision);
    await store.saveDecision(decision);
    assert.equal(sql.decisions.size, 1);
    const loaded = await store.getDecision(decision.decision_id);
    assert.equal(loaded?.decision_id, decision.decision_id);
    assert.equal(loaded?.contract_hash, decision.contract_hash);
  });

  it("HTTP client posts a libsql pipeline and never treats Turso as authority", async () => {
    const bodies: string[] = [];
    const client = new LibsqlHttpClient({
      url: "libsql://example.turso.io",
      token: "secret-token",
      timeoutMs: 500,
      fetch: async (url, init) => {
        assert.equal(url, "https://example.turso.io/v2/pipeline");
        assert.equal(init?.headers?.Authorization, "Bearer secret-token");
        bodies.push(init?.body ?? "");
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({
              results: [
                {
                  type: "ok",
                  response: {
                    result: {
                      cols: [{ name: "record_json" }],
                      rows: [[{ type: "text", value: "{\"decision_id\":\"dg_1\"}" }]],
                      affected_row_count: 1,
                    },
                  },
                },
              ],
            });
          },
        };
      },
    });
    const result = await client.execute("SELECT record_json FROM decisions WHERE decision_id = ?", [
      "dg_1",
    ]);
    assert.equal(result.rows[0]?.record_json, "{\"decision_id\":\"dg_1\"}");
    assert.match(bodies[0] ?? "", /"type":"execute"/);
  });

  it("9. Turso credentials are optional and not required for local checks", () => {
    assert.equal(readTursoConfig({}), null);
    assert.equal(readTursoConfig({ TURSO_DATABASE_URL: "https://x" }), null);
    const config = readTursoConfig({
      TURSO_DATABASE_URL: "libsql://example.turso.io",
      TURSO_AUTH_TOKEN: "token",
    });
    assert.equal(config?.url, "libsql://example.turso.io");
  });

  it("schema documents repositories, contracts, scans, decisions, evidence", () => {
    const sql = TURSO_SCHEMA_STATEMENTS.join("\n");
    for (const table of ["repositories", "contracts", "scans", "findings", "decisions", "evidence"]) {
      assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
    }
  });
});
