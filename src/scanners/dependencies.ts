import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CheckResult, Finding, ScanContext } from "../types.js";

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

export function scanDependencies(ctx: ScanContext): CheckResult {
  const started = Date.now();
  const findings: Finding[] = [];
  const pkgPath = resolve(ctx.root, "package.json");

  if (!existsSync(pkgPath)) {
    return {
      name: "dependencies",
      status: "SKIP",
      findings: [],
      evidence: {
        reason: "no package.json",
        violations: 0,
      },
      duration_ms: Date.now() - started,
    };
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageJson;
  const production = {
    ...pkg.dependencies,
    ...pkg.optionalDependencies,
  };
  const all = {
    ...production,
    ...pkg.devDependencies,
    ...pkg.peerDependencies,
  };

  const forbiddenHits: string[] = [];
  const allowlistHits: string[] = [];

  for (const name of Object.keys(all)) {
    if (ctx.contract.dependencies.forbidden.includes(name)) {
      forbiddenHits.push(name);
      findings.push({
        id: "DEP-001",
        rule: "dependencies.forbidden",
        severity: "error",
        message: `Forbidden dependency detected: ${name}`,
        file: "package.json",
        expected: `Package "${name}" must not be declared`,
        actual: versionOf(all, name),
        repair: `Remove "${name}" from package.json and replace it with an approved alternative.`,
      });
    }
  }

  const allowed = ctx.contract.dependencies.allowed;
  if (allowed) {
    for (const name of Object.keys(production)) {
      if (!allowed.includes(name) && !ctx.contract.dependencies.forbidden.includes(name)) {
        allowlistHits.push(name);
        findings.push({
          id: "DEP-002",
          rule: "dependencies.allowed",
          severity: "error",
          message: `Dependency is not on the allowlist: ${name}`,
          file: "package.json",
          expected: `Only ${allowed.join(", ") || "(empty allowlist)"}`,
          actual: name,
          repair: `Remove "${name}" or add it to dependencies.allowed in architecture.yaml after review.`,
        });
      }
    }
  }

  return {
    name: "dependencies",
    status: findings.length > 0 ? "FAIL" : "PASS",
    findings,
    evidence: {
      files_scanned: 1,
      production_count: Object.keys(production).length,
      total_declared: Object.keys(all).length,
      allowlist: allowed,
      forbidden_hits: forbiddenHits,
      allowlist_violations: allowlistHits,
      violations: findings.length,
    },
    duration_ms: Date.now() - started,
  };
}

function versionOf(deps: Record<string, string>, name: string): string {
  return deps[name] ?? "declared";
}
