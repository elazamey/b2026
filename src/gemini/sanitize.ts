import { randomBytes } from "node:crypto";
import { GEMINI_CAPABILITIES, REVIEW_SCHEMA_VERSION, type AiReview, type ReviewRisk } from "./types.js";

export function newReviewId(): string {
  return `rv_${randomBytes(8).toString("hex")}`;
}

export function sanitizeReview(input: {
  decisionId: string;
  model: string;
  raw: unknown;
}): AiReview {
  const source = asRecord(input.raw);
  const risk = parseRisk(source.risk);
  const explanation = asString(source.explanation) || "No explanation returned.";
  const repair_plan = asStringList(source.repair_plan);
  const review: AiReview = {
    schema_version: REVIEW_SCHEMA_VERSION,
    review_id: newReviewId(),
    decision_id: input.decisionId,
    authority: GEMINI_CAPABILITIES.authority,
    provider: "gemini",
    model: input.model,
    risk,
    explanation,
    repair_plan,
    created_at: new Date().toISOString(),
  };
  assertAdvisory(review);
  return review;
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const payload = fenced?.[1]?.trim() ?? trimmed;
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return { explanation: payload, risk: "medium", repair_plan: [] };
  }
}

function assertAdvisory(review: AiReview): void {
  if (review.authority !== "advisory") {
    throw new Error("Gemini review must be advisory.");
  }
  if ("result" in review) {
    throw new Error("Gemini review cannot carry a Guardian result.");
  }
  if (GEMINI_CAPABILITIES.may_decide || GEMINI_CAPABILITIES.may_merge) {
    throw new Error("Gemini cannot decide or merge.");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const copy = { ...(value as Record<string, unknown>) };
    delete copy.result;
    delete copy.decision;
    delete copy.SAFE_TO_MERGE;
    return copy;
  }
  return {};
}

function parseRisk(value: unknown): ReviewRisk {
  if (value === "low" || value === "medium" || value === "high") return value;
  return "medium";
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => asString(item)).filter(Boolean).slice(0, 12);
}
