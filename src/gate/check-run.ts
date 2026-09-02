import type { DecisionResult, VerificationReport } from "../types.js";
import { renderGithubSummary } from "../report/reporter.js";

export const GATE_CHECK_NAME = "ai-guardian";

export type GateConclusion = "success" | "failure";

export function gateConclusion(result: DecisionResult): GateConclusion {
  return result === "SAFE_TO_MERGE" ? "success" : "failure";
}

export function renderGateOutput(report: VerificationReport): {
  title: string;
  summary: string;
} {
  const passed = report.decision.result === "SAFE_TO_MERGE";
  return {
    title: passed ? "SAFE TO MERGE" : "REJECTED",
    summary: [
      renderGithubSummary(report),
      "",
      passed
        ? "Required check `ai-guardian` may pass. The coding agent did not authorize this merge."
        : "Required check `ai-guardian` must fail. Repair with a new commit; do not edit architecture.yaml.",
    ].join("\n"),
  };
}

export interface CheckRunResult {
  id: number;
  html_url: string;
  name: string;
  conclusion: string;
}
