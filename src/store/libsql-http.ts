import { libsqlArg, type SqlExecutor, type SqlResult, type SqlRow, type SqlValue } from "./sql.js";

export type FetchLike = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
}>;

export class LibsqlHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "LibsqlHttpError";
  }
}

export class LibsqlHttpClient implements SqlExecutor {
  private readonly url: string;
  private readonly token: string;
  private readonly fetchFn: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: {
    url: string;
    token: string;
    fetch?: FetchLike;
    timeoutMs?: number;
  }) {
    this.url = normalizeLibsqlUrl(options.url);
    this.token = options.token;
    this.fetchFn = options.fetch ?? (globalThis.fetch as FetchLike);
    this.timeoutMs = options.timeoutMs ?? 2500;
  }

  async execute(sql: string, args: SqlValue[] = []): Promise<SqlResult> {
    const response = await this.fetchFn(`${this.url}/v2/pipeline`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        requests: [
          {
            type: "execute",
            stmt: {
              sql,
              args: args.map(libsqlArg),
            },
          },
          { type: "close" },
        ],
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new LibsqlHttpError(
        `Turso HTTP ${response.status}`,
        response.status,
      );
    }
    return parsePipeline(text);
  }
}

export function normalizeLibsqlUrl(url: string): string {
  return url
    .replace(/^libsql:\/\//, "https://")
    .replace(/\/$/, "");
}

function parsePipeline(text: string): SqlResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new LibsqlHttpError("Turso returned invalid JSON", 0);
  }
  const root = parsed as {
    results?: Array<{
      type?: string;
      error?: { message?: string };
      response?: {
        result?: {
          cols?: Array<{ name?: string }>;
          rows?: Array<Array<{ type?: string; value?: string | number | null }>>;
          affected_row_count?: number;
        };
      };
    }>;
  };
  const first = root.results?.[0];
  if (first?.type === "error") {
    throw new LibsqlHttpError(first.error?.message ?? "Turso execute failed", 0);
  }
  const result = first?.response?.result;
  const cols = (result?.cols ?? []).map((col) => col.name ?? "");
  const rows: SqlRow[] = (result?.rows ?? []).map((row) => {
    const record: SqlRow = {};
    cols.forEach((name, index) => {
      const cell = row[index];
      record[name] = cell?.value ?? null;
    });
    return record;
  });
  return { rows, affected: result?.affected_row_count ?? 0 };
}
