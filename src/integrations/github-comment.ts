import type { CheckResult, DecisionRecord, Finding, VerificationReport } from "../types.js";
import { COMMENT_MARKER } from "./github-api.js";

const CHECK_ORDER = [
  "architecture",
  "dependencies",
  "security",
  "boundaries",
  "tests",
  "build",
] as const;

export function renderPrComment(report: VerificationReport): string {
  const decision = report.decision;
  const passed = decision.result === "SAFE_TO_MERGE";
  const badge = passed ? "SAFE TO MERGE" : "REJECTED";
  const lines = [
    COMMENT_MARKER,
    `## AI Architecture & Engineering Guardian`,
    "",
    `**Decision:** \`${badge}\``,
    "",
    renderCheckTable(report.checks, decision),
    "",
  ];

  if (decision.violations.length > 0) {
    lines.push("### Violations", "", renderViolationTable(decision.violations), "");
  }

  lines.push("### Provenance", "");
  lines.push(`| Field | Value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| Repository | \`${decision.repository}\` |`);
  lines.push(`| Commit | \`${decision.commit_sha ?? decision.commit}\` |`);
  if (decision.pull_request) {
    const n = decision.pull_request.number;
    const url = decision.pull_request.url;
    lines.push(`| Pull request | ${url ? `[#${n}](${url})` : `#${n}`} |`);
  }
  lines.push(`| Contract hash | \`${decision.contract_hash}\` |`);
  lines.push(`| Evidence hash | \`${decision.evidence_hash}\` |`);
  lines.push(`| Decision ID | \`${decision.decision_id}\` |`);
  if (decision.storage?.turso === "persisted" || decision.storage?.turso === "exists") {
    lines.push(`| State ledger | Turso (\`${decision.decision_id}\`) |`);
  }
  lines.push(`| Engine | \`${decision.engine_version}\` |`);
  lines.push(`| Timestamp | \`${decision.timestamp}\` |`);
  if (decision.github?.run_url) {
    lines.push(`| Workflow run | [run](${decision.github.run_url}) |`);
  }
  lines.push("");
  lines.push(
    passed
      ? "_Deterministic engine decision. The coding agent did not authorize this merge._"
      : "_Deterministic engine decision. Repair the findings and push; this comment will be updated in place._",
  );
  lines.push("");
  return lines.join("\n");
}

function renderCheckTable(checks: CheckResult[], decision: DecisionRecord): string {
  const rows = CHECK_ORDER.map((name) => {
    const check = checks.find((item) => item.name === name);
    const status = check?.status ?? decision.checks[name] ?? "SKIP";
    const findings = check?.findings.length ?? 0;
    return `| ${titleCase(name)} | ${statusIcon(status)} \`${status}\` | ${findings} |`;
  });
  return [
    `| Check | Status | Findings |`,
    `| --- | --- | ---: |`,
    ...rows,
  ].join("\n");
}

function renderViolationTable(violations: Finding[]): string {
  const shown = violations.slice(0, 20);
  const rows = shown.map((finding) => {
    const loc = finding.file
      ? finding.line
        ? `${finding.file}:${finding.line}`
        : finding.file
      : "—";
    return `| \`${cell(finding.id)}\` | ${cell(finding.message)} | \`${cell(loc)}\` | ${cell(finding.repair ?? "")} |`;
  });
  const table = [
    `| ID | Message | File | Repair |`,
    `| --- | --- | --- | --- |`,
    ...rows,
  ];
  if (violations.length > shown.length) {
    table.push("");
    table.push(`_…and ${violations.length - shown.length} more. See the decision ledger._`);
  }
  return table.join("\n");
}

function statusIcon(status: string): string {
  switch (status) {
    case "PASS":
      return "✅";
    case "FAIL":
      return "❌";
    case "ERROR":
      return "💥";
    case "WARN":
      return "⚠️";
    default:
      return "⏭️";
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function cell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim().slice(0, 180);
}
