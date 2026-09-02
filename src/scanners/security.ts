import type { CheckResult, Finding, ScanContext } from "../types.js";
import { isIgnored, isTextFile, lineNumberAt, readText, rel } from "../util/files.js";

interface PatternRule {
  id: string;
  rule: string;
  category: string;
  message: string;
  repair: string;
  regex: RegExp;
}

function rules(): PatternRule[] {
  const begin = ["BEGIN", " ", "PRIVATE", " ", "KEY"].join("");
  return [
    {
      id: "SEC-001",
      rule: "security.secrets.forbid_in_source",
      category: "hardcoded_credentials",
      message: "Hardcoded AWS access key id",
      repair: "Move credentials to a secret store or environment variables. Never commit keys.",
      regex: /\bAKIA[0-9A-Z]{16}\b/g,
    },
    {
      id: "SEC-001",
      rule: "security.secrets.forbid_in_source",
      category: "hardcoded_credentials",
      message: "PEM private key material in source",
      repair: "Remove private keys from the repository and load them from a secret store.",
      regex: new RegExp(`-----${begin}-----`, "g"),
    },
    {
      id: "SEC-001",
      rule: "security.secrets.forbid_in_source",
      category: "hardcoded_credentials",
      message: "GitHub token in source",
      repair: "Revoke the token and store it in GitHub Secrets or a secret manager.",
      regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/g,
    },
    {
      id: "SEC-001",
      rule: "security.secrets.forbid_in_source",
      category: "hardcoded_credentials",
      message: "Stripe live secret key in source",
      repair: "Revoke the key and inject it via environment variables.",
      regex: /\bsk_live_[A-Za-z0-9]{10,}\b/g,
    },
    {
      id: "SEC-001",
      rule: "security.secrets.forbid_in_source",
      category: "hardcoded_credentials",
      message: "OpenAI-style secret key in source",
      repair: "Revoke the key and load it from the environment.",
      regex: /\bsk-[A-Za-z0-9_-]{20,}\b/g,
    },
    {
      id: "SEC-001",
      rule: "security.secrets.forbid_in_source",
      category: "hardcoded_credentials",
      message: "Hardcoded credential assignment",
      repair: "Replace the hardcoded secret with a process.env lookup or secret manager call.",
      regex:
        /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token)\s*[:=]\s*['"][^'"]{8,}['"]/gi,
    },
    {
      id: "SEC-002",
      rule: "security.dangerous_patterns",
      category: "dynamic_code_execution",
      message: "Dynamic code execution",
      repair: "Remove eval/Function/vm usage. Use explicit parsers or typed configuration instead.",
      regex: /\beval\s*\(|new\s+Function\s*\(|\bvm\.runIn(?:New)?Context\s*\(/g,
    },
    {
      id: "SEC-003",
      rule: "security.dangerous_patterns",
      category: "unsafe_child_process",
      message: "Unsafe child_process invocation",
      repair: "Avoid shell interpolation. Prefer execFile/spawn with a fixed argument array.",
      regex:
        /\b(?:exec|execSync|execFile|execFileSync)\s*\(\s*[`'"].*\$\{|(?:exec|execSync)\s*\(\s*[`'"][^`'"]*\$\{/g,
    },
  ];
}

export function scanSecurity(ctx: ScanContext): CheckResult {
  const started = Date.now();
  const findings: Finding[] = [];
  const enabled = new Set(ctx.contract.security.dangerous_patterns);
  const ignore = [
    ...ctx.contract.scan.ignore,
    ...ctx.contract.security.ignore_paths,
  ];
  const activeRules = rules().filter((rule) => {
    if (rule.category === "hardcoded_credentials") {
      return ctx.contract.security.secrets.forbid_in_source;
    }
    return enabled.has(rule.category);
  });

  let filesScanned = 0;
  for (const file of ctx.files) {
    const relative = rel(ctx.root, file);
    if (isIgnored(relative, ignore) || !isTextFile(file)) continue;
    if (relative === "architecture.yaml" || relative.endsWith("/architecture.yaml")) {
      continue;
    }
    let content: string;
    try {
      content = readText(file);
    } catch {
      continue;
    }
    filesScanned += 1;
    if (content.includes("guardian-ignore-file")) continue;

    for (const rule of activeRules) {
      rule.regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.regex.exec(content)) !== null) {
        const around = content.slice(Math.max(0, match.index - 80), match.index);
        if (around.includes("guardian-ignore") || around.includes("guardian-allow")) {
          continue;
        }
        const line = lineNumberAt(content, match.index);
        findings.push({
          id: rule.id,
          rule: rule.rule,
          severity: "error",
          message: rule.message,
          file: relative,
          line,
          actual: snippet(content, match.index),
          repair: rule.repair,
        });
        if (rule.regex.lastIndex === match.index) {
          rule.regex.lastIndex += 1;
        }
      }
    }
  }

  return {
    name: "security",
    status: findings.length > 0 ? "FAIL" : "PASS",
    findings,
    evidence: {
      files_scanned: filesScanned,
      patterns_enabled: [...enabled],
      secrets_forbidden: ctx.contract.security.secrets.forbid_in_source,
      violations: findings.length,
    },
    duration_ms: Date.now() - started,
  };
}

function snippet(content: string, index: number): string {
  const line = content.split("\n")[lineNumberAt(content, index) - 1] ?? "";
  return line.trim().slice(0, 120);
}
