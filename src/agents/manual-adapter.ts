import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AgentAdapter, DispatchResult, RepairTask } from "./types.js";

export class ManualAdapter implements AgentAdapter {
  readonly provider = "manual" as const;

  constructor(private readonly root: string) {}

  async dispatch(task: RepairTask): Promise<DispatchResult> {
    if (task.constraints.merge_authority !== "guardian") {
      throw new Error("Adapter refused a task that claims merge authority.");
    }
    const dir = resolve(this.root, ".guardian", "repair-tasks");
    mkdirSync(dir, { recursive: true });
    const named = resolve(dir, `${task.decision_id}.json`);
    const latest = resolve(this.root, ".guardian", "repair-task.json");
    const body = `${JSON.stringify(task, null, 2)}\n`;
    writeFileSync(named, body, "utf8");
    writeFileSync(latest, body, "utf8");
    return { provider: "manual", written: latest, channel: "local-file" };
  }
}
