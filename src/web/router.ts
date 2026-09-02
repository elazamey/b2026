import type { ControlPlaneReader, ControlPlaneSnapshot } from "../control-plane/types.js";
import { handleControlPlaneRequest, type PlaneRequest, type PlaneResponse } from "../control-plane/http.js";
import {
  canAccessAdmin,
  canAccessApp,
  visibleRepositories,
} from "../identity/authorize.js";
import { clearSessionCookie, readSessionToken, sessionCookie } from "../identity/cookie.js";
import { MemoryIdentityStore } from "../identity/store.js";
import type { IdentityStore, Principal } from "../identity/types.js";
import { renderPublicPage, type PublicPage } from "./html.js";
import { headerValue, parseForm } from "./roles.js";

const DECISION_MUTATION_BLOCK =
  "This product UI cannot change Guardian decisions. Guardian → DECIDE. GitHub → ENFORCE.";

export async function handleSiteRequest(
  request: PlaneRequest,
  reader: ControlPlaneReader,
  identity: IdentityStore = new MemoryIdentityStore(),
): Promise<PlaneResponse> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url, "http://guardian.local");
  const pathname = normalizePath(url.pathname);
  const token = readSessionToken(headerValue(request.headers, "cookie") || null);
  const principal = await identity.getPrincipal(token);

  if (pathname === "/health") {
    return json(200, { ok: true, writable: false, product: "ai-guardian" });
  }

  if (pathname === "/login" || pathname === "/register") {
    const pageName = pathname === "/login" ? "login" : "register";
    if (method === "POST") {
      return pageName === "login"
        ? signIn(identity, request.body ?? "")
        : register(identity, request.body ?? "");
    }
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD, POST" });
    }
    return html(200, renderPublicPage({ name: pageName }, null, principal));
  }

  if (pathname === "/logout") {
    if (method !== "POST" && method !== "GET") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, POST" });
    }
    if (token) await identity.revokeSession(token);
    return redirect("/", clearSessionCookie());
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!canAccessAdmin(principal)) {
      return html(403, renderPublicPage({ name: "forbidden" }, null, principal));
    }
    const inner = pathname === "/admin" ? "/" : pathname.slice("/admin".length);
    return handleControlPlaneRequest(
      { ...request, url: `${inner}${url.search}` },
      reader,
      { basePath: "/admin" },
    );
  }

  if (pathname === "/app/projects" && method === "POST") {
    if (!canAccessApp(principal) || !principal) return redirect("/login");
    return createProject(identity, principal, request.body ?? "");
  }

  const appPage = resolveApp(pathname);
  if (appPage) {
    if (!canAccessApp(principal) || !principal) {
      return redirect("/login");
    }
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    const snapshot = scopedSnapshot(await reader.snapshot(), principal);
    return html(200, renderPublicPage(appPage, snapshot, principal));
  }

  if (pathname === "/settings") {
    if (!canAccessApp(principal) || !principal) return redirect("/login");
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    return html(200, renderPublicPage({ name: "settings" }, null, principal));
  }

  if (pathname === "/") {
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    return html(200, renderPublicPage({ name: "home" }, null, principal));
  }

  if (method !== "GET" && method !== "HEAD") {
    return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
  }
  return html(404, renderPublicPage({ name: "not-found" }, null, principal));
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

async function signIn(identity: IdentityStore, body: string): Promise<PlaneResponse> {
  const form = parseForm(body);
  void form.role;
  const user = await identity.authenticate(form.email ?? "", form.password ?? "");
  if (!user) {
    return html(401, renderPublicPage({ name: "login", error: "Invalid email or password." }, null, null));
  }
  const { token } = await identity.createSession(user.id);
  return redirect("/app", sessionCookie(token));
}

async function register(identity: IdentityStore, body: string): Promise<PlaneResponse> {
  const form = parseForm(body);
  void form.role;
  try {
    const user = await identity.createUser({
      email: form.email ?? "",
      password: form.password ?? "",
    });
    const { token } = await identity.createSession(user.id);
    return redirect("/app", sessionCookie(token));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create account.";
    return html(400, renderPublicPage({ name: "register", error: message }, null, null));
  }
}

async function createProject(
  identity: IdentityStore,
  principal: Principal,
  body: string,
): Promise<PlaneResponse> {
  const form = parseForm(body);
  try {
    const project = await identity.createProject({
      name: form.name ?? "",
      repository: form.repository ?? "",
      ownerId: principal.user.id,
    });
    return redirect(`/app/projects/${encodeURIComponent(project.id)}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create project.";
    return text(400, message);
  }
}

function scopedSnapshot(snapshot: ControlPlaneSnapshot, principal: Principal): ControlPlaneSnapshot {
  const allowed = visibleRepositories(principal);
  return {
    ...snapshot,
    writable: false,
    repositories: snapshot.repositories.filter((row) => allowed.has(row.id)),
    decisions: snapshot.decisions.filter((row) => allowed.has(row.repository)),
    findings: snapshot.findings.filter((row) => allowed.has(row.repository)),
    audit: snapshot.audit.filter((row) => allowed.has(row.repository)),
  };
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
