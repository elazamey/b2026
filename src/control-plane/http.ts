import type { ControlPlaneReader } from "./types.js";
import { CONTROL_PLANE_CAPABILITIES } from "./types.js";
import { renderControlPlanePage, type ControlPlanePage } from "./html.js";

export interface PlaneRequest {
  method: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string;
}

export interface PlaneResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

const MUTATION_BLOCK =
  "Control plane cannot change Guardian decisions. Dashboard → READ. Guardian → DECIDE. GitHub → ENFORCE.";

export async function handleControlPlaneRequest(
  request: PlaneRequest,
  reader: ControlPlaneReader,
  options: { basePath?: string } = {},
): Promise<PlaneResponse> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return text(405, MUTATION_BLOCK, { Allow: "GET, HEAD" });
  }

  const url = new URL(request.url, "http://control-plane.local");
  const pathname = normalizePath(url.pathname);
  const snapshot = await reader.snapshot();
  const wantsJson = wantsJsonResponse(request.headers, url.searchParams);
  const basePath = options.basePath ?? "";

  if (pathname === "/health") {
    return json(200, {
      ok: true,
      writable: false,
      kind: snapshot.kind,
      capabilities: CONTROL_PLANE_CAPABILITIES,
    });
  }

  const page = await resolvePage(pathname, reader);
  if (wantsJson) {
    if (page.name === "not-found") return json(404, { error: "not_found" });
    if (page.name === "decision") {
      return json(page.record ? 200 : 404, {
        writable: false,
        capabilities: CONTROL_PLANE_CAPABILITIES,
        decision: page.record
          ? {
              decision_id: page.record.decision_id,
              repository: page.record.repository,
              commit_sha: page.record.commit_sha ?? page.record.commit,
              contract_hash: page.record.contract_hash,
              evidence_hash: page.record.evidence_hash,
              result: page.record.result,
              timestamp: page.record.timestamp,
              engine_version: page.record.engine_version,
              lineage: page.record.lineage ?? null,
            }
          : null,
      });
    }
    return json(200, {
      writable: false,
      kind: snapshot.kind,
      capabilities: CONTROL_PLANE_CAPABILITIES,
      repositories: snapshot.repositories,
      decisions: snapshot.decisions,
      findings: snapshot.findings,
      audit: snapshot.audit,
    });
  }

  if (page.name === "not-found") {
    return html(404, renderControlPlanePage(page, snapshot, basePath));
  }
  const body = renderControlPlanePage(page, snapshot, basePath);
  return html(200, method === "HEAD" ? "" : body);
}

async function resolvePage(pathname: string, reader: ControlPlaneReader): Promise<ControlPlanePage> {
  if (pathname === "/") return { name: "home" };
  if (pathname === "/repositories") return { name: "repositories" };
  if (pathname === "/decisions") return { name: "decisions" };
  if (pathname === "/findings") return { name: "findings" };
  if (pathname === "/audit") return { name: "audit" };

  const repository = matchPrefixed(pathname, ["/repository/", "/repositories/"]);
  if (repository) return { name: "repository", id: repository };

  const decisionId = matchPrefixed(pathname, ["/decision/", "/decisions/"]);
  if (decisionId) {
    return { name: "decision", id: decisionId, record: await reader.getDecision(decisionId) };
  }

  return { name: "not-found" };
}

function matchPrefixed(pathname: string, prefixes: string[]): string | null {
  for (const prefix of prefixes) {
    if (pathname.startsWith(prefix) && pathname.length > prefix.length) {
      return decodeURIComponent(pathname.slice(prefix.length));
    }
  }
  return null;
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

function wantsJsonResponse(
  headers: PlaneRequest["headers"],
  search: URLSearchParams,
): boolean {
  if (search.get("format") === "json") return true;
  const accept = headerValue(headers, "accept");
  return accept.includes("application/json");
}

function headerValue(
  headers: PlaneRequest["headers"],
  name: string,
): string {
  if (!headers) return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw.join(",");
  return raw ?? "";
}

function html(status: number, body: string): PlaneResponse {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-guardian-writable": "false",
    },
    body,
  };
}

function json(status: number, payload: unknown): PlaneResponse {
  return {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-guardian-writable": "false",
    },
    body: `${JSON.stringify(payload, null, 2)}\n`,
  };
}

function text(status: number, body: string, extra: Record<string, string> = {}): PlaneResponse {
  return {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-guardian-writable": "false",
      ...extra,
    },
    body: `${body}\n`,
  };
}
