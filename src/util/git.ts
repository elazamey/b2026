import { execFileSync } from "node:child_process";

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function detectCommit(root: string): string {
  return git(root, ["rev-parse", "--short=7", "HEAD"]) ?? "unknown";
}

export function detectCommitSha(root: string): string | undefined {
  return git(root, ["rev-parse", "HEAD"]) ?? undefined;
}

export function detectBranch(root: string): string | undefined {
  return git(root, ["rev-parse", "--abbrev-ref", "HEAD"]) ?? undefined;
}

export function detectRepository(root: string): string {
  const remote = git(root, ["config", "--get", "remote.origin.url"]);
  if (remote) {
    return normalizeRemote(remote);
  }
  const name = git(root, ["rev-parse", "--show-toplevel"]);
  if (name) {
    const parts = name.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] ?? "unknown";
  }
  return "unknown";
}

function normalizeRemote(remote: string): string {
  const trimmed = remote.replace(/\.git$/, "");
  const ssh = trimmed.match(/^git@[^:]+:(.+)$/);
  if (ssh?.[1]) return ssh[1];
  const https = trimmed.match(/https?:\/\/[^/]+\/(.+)$/);
  if (https?.[1]) return https[1];
  return trimmed;
}
