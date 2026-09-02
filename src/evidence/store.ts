import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EvidenceManifest } from "./types.js";

export function defaultEvidenceDir(root: string): string {
  return resolve(root, ".guardian", "evidence");
}

export function defaultManifestPath(root: string): string {
  return resolve(defaultEvidenceDir(root), "evidence_manifest.json");
}

export function writeEvidenceManifest(root: string, manifest: EvidenceManifest): string {
  const dir = defaultEvidenceDir(root);
  mkdirSync(dir, { recursive: true });
  const latest = defaultManifestPath(root);
  const named = resolve(dir, `${manifest.decision_id}.json`);
  const body = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(latest, body, "utf8");
  writeFileSync(named, body, "utf8");
  return latest;
}

export function readEvidenceManifest(root: string, decisionId?: string): EvidenceManifest | null {
  const path = decisionId
    ? resolve(defaultEvidenceDir(root), `${decisionId}.json`)
    : defaultManifestPath(root);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as EvidenceManifest;
  } catch {
    return null;
  }
}
