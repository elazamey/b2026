import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionRecord, DecisionResult } from "../types.js";
import type { AgentProvider } from "../agents/types.js";
import { slimViolations, type RepairViolation } from "../agents/violations.js";
import { MAX_REPAIR_ATTEMPTS, orchestrationStatus } from "./orchestrate.js";

export const REPAIR_CYCLE_SCHEMA = "guardian.repair-cycle/v1";

export interface RepairCycle {
  schema: typeof REPAIR_CYCLE_SCHEMA;
  cycle_id: string;
  attempt: number;
  parent_decision_id: string;
  source_commit: string;
  findings: RepairViolation[];
  repair_provider: AgentProvider | "unknown";
  resulting_commit: string;
  resulting_decision_id: string;
  resulting_result: DecisionResult;
  status: "rejected" | "passed" | "exhausted";
  created_at: string;
}

export function buildRepairCycle(input: {
  previous: DecisionRecord;
  current: DecisionRecord;
  repairProvider?: AgentProvider | "unknown";
}): RepairCycle | null {
  const lineage = input.current.lineage;
  if (!lineage) return null;
  const status = orchestrationStatus(input.current);
  return {
    schema: REPAIR_CYCLE_SCHEMA,
    cycle_id: `R${lineage.repair_attempt}`,
    attempt: lineage.repair_attempt,
    parent_decision_id: lineage.parent_decision_id,
    source_commit: lineage.parent_commit_sha,
    findings: slimViolations(input.previous),
    repair_provider: input.repairProvider ?? "unknown",
    resulting_commit: lineage.new_commit_sha,
    resulting_decision_id: input.current.decision_id,
    resulting_result: input.current.result,
    status: status === "dispatch" ? "rejected" : status,
    created_at: new Date().toISOString(),
  };
}

export function writeRepairCycle(root: string, cycle: RepairCycle): string {
  const dir = resolve(root, ".guardian", "repairs");
  mkdirSync(dir, { recursive: true });
  const named = resolve(dir, `${cycle.cycle_id}-${cycle.resulting_decision_id}.json`);
  const latest = resolve(dir, "latest.json");
  const body = `${JSON.stringify(cycle, null, 2)}\n`;
  writeFileSync(named, body, "utf8");
  writeFileSync(latest, body, "utf8");
  appendCycleIndex(dir, cycle);
  return named;
}

export function defaultRepairDir(root: string): string {
  return resolve(root, ".guardian", "repairs");
}

export function readLastRepairProvider(root: string, parentDecisionId: string): AgentProvider | "unknown" {
  const dispatch = readProviderFile(resolve(root, ".guardian", "last-dispatch.json"), parentDecisionId, "primary");
  if (dispatch !== "unknown") return dispatch;
  return readProviderFile(resolve(root, ".guardian", "repair-task.json"), parentDecisionId, "provider");
}

function readProviderFile(
  path: string,
  parentDecisionId: string,
  field: "primary" | "provider",
): AgentProvider | "unknown" {
  if (!existsSync(path)) return "unknown";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      decision_id?: string;
      primary?: string;
      provider?: string;
    };
    if (parsed.decision_id !== parentDecisionId) return "unknown";
    const value = parsed[field];
    if (value === "arena" || value === "manual" || value === "future") return value;
  } catch {
    return "unknown";
  }
  return "unknown";
}

function appendCycleIndex(dir: string, cycle: RepairCycle): void {
  const indexPath = resolve(dir, "index.json");
  let entries: Array<{ cycle_id: string; attempt: number; resulting_decision_id: string; status: string }> = [];
  if (existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(readFileSync(indexPath, "utf8")) as { entries?: typeof entries };
      entries = parsed.entries ?? [];
    } catch {
      entries = [];
    }
  }
  entries.push({
    cycle_id: cycle.cycle_id,
    attempt: cycle.attempt,
    resulting_decision_id: cycle.resulting_decision_id,
    status: cycle.status,
  });
  writeFileSync(
    indexPath,
    `${JSON.stringify({ schema: REPAIR_CYCLE_SCHEMA, max_attempts: MAX_REPAIR_ATTEMPTS, entries }, null, 2)}\n`,
    "utf8",
  );
}
