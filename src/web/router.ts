import type { ControlPlaneReader } from "../control-plane/types.js";
import { handleControlPlaneRequest, type PlaneRequest, type PlaneResponse } from "../control-plane/http.js";
import { renderPublicPage, type PublicPage } from "./html.js";
import {
  canAccessAdmin,
  canAccessApp,
  parseForm,
  parseRole,
  readRole,
  sessionCookie,
  type Role,
} from "./roles.js";

const DECISION_MUTATION_BLOCK =
  "This product UI cannot change Guardian decisions. Guardian → DECIDE. GitHub → ENFORCE.";

export async function handleSiteRequest(
  request: PlaneRequest,
  reader: ControlPlaneReader,
): Promise<PlaneResponse> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url, "http://guardian.local");
  const pathname = normalizePath(url.pathname);
  const role = readRole(request.headers);

  if (pathname === "/health") {
    return json(200, { ok: true, writable: false, product: "ai-guardian" });
  }

  if (pathname === "/login" || pathname === "/register") {
    if (method === "POST") {
      return signIn(request.body ?? "");
    }
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD, POST" });
    }
    return html(200, renderPublicPage({ name: pathname === "/login" ? "login" : "register" }, null, role));
  }

  if (pathname === "/logout") {
    if (method !== "POST" && method !== "GET") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, POST" });
    }
    return redirect("/", sessionCookie("anonymous"));
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!canAccessAdmin(role)) {
      return html(403, renderPublicPage({ name: "forbidden" }, null, role));
    }
    const inner = pathname === "/admin" ? "/" : pathname.slice("/admin".length);
    return handleControlPlaneRequest(
      { ...request, url: `${inner}${url.search}` },
      reader,
      { basePath: "/admin" },
    );
  }

  const appPage = resolveApp(pathname);
  if (appPage) {
    if (!canAccessApp(role)) {
      return redirect("/login");
    }
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    const snapshot = await reader.snapshot();
    return html(200, renderPublicPage(appPage, snapshot, role));
  }

  if (pathname === "/settings") {
    if (!canAccessApp(role)) return redirect("/login");
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    return html(200, renderPublicPage({ name: "settings", role }, null, role));
  }

  if (pathname === "/") {
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    return html(200, renderPublicPage({ name: "home" }, null, role));
  }

  if (method !== "GET" && method !== "HEAD") {
    return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
  }
  return html(404, renderPublicPage({ name: "not-found" }, null, role));
}

function resolveApp(pathname: string): PublicPage | null {
  if (pathname === "/app" || pathname === "/app/overview") return { name: "app-overview" };
  if (pathname === "/app/projects") return { name: "app-projects" };
  if (pathname === "/app/scans") return { name: "app-scans" };
  if (pathname === "/app/findings") return { name: "app-findings" };
  if (pathname === "/app/activity") return { name: "app-activity" };
  if (pathname.startsWith("/app/projects/") && pathname.length > "/app/projects/".length) {
    return { name: "app-project", id: decodeURIComponent(pathname.slice("/app/projects/".length)) };
  }
  return null;
}

function signIn(body: string): PlaneResponse {
  const form = parseForm(body);
  const role = parseRole(form.role);
  if (!role) {
    return text(400, "Unknown role. Use user, developer, or owner.");
  }
  return redirect("/app", sessionCookie(role));
}

function normalizePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname || "/";
}

function html(status: number, body: string, extra: Record<string, string> = {}): PlaneResponse {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-guardian-writable": "false",
      ...extra,
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
    body: `${JSON.stringify(payload)}\n`,
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

function redirect(location: string, cookie?: string): PlaneResponse {
  return {
    status: 303,
    headers: {
      location,
      "cache-control": "no-store",
      "x-guardian-writable": "false",
      ...(cookie ? { "set-cookie": cookie } : {}),
    },
    body: "",
  };
}

export type { Role };
