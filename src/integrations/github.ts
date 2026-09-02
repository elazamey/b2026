import { appendFileSync, writeFileSync } from "node:fs";
import type { VerificationReport } from "../types.js";
import { renderGithub, renderGithubSummary } from "../report/reporter.js";

export function emitGithub(report: VerificationReport): void {
  if (!process.env.GITHUB_ACTIONS) return;

  const annotations = renderGithub(report);
  if (annotations) {
    process.stdout.write(`${annotations}\n`);
  }

  if (process.env.GITHUB_STEP_SUMMARY) {
    writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${renderGithubSummary(report)}\n`, {
      flag: "a",
    });
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      [
        `decision=${report.decision.result}`,
        `violations=${report.decision.summary.violation_count}`,
        `decision_id=${report.decision.decision_id}`,
        `contract_hash=${report.contract_hash}`,
        "",
      ].join("\n"),
    );
  }
}
