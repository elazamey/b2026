import type { DecisionRecord } from "../types.js";
import { parseRecordJson, toPersistGraph } from "./graph.js";
import type { TursoDriver } from "./turso-driver.js";
import type { DecisionStore, SaveResult } from "./types.js";
import { immutableSlice, mergeProjections } from "./types.js";

export class TursoDecisionStore implements DecisionStore {
  constructor(private readonly driver: TursoDriver) {}

  async saveDecision(decision: DecisionRecord): Promise<SaveResult> {
    await this.driver.ensureSchema();
    const existingJson = await this.driver.getDecisionJson(decision.decision_id);
    if (existingJson) {
      const existing = parseRecordJson(existingJson);
      if (!existing) {
        throw new Error(`Corrupt Turso record for ${decision.decision_id}`);
      }
      const merged = mergeProjections(existing, decision);
      await this.driver.mergeRecordJson(decision.decision_id, JSON.stringify(merged));
      return {
        record: merged,
        created: false,
        storage: { local: true, turso: "exists" },
      };
    }
    const graph = toPersistGraph(decision);
    const status = await this.driver.insertGraph(graph);
    if (status === "exists") {
      const again = await this.getDecision(decision.decision_id);
      return {
        record: again ?? decision,
        created: false,
        storage: { local: true, turso: "exists" },
      };
    }
    return {
      record: decision,
      created: true,
      storage: { local: true, turso: "persisted" },
    };
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    await this.driver.ensureSchema();
    const json = await this.driver.getDecisionJson(id);
    return json ? parseRecordJson(json) : null;
  }

  async getLatest(repository: string): Promise<DecisionRecord | null> {
    await this.driver.ensureSchema();
    const json = await this.driver.getLatestJson(repository);
    return json ? parseRecordJson(json) : null;
  }
}

export function assertSameSealedDecision(
  left: DecisionRecord,
  right: DecisionRecord,
): void {
  const a = immutableSlice(left);
  const b = immutableSlice(right);
  const keys = Object.keys(a) as Array<keyof typeof a>;
  for (const key of keys) {
    if (a[key] !== b[key]) {
      throw new Error(`Sealed field mismatch: ${key}`);
    }
  }
}
