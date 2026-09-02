import { execFileSync } from "node:child_process";
import type { RepairUsage } from "./classify.js";

export interface RepairDiffStats {
  files_changed: number;
  diff_lines: number;
}

export function parseNumstat(output: string): RepairDiffStats {
  let files_changed = 0;
  let diff_lines = 0;
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, deletedRaw] = line.split("\t");
    files_changed += 1;
    if (addedRaw === "-" || deletedRaw === "-") continue;
    const added = Number(addedRaw);
    const deleted = Number(deletedRaw);
    if (Number.isFinite(added)) diff_lines += added;
    if (Number.isFinite(deleted)) diff_lines += deleted;
  }
  return { files_changed, diff_lines };
}

export function measureRepairDiff(root: string, parentSha: string, currentSha: string): RepairDiffStats {
  try {
    const output = execFileSync("git", ["diff", "--numstat", parentSha, currentSha], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseNumstat(output);
  } catch {
    return { files_changed: 0, diff_lines: 0 };
  }
}

export function runtimeSeconds(startedAt: string | undefined, now = Date.now()): number {
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return 0;
  return Math.max(0, Math.floor((now - start) / 1000));
}

export function usageFrom(input: {
  diff?: RepairDiffStats;
  runtime_seconds?: number;
  tokens?: number | null;
}): RepairUsage {
  return {
    runtime_seconds: input.runtime_seconds ?? 0,
    files_changed: input.diff?.files_changed ?? 0,
    diff_lines: input.diff?.diff_lines ?? 0,
    tokens: input.tokens ?? null,
  };
}
