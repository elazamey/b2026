import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionRecord } from "../types.js";
import {
  defaultLedgerDir,
  defaultLedgerPath,
  readLedger,
  writeLedgerBundle,
} from "../ledger/decision-ledger.js";
import type { DecisionStore, SaveResult } from "./types.js";
import { mergeProjections } from "./types.js";

export class FileDecisionStore implements DecisionStore {
  constructor(
    private readonly root: string,
    private readonly extraPath?: string,
  ) {}

  async saveDecision(decision: DecisionRecord): Promise<SaveResult> {
    const existing = await this.getDecision(decision.decision_id);
    const record = existing ? mergeProjections(existing, decision) : decision;
    writeLedgerBundle({
      root: this.root,
      record,
      extraPath: this.extraPath,
    });
    return {
      record,
      created: !existing,
      storage: { local: true, turso: "skipped" },
    };
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    const path = defaultLedgerPath(this.root, {
      decision_id: id,
    } as DecisionRecord);
    if (!existsSync(path)) return null;
    try {
      return readLedger(path);
    } catch {
      return null;
    }
  }

  async getLatest(repository: string): Promise<DecisionRecord | null> {
    const latest = resolve(defaultLedgerDir(this.root), "latest.json");
    if (existsSync(latest)) {
      try {
        const record = readLedger(latest);
        if (!repository || record.repository === repository) return record;
      } catch {
        /* fall through to scan */
      }
    }
    const dir = defaultLedgerDir(this.root);
    if (!existsSync(dir)) return null;
    const files = readdirSync(dir)
      .filter((name) => name.startsWith("dg_") && name.endsWith(".json"))
      .map((name) => resolve(dir, name));
    let latestRecord: DecisionRecord | null = null;
    for (const file of files) {
      try {
        const record = readLedger(file);
        if (repository && record.repository !== repository) continue;
        if (!latestRecord || record.timestamp > latestRecord.timestamp) {
          latestRecord = record;
        }
      } catch {
        continue;
      }
    }
    return latestRecord;
  }
}
