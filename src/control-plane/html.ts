import type { DecisionRecord } from "../types.js";
import { ENGINE_VERSION } from "../types.js";
import { CONTROL_PLANE_CAPABILITIES } from "./types.js";
import type {
  AuditEntry,
  ControlPlaneSnapshot,
  DecisionSummary,
  FindingRow,
  RepositorySummary,
} from "./types.js";

export type ControlPlanePage =
  | { name: "home" }
  | { name: "repositories" }
  | { name: "repository"; id: string }
  | { name: "decisions" }
  | { name: "decision"; id: string; record: DecisionRecord | null }
  | { name: "findings" }
  | { name: "audit" }
  | { name: "not-found" };

export function renderControlPlanePage(
  page: ControlPlanePage,
  snapshot: ControlPlaneSnapshot,
  basePath = "",
): string {
  const title = pageTitle(page);
  const body = renderBody(page, snapshot);
  const raw = layout(title, snapshot, body);
  const base = basePath.replace(/\/$/, "");
  if (!base) return raw;
  return raw.replaceAll('href="/', `href="${base}/`);
}

function pageTitle(page: ControlPlanePage): string {
  switch (page.name) {
    case "home":
      return "Control Plane";
    case "repositories":
      return "Repositories";
    case "repository":
      return page.id;
    case "decisions":
      return "Decisions";
    case "decision":
      return page.id;
    case "findings":
      return "Findings";
    case "audit":
      return "Audit";
    default:
      return "Not found";
  }
}

function renderBody(page: ControlPlanePage, snapshot: ControlPlaneSnapshot): string {
  switch (page.name) {
    case "home":
      return renderHome(snapshot);
    case "repositories":
      return renderRepositories(snapshot.repositories);
    case "repository":
      return renderRepository(
        page.id,
        snapshot.repositories.find((item) => item.id === page.id) ?? null,
        snapshot.decisions.filter((item) => item.repository === page.id),
      );
    case "decisions":
      return renderDecisions(snapshot.decisions);
    case "decision":
      return renderDecision(page.id, page.record);
    case "findings":
      return renderFindings(snapshot.findings);
    case "audit":
      return renderAudit(snapshot.audit);
    default:
      return `<section class="panel"><h1>Not found</h1><p>No such Control Plane page.</p></section>`;
  }
}

function renderHome(snapshot: ControlPlaneSnapshot): string {
  const latest = snapshot.decisions[0];
  return `
<section class="hero">
  <p class="kicker">admin · read-only</p>
  <h1>Guardian Control Plane</h1>
  <p class="lede">This site displays sealed decisions. It cannot decide, merge, chat, or edit <code>architecture.yaml</code>.</p>
  <dl class="roles">
    <div><dt>Dashboard</dt><dd>READ</dd></div>
    <div><dt>Guardian</dt><dd>DECIDE</dd></div>
    <div><dt>GitHub</dt><dd>ENFORCE</dd></div>
    <div><dt>Turso</dt><dd>STORE</dd></div>
    <div><dt>Arena</dt><dd>REPAIR</dd></div>
  </dl>
</section>
<section class="panel">
  <h2>Latest decision</h2>
  ${latest ? decisionTable([latest]) : `<p class="empty">No decisions recorded yet.</p>`}
  <p class="meta">Source: <strong>${escapeHtml(sourceLabel(snapshot.kind))}</strong> · writable=${String(snapshot.writable)}</p>
</section>`;
}

function renderRepositories(rows: RepositorySummary[]): string {
  if (rows.length === 0) {
    return `<section class="panel"><h1>Repositories</h1><p class="empty">No repositories in the ledger.</p></section>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
  <td><a href="/repository/${encodeURIComponent(row.id)}">${escapeHtml(row.id)}</a></td>
  <td>${row.decision_count}</td>
  <td>${resultBadge(row.latest_result)}</td>
  <td class="mono">${escapeHtml(row.latest_timestamp ?? "—")}</td>
</tr>`,
    )
    .join("\n");
  return `<section class="panel">
  <h1>Repositories</h1>
  <table>
    <thead><tr><th>Repository</th><th>Decisions</th><th>Latest</th><th>Timestamp</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function renderRepository(
  id: string,
  repo: RepositorySummary | null,
  decisions: DecisionSummary[],
): string {
  if (!repo) {
    return `<section class="panel"><h1>${escapeHtml(id)}</h1><p class="empty">Repository not found in the ledger.</p></section>`;
  }
  return `<section class="panel">
  <h1>${escapeHtml(id)}</h1>
  <p class="meta">${repo.decision_count} decisions · latest ${resultBadge(repo.latest_result)}</p>
  ${decisionTable(decisions)}
</section>`;
}

function renderDecisions(rows: DecisionSummary[]): string {
  return `<section class="panel">
  <h1>Decisions</h1>
  <p class="lede">Sealed Guardian history. The Control Plane cannot rewrite <code>result</code>.</p>
  ${rows.length ? decisionTable(rows) : `<p class="empty">No decisions recorded yet.</p>`}
</section>`;
}

function renderDecision(id: string, record: DecisionRecord | null): string {
  if (!record) {
    return `<section class="panel"><h1>${escapeHtml(id)}</h1><p class="empty">Decision not found.</p></section>`;
  }
  const lineage = record.lineage
    ? `<dl class="kv">
  <div><dt>original_decision_id</dt><dd class="mono">${escapeHtml(record.lineage.original_decision_id)}</dd></div>
  <div><dt>repair_attempt_id</dt><dd class="mono">${escapeHtml(record.lineage.repair_attempt_id)}</dd></div>
  <div><dt>parent_commit_sha</dt><dd class="mono">${escapeHtml(record.lineage.parent_commit_sha)}</dd></div>
  <div><dt>new_commit_sha</dt><dd class="mono">${escapeHtml(record.lineage.new_commit_sha)}</dd></div>
</dl>`
    : `<p class="meta">No repair lineage on this record.</p>`;
  const checks = Object.entries(record.checks)
    .map(([name, status]) => `<tr><td>${escapeHtml(name)}</td><td>${escapeHtml(status)}</td></tr>`)
    .join("");
  const violations = record.violations.length
    ? record.violations
        .map(
          (finding) => `<tr>
  <td class="mono">${escapeHtml(finding.id)}</td>
  <td>${escapeHtml(finding.rule)}</td>
  <td>${escapeHtml(finding.message)}</td>
  <td class="mono">${escapeHtml(finding.file ?? "—")}</td>
</tr>`,
        )
        .join("")
    : `<tr><td colspan="4">None</td></tr>`;
  return `<section class="panel">
  <p class="kicker">sealed decision</p>
  <h1>${resultBadge(record.result)}</h1>
  <p class="lede">This page has no approve, merge, or override action. Guardian already decided.</p>
  <dl class="kv">
    <div><dt>decision_id</dt><dd class="mono">${escapeHtml(record.decision_id)}</dd></div>
    <div><dt>repository</dt><dd>${escapeHtml(record.repository)}</dd></div>
    <div><dt>commit_sha</dt><dd class="mono">${escapeHtml(record.commit_sha ?? record.commit)}</dd></div>
    <div><dt>contract_hash</dt><dd class="mono">${escapeHtml(record.contract_hash)}</dd></div>
    <div><dt>evidence_hash</dt><dd class="mono">${escapeHtml(record.evidence_hash)}</dd></div>
    <div><dt>result</dt><dd>${resultBadge(record.result)}</dd></div>
    <div><dt>engine_version</dt><dd class="mono">${escapeHtml(record.engine_version)}</dd></div>
    <div><dt>timestamp</dt><dd class="mono">${escapeHtml(record.timestamp)}</dd></div>
  </dl>
  <h2>Lineage</h2>
  ${lineage}
  <h2>Checks</h2>
  <table><thead><tr><th>Check</th><th>Status</th></tr></thead><tbody>${checks}</tbody></table>
  <h2>Findings</h2>
  <table>
    <thead><tr><th>ID</th><th>Rule</th><th>Message</th><th>File</th></tr></thead>
    <tbody>${violations}</tbody>
  </table>
</section>`;
}

function renderFindings(rows: FindingRow[]): string {
  if (rows.length === 0) {
    return `<section class="panel"><h1>Findings</h1><p class="empty">No recorded violations.</p></section>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
  <td><a href="/decision/${encodeURIComponent(row.decision_id)}">${escapeHtml(row.decision_id)}</a></td>
  <td class="mono">${escapeHtml(row.id)}</td>
  <td>${escapeHtml(row.message)}</td>
  <td class="mono">${escapeHtml(row.commit_sha)}</td>
</tr>`,
    )
    .join("\n");
  return `<section class="panel">
  <h1>Findings</h1>
  <table>
    <thead><tr><th>Decision</th><th>ID</th><th>Message</th><th>commit_sha</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function renderAudit(rows: AuditEntry[]): string {
  if (rows.length === 0) {
    return `<section class="panel"><h1>Audit</h1><p class="empty">No audit trail yet.</p></section>`;
  }
  const body = rows
    .map(
      (row) => `<tr>
  <td class="mono">${escapeHtml(row.timestamp)}</td>
  <td><a href="/decision/${encodeURIComponent(row.decision_id)}">${escapeHtml(row.decision_id)}</a></td>
  <td>${resultBadge(row.result)}</td>
  <td class="mono">${escapeHtml(row.commit_sha)}</td>
  <td class="mono">${escapeHtml(row.contract_hash)}</td>
  <td class="mono">${escapeHtml(row.evidence_hash)}</td>
  <td class="mono">${escapeHtml(row.repair_attempt_id ?? "—")}</td>
</tr>`,
    )
    .join("\n");
  return `<section class="panel">
  <h1>Audit</h1>
  <p class="lede">Each re-check is a new row. Original decisions are never mutated.</p>
  <table>
    <thead>
      <tr>
        <th>Timestamp</th><th>Decision</th><th>Result</th>
        <th>commit_sha</th><th>contract_hash</th><th>evidence_hash</th><th>repair</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function decisionTable(rows: DecisionSummary[]): string {
  const body = rows
    .map(
      (row) => `<tr>
  <td><a href="/decision/${encodeURIComponent(row.decision_id)}">${escapeHtml(row.decision_id)}</a></td>
  <td>${escapeHtml(row.repository)}</td>
  <td>${resultBadge(row.result)}</td>
  <td class="mono">${escapeHtml(row.commit_sha)}</td>
  <td class="mono">${escapeHtml(row.contract_hash)}</td>
  <td class="mono">${escapeHtml(row.evidence_hash)}</td>
</tr>`,
    )
    .join("\n");
  return `<table>
  <thead>
    <tr>
      <th>decision_id</th><th>repository</th><th>result</th>
      <th>commit_sha</th><th>contract_hash</th><th>evidence_hash</th>
    </tr>
  </thead>
  <tbody>${body}</tbody>
</table>`;
}

function resultBadge(result: DecisionSummary["result"] | null): string {
  if (!result) return "—";
  const cls = result === "SAFE_TO_MERGE" ? "pass" : "fail";
  return `<span class="badge ${cls}">${escapeHtml(result)}</span>`;
}

function sourceLabel(kind: ControlPlaneSnapshot["kind"]): string {
  if (kind === "turso") return "Turso (recorded state)";
  if (kind === "local-ledger") return "local ledger (.guardian)";
  return "in-memory (tests)";
}

function layout(title: string, snapshot: ControlPlaneSnapshot, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(title)} · AI Guardian</title>
  <style>
    :root {
      --ink: #0e1116;
      --paper: #f4efe4;
      --rule: #d7cbb3;
      --pass: #0f6b4c;
      --fail: #9b1d2a;
      --muted: #6b6458;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--paper);
      color: var(--ink);
      font: 16px/1.45 "Iowan Old Style", "Palatino Linotype", Palatino, serif;
    }
    header {
      background: var(--ink);
      color: var(--paper);
      padding: 1rem 1.5rem 1.25rem;
    }
    header a { color: var(--paper); text-decoration: none; }
    nav { display: flex; gap: 1rem; flex-wrap: wrap; margin-top: .75rem; font-size: .95rem; }
    nav a { border-bottom: 1px solid transparent; }
    nav a:hover { border-bottom-color: var(--paper); }
    .banner {
      background: #c9a227;
      color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: .8rem;
      letter-spacing: .04em;
      padding: .45rem 1.5rem;
      text-transform: uppercase;
    }
    main { padding: 1.5rem; max-width: 1100px; }
    h1, h2 { font-weight: 600; letter-spacing: -.02em; }
    .hero h1 { font-size: 2.2rem; margin: .2rem 0 .5rem; }
    .kicker { text-transform: uppercase; letter-spacing: .14em; font-size: .75rem; color: var(--muted); }
    .lede { max-width: 42rem; }
    .panel { margin: 1.5rem 0; }
    table { width: 100%; border-collapse: collapse; font-size: .92rem; }
    th, td { border-bottom: 1px solid var(--rule); padding: .45rem .4rem; text-align: left; vertical-align: top; }
    th { font-size: .75rem; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; word-break: break-all; }
    .badge { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .78rem; }
    .badge.pass { color: var(--pass); }
    .badge.fail { color: var(--fail); }
    .kv { display: grid; gap: .4rem; }
    .kv div { display: grid; grid-template-columns: 12rem 1fr; gap: .5rem; }
    .kv dt { color: var(--muted); font-size: .85rem; }
    .roles { display: grid; grid-template-columns: repeat(auto-fit, minmax(7.5rem, 1fr)); gap: .75rem; padding: 0; }
    .roles div { border-top: 2px solid var(--ink); padding-top: .35rem; }
    .roles dt { font-size: .75rem; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .roles dd { margin: 0; font-weight: 600; }
    .empty, .meta { color: var(--muted); }
    a { color: var(--ink); }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: .85em; }
    footer { padding: 1rem 1.5rem 2rem; color: var(--muted); font-size: .85rem; }
  </style>
</head>
<body>
  <div class="banner">Read only — this dashboard cannot declare SAFE_TO_MERGE, cannot merge, and cannot edit the contract</div>
  <header>
    <a href="/"><strong>AI Guardian</strong> Admin</a>
    <nav>
      <a href="/repositories">Repositories</a>
      <a href="/decisions">Decisions</a>
      <a href="/findings">Findings</a>
      <a href="/audit">Audit</a>
    </nav>
  </header>
  <main>
    ${body}
  </main>
  <footer>
    Engine ${escapeHtml(ENGINE_VERSION)} · source ${escapeHtml(sourceLabel(snapshot.kind))} ·
    decide=${String(CONTROL_PLANE_CAPABILITIES.may_decide)} ·
    merge=${String(CONTROL_PLANE_CAPABILITIES.may_merge)} ·
    chat=${String(CONTROL_PLANE_CAPABILITIES.may_chat)}
  </footer>
</body>
</html>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
