export const COMMENT_MARKER = "<!-- ai-guardian-decision -->";

export interface GithubComment {
  id: number;
  body: string;
  html_url: string;
}

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "GithubApiError";
  }
}

export interface GithubCheckRun {
  id: number;
  html_url: string;
  name: string;
  conclusion: string;
}

export interface GithubClient {
  listIssueComments(issue: number): Promise<GithubComment[]>;
  createIssueComment(issue: number, body: string): Promise<GithubComment>;
  updateComment(commentId: number, body: string): Promise<GithubComment>;
  createCheckRun(input: {
    name: string;
    head_sha: string;
    conclusion: "success" | "failure";
    title: string;
    summary: string;
  }): Promise<GithubCheckRun>;
}

export function createGithubClient(options: {
  token: string;
  owner: string;
  repo: string;
  apiUrl?: string;
  fetch?: FetchLike;
}): GithubClient {
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const base = `${apiUrl}/repos/${options.owner}/${options.repo}`;
  const fetchFn = options.fetch ?? (globalThis.fetch as FetchLike);

  async function request(path: string, init: { method?: string; body?: string } = {}) {
    const response = await fetchFn(`${base}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${options.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "ai-guardian",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new GithubApiError(
        `GitHub API ${init.method ?? "GET"} ${path} failed (${response.status})`,
        response.status,
        text.slice(0, 500),
      );
    }
    return text ? (JSON.parse(text) as unknown) : null;
  }

  return {
    async listIssueComments(issue: number): Promise<GithubComment[]> {
      const data = await request(`/issues/${issue}/comments?per_page=100`);
      return asComments(data);
    },
    async createIssueComment(issue: number, body: string): Promise<GithubComment> {
      const data = await request(`/issues/${issue}/comments`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      return asComment(data);
    },
    async updateComment(commentId: number, body: string): Promise<GithubComment> {
      const data = await request(`/issues/comments/${commentId}`, {
        method: "PATCH",
        body: JSON.stringify({ body }),
      });
      return asComment(data);
    },
    async createCheckRun(input): Promise<GithubCheckRun> {
      const data = await request(`/check-runs`, {
        method: "POST",
        body: JSON.stringify({
          name: input.name,
          head_sha: input.head_sha,
          status: "completed",
          conclusion: input.conclusion,
          output: {
            title: input.title,
            summary: input.summary.slice(0, 65535),
          },
        }),
      });
      return asCheckRun(data);
    },
  };
}

export async function upsertDecisionComment(
  client: GithubClient,
  issue: number,
  body: string,
): Promise<{ comment: GithubComment; updated: boolean }> {
  const comments = await client.listIssueComments(issue);
  const existing = comments.find((comment) => comment.body.includes(COMMENT_MARKER));
  if (existing) {
    const comment = await client.updateComment(existing.id, body);
    return { comment, updated: true };
  }
  const comment = await client.createIssueComment(issue, body);
  return { comment, updated: false };
}

function asComments(data: unknown): GithubComment[] {
  if (!Array.isArray(data)) return [];
  return data.map(asComment);
}

function asComment(data: unknown): GithubComment {
  const record = (data ?? {}) as { id?: number; body?: string; html_url?: string };
  return {
    id: Number(record.id ?? 0),
    body: String(record.body ?? ""),
    html_url: String(record.html_url ?? ""),
  };
}

function asCheckRun(data: unknown): GithubCheckRun {
  const record = (data ?? {}) as {
    id?: number;
    html_url?: string;
    name?: string;
    conclusion?: string;
  };
  return {
    id: Number(record.id ?? 0),
    html_url: String(record.html_url ?? ""),
    name: String(record.name ?? ""),
    conclusion: String(record.conclusion ?? ""),
  };
}
