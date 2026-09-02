import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionRecord } from "../types.js";
import { defaultLedgerDir, readLedger } from "../ledger/decision-ledger.js";
import { LibsqlHttpClient } from "../store/libsql-http.js";
import { parseRecordJson } from "../store/graph.js";
import { readTursoConfig } from "../store/create.js";
import type { SqlExecutor } from "../store/sql.js";
import { ReadOnlySql } from "./readonly.js";
import { projectRecords } from "./project.js";
import type { ControlPlaneKind, ControlPlaneReader, ControlPlaneSnapshot } from "./types.js";

export class MemoryControlPlaneReader implements ControlPlaneReader {
  readonly kind: ControlPlaneKind = "memory";
  readonly writable = false as const;

  constructor(private readonly records: DecisionRecord[]) {}

  async snapshot(): Promise<ControlPlaneSnapshot> {
    return projectRecords(this.kind, this.records);
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    return this.records.find((record) => record.decision_id === id) ?? null;
  }
}

export class FileControlPlaneReader implements ControlPlaneReader {
  readonly kind: ControlPlaneKind = "local-ledger";
  readonly writable = false as const;

  constructor(private readonly root: string) {}

  async snapshot(): Promise<ControlPlaneSnapshot> {
    return projectRecords(this.kind, loadLocalRecords(this.root));
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    return loadLocalRecords(this.root).find((record) => record.decision_id === id) ?? null;
  }
}

export class TursoControlPlaneReader implements ControlPlaneReader {
  readonly kind: ControlPlaneKind = "turso";
  readonly writable = false as const;
  private readonly sql: ReadOnlySql;

  constructor(executor: SqlExecutor) {
    this.sql = new ReadOnlySql(executor);
  }

  async snapshot(): Promise<ControlPlaneSnapshot> {
    return projectRecords(this.kind, await this.loadAll());
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    const result = await this.sql.execute(
      "SELECT record_json FROM decisions WHERE decision_id = ?",
      [id],
    );
    const json = result.rows[0]?.record_json;
    return typeof json === "string" ? parseRecordJson(json) : null;
  }

  private async loadAll(): Promise<DecisionRecord[]> {
    const result = await this.sql.execute(
      "SELECT record_json FROM decisions ORDER BY timestamp DESC LIMIT 200",
    );
    const records: DecisionRecord[] = [];
    for (const row of result.rows) {
      if (typeof row.record_json !== "string") continue;
      const parsed = parseRecordJson(row.record_json);
      if (parsed) records.push(parsed);
    }
    return records;
  }
}

export function createControlPlaneReader(options: {
  root: string;
  env?: NodeJS.ProcessEnv;
  sql?: SqlExecutor;
}): ControlPlaneReader {
  if (options.sql) {
    return new TursoControlPlaneReader(options.sql);
  }
  const config = readTursoConfig(options.env);
  if (config) {
    return new TursoControlPlaneReader(
      new LibsqlHttpClient({ url: config.url, token: config.token }),
    );
  }
  return new FileControlPlaneReader(options.root);
}

function loadLocalRecords(root: string): DecisionRecord[] {
  const dir = defaultLedgerDir(root);
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir).filter(
    (name) => name.startsWith("dg_") && name.endsWith(".json"),
  );
  const records: DecisionRecord[] = [];
  for (const name of files) {
    try {
      records.push(readLedger(resolve(dir, name)));
    } catch {
      continue;
    }
  }
  return records;
}
