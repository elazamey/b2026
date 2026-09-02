import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { DecisionRecord, LedgerIndex, LedgerIndexEntry } from "../types.js";
import { LEDGER_SCHEMA_VERSION } from "../types.js";
import { toPosix } from "../util/files.js";

const INDEX_CAP = 200;

export function defaultLedgerDir(root: string): string {
  return resolve(root, ".guardian", "decisions");
}

export function defaultLedgerPath(root: string, record: DecisionRecord): string {
  return resolve(defaultLedgerDir(root), `${record.decision_id}.json`);
}

export function writeLedger(path: string, record: DecisionRecord): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return path;
}

export function writeLedgerBundle(options: {
  root: string;
  record: DecisionRecord;
  extraPath?: string;
}): { decisionPath: string; indexPath: string; latestPath: string } {
  const dir = defaultLedgerDir(options.root);
  const decisionPath = defaultLedgerPath(options.root, options.record);
  writeLedger(decisionPath, options.record);

  const latestPath = resolve(dir, "latest.json");
  writeLedger(latestPath, options.record);

  if (options.extraPath && resolve(options.extraPath) !== decisionPath) {
    writeLedger(options.extraPath, options.record);
  }

  const indexPath = resolve(dir, "index.json");
  const index = upsertIndex(indexPath, options.root, options.record, decisionPath);
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");

  return { decisionPath, indexPath, latestPath };
}

export function readLedger(path: string): DecisionRecord {
  return JSON.parse(readFileSync(path, "utf8")) as DecisionRecord;
}

function upsertIndex(
  indexPath: string,
  root: string,
  record: DecisionRecord,
  decisionPath: string,
): LedgerIndex {
  const existing = loadIndex(indexPath);
  const entry: LedgerIndexEntry = {
    decision_id: record.decision_id,
    timestamp: record.timestamp,
    repository: record.repository,
    commit: record.commit,
    commit_sha: record.commit_sha,
    result: record.result,
    pull_request: record.pull_request?.number ?? null,
    contract_hash: record.contract_hash,
    evidence_hash: record.evidence_hash,
    violation_count: record.summary.violation_count,
    original_decision_id: record.lineage?.original_decision_id,
    repair_attempt_id: record.lineage?.repair_attempt_id,
    path: toPosix(relative(root, decisionPath)),
  };
  const entries = [
    entry,
    ...existing.entries.filter((item) => item.decision_id !== record.decision_id),
  ].slice(0, INDEX_CAP);
  return {
    schema_version: LEDGER_SCHEMA_VERSION,
    updated_at: record.timestamp,
    entries,
  };
}

function loadIndex(path: string): LedgerIndex {
  if (!existsSync(path)) {
    return { schema_version: LEDGER_SCHEMA_VERSION, updated_at: "", entries: [] };
  }
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as LedgerIndex;
    return {
      schema_version: LEDGER_SCHEMA_VERSION,
      updated_at: parsed.updated_at ?? "",
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { schema_version: LEDGER_SCHEMA_VERSION, updated_at: "", entries: [] };
  }
}
