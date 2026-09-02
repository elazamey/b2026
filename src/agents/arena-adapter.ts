import type { AgentAdapter, DispatchResult, RepairTask } from "./types.js";

/**
 * Arena is an optional Agent Provider, not Core.
 * GitHub is the event bus. This adapter never calls Arena, never
 * declares SAFE_TO_MERGE, and never edits architecture.yaml.
 */
export class ArenaAdapter implements AgentAdapter {
  readonly provider = "arena" as const;

  async dispatch(task: RepairTask): Promise<DispatchResult> {
    if (task.constraints.may_declare_safe_to_merge) {
      throw new Error("Arena adapter cannot accept a task that may declare SAFE_TO_MERGE.");
    }
    if (task.constraints.may_modify_contract) {
      throw new Error("Arena adapter cannot accept a task that may modify the contract.");
    }
    if (task.constraints.merge_authority !== "guardian") {
      throw new Error("Arena adapter cannot accept merge authority.");
    }
    return { provider: "arena", channel: "github-bus" };
  }
}
