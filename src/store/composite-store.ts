import type { DecisionRecord } from "../types.js";
import type { DecisionStore, RemoteStorageStatus, SaveResult } from "./types.js";

export class CompositeDecisionStore implements DecisionStore {
  constructor(
    private readonly local: DecisionStore,
    private readonly remote: DecisionStore | null,
    private readonly onWarning: (message: string) => void = warn,
  ) {}

  async saveDecision(decision: DecisionRecord): Promise<SaveResult> {
    const localResult = await this.local.saveDecision(decision);
    if (!this.remote) {
      const record = withStorage(localResult.record, "skipped");
      return { ...localResult, record, storage: { local: true, turso: "skipped" } };
    }
    try {
      const remoteResult = await this.remote.saveDecision(localResult.record);
      const status: RemoteStorageStatus = remoteResult.created ? "persisted" : "exists";
      const record = withStorage(localResult.record, status);
      await this.local.saveDecision(record);
      return {
        record,
        created: localResult.created,
        storage: { local: true, turso: status },
      };
    } catch (error) {
      this.onWarning(
        `Turso unavailable; local ledger retained. ${error instanceof Error ? error.message : String(error)}`,
      );
      const record = withStorage(localResult.record, "unavailable");
      await this.local.saveDecision(record);
      return {
        record,
        created: localResult.created,
        storage: { local: true, turso: "unavailable" },
      };
    }
  }

  async getDecision(id: string): Promise<DecisionRecord | null> {
    const local = await this.local.getDecision(id);
    if (local) return local;
    if (!this.remote) return null;
    try {
      return await this.remote.getDecision(id);
    } catch (error) {
      this.onWarning(
        `Turso read failed. ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  async getLatest(repository: string): Promise<DecisionRecord | null> {
    const local = await this.local.getLatest(repository);
    if (local) return local;
    if (!this.remote) return null;
    try {
      return await this.remote.getLatest(repository);
    } catch {
      return null;
    }
  }
}

function withStorage(record: DecisionRecord, turso: RemoteStorageStatus): DecisionRecord {
  return {
    ...record,
    storage: { local: true, turso },
  };
}

function warn(message: string): void {
  process.stderr.write(`${message}\n`);
}
