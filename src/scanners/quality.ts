import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { CheckResult, Finding, ScanContext } from "../types.js";
import { rel } from "../util/files.js";

const TEST_FILE_RE = /\.(test|spec)\.(t|j)sx?$/;
const TEST_DIR_RE = /(^|\/)(__tests__|tests|test)(\/|$)/;

export function scanTests(ctx: ScanContext): CheckResult {
  const started = Date.now();
  if (!ctx.contract.quality.tests_required) {
    return skipped("tests", "quality.tests_required is false", started);
  }

  const findings: Finding[] = [];
  const testFiles = ctx.files
    .map((file) => rel(ctx.root, file))
    .filter((file) => TEST_FILE_RE.test(file) || TEST_DIR_RE.test(file));

  if (testFiles.length === 0) {
    findings.push({
      id: "QUAL-001",
      rule: "quality.tests_required",
      severity: "error",
      message: "No test files found",
      expected: "At least one test/spec file",
      actual: "0 test files",
      repair: "Add tests covering the changed architecture before merge.",
    });
  }

  const command = ctx.contract.quality.commands.test;
  if (command && testFiles.length > 0) {
    const result = runCommand(ctx.root, command);
    if (result.status !== 0) {
      findings.push({
        id: "QUAL-001",
        rule: "quality.tests_required",
        severity: "error",
        message: `Test command failed: ${command}`,
        actual: result.output.slice(0, 500),
        repair: "Fix failing tests. The Guardian will not mark the change SAFE TO MERGE while tests fail.",
      });
    }
  }

  return {
    name: "tests",
    status: findings.length > 0 ? "FAIL" : "PASS",
    findings,
    evidence: {
      files_scanned: testFiles.length,
      test_files: testFiles.slice(0, 50),
      command: command ?? null,
      violations: findings.length,
    },
    duration_ms: Date.now() - started,
  };
}

export function scanBuild(ctx: ScanContext): CheckResult {
  const started = Date.now();
  const { typecheck_required, build_required, commands } = ctx.contract.quality;
  if (!typecheck_required && !build_required) {
    return skipped("build", "quality.typecheck_required and build_required are false", started);
  }

  const findings: Finding[] = [];
  const ran: string[] = [];

  if (typecheck_required) {
    const command =
      commands.typecheck ??
      (existsSync(resolve(ctx.root, "tsconfig.json")) ? "npx tsc --noEmit" : null);
    if (!command) {
      findings.push({
        id: "QUAL-002",
        rule: "quality.typecheck_required",
        severity: "error",
        message: "Typecheck required but no tsconfig.json or quality.commands.typecheck was found",
        repair: "Add tsconfig.json or set quality.commands.typecheck in architecture.yaml.",
      });
    } else {
      ran.push(command);
      const result = runCommand(ctx.root, command);
      if (result.status !== 0) {
        findings.push({
          id: "QUAL-002",
          rule: "quality.typecheck_required",
          severity: "error",
          message: `Typecheck failed: ${command}`,
          actual: result.output.slice(0, 800),
          repair: "Fix type errors. merge.require includes build/typecheck.",
        });
      }
    }
  }

  if (build_required) {
    const command = commands.build;
    if (!command) {
      findings.push({
        id: "QUAL-003",
        rule: "quality.build_required",
        severity: "error",
        message: "Build required but quality.commands.build is not set",
        repair: "Set quality.commands.build to the project's build command, e.g. npm run build.",
      });
    } else {
      ran.push(command);
      const result = runCommand(ctx.root, command);
      if (result.status !== 0) {
        findings.push({
          id: "QUAL-003",
          rule: "quality.build_required",
          severity: "error",
          message: `Build failed: ${command}`,
          actual: result.output.slice(0, 800),
          repair: "Fix the build. The Guardian blocks merge while the build fails.",
        });
      }
    }
  }

  return {
    name: "build",
    status: findings.length > 0 ? "FAIL" : "PASS",
    findings,
    evidence: {
      typecheck_required,
      build_required,
      commands: ran,
      violations: findings.length,
    },
    duration_ms: Date.now() - started,
  };
}

function skipped(name: "tests" | "build", reason: string, started: number): CheckResult {
  return {
    name,
    status: "SKIP",
    findings: [],
    evidence: { reason, violations: 0 },
    duration_ms: Date.now() - started,
  };
}

function runCommand(
  cwd: string,
  command: string,
): { status: number; output: string } {
  const result = spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    timeout: 120_000,
    env: { ...process.env, GUARDIAN_CHILD: "1" },
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return { status: result.status ?? 1, output };
}
