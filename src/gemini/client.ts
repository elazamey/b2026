import type { DecisionRecord } from "../types.js";
import { sanitizeReview, parseModelJson } from "./sanitize.js";
import { GEMINI_CAPABILITIES, type ReviewResult } from "./types.js";

const DEFAULT_MODEL = "gemini-2.0-flash";

export interface GeminiReviewer {
  review(decision: DecisionRecord): Promise<ReviewResult>;
}

export function createGeminiReviewer(options: {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  disabled?: boolean;
} = {}): GeminiReviewer {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    async review(decision) {
      if (options.disabled) {
        return { skipped: true, reason: "disabled", decision_id: decision.decision_id };
      }
      if (decision.result !== "REJECTED") {
        return { skipped: true, reason: "not_rejected", decision_id: decision.decision_id };
      }
      const key = env.GEMINI_API_KEY?.trim();
      if (!key) {
        return { skipped: true, reason: "no_key", decision_id: decision.decision_id };
      }
      const model = env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
      try {
        const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": key,
          },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: reviewPrompt(decision) }] }],
            generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
          }),
        });
        if (!response.ok) {
          return { skipped: true, reason: "unavailable", decision_id: decision.decision_id };
        }
        const payload = (await response.json()) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
        };
        const text = payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        const review = sanitizeReview({
          decisionId: decision.decision_id,
          model,
          raw: parseModelJson(text),
        });
        if (review.authority !== GEMINI_CAPABILITIES.authority) {
          return { skipped: true, reason: "unavailable", decision_id: decision.decision_id };
        }
        return review;
      } catch {
        return { skipped: true, reason: "unavailable", decision_id: decision.decision_id };
      }
    },
  };
}

export async function maybeCreateReview(options: {
  decision: DecisionRecord;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  disabled?: boolean;
}): Promise<ReviewResult> {
  return createGeminiReviewer(options).review(options.decision);
}

function reviewPrompt(decision: DecisionRecord): string {
  const findings = decision.violations
    .map((item) => `- [${item.id}] ${item.message}${item.file ? ` (${item.file})` : ""}`)
    .join("\n");
  return [
    "You are an advisory reviewer for AI Guardian.",
    "You cannot approve a merge. You cannot emit SAFE_TO_MERGE as a decision.",
    "Guardian already decided REJECTED. Explain why and propose a repair plan.",
    "Return JSON only with keys risk, explanation, repair_plan.",
    "risk must be low, medium, or high. repair_plan is an array of short strings.",
    `decision_id=${decision.decision_id}`,
    `repository=${decision.repository}`,
    `contract_hash=${decision.contract_hash}`,
    `violations:`,
    findings || "- none listed",
  ].join("\n");
}
