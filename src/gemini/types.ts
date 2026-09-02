export const REVIEW_SCHEMA_VERSION = "0.8";

export const GEMINI_CAPABILITIES = {
  may_decide: false,
  may_merge: false,
  may_override: false,
  may_rewrite_decision: false,
  authority: "advisory",
} as const;

export type ReviewRisk = "low" | "medium" | "high";

export interface AiReview {
  schema_version: typeof REVIEW_SCHEMA_VERSION;
  review_id: string;
  decision_id: string;
  authority: "advisory";
  provider: "gemini";
  model: string;
  risk: ReviewRisk;
  explanation: string;
  repair_plan: string[];
  created_at: string;
}

export interface ReviewSkip {
  skipped: true;
  reason: "disabled" | "unavailable" | "not_rejected" | "no_key";
  decision_id: string;
}

export type ReviewResult = AiReview | ReviewSkip;

export function isReviewSkip(value: ReviewResult): value is ReviewSkip {
  return "skipped" in value && value.skipped === true;
}
