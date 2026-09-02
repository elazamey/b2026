import { appendFileSync, writeFileSync } from "node:fs";
import type { DecisionRecord, VerificationReport } from "../types.js";
import { evidenceHash } from "../core/evidence-engine.js";
import { renderGithub, renderGithubSummary } from "../report/reporter.js";
import {
  createGithubClient,
  upsertDecisionComment,
  type FetchLike,
} from "./github-api.js";
import { renderPrComment } from "./github-comment.js";
import { type GithubContext } from "./github-context.js";

export interface EmitGithubOptions {
  comment: boolean;
  context: GithubContext | null;
  fetch?: FetchLike;
  onWarning?: (message: string) => void;
}

export function applyGithubProvenance(
  record: DecisionRecord,
  context: GithubContext | null,
): DecisionRecord {
  if (!context) return record;
  if (!context.inActions && !context.pullRequest) return record;
  if (context.repository && context.repository !== "unknown") {
    record.repository = context.repository;
  }
  if (context.sha) {
    record.commit_sha = context.pullRequest?.head_sha || context.sha;
    record.commit = record.commit_sha.slice(0, 7);
  }
  if (context.pullRequest?.head_ref) {
    record.branch = context.pullRequest.head_ref;
  }
  record.pull_request = context.pullRequest
    ? {
        number: context.pullRequest.number,
        url: context.pullRequest.url,
        head_sha: context.pullRequest.head_sha,
        head_ref: context.pullRequest.head_ref,
        base_ref: context.pullRequest.base_ref,
      }
    : record.pull_request;
  const github = {
    ...(record.github ?? {}),
    ...(context.eventName ? { event_name: context.eventName } : {}),
    ...(context.actor ? { actor: context.actor } : {}),
    ...(context.runId ? { run_id: context.runId } : {}),
    ...(context.runUrl ? { run_url: context.runUrl } : {}),
  };
  record.github = Object.keys(github).length > 0 ? github : null;
  record.evidence_hash = evidenceHash(record);
  return record;
}

export async function emitGithub(
  report: VerificationReport,
  options: EmitGithubOptions,
): Promise<void> {
  const context = options.context;
  if (context?.inActions) {
    const annotations = renderGithub(report);
    if (annotations) {
      process.stdout.write(`${annotations}\n`);
    }
    if (process.env.GITHUB_STEP_SUMMARY) {
      writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${renderGithubSummary(report)}\n`, {
        flag: "a",
      });
    }
    writeGithubOutput(report);
  }

  if (!options.comment) return;
  await postPrComment(report, options);
}

async function postPrComment(
  report: VerificationReport,
  options: EmitGithubOptions,
): Promise<void> {
  const warn = options.onWarning ?? ((message: string) => process.stderr.write(`${message}\n`));
  const context = options.context;
  if (!context) {
    warn("Guardian comment skipped: no GitHub context.");
    return;
  }
  if (!context.token) {
    warn("Guardian comment skipped: GITHUB_TOKEN is not set.");
    return;
  }
  if (!context.owner || !context.repo) {
    warn("Guardian comment skipped: GITHUB_REPOSITORY is not set.");
    return;
  }
  if (!context.pullRequest) {
    warn("Guardian comment skipped: no pull request number.");
    return;
  }

  try {
    const client = createGithubClient({
      token: context.token,
      owner: context.owner,
      repo: context.repo,
      apiUrl: context.apiUrl,
      fetch: options.fetch,
    });
    const body = renderPrComment(report);
    const { comment, updated } = await upsertDecisionComment(
      client,
      context.pullRequest.number,
      body,
    );
    report.decision.github = {
      ...(report.decision.github ?? {}),
      comment_id: comment.id,
      comment_url: comment.html_url,
    };
    process.stdout.write(
      `PR comment ${updated ? "updated" : "created"}: ${comment.html_url || `#${comment.id}`}\n`,
    );
  } catch (error) {
    warn(
      `Guardian comment failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function writeGithubOutput(report: VerificationReport): void {
  if (!process.env.GITHUB_OUTPUT) return;
  const pr = report.decision.pull_request?.number ?? "";
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `decision=${report.decision.result}`,
      `violations=${report.decision.summary.violation_count}`,
      `decision_id=${report.decision.decision_id}`,
      `contract_hash=${report.contract_hash}`,
      `evidence_hash=${report.decision.evidence_hash}`,
      `pull_request=${pr}`,
      "",
    ].join("\n"),
  );
}
