import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import type {
  ArchitectureContract,
  BoundaryLayer,
  CheckName,
  ProjectType,
} from "../types.js";
import { canonicalJson, sha256Prefixed } from "../util/hash.js";
import { DEFAULT_IGNORE } from "../util/files.js";

export const CONTRACT_FILENAMES = [
  "architecture.yaml",
  "architecture.yml",
  ".guardian/architecture.yaml",
];

const CHECK_NAMES: CheckName[] = [
  "architecture",
  "dependencies",
  "security",
  "boundaries",
  "tests",
  "build",
];

export class ContractError extends Error {
  constructor(
    message: string,
    readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ContractError";
  }
}

export function findContractPath(root: string, explicit?: string): string {
  if (explicit) {
    const resolved = resolve(root, explicit);
    if (!existsSync(resolved)) {
      throw new ContractError(`Contract file not found: ${explicit}`);
    }
    return resolved;
  }
  for (const name of CONTRACT_FILENAMES) {
    const candidate = resolve(root, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new ContractError(
    "No architecture.yaml found. Run `ai-guardian init` to create a contract.",
  );
}

export function loadContract(path: string): ArchitectureContract {
  const raw = readFileSync(path, "utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (error) {
    throw new ContractError(
      `Invalid YAML in contract: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return validateContract(parsed);
}

export function contractHash(contract: ArchitectureContract): string {
  return sha256Prefixed(canonicalJson(contract));
}

export function validateContract(input: unknown): ArchitectureContract {
  if (!isRecord(input)) {
    throw new ContractError("Contract must be a YAML object.");
  }
  const issues: string[] = [];

  const version = asString(input.version);
  if (version !== "1") {
    issues.push(`version must be "1", got ${JSON.stringify(input.version)}`);
  }

  const projectRaw = isRecord(input.project) ? input.project : {};
  const projectType = normalizeProjectType(projectRaw.type);
  if (!projectType) {
    issues.push('project.type must be one of "nextjs", "node", "generic"');
  }

  const architectureRaw = isRecord(input.architecture) ? input.architecture : {};
  if (architectureRaw.required_paths != null && !Array.isArray(architectureRaw.required_paths)) {
    issues.push("architecture.required_paths must be an array of paths");
  }
  if (architectureRaw.forbidden_paths != null && !Array.isArray(architectureRaw.forbidden_paths)) {
    issues.push("architecture.forbidden_paths must be an array of paths");
  }
  const requiredPaths = asStringArray(architectureRaw.required_paths);
  const forbiddenPaths = asStringArray(architectureRaw.forbidden_paths);

  const depsRaw = isRecord(input.dependencies) ? input.dependencies : {};
  const allowed = depsRaw.allowed == null ? null : asStringArray(depsRaw.allowed);
  if (depsRaw.allowed != null && !Array.isArray(depsRaw.allowed)) {
    issues.push("dependencies.allowed must be an array or null");
  }
  const forbiddenDeps = asStringArray(depsRaw.forbidden);

  const securityRaw = isRecord(input.security) ? input.security : {};
  const secretsRaw = isRecord(securityRaw.secrets) ? securityRaw.secrets : {};
  const dangerous = asStringArray(securityRaw.dangerous_patterns);
  const securityIgnore = asStringArray(securityRaw.ignore_paths);

  const qualityRaw = isRecord(input.quality) ? input.quality : {};
  const commandsRaw = isRecord(qualityRaw.commands) ? qualityRaw.commands : {};

  const scanRaw = isRecord(input.scan) ? input.scan : {};
  const scanIgnore = unique([
    ...DEFAULT_IGNORE,
    ...asStringArray(scanRaw.ignore),
  ]);

  const mergeRaw = isRecord(input.merge) ? input.merge : {};
  const requireChecks = asStringArray(mergeRaw.require).filter((name): name is CheckName =>
    CHECK_NAMES.includes(name as CheckName),
  );
  if (Array.isArray(mergeRaw.require)) {
    for (const name of mergeRaw.require) {
      if (!CHECK_NAMES.includes(name as CheckName)) {
        issues.push(`merge.require contains unknown check "${String(name)}"`);
      }
    }
  }

  if (issues.length > 0) {
    throw new ContractError("Contract failed schema validation.", issues);
  }

  const contract: ArchitectureContract = {
    version: "1",
    project: {
      name: asOptionalString(projectRaw.name),
      type: projectType ?? "generic",
    },
    architecture: {
      required_paths: requiredPaths,
      forbidden_paths: forbiddenPaths,
    },
    dependencies: {
      allowed,
      forbidden: forbiddenDeps,
    },
    security: {
      secrets: {
        forbid_in_source: secretsRaw.forbid_in_source !== false,
      },
      dangerous_patterns:
        dangerous.length > 0
          ? dangerous
          : [
              "hardcoded_credentials",
              "dynamic_code_execution",
              "unsafe_child_process",
            ],
      ignore_paths: securityIgnore,
    },
    boundaries: normalizeBoundaries(input.boundaries, projectType ?? "generic"),
    quality: {
      tests_required: qualityRaw.tests_required === true,
      typecheck_required: qualityRaw.typecheck_required === true,
      build_required: qualityRaw.build_required === true,
      commands: {
        test: asOptionalString(commandsRaw.test),
        typecheck: asOptionalString(commandsRaw.typecheck),
        build: asOptionalString(commandsRaw.build),
      },
    },
    scan: {
      ignore: scanIgnore,
      include_globs: asStringArray(scanRaw.include_globs),
    },
    merge: {
      require:
        requireChecks.length > 0
          ? requireChecks
          : ["architecture", "dependencies", "security", "boundaries"],
    },
  };

  return contract;
}

function normalizeBoundaries(
  raw: unknown,
  projectType: ProjectType,
): Record<string, BoundaryLayer> {
  if (!isRecord(raw) || Object.keys(raw).length === 0) {
    return defaultBoundaries(projectType);
  }
  const layers: Record<string, BoundaryLayer> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isRecord(value)) continue;
    layers[name] = {
      paths: asStringArray(value.paths).length
        ? asStringArray(value.paths)
        : defaultLayerPaths(name, projectType),
      forbidden_imports: asStringArray(value.forbidden_imports),
    };
  }
  return layers;
}

function defaultBoundaries(type: ProjectType): Record<string, BoundaryLayer> {
  if (type === "nextjs") {
    return {
      client: {
        paths: ["src/app", "src/components", "app", "components"],
        forbidden_imports: ["src/server", "src/lib/db", "src/lib/server"],
      },
      server: {
        paths: ["src/server", "src/lib/server"],
        forbidden_imports: ["src/app/client-only"],
      },
    };
  }
  return {};
}

function defaultLayerPaths(name: string, type: ProjectType): string[] {
  if (type === "nextjs" && name === "client") {
    return ["src/app", "src/components", "app", "components"];
  }
  if (type === "nextjs" && name === "server") {
    return ["src/server", "src/lib/server"];
  }
  if (name === "client") return ["src/components", "src/app"];
  if (name === "server") return ["src/server"];
  return [];
}

function normalizeProjectType(value: unknown): ProjectType | null {
  if (value == null) return "generic";
  if (value === "nextjs" || value === "node" || value === "generic") return value;
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
