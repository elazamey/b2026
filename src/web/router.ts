import type { ControlPlaneReader, ControlPlaneSnapshot } from "../control-plane/types.js";
import { handleControlPlaneRequest, type PlaneRequest, type PlaneResponse } from "../control-plane/http.js";
import {
  canAccessAdmin,
  canAccessApp,
  canReadProject,
  visibleRepositories,
} from "../identity/authorize.js";
import {
  clearSessionCookie,
  csrfCookie,
  readSessionToken,
  requestIsSecure,
  sessionCookie,
} from "../identity/cookie.js";
import { csrfFromCookie, csrfMatches, newCsrfToken, originAllowed } from "../identity/csrf.js";
import { clientIp, LoginLimiter } from "../identity/rate-limit.js";
import { MemoryIdentityStore } from "../identity/store.js";
import type { IdentityStore, Principal, Project } from "../identity/types.js";
import type { GeminiReviewer } from "../gemini/client.js";
import { isReviewSkip } from "../gemini/types.js";
import { MemoryReviewStore, type ReviewStore } from "../gemini/store.js";
import { renderPublicPage, type PublicPage } from "./html.js";
import { headerValue, parseForm } from "./roles.js";

const DECISION_MUTATION_BLOCK =
  "This product UI cannot change Guardian decisions. Guardian → DECIDE. GitHub → ENFORCE.";

const defaultLimiter = new LoginLimiter();

export interface SiteContext {
  limiter?: LoginLimiter;
  reviews?: ReviewStore;
  gemini?: GeminiReviewer;
}

export async function handleSiteRequest(
  request: PlaneRequest,
  reader: ControlPlaneReader,
  identity: IdentityStore = new MemoryIdentityStore(),
  context: SiteContext = {},
): Promise<PlaneResponse> {
  const method = request.method.toUpperCase();
  const url = new URL(request.url, "http://guardian.local");
  const pathname = normalizePath(url.pathname);
  const cookieHeader = headerValue(request.headers, "cookie") || null;
  const token = readSessionToken(cookieHeader);
  const principal = await identity.getPrincipal(token);
  const secure = requestIsSecure(request.headers);
  const limiter = context.limiter ?? defaultLimiter;
  const reviews = context.reviews ?? new MemoryReviewStore();
  const csrf = csrfFromCookie(cookieHeader) ?? newCsrfToken();
  const csrfHeader = csrfCookie(csrf, { secure });

  if (pathname === "/health") {
    return json(200, { ok: true, writable: false, product: "ai-guardian" });
  }

  if (method === "POST" && !originAllowed(request.headers, url)) {
    return text(403, "Cross-origin form rejected. Guardian decisions are unchanged.");
  }

  if (pathname === "/login" || pathname === "/register") {
    const pageName = pathname === "/login" ? "login" : "register";
    if (method === "POST") {
      const form = parseForm(request.body ?? "");
      if (!csrfMatches(csrfFromCookie(cookieHeader), form.csrf)) {
        return html(
          403,
          renderPublicPage({ name: pageName, error: "Invalid session token. Reload and try again." }, null, principal, csrf),
          csrfHeader,
        );
      }
      return pageName === "login"
        ? signIn(identity, form, limiter, request.headers, csrf, secure)
        : register(identity, form, limiter, request.headers, csrf, secure);
    }
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD, POST" });
    }
    return html(200, renderPublicPage({ name: pageName }, null, principal, csrf), csrfHeader);
  }

  if (pathname === "/logout") {
    if (method !== "POST") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "POST" });
    }
    const form = parseForm(request.body ?? "");
    if (!csrfMatches(csrfFromCookie(cookieHeader), form.csrf)) {
      return text(403, "Invalid session token. Guardian decisions are unchanged.");
    }
    if (token) await identity.revokeSession(token);
    return redirect("/", [clearSessionCookie({ secure }), csrfHeader]);
  }

  if (pathname.startsWith("/api/reviews/")) {
    const decisionId = decodeURIComponent(pathname.slice("/api/reviews/".length));
    return handleReviewApi({
      method,
      decisionId,
      principal,
      reader,
      identity,
      reviews,
      gemini: context.gemini,
      cookieHeader,
      csrf,
      csrfHeader,
      body: request.body ?? "",
    });
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (!canAccessAdmin(principal)) {
      return html(403, renderPublicPage({ name: "forbidden" }, null, principal, csrf), csrfHeader);
    }
    const inner = pathname === "/admin" ? "/" : pathname.slice("/admin".length);
    return handleControlPlaneRequest(
      { ...request, url: `${inner}${url.search}` },
      reader,
      { basePath: "/admin" },
    );
  }

  if (pathname === "/app/projects" && method === "POST") {
    if (!canAccessApp(principal) || !principal) return redirect("/login", csrfHeader);
    const form = parseForm(request.body ?? "");
    if (!csrfMatches(csrfFromCookie(cookieHeader), form.csrf)) {
      return text(403, "Invalid session token. Guardian decisions are unchanged.");
    }
    return createProject(identity, principal, form);
  }

  const appPage = resolveApp(pathname);
  if (appPage) {
    if (!canAccessApp(principal) || !principal) {
      return redirect("/login", csrfHeader);
    }
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    if (appPage.name === "app-project") {
      const project = await loadAuthorizedProject(identity, principal, appPage.id);
      if (!project) {
        return html(404, renderPublicPage({ name: "not-found" }, null, principal, csrf), csrfHeader);
      }
      const snapshot = scopedSnapshot(await reader.snapshot(), principal);
      return html(200, renderPublicPage({ name: "app-project", id: project.id }, snapshot, principal, csrf), csrfHeader);
    }
    const snapshot = scopedSnapshot(await reader.snapshot(), principal);
    return html(200, renderPublicPage(appPage, snapshot, principal, csrf), csrfHeader);
  }

  if (pathname === "/settings") {
    if (!canAccessApp(principal) || !principal) return redirect("/login", csrfHeader);
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    return html(200, renderPublicPage({ name: "settings" }, null, principal, csrf), csrfHeader);
  }

  if (pathname === "/") {
    if (method !== "GET" && method !== "HEAD") {
      return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
    }
    return html(200, renderPublicPage({ name: "home" }, null, principal, csrf), csrfHeader);
  }

  if (method !== "GET" && method !== "HEAD") {
    return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD" });
  }
  return html(404, renderPublicPage({ name: "not-found" }, null, principal, csrf), csrfHeader);
}

async function handleReviewApi(input: {
  method: string;
  decisionId: string;
  principal: Principal | null;
  reader: ControlPlaneReader;
  identity: IdentityStore;
  reviews: ReviewStore;
  gemini?: GeminiReviewer;
  cookieHeader: string | null;
  csrf: string;
  csrfHeader: string;
  body: string;
}): Promise<PlaneResponse> {
  if (!input.principal) {
    return json(401, { error: "unauthorized", writable: false, authority: "advisory" });
  }
  if (!input.decisionId) {
    return json(404, { error: "not_found", writable: false, authority: "advisory" });
  }
  const record = await input.reader.getDecision(input.decisionId);
  if (!record) {
    return json(404, { error: "not_found", writable: false, authority: "advisory" });
  }
  const project = await input.identity.findProjectByRepository(record.repository);
  if (!project || !canReadProject(input.principal, project)) {
    return json(404, { error: "not_found", writable: false, authority: "advisory" });
  }

  if (input.method === "GET" || input.method === "HEAD") {
    const review = await input.reviews.getByDecision(input.decisionId);
    if (!review) return json(404, { error: "not_found", writable: false, authority: "advisory" });
    return json(200, { ...review, writable: false });
  }

  if (input.method !== "POST") {
    return text(405, DECISION_MUTATION_BLOCK, { Allow: "GET, HEAD, POST" });
  }

  const form = parseForm(input.body);
  if (!csrfMatches(csrfFromCookie(input.cookieHeader), form.csrf)) {
    return json(403, { error: "csrf", writable: false, authority: "advisory" });
  }
  if (!input.gemini) {
    return json(503, {
      error: "gemini_off",
      message: "Gemini off. Guardian decisions are unchanged.",
      writable: false,
      authority: "advisory",
      decision_result: record.result,
    });
  }
  const reviewed = await input.gemini.review(record);
  if (isReviewSkip(reviewed)) {
    return json(503, {
      error: reviewed.reason,
      message: "Gemini unavailable. Guardian decisions are unchanged.",
      writable: false,
      authority: "advisory",
      decision_result: record.result,
    });
  }
  const saved = await input.reviews.save(reviewed);
  const sealed = await input.reader.getDecision(record.decision_id);
  return json(200, {
    ...saved,
    writable: false,
    decision_result: sealed?.result,
  });
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

async function loadAuthorizedProject(
  identity: IdentityStore,
  principal: Principal,
  id: string,
): Promise<Project | null> {
  const direct = await identity.getProject(id);
  const project = direct ?? (await identity.findProjectByRepository(id));
  if (!project) return null;
  if (!canReadProject(principal, project)) return null;
  return project;
}

async function signIn(
  identity: IdentityStore,
  form: Record<string, string>,
  limiter: LoginLimiter,
  headers: PlaneRequest["headers"],
  csrf: string,
  secure: boolean,
): Promise<PlaneResponse> {
  void form.role;
  const email = form.email ?? "";
  const ip = clientIp(headers);
  if (limiter.blocked(ip, email)) {
    return html(
      429,
      renderPublicPage({ name: "login", error: "Too many sign-in attempts. Try again later." }, null, null, csrf),
      csrfCookie(csrf, { secure }),
    );
  }
  const user = await identity.authenticate(email, form.password ?? "");
  if (!user) {
    return html(
      401,
      renderPublicPage({ name: "login", error: "Invalid email or password." }, null, null, csrf),
      csrfCookie(csrf, { secure }),
    );
  }
  const { token } = await identity.createSession(user.id);
  return redirect("/app", [sessionCookie(token, { secure }), csrfCookie(csrf, { secure })]);
}

async function register(
  identity: IdentityStore,
  form: Record<string, string>,
  limiter: LoginLimiter,
  headers: PlaneRequest["headers"],
  csrf: string,
  secure: boolean,
): Promise<PlaneResponse> {
  void form.role;
  const email = form.email ?? "";
  const ip = clientIp(headers);
  if (limiter.blocked(ip, email)) {
    return html(
      429,
      renderPublicPage({ name: "register", error: "Too many attempts. Try again later." }, null, null, csrf),
      csrfCookie(csrf, { secure }),
    );
  }
  try {
    const user = await identity.createUser({
      email,
      password: form.password ?? "",
    });
    const { token } = await identity.createSession(user.id);
    return redirect("/app", [sessionCookie(token, { secure }), csrfCookie(csrf, { secure })]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create account.";
    return html(400, renderPublicPage({ name: "register", error: message }, null, null, csrf), csrfCookie(csrf, { secure }));
  }
}

async function createProject(
  identity: IdentityStore,
  principal: Principal,
  form: Record<string, string>,
): Promise<PlaneResponse> {
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

function html(status: number, body: string, cookie?: string | string[]): PlaneResponse {
  return {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-guardian-writable": "false",
      ...(cookie ? { "set-cookie": cookie } : {}),
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

function redirect(location: string, cookie?: string | string[]): PlaneResponse {
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
