import type { DecisionRecord } from "../types.js";
import {
  buildOpenCycle,
  buildProviderErrorCycle,
  readLatestCycle,
  writeLastDispatch,
  writeRepairCycle,
} from "../loop/cycles.js";
import { dispatchStopReason, shouldDispatchRepair } from "../loop/orchestrate.js";
import { ArenaAdapter } from "./arena-adapter.js";
import { ManualAdapter } from "./manual-adapter.js";
import { buildRepairTask } from "./task.js";
import type { AgentAdapter, AgentProvider, DispatchResult, RepairTask } from "./types.js";

export function createAdapters(root: string): Record<AgentProvider, AgentAdapter> {
  return {
    manual: new ManualAdapter(root),
    arena: new ArenaAdapter(),
    future: {
      provider: "future",
      async dispatch(): Promise<DispatchResult> {
        throw new Error("Future agent provider is not configured. Core is unchanged.");
      },
    },
  };
}

export async function dispatchRepairTask(options: {
  root: string;
  decision: DecisionRecord;
  providers?: AgentProvider[];
  repairPlan?: string[];
}): Promise<{
  task: RepairTask | null;
  results: DispatchResult[];
  stopped?: "passed" | "exhausted" | "timeout" | "budget" | "provider";
}> {
  const last = readLatestCycle(options.root);
  if (options.decision.result !== "REJECTED") {
    return { task: null, results: [], stopped: "passed" };
  }
  if (!shouldDispatchRepair(options.decision, last?.status)) {
    return { task: null, results: [], stopped: dispatchStopReason(options.decision, last?.status) };
  }
  const providers = options.providers ?? ["arena", "manual"];
  const adapters = createAdapters(options.root);
  const results: DispatchResult[] = [];
  const errors: string[] = [];
  let task: RepairTask | null = null;
  for (const provider of providers) {
    const adapter = adapters[provider];
    const next = buildRepairTask(options.decision, provider, { repairPlan: options.repairPlan });
    task = next;
    try {
      results.push(await adapter.dispatch(next));
    } catch (error) {
      errors.push(`${provider}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const startedAt = new Date().toISOString();
  const primary = providers[0] ?? "arena";
  if (task && results.length === 0) {
    writeLastDispatch(options.root, {
      decision_id: task.decision_id,
      primary,
      providers,
      started_at: startedAt,
      tokens: null,
      error: errors.join("; ") || "provider failed",
    });
    writeRepairCycle(
      options.root,
      buildProviderErrorCycle({
        decision: options.decision,
        provider: primary,
        startedAt,
      }),
    );
    return { task, results, stopped: "provider" };
  }
  if (task) {
    writeLastDispatch(options.root, {
      decision_id: task.decision_id,
      primary,
      providers,
      started_at: startedAt,
      tokens: null,
      error: errors.length > 0 ? errors.join("; ") : null,
    });
    writeRepairCycle(
      options.root,
      buildOpenCycle({
        decision: options.decision,
        provider: primary,
        startedAt,
      }),
    );
  }
  return { task, results };
}
