import type { CheckResult, Finding, ScanContext } from "../types.js";
import { isDirectory, pathExists } from "../util/files.js";

export function scanArchitecture(ctx: ScanContext): CheckResult {
  const started = Date.now();
  const findings: Finding[] = [];
  const { required_paths, forbidden_paths } = ctx.contract.architecture;
  const missing: string[] = [];
  const presentForbidden: string[] = [];

  for (const required of required_paths) {
    if (!pathExists(ctx.root, required)) {
      missing.push(required);
      findings.push({
        id: "ARCH-001",
        rule: "architecture.required_paths",
        severity: "error",
        message: `Required path is missing: ${required}`,
        expected: `Path "${required}" must exist`,
        actual: "not found",
        repair: `Create the required path "${required}" as defined by the architecture contract.`,
      });
    }
  }

  for (const forbidden of forbidden_paths) {
    if (pathExists(ctx.root, forbidden)) {
      presentForbidden.push(forbidden);
      findings.push({
        id: "ARCH-002",
        rule: "architecture.forbidden_paths",
        severity: "error",
        message: `Forbidden path is present: ${forbidden}`,
        expected: `Path "${forbidden}" must not exist`,
        actual: isDirectory(ctx.root, forbidden) ? "directory exists" : "file exists",
        repair: `Remove "${forbidden}" or move it outside the approved architecture.`,
      });
    }
  }

  const status = findings.length > 0 ? "FAIL" : "PASS";
  return {
    name: "architecture",
    status,
    findings,
    evidence: {
      files_scanned: 0,
      required_paths: required_paths.length,
      forbidden_paths: forbidden_paths.length,
      missing_required: missing,
      present_forbidden: presentForbidden,
      violations: findings.length,
    },
    duration_ms: Date.now() - started,
  };
}
