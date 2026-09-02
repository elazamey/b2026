import { readFileSync } from "node:fs";

export interface GithubPullRequest {
  number: number;
  url: string;
  head_sha: string;
  head_ref: string;
  base_ref: string;
}

export interface GithubContext {
  token: string | null;
  apiUrl: string;
  serverUrl: string;
  repository: string;
  owner: string;
  repo: string;
  eventName: string;
  sha: string;
  ref: string;
  actor: string | null;
  runId: string | null;
  runUrl: string | null;
  inActions: boolean;
  pullRequest: GithubPullRequest | null;
}

export interface GithubContextOverrides {
  token?: string;
  pullRequest?: number;
  repository?: string;
}

export function readGithubContext(
  env: NodeJS.ProcessEnv = process.env,
  overrides: GithubContextOverrides = {},
): GithubContext | null {
  const token = overrides.token ?? env.GITHUB_TOKEN ?? env.GH_TOKEN ?? null;
  const inActions = env.GITHUB_ACTIONS === "true";
  const repository = overrides.repository ?? env.GITHUB_REPOSITORY ?? "";
  const eventName = env.GITHUB_EVENT_NAME ?? "";
  const sha = env.GITHUB_SHA ?? "";
  const hasSignal = inActions || Boolean(token) || Boolean(overrides.pullRequest);

  if (!hasSignal) {
    return null;
  }

  const [owner, repo] = splitRepo(repository);
  const serverUrl = (env.GITHUB_SERVER_URL ?? "https://github.com").replace(/\/$/, "");
  const apiUrl = (env.GITHUB_API_URL ?? "https://api.github.com").replace(/\/$/, "");
  const runId = env.GITHUB_RUN_ID ?? null;
  const runUrl =
    runId && owner && repo ? `${serverUrl}/${owner}/${repo}/actions/runs/${runId}` : null;

  const fromEvent = parseEventPullRequest(env.GITHUB_EVENT_PATH, serverUrl);
  const pullRequest =
    overrides.pullRequest != null
      ? {
          number: overrides.pullRequest,
          url: owner && repo ? `${serverUrl}/${owner}/${repo}/pull/${overrides.pullRequest}` : "",
          head_sha: fromEvent?.head_sha ?? sha,
          head_ref: fromEvent?.head_ref ?? env.GITHUB_HEAD_REF ?? "",
          base_ref: fromEvent?.base_ref ?? env.GITHUB_BASE_REF ?? "",
        }
      : fromEvent;

  return {
    token,
    apiUrl,
    serverUrl,
    repository: repository || "unknown",
    owner,
    repo,
    eventName,
    sha,
    ref: env.GITHUB_REF ?? "",
    actor: env.GITHUB_ACTOR ?? null,
    runId,
    runUrl,
    inActions,
    pullRequest,
  };
}

export function isPullRequestEvent(context: GithubContext): boolean {
  return (
    context.pullRequest != null &&
    (context.eventName === "pull_request" ||
      context.eventName === "pull_request_target" ||
      context.eventName === "")
  );
}

function nonempty(value: string | undefined | null): string | null {
  return value && value.trim().length > 0 ? value : null;
}

function splitRepo(repository: string): [string, string] {
  const [owner, repo] = repository.split("/");
  return [owner ?? "", repo ?? ""];
}

function parseEventPullRequest(
  eventPath: string | undefined,
  serverUrl: string,
): GithubPullRequest | null {
  if (!eventPath) return null;
  try {
    const raw = JSON.parse(readFileSync(eventPath, "utf8")) as {
      pull_request?: {
        number?: number;
        html_url?: string;
        head?: { sha?: string; ref?: string };
        base?: { ref?: string };
      };
      number?: number;
    };
    const pr = raw.pull_request;
    const number = pr?.number ?? raw.number;
    if (!number) return null;
    return {
      number,
      url: pr?.html_url ?? `${serverUrl}`,
      head_sha: pr?.head?.sha ?? "",
      head_ref: pr?.head?.ref ?? "",
      base_ref: pr?.base?.ref ?? "",
    };
  } catch {
    return null;
  }
}
