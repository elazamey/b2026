import type { ControlPlaneReader } from "./types.js";
import { createControlPlaneReader } from "./reader.js";
import { handleControlPlaneRequest } from "./http.js";

export interface VercelLikeRequest {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
}

export interface VercelLikeResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

export function vercelRequestUrl(req: VercelLikeRequest): string {
  const forwarded =
    headerValue(req.headers, "x-forwarded-uri") || headerValue(req.headers, "x-original-uri");
  if (forwarded) return forwarded;

  const raw = req.url && req.url.length > 0 ? req.url : "/";
  const url = raw.startsWith("http") ? new URL(raw) : new URL(raw, "http://control-plane.local");
  if (isPlaneFunctionPath(url.pathname)) {
    const recovered = url.searchParams.get("__path");
    url.searchParams.delete("__path");
    const search = url.searchParams.toString();
    const path = recovered && recovered.length > 0 ? recovered : "/";
    return search ? `${path}?${search}` : path;
  }
  return `${url.pathname}${url.search}`;
}

export function createVercelHandler(options: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  reader?: ControlPlaneReader;
} = {}) {
  return async function vercelHandler(
    req: VercelLikeRequest,
    res: VercelLikeResponse,
  ): Promise<void> {
    try {
      const reader =
        options.reader ??
        createControlPlaneReader({
          root: options.root ?? process.cwd(),
          env: options.env ?? process.env,
        });
      const response = await handleControlPlaneRequest(
        {
          method: req.method ?? "GET",
          url: vercelRequestUrl(req),
          headers: req.headers,
        },
        reader,
      );
      res.statusCode = response.status;
      for (const [name, value] of Object.entries(response.headers)) {
        res.setHeader(name, value);
      }
      res.end(response.body);
    } catch {
      res.statusCode = 503;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-guardian-writable", "false");
      res.end(
        "Control plane unavailable. Dashboard is degraded. Guardian decisions are unchanged.\n",
      );
    }
  };
}

function isPlaneFunctionPath(pathname: string): boolean {
  return (
    pathname === "/api/plane" ||
    pathname === "/api/plane.js" ||
    pathname === "/api/plane.ts" ||
    pathname === "/api/plane.mjs"
  );
}

function headerValue(
  headers: VercelLikeRequest["headers"],
  name: string,
): string {
  if (!headers) return "";
  const raw = headers[name] ?? headers[name.toLowerCase()];
  if (Array.isArray(raw)) return raw[0] ?? "";
  return raw ?? "";
}

const handler = createVercelHandler();
export default handler;
