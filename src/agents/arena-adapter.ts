import { assertRepairTaskSafe, type AgentAdapter, type DispatchResult, type RepairTask } from "./types.js";

/**
 * Arena is an optional Agent Provider, not Core.
 * GitHub is the event bus. This adapter never calls Arena, never
 * declares SAFE_TO_MERGE, and never edits architecture.yaml.
 */
export class ArenaAdapter implements AgentAdapter {
  readonly provider = "arena" as const;

  async dispatch(task: RepairTask): Promise<DispatchResult> {
    assertRepairTaskSafe(task);
    return { provider: "arena", channel: "github-bus" };
  }
}
