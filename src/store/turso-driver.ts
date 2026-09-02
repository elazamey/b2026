import type { PersistGraph } from "./graph.js";
import { TURSO_SCHEMA_STATEMENTS } from "./schema.js";
import type { SqlExecutor, SqlValue } from "./sql.js";

export interface TursoDriver {
  ensureSchema(): Promise<void>;
  getDecisionJson(id: string): Promise<string | null>;
  getLatestJson(repository: string): Promise<string | null>;
  insertGraph(graph: PersistGraph): Promise<"inserted" | "exists">;
  mergeRecordJson(id: string, recordJson: string): Promise<void>;
}

export class SqlTursoDriver implements TursoDriver {
  constructor(private readonly sql: SqlExecutor) {}

  async ensureSchema(): Promise<void> {
    for (const statement of TURSO_SCHEMA_STATEMENTS) {
      await this.sql.execute(statement);
    }
  }

  async getDecisionJson(id: string): Promise<string | null> {
    const result = await this.sql.execute(
      "SELECT record_json FROM decisions WHERE decision_id = ?",
      [id],
    );
    const value = result.rows[0]?.record_json;
    return typeof value === "string" ? value : null;
  }

  async getLatestJson(repository: string): Promise<string | null> {
    const result = await this.sql.execute(
      "SELECT record_json FROM decisions WHERE repository_id = ? ORDER BY timestamp DESC LIMIT 1",
      [repository],
    );
    const value = result.rows[0]?.record_json;
    return typeof value === "string" ? value : null;
  }

  async insertGraph(graph: PersistGraph): Promise<"inserted" | "exists"> {
    const existing = await this.getDecisionJson(graph.decision.decision_id);
    if (existing) return "exists";

    await this.sql.execute(
      `INSERT INTO repositories (id, created_at, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
      [graph.repository.id, graph.repository.created_at, graph.repository.updated_at],
    );
    await this.sql.execute(
      `INSERT INTO contracts (hash, repository_id, path, recorded_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(hash) DO NOTHING`,
      [
        graph.contract.hash,
        graph.contract.repository_id,
        graph.contract.path,
        graph.contract.recorded_at,
      ],
    );
    await this.sql.execute(
      `INSERT INTO scans (
         id, repository_id, decision_id, commit_sha, contract_hash,
         engine_version, schema_version, timestamp, result, evidence_hash
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [
        graph.scan.id,
        graph.scan.repository_id,
        graph.scan.decision_id,
        graph.scan.commit_sha,
        graph.scan.contract_hash,
        graph.scan.engine_version,
        graph.scan.schema_version,
        graph.scan.timestamp,
        graph.scan.result,
        graph.scan.evidence_hash,
      ],
    );
    for (const finding of graph.findings) {
      await this.sql.execute(
        `INSERT INTO findings (
           scan_id, finding_id, rule, severity, message, file, line, repair
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          finding.scan_id,
          finding.finding_id,
          finding.rule,
          finding.severity,
          finding.message,
          finding.file,
          finding.line,
          finding.repair,
        ],
      );
    }
    await this.sql.execute(
      `INSERT INTO decisions (
         decision_id, repository_id, scan_id, commit_sha, contract_hash,
         engine_version, schema_version, timestamp, result, evidence_hash, record_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(decision_id) DO NOTHING`,
      [
        graph.decision.decision_id,
        graph.decision.repository_id,
        graph.decision.scan_id,
        graph.decision.commit_sha,
        graph.decision.contract_hash,
        graph.decision.engine_version,
        graph.decision.schema_version,
        graph.decision.timestamp,
        graph.decision.result,
        graph.decision.evidence_hash,
        graph.decision.record_json,
      ],
    );
    await this.sql.execute(
      `INSERT INTO evidence (evidence_hash, decision_id, payload_json) VALUES (?, ?, ?)
       ON CONFLICT(evidence_hash) DO NOTHING`,
      [
        graph.evidence.evidence_hash,
        graph.evidence.decision_id,
        graph.evidence.payload_json,
      ],
    );
    return "inserted";
  }

  async mergeRecordJson(id: string, recordJson: string): Promise<void> {
    await this.sql.execute(
      "UPDATE decisions SET record_json = ? WHERE decision_id = ?",
      [recordJson, id],
    );
  }
}

export class MemoryTursoDriver implements TursoDriver {
  private readonly decisions = new Map<string, string>();
  private schemaReady = false;

  async ensureSchema(): Promise<void> {
    this.schemaReady = true;
  }

  async getDecisionJson(id: string): Promise<string | null> {
    this.assertReady();
    return this.decisions.get(id) ?? null;
  }

  async getLatestJson(repository: string): Promise<string | null> {
    this.assertReady();
    let latest: { timestamp: string; json: string } | null = null;
    for (const json of this.decisions.values()) {
      const parsed = JSON.parse(json) as { repository?: string; timestamp?: string };
      if (parsed.repository !== repository) continue;
      if (!latest || (parsed.timestamp ?? "") > latest.timestamp) {
        latest = { timestamp: parsed.timestamp ?? "", json };
      }
    }
    return latest?.json ?? null;
  }

  async insertGraph(graph: PersistGraph): Promise<"inserted" | "exists"> {
    this.assertReady();
    if (this.decisions.has(graph.decision.decision_id)) return "exists";
    this.decisions.set(graph.decision.decision_id, graph.decision.record_json);
    return "inserted";
  }

  async mergeRecordJson(id: string, recordJson: string): Promise<void> {
    this.assertReady();
    if (!this.decisions.has(id)) return;
    this.decisions.set(id, recordJson);
  }

  private assertReady(): void {
    if (!this.schemaReady) {
      throw new Error("Turso schema has not been applied");
    }
  }
}

void (0 as unknown as SqlValue);
