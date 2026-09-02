import { dirname, extname, normalize, resolve } from "node:path";
import type { CheckResult, Finding, ScanContext } from "../types.js";
import { isSourceFile, readText, rel, toPosix } from "../util/files.js";

const IMPORT_RE =
  /(?:(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?from\s*)?|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g;

export function scanBoundaries(ctx: ScanContext): CheckResult {
  const started = Date.now();
  const findings: Finding[] = [];
  const layers = ctx.contract.boundaries;
  const layerNames = Object.keys(layers);

  if (layerNames.length === 0) {
    return {
      name: "boundaries",
      status: "SKIP",
      findings: [],
      evidence: {
        reason: "no boundary layers defined",
        files_scanned: 0,
        violations: 0,
      },
      duration_ms: Date.now() - started,
    };
  }

  let filesScanned = 0;
  const importCount = { total: 0, checked: 0 };

  for (const file of ctx.files) {
    if (!isSourceFile(file)) continue;
    const relative = rel(ctx.root, file);
    const layerName = layerOf(relative, layers);
    if (!layerName) continue;
    const layer = layers[layerName];
    if (!layer || layer.forbidden_imports.length === 0) continue;

    let content: string;
    try {
      content = readText(file);
    } catch {
      continue;
    }
    filesScanned += 1;

    IMPORT_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = IMPORT_RE.exec(content)) !== null) {
      const specifier = match[1];
      if (!specifier) continue;
      importCount.total += 1;
      if (specifier.startsWith("node:") || !isPathSpecifier(specifier)) {
        continue;
      }
      const resolved = resolveImport(ctx.root, file, specifier);
      if (!resolved) continue;
      importCount.checked += 1;
      const hit = layer.forbidden_imports.find((forbidden) =>
        isPrefix(resolved, forbidden),
      );
      if (!hit) continue;
      const line = content.slice(0, match.index).split("\n").length;
      findings.push({
        id: "BND-001",
        rule: `boundaries.${layerName}.forbidden_imports`,
        severity: "error",
        message: `Forbidden ${layerName} import of "${hit}"`,
        file: relative,
        line,
        expected: `${layerName} layer must not import ${hit}`,
        actual: specifier,
        repair: `Move data access behind an approved API/server boundary. Do not import "${hit}" from ${relative}.`,
      });
    }
  }

  return {
    name: "boundaries",
    status: findings.length > 0 ? "FAIL" : "PASS",
    findings,
    evidence: {
      files_scanned: filesScanned,
      layers: layerNames,
      imports_seen: importCount.total,
      imports_resolved: importCount.checked,
      violations: findings.length,
    },
    duration_ms: Date.now() - started,
  };
}

function layerOf(
  relativePath: string,
  layers: ScanContext["contract"]["boundaries"],
): string | null {
  for (const [name, layer] of Object.entries(layers)) {
    if (layer.paths.some((path) => isPrefix(relativePath, path))) {
      return name;
    }
  }
  return null;
}

function isPathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith(".") ||
    specifier.startsWith("/") ||
    specifier.startsWith("@/") ||
    specifier.startsWith("src/")
  );
}

function resolveImport(
  root: string,
  fromFile: string,
  specifier: string,
): string | null {
  let absolute: string;
  if (specifier.startsWith("@/")) {
    absolute = resolve(root, "src", specifier.slice(2));
  } else if (specifier.startsWith("src/")) {
    absolute = resolve(root, specifier);
  } else if (specifier.startsWith(".")) {
    absolute = resolve(dirname(fromFile), specifier);
  } else if (specifier.startsWith("/")) {
    absolute = resolve(root, specifier.slice(1));
  } else {
    return null;
  }
  const withoutExt = stripKnownExt(absolute);
  return toPosix(withoutExt.slice(resolve(root).length + 1));
}

function stripKnownExt(file: string): string {
  const ext = extname(file);
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"].includes(ext)) {
    return file.slice(0, -ext.length);
  }
  return file;
}

function isPrefix(path: string, prefix: string): boolean {
  const a = normalizePosix(path);
  const b = normalizePosix(prefix);
  return a === b || a.startsWith(`${b}/`);
}

function normalizePosix(path: string): string {
  return toPosix(normalize(path)).replace(/^\.\/+/, "").replace(/\/+$/, "");
}
