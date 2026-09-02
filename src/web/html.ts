import { ENGINE_VERSION } from "../types.js";
import type { ControlPlaneSnapshot, DecisionSummary, FindingRow } from "../control-plane/types.js";
import { IDENTITY_CAPABILITIES, type Principal, type Project } from "../identity/types.js";
import { canAccessAdmin, canSeeHashes } from "../identity/authorize.js";

export type PublicPage =
  | { name: "home" }
  | { name: "login"; error?: string }
  | { name: "register"; error?: string }
  | { name: "settings" }
  | { name: "app-overview" }
  | { name: "app-projects" }
  | { name: "app-project"; id: string }
  | { name: "app-scans" }
  | { name: "app-findings" }
  | { name: "app-activity" }
  | { name: "forbidden" }
  | { name: "not-found" };

export function renderPublicPage(
  page: PublicPage,
  snapshot: ControlPlaneSnapshot | null,
  principal: Principal | null,
  csrf = "",
): string {
  return shell(pageTitle(page), principal, renderBody(page, snapshot, principal, csrf));
}

function pageTitle(page: PublicPage): string {
  switch (page.name) {
    case "home":
      return "AI Guardian";
    case "login":
      return "Sign in";
    case "register":
      return "Create account";
    case "settings":
      return "Settings";
    case "app-overview":
      return "Overview";
    case "app-projects":
      return "Projects";
    case "app-project":
      return page.id;
    case "app-scans":
      return "Scans";
    case "app-findings":
      return "Findings";
    case "app-activity":
      return "Activity";
    case "forbidden":
      return "Forbidden";
    default:
      return "Not found";
  }
}

function renderBody(
  page: PublicPage,
  snapshot: ControlPlaneSnapshot | null,
  principal: Principal | null,
  csrf: string,
): string {
  switch (page.name) {
    case "home":
      return renderLanding();
    case "login":
      return renderAuth("Sign in", "/login", csrf, page.error);
    case "register":
      return renderAuth("Create account", "/register", csrf, page.error);
    case "settings":
      return renderSettings(principal, csrf);
    case "app-overview":
      return renderOverview(snapshot, principal);
    case "app-projects":
      return renderProjects(snapshot, principal, csrf);
    case "app-project":
      return renderProject(page.id, snapshot, principal);
    case "app-scans":
      return renderScans(snapshot, principal);
    case "app-findings":
      return renderFindings(snapshot, principal);
    case "app-activity":
      return renderActivity(snapshot);
    case "forbidden":
      return `<section class="panel"><h1>Platform admin only</h1><p>Project ownership is not platform administration. The Control Plane is not part of the user product.</p></section>`;
    default:
      return `<section class="panel"><h1>Not found</h1></section>`;
  }
}

function renderLanding(): string {
  return `
<section class="hero">
  <p class="kicker">Deterministic verification for AI-generated changes</p>
  <h1>The coding agent builds.<br/>Guardian decides.</h1>
  <p class="lede">Architecture, dependencies, security, and boundaries — checked before merge. No vibe. No override.</p>
  <p class="cta">
    <a class="btn" href="/register">Start free</a>
    <a class="btn ghost" href="/login">Sign in</a>
  </p>
</section>
<section id="how" class="grid3">
  <article><h2>How it works</h2><p>PR opens. GitHub Actions runs Guardian. The required check <code>ai-guardian</code> allows or blocks merge.</p></article>
  <article><h2>Features</h2><p>Contract in Git. Sealed decision ledger. Repair loop for agents. Hosted dashboard that cannot rewrite history.</p></article>
  <article><h2>Security</h2><p>No LLM in the core. No VPS. Secrets stay in GitHub and Vercel env, never in the contract.</p></article>
</section>
<section class="cta-band">
  <h2>Ship AI code without handing it the merge button.</h2>
  <a class="btn" href="/register">Create a workspace</a>
</section>`;
}

function renderAuth(title: string, action: string, csrf: string, error?: string): string {
  const errorLine = error ? `<p class="status fail">${escapeHtml(error)}</p>` : "";
  return `
<section class="panel narrow">
  <h1>${escapeHtml(title)}</h1>
  <p class="lede">Email and password create a server session. There is no role picker. This form cannot change a Guardian decision.</p>
  ${errorLine}
  <form method="post" action="${escapeHtml(action)}">
    ${csrfField(csrf)}
    <label>Email <input type="email" name="email" required placeholder="you@company.com" autocomplete="username"/></label>
    <label>Password <input type="password" name="password" required minlength="8" autocomplete="current-password"/></label>
    <button type="submit">${escapeHtml(title)}</button>
  </form>
  <p class="meta">override=${String(IDENTITY_CAPABILITIES.may_override)} · decide=${String(IDENTITY_CAPABILITIES.may_decide)}</p>
</section>`;
}

function renderSettings(principal: Principal | null, csrf: string): string {
  if (!principal) {
    return `<section class="panel"><h1>Settings</h1><p>Signed out.</p></section>`;
  }
  const rows = principal.memberships
    .map((item) => {
      const project = principal.projects.find((row) => row.id === item.project_id);
      return `<tr><td>${escapeHtml(project?.name ?? item.project_id)}</td><td>${escapeHtml(item.role)}</td></tr>`;
    })
    .join("");
  const table = rows
    ? `<table><thead><tr><th>Project</th><th>Membership</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="empty">No project memberships yet.</p>`;
  return `
<section class="panel">
  <h1>Settings</h1>
  <p>Signed in as <strong>${escapeHtml(principal.user.email)}</strong>.</p>
  <p>Platform admin: <strong>${principal.user.platform_admin ? "yes" : "no"}</strong>. Membership on a project is not platform admin.</p>
  <p>Policies live in <code>architecture.yaml</code> in Git. This page cannot edit the contract.</p>
  ${table}
  <form method="post" action="/logout">${csrfField(csrf)}<button type="submit">Sign out</button></form>
</section>`;
}

function renderOverview(snapshot: ControlPlaneSnapshot | null, principal: Principal | null): string {
  const projects = principal?.projects.length ?? 0;
  const latest = snapshot?.decisions[0];
  return `
<section class="panel">
  <h1>Overview</h1>
  <p class="lede">${projects} project${projects === 1 ? "" : "s"} in this workspace.</p>
  ${latest ? projectCard(latest, snapshot) : `<p class="empty">No scans yet. Create a project and open a pull request.</p>`}
</section>`;
}

function renderProjects(snapshot: ControlPlaneSnapshot | null, principal: Principal | null, csrf: string): string {
  const projects = principal?.projects ?? [];
  const cards = projects
    .map((project) => {
      const latest = snapshot?.decisions.find((item) => item.repository === project.repository);
      return `<a class="card" href="/app/projects/${encodeURIComponent(project.id)}">
  <h2>${escapeHtml(project.name)}</h2>
  <p class="meta">${escapeHtml(project.repository)}</p>
  <p>${healthLine(latest)}</p>
  <p class="meta">${escapeHtml(latest?.timestamp ?? "—")}</p>
</a>`;
    })
    .join("\n");
  const list = projects.length
    ? `<div class="cards">${cards}</div>`
    : `<p class="empty">No projects yet. Create one to see your Guardian results.</p>`;
  return `<section class="panel">
  <h1>Projects</h1>
  ${list}
  <form method="post" action="/app/projects" class="narrow">
    ${csrfField(csrf)}
    <h2>New project</h2>
    <label>Name <input name="name" required placeholder="API"/></label>
    <label>Repository <input name="repository" required placeholder="owner/name"/></label>
    <button type="submit">Create project</button>
  </form>
</section>`;
}

function renderProject(
  id: string,
  snapshot: ControlPlaneSnapshot | null,
  principal: Principal | null,
): string {
  const project = findProject(id, principal);
  if (!project) {
    return `<section class="panel"><h1>${escapeHtml(id)}</h1><p class="empty">Project not found.</p></section>`;
  }
  const latest = snapshot?.decisions.find((item) => item.repository === project.repository) ?? null;
  const findings = (snapshot?.findings ?? []).filter((item) => item.repository === project.repository);
  return `
<section class="panel">
  <h1>${escapeHtml(project.name)}</h1>
  <p class="meta">${escapeHtml(project.repository)}</p>
  ${projectCard(latest, snapshot)}
  ${findings.length ? findingsList(findings) : ""}
</section>`;
}

function renderScans(snapshot: ControlPlaneSnapshot | null, principal: Principal | null): string {
  const rows = snapshot?.decisions ?? [];
  const hashes = canSeeHashes(principal);
  const extra = hashes
    ? "<p class=\"meta\">Developer or owner membership includes commit and contract hashes from the sealed ledger.</p>"
    : "";
  if (rows.length === 0) {
    return `<section class="panel"><h1>Scans</h1><p class="empty">No scans recorded for your projects.</p></section>`;
  }
  const body = rows
    .map((row) => {
      const hashCells = hashes
        ? `<td class="mono">${escapeHtml(row.commit_sha)}</td><td class="mono">${escapeHtml(row.contract_hash)}</td>`
        : "";
      return `<tr>
  <td><a href="/app/projects/${encodeURIComponent(row.repository)}">${escapeHtml(row.repository)}</a></td>
  <td>${statusLabel(row)}</td>
  <td class="mono">${escapeHtml(row.timestamp)}</td>
  ${hashCells}
</tr>`;
    })
    .join("\n");
  const head = hashes
    ? "<tr><th>Project</th><th>Status</th><th>When</th><th>commit_sha</th><th>contract_hash</th></tr>"
    : "<tr><th>Project</th><th>Status</th><th>When</th></tr>";
  return `<section class="panel"><h1>Scans</h1>${extra}<table><thead>${head}</thead><tbody>${body}</tbody></table></section>`;
}

function renderFindings(snapshot: ControlPlaneSnapshot | null, principal: Principal | null): string {
  const rows = snapshot?.findings ?? [];
  if (rows.length === 0) {
    return `<section class="panel"><h1>Findings</h1><p class="empty">No violations on the latest scans.</p></section>`;
  }
  const prNote = canSeeHashes(principal)
    ? "<p class=\"meta\">Repair in a new commit. Do not edit architecture.yaml. Guardian will re-check.</p>"
    : "";
  return `<section class="panel"><h1>Findings</h1>${prNote}${findingsList(rows)}</section>`;
}

function renderActivity(snapshot: ControlPlaneSnapshot | null): string {
  const rows = snapshot?.audit ?? [];
  if (rows.length === 0) {
    return `<section class="panel"><h1>Activity</h1><p class="empty">No activity yet.</p></section>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
  <td class="mono">${escapeHtml(row.timestamp)}</td>
  <td>${escapeHtml(row.repository)}</td>
  <td>${row.result === "SAFE_TO_MERGE" ? "Healthy" : "Rejected"}</td>
</tr>`,
    )
    .join("\n");
  return `<section class="panel"><h1>Activity</h1><table><thead><tr><th>When</th><th>Project</th><th>Status</th></tr></thead><tbody>${body}</tbody></table></section>`;
}

function findProject(id: string, principal: Principal | null): Project | null {
  if (!principal) return null;
  return (
    principal.projects.find((item) => item.id === id || item.repository === id) ?? null
  );
}

function projectCard(latest: DecisionSummary | null | undefined, snapshot: ControlPlaneSnapshot | null): string {
  if (!latest) return `<p class="empty">No scan yet.</p>`;
  const rejected = latest.result === "REJECTED";
  const checks = ["architecture", "dependencies", "security", "boundaries"]
    .map((name) => {
      const bad = rejected && snapshot?.findings.some((item) => item.decision_id === latest.decision_id && item.rule.includes(name));
      const label = bad || (rejected && name === "architecture") ? "⚠ Attention" : "✓ Healthy";
      return `<div><dt>${escapeHtml(name)}</dt><dd>${label}</dd></div>`;
    })
    .join("");
  const risk = rejected ? "High" : "Low";
  const status = rejected
    ? `<p class="status fail">REJECTED</p>`
    : `<p class="status pass">SAFE TO MERGE</p>`;
  return `
<div class="card">
  <p class="kicker">Latest status</p>
  ${status}
  <p>Risk level: <strong>${risk}</strong></p>
  <dl class="checks">${checks}</dl>
  <p class="meta">Last scan ${escapeHtml(latest.timestamp)}</p>
</div>`;
}

function findingsList(rows: FindingRow[]): string {
  return rows
    .map(
      (row) => `<article class="finding">
  <h2>${escapeHtml(row.id)}</h2>
  <p>${escapeHtml(row.message)}</p>
  <p class="meta">File: ${escapeHtml(row.file ?? "—")}</p>
  <p class="status fail">REJECTED</p>
</article>`,
    )
    .join("\n");
}

function healthLine(latest: DecisionSummary | undefined): string {
  if (!latest) return "No scan yet";
  return latest.result === "SAFE_TO_MERGE" ? "✓ Healthy · SAFE TO MERGE" : "⚠ Violations · REJECTED";
}

function statusLabel(row: DecisionSummary): string {
  return row.result === "SAFE_TO_MERGE" ? "Healthy" : "Rejected";
}

function shell(title: string, principal: Principal | null, body: string): string {
  const signedIn = Boolean(principal);
  const appNav = signedIn
    ? `<a href="/app">Overview</a><a href="/app/projects">Projects</a><a href="/app/scans">Scans</a><a href="/app/findings">Findings</a><a href="/app/activity">Activity</a><a href="/settings">Settings</a>${canAccessAdmin(principal) ? `<a href="/admin">Admin</a>` : ""}`
    : `<a href="/login">Sign in</a><a href="/register">Start</a>`;
  const who = principal?.user.email ?? "signed out";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>
    :root { --bg:#07080c; --fg:#e8ead4; --muted:#8b9078; --line:#24261c; --accent:#c6f01f; --fail:#ff5a57; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 "Newsreader", "Iowan Old Style", Georgia, serif; }
    header { display:flex; justify-content:space-between; gap:1rem; flex-wrap:wrap; padding:1rem 1.5rem; border-bottom:1px solid var(--line); }
    header a { color:var(--fg); text-decoration:none; }
    nav { display:flex; gap:1rem; flex-wrap:wrap; font-size:.92rem; }
    .hero { padding:4rem 1.5rem 3rem; max-width:52rem; }
    .hero h1 { font-size:clamp(2.2rem, 6vw, 4.2rem); line-height:1.05; letter-spacing:-.04em; margin:.3rem 0 1rem; }
    .kicker { letter-spacing:.16em; text-transform:uppercase; font-size:.72rem; color:var(--accent); }
    .lede { color:var(--muted); max-width:38rem; }
    .cta { display:flex; gap:.75rem; flex-wrap:wrap; margin-top:1.5rem; }
    .btn { background:var(--accent); color:#111; text-decoration:none; padding:.7rem 1rem; font-weight:600; }
    .btn.ghost { background:transparent; color:var(--fg); border:1px solid var(--line); }
    .grid3 { display:grid; grid-template-columns:repeat(auto-fit,minmax(16rem,1fr)); gap:1.25rem; padding:0 1.5rem 3rem; }
    .grid3 article { border-top:1px solid var(--line); padding-top:1rem; }
    .cta-band { margin:0 1.5rem 3rem; padding:2rem; background:#10120a; }
    .panel { padding:2rem 1.5rem; max-width:960px; }
    .narrow { max-width:28rem; }
    form { display:grid; gap:.8rem; }
    label { display:grid; gap:.3rem; font-size:.9rem; color:var(--muted); }
    input, select, button { font:inherit; padding:.6rem .7rem; border:1px solid var(--line); background:#10120a; color:var(--fg); }
    button { background:var(--accent); color:#111; font-weight:600; cursor:pointer; }
    .cards { display:grid; gap:1rem; }
    .card { display:block; border:1px solid var(--line); padding:1rem; color:inherit; text-decoration:none; }
    .checks { display:grid; grid-template-columns:repeat(auto-fit,minmax(9rem,1fr)); gap:.6rem; }
    .checks dt { color:var(--muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.08em; }
    .checks dd { margin:0; }
    .status.pass { color:var(--accent); font-family:ui-monospace,monospace; }
    .status.fail { color:var(--fail); font-family:ui-monospace,monospace; }
    .finding { border-top:1px solid var(--line); padding:1rem 0; }
    table { width:100%; border-collapse:collapse; }
    th, td { text-align:left; padding:.4rem; border-bottom:1px solid var(--line); vertical-align:top; }
    .mono { font-family:ui-monospace,monospace; font-size:.78rem; word-break:break-all; }
    .empty, .meta { color:var(--muted); }
    footer { padding:1.5rem; color:var(--muted); font-size:.85rem; border-top:1px solid var(--line); }
    code { font-family:ui-monospace,monospace; font-size:.85em; }
  </style>
</head>
<body>
  <header>
    <a href="/"><strong>AI Guardian</strong></a>
    <nav>${appNav}</nav>
  </header>
  <main>${body}</main>
  <footer>Engine ${escapeHtml(ENGINE_VERSION)} · ${escapeHtml(who)} · this UI cannot override Guardian · merge=${String(IDENTITY_CAPABILITIES.may_merge)}</footer>
</body>
</html>`;
}

function csrfField(csrf: string): string {
  if (!csrf) return "";
  return `<input type="hidden" name="csrf" value="${escapeHtml(csrf)}"/>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
