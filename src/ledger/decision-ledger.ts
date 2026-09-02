import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { DecisionRecord } from "../types.js";
import { canonicalJson } from "../util/hash.js";

export function defaultLedgerPath(root: string, record: DecisionRecord): string {
  return resolve(root, ".guardian", "decisions", `${record.decision_id}.json`);
}

export function writeLedger(path: string, record: DecisionRecord): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${canonicalJson(record)}\n`, "utf8");
  return path;
}
