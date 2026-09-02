import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { DecisionRecord, DecisionResult } from "../types.js";
import type { AgentProvider } from "../agents/types.js";
import { slimViolations, type RepairViolation } from "../agents/violations.js";
import { MAX_REPAIR_ATTEMPTS, REPAIR_BUDGET, type RepairBudget } from "./budget.js";
import {
  classifyCycle,
  failureClassOf,
  type CycleStatus,
  type FailureClass,
  type RepairUsage,
  EMPTY_USAGE,
} from "./classify.js";
import { measureRepairDiff, runtimeSeconds, usageFrom } from "./diff.js";
import { repairAttemptNumber } from "./orchestrate.js";

export const REPAIR_CYCLE_SCHEMA = "guardian.repair-cycle/v2";

export interface LastDispatch {
  decision_id: string;
  primary: AgentProvider | "unknown";
  providers: AgentProvider[];
  started_at: string;
  tokens?: number | null;
  error?: string | null;
}

export interface RepairCycle {
  schema: typeof REPAIR_CYCLE_SCHEMA;
  cycle_id: string;
  attempt: number;
  parent_decision_id: string;
  source_commit: string;
  findings: RepairViolation[];
  repair_provider: AgentProvider | "unknown";
  resulting_commit: string | null;
  resulting_decision_id: string | null;
  resulting_result: DecisionResult | null;
  status: CycleStatus;
  failure_class: FailureClass | null;
  budget: RepairBudget;
  usage: RepairUsage;
  started_at: string;
  finished_at: string | null;
  created_at: string;
}

export function buildRepairCycle(input: {
  previous: DecisionRecord;
  current: DecisionRecord;
  repairProvider?: AgentProvider | "unknown";
  usage?: RepairUsage;
  providerError?: boolean;
  startedAt?: string;
}): RepairCycle | null {
  const lineage = input.current.lineage;
  if (!lineage) return null;
  const status = classifyCycle({
    guardianResult: input.current.result,
    usage: input.usage ?? EMPTY_USAGE,
    contractMutated: input.current.violations.some((item) => item.id === "CTR-001"),
    providerError: input.providerError,
  });
  const started = input.startedAt ?? input.previous.timestamp;
  const finished = new Date().toISOString();
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
    status,
    failure_class: failureClassOf(status),
    budget: { ...REPAIR_BUDGET },
    usage: input.usage ?? EMPTY_USAGE,
    started_at: started,
    finished_at: finished,
    created_at: finished,
  };
}

export function buildOpenCycle(input: {
  decision: DecisionRecord;
  provider: AgentProvider | "unknown";
  startedAt?: string;
}): RepairCycle {
  const attempt = repairAttemptNumber(input.decision) + 1;
  const started = input.startedAt ?? new Date().toISOString();
  return {
    schema: REPAIR_CYCLE_SCHEMA,
    cycle_id: `R${attempt}`,
    attempt,
    parent_decision_id: input.decision.decision_id,
    source_commit: input.decision.commit_sha ?? input.decision.commit,
    findings: slimViolations(input.decision),
    repair_provider: input.provider,
    resulting_commit: null,
    resulting_decision_id: null,
    resulting_result: null,
    status: "RUNNING",
    failure_class: null,
    budget: { ...REPAIR_BUDGET },
    usage: { ...EMPTY_USAGE },
    started_at: started,
    finished_at: null,
    created_at: started,
  };
}

export function buildProviderErrorCycle(input: {
  decision: DecisionRecord;
  provider: AgentProvider | "unknown";
  startedAt?: string;
}): RepairCycle {
  const open = buildOpenCycle(input);
  const finished = new Date().toISOString();
  return {
    ...open,
    status: "PROVIDER_ERROR",
    failure_class: "infrastructure",
    finished_at: finished,
    created_at: finished,
  };
}

export function writeRepairCycle(root: string, cycle: RepairCycle): string {
  const dir = resolve(root, ".guardian", "repairs");
  mkdirSync(dir, { recursive: true });
  const stamp = cycle.resulting_decision_id ?? "open";
  const named = resolve(dir, `${cycle.cycle_id}-${stamp}.json`);
  const latest = resolve(dir, "latest.json");
  const body = `${JSON.stringify(cycle, null, 2)}\n`;
  writeFileSync(named, body, "utf8");
  writeFileSync(latest, body, "utf8");
  if (cycle.status === "RUNNING") {
    writeFileSync(resolve(dir, "running.json"), body, "utf8");
  } else {
    clearRunning(dir);
    appendCycleIndex(dir, cycle);
  }
  return named;
}

export function defaultRepairDir(root: string): string {
  return resolve(root, ".guardian", "repairs");
}

export function readLatestCycle(root: string): RepairCycle | null {
  return readCycleFile(resolve(root, ".guardian", "repairs", "latest.json"));
}

export function readRunningCycle(root: string): RepairCycle | null {
  return readCycleFile(resolve(root, ".guardian", "repairs", "running.json"));
}

export function closeRepairCycle(
  root: string,
  previous: DecisionRecord,
  current: DecisionRecord,
): RepairCycle | null {
  const dispatch = readLastDispatch(root);
  const running = readRunningCycle(root);
  const provider =
    dispatch && dispatch.decision_id === current.lineage?.parent_decision_id
      ? dispatch.primary
      : running?.repair_provider ?? readLastRepairProvider(root, current.lineage?.parent_decision_id ?? "");
  const parentSha = current.lineage?.parent_commit_sha;
  const currentSha = current.lineage?.new_commit_sha;
  const diff =
    parentSha && currentSha ? measureRepairDiff(root, parentSha, currentSha) : { files_changed: 0, diff_lines: 0 };
  const startedAt = running?.started_at ?? dispatch?.started_at ?? previous.timestamp;
  const usage = usageFrom({
    diff,
    runtime_seconds: runtimeSeconds(startedAt),
    tokens: dispatch?.tokens ?? null,
  });
  const cycle = buildRepairCycle({
    previous,
    current,
    repairProvider: provider,
    usage,
    providerError: Boolean(dispatch?.error),
    startedAt,
  });
  if (!cycle) return null;
  writeRepairCycle(root, cycle);
  return cycle;
}

export function readLastDispatch(root: string): LastDispatch | null {
  const path = resolve(root, ".guardian", "last-dispatch.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LastDispatch;
  } catch {
    return null;
  }
}

export function writeLastDispatch(root: string, record: LastDispatch): void {
  mkdirSync(resolve(root, ".guardian"), { recursive: true });
  writeFileSync(resolve(root, ".guardian", "last-dispatch.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function readLastRepairProvider(root: string, parentDecisionId: string): AgentProvider | "unknown" {
  const dispatch = readLastDispatch(root);
  if (dispatch && dispatch.decision_id === parentDecisionId) {
    if (dispatch.primary === "arena" || dispatch.primary === "manual" || dispatch.primary === "future") {
      return dispatch.primary;
    }
  }
  return readProviderFile(resolve(root, ".guardian", "repair-task.json"), parentDecisionId);
}

function readProviderFile(path: string, parentDecisionId: string): AgentProvider | "unknown" {
  if (!existsSync(path)) return "unknown";
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { decision_id?: string; provider?: string };
    if (parsed.decision_id !== parentDecisionId) return "unknown";
    if (parsed.provider === "arena" || parsed.provider === "manual" || parsed.provider === "future") {
      return parsed.provider;
    }
  } catch {
    return "unknown";
  }
  return "unknown";
}

function readCycleFile(path: string): RepairCycle | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as RepairCycle;
  } catch {
    return null;
  }
}

function clearRunning(dir: string): void {
  const running = resolve(dir, "running.json");
  if (existsSync(running)) unlinkSync(running);
}

function appendCycleIndex(dir: string, cycle: RepairCycle): void {
  const indexPath = resolve(dir, "index.json");
  let entries: Array<{
    cycle_id: string;
    attempt: number;
    resulting_decision_id: string | null;
    status: CycleStatus;
    failure_class: FailureClass | null;
  }> = [];
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
    failure_class: cycle.failure_class,
  });
  writeFileSync(
    indexPath,
    `${JSON.stringify({ schema: REPAIR_CYCLE_SCHEMA, max_attempts: MAX_REPAIR_ATTEMPTS, budget: REPAIR_BUDGET, entries }, null, 2)}\n`,
    "utf8",
  );
}
