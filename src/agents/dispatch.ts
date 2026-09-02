import type { DecisionRecord } from "../types.js";
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
}): Promise<{ task: RepairTask | null; results: DispatchResult[] }> {
  if (options.decision.result !== "REJECTED") {
    return { task: null, results: [] };
  }
  const providers = options.providers ?? ["manual", "arena"];
  const adapters = createAdapters(options.root);
  const results: DispatchResult[] = [];
  let task: RepairTask | null = null;
  for (const provider of providers) {
    const adapter = adapters[provider];
    const next = buildRepairTask(options.decision, provider);
    task = next;
    results.push(await adapter.dispatch(next));
  }
  return { task, results };
}
