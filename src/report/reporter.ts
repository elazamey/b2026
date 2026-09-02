import type { CheckResult, Finding, VerificationReport } from "../types.js";
import { countEvidenceChecks } from "../core/evidence-engine.js";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const GRAY = "\x1b[90m";

export interface ReporterOptions {
  color: boolean;
  json: boolean;
}

export function renderReport(report: VerificationReport, options: ReporterOptions): string {
  if (options.json) {
    return `${JSON.stringify(report.decision, null, 2)}\n`;
  }
  const c = options.color ? paint : plain;
  const lines: string[] = [];
  const width = 40;
  const bar = "─".repeat(width);

  lines.push("");
  lines.push(c(BOLD, "AI Architecture & Engineering Guardian"));
  lines.push(c(GRAY, bar));
  lines.push("");
  lines.push(`Repository: ${report.repository}`);
  lines.push(`Commit: ${report.commit}`);
  lines.push("");

  const order = ["architecture", "dependencies", "security", "boundaries", "tests", "build"] as const;
  for (const name of order) {
    const check = report.checks.find((item) => item.name === name);
    if (!check) continue;
    lines.push(formatCheckLine(check, c));
  }

  lines.push("");
  lines.push(c(GRAY, bar));
  const decision = report.decision;
  if (decision.result === "SAFE_TO_MERGE") {
    lines.push(`${c(BOLD, "Decision:")} ${c(GREEN + BOLD, "SAFE TO MERGE")}`);
  } else {
    lines.push(`${c(BOLD, "Decision:")} ${c(RED + BOLD, "REJECTED")}`);
  }
  lines.push(`Evidence: ${countEvidenceChecks(decision)} checks`);
  lines.push(`Violations: ${decision.summary.violation_count}`);
  lines.push(`Contract: ${report.contract_hash}`);
  lines.push(`Engine: ${report.engine_version}`);
  lines.push(`Decision ID: ${decision.decision_id}`);

  if (decision.result === "REJECTED") {
    for (const finding of decision.violations) {
      lines.push("");
      lines.push(renderFinding(finding, c));
    }
  }

  lines.push("");
  return lines.join("\n");
}

function formatCheckLine(
  check: CheckResult,
  c: (code: string, text: string) => string,
): string {
  const label = pad(titleCase(check.name), 20);
  const status = statusColor(check.status, c);
  return `${label}${status}`;
}

function statusColor(
  status: CheckResult["status"],
  c: (code: string, text: string) => string,
): string {
  switch (status) {
    case "PASS":
      return c(GREEN + BOLD, "PASS");
    case "FAIL":
      return c(RED + BOLD, "FAIL");
    case "ERROR":
      return c(RED + BOLD, "ERROR");
    case "WARN":
      return c(YELLOW + BOLD, "WARN");
    case "SKIP":
      return c(GRAY, "SKIP");
  }
}

function renderFinding(
  finding: Finding,
  c: (code: string, text: string) => string,
): string {
  const header = `${c(RED + BOLD, `[${finding.id}]`)}\n${finding.message}`;
  const body: string[] = [header];
  if (finding.file) {
    const loc = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    body.push(`File:\n  ${c(CYAN, loc)}`);
  }
  if (finding.expected) body.push(`Expected:\n  ${finding.expected}`);
  if (finding.actual) body.push(`Actual:\n  ${c(DIM, finding.actual)}`);
  if (finding.repair) body.push(`Repair suggestion:\n  ${finding.repair}`);
  return body.join("\n");
}

export function renderGithub(report: VerificationReport): string {
  const lines: string[] = [];
  for (const finding of report.decision.violations) {
    if (!finding.file) continue;
    const loc = finding.line ? `,line=${finding.line}` : "";
    const text = `[${finding.id}] ${finding.message}`.replace(/\n/g, " ");
    lines.push(`::error file=${finding.file}${loc}::${text}`);
  }
  return lines.join("\n");
}

export function renderGithubSummary(report: VerificationReport): string {
  const decision = report.decision;
  const rows = report.checks
    .map((check) => `| ${titleCase(check.name)} | ${check.status} | ${check.findings.length} |`)
    .join("\n");
  return [
    `# AI Architecture & Engineering Guardian`,
    "",
    `**Decision:** \`${decision.result}\``,
    "",
    `| Check | Status | Findings |`,
    `| --- | --- | --- |`,
    rows,
    "",
    `- Repository: \`${report.repository}\``,
    `- Commit: \`${report.commit}\``,
    `- Contract: \`${report.contract_hash}\``,
    `- Decision ID: \`${decision.decision_id}\``,
    `- Evidence hash: \`${decision.evidence_hash}\``,
  ].join("\n");
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function pad(value: string, width: number): string {
  return value.length >= width ? `${value} ` : value + " ".repeat(width - value.length);
}

function paint(code: string, text: string): string {
  return `${code}${text}${RESET}`;
}

function plain(_code: string, text: string): string {
  return text;
}
