import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

export const DEFAULT_IGNORE = [
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".next",
  ".turbo",
  ".venv",
  ".cache",
  ".guardian",
  "__pycache__",
  ".output",
  "build",
];

export const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

export const TEXT_EXTENSIONS = new Set([
  ...SOURCE_EXTENSIONS,
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".env",
  ".toml",
  ".txt",
  ".css",
  ".scss",
  ".html",
]);

export function toPosix(path: string): string {
  return path.split(sep).join("/");
}

export function rel(root: string, file: string): string {
  return toPosix(relative(root, file));
}

export function isIgnored(relPath: string, ignore: string[]): boolean {
  const posix = toPosix(relPath);
  return ignore.some((rule) => {
    const normalized = rule.replace(/^\.\//, "").replace(/\/$/, "");
    if (posix === normalized) return true;
    if (posix.startsWith(`${normalized}/`)) return true;
    const segments = posix.split("/");
    return segments.includes(normalized);
  });
}

export function walkFiles(root: string, ignore: string[]): string[] {
  const results: string[] = [];

  function visit(dir: string): void {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      const relativePath = rel(root, full);
      if (isIgnored(relativePath, ignore) || isIgnored(entry.name, ignore)) {
        continue;
      }
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (entry.isFile()) {
        results.push(full);
      }
    }
  }

  visit(root);
  return results;
}

export function readText(file: string): string {
  return readFileSync(file, "utf8");
}

export function pathExists(root: string, path: string): boolean {
  return existsSync(resolve(root, path));
}

export function isDirectory(root: string, path: string): boolean {
  try {
    return statSync(resolve(root, path)).isDirectory();
  } catch {
    return false;
  }
}

export function isSourceFile(file: string): boolean {
  return SOURCE_EXTENSIONS.has(extname(file).toLowerCase());
}

export function isTextFile(file: string): boolean {
  const ext = extname(file).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = file.split(/[/\\]/).pop() ?? "";
  return base.startsWith(".env") || base === "Dockerfile";
}

export function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}
