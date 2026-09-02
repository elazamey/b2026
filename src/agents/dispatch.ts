import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionRecord } from "../types.js";
import { shouldDispatchRepair } from "../loop/orchestrate.js";
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
}): Promise<{ task: RepairTask | null; results: DispatchResult[]; stopped?: "passed" | "exhausted" }> {
  if (options.decision.result !== "REJECTED") {
    return { task: null, results: [], stopped: "passed" };
  }
  if (!shouldDispatchRepair(options.decision)) {
    return { task: null, results: [], stopped: "exhausted" };
  }
  const providers = options.providers ?? ["arena", "manual"];
  const adapters = createAdapters(options.root);
  const results: DispatchResult[] = [];
  let task: RepairTask | null = null;
  for (const provider of providers) {
    const adapter = adapters[provider];
    const next = buildRepairTask(options.decision, provider, { repairPlan: options.repairPlan });
    task = next;
    results.push(await adapter.dispatch(next));
  }
  if (task) writeLastDispatch(options.root, task.decision_id, providers);
  return { task, results };
}

function writeLastDispatch(root: string, decisionId: string, providers: AgentProvider[]): void {
  mkdirSync(resolve(root, ".guardian"), { recursive: true });
  writeFileSync(
    resolve(root, ".guardian", "last-dispatch.json"),
    `${JSON.stringify({ decision_id: decisionId, primary: providers[0] ?? "arena", providers }, null, 2)}\n`,
    "utf8",
  );
}
