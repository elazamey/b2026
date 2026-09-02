import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AiReview } from "./types.js";

export interface ReviewStore {
  save(review: AiReview): Promise<AiReview>;
  getByDecision(decisionId: string): Promise<AiReview | null>;
}

export class MemoryReviewStore implements ReviewStore {
  protected reviews = new Map<string, AiReview>();

  async save(review: AiReview): Promise<AiReview> {
    if (review.authority !== "advisory") {
      throw new Error("Review ledger only stores advisory records.");
    }
    if ("result" in review) {
      throw new Error("Review ledger cannot store a Guardian result.");
    }
    this.reviews.set(review.decision_id, review);
    this.persist(review);
    return review;
  }

  async getByDecision(decisionId: string): Promise<AiReview | null> {
    return this.reviews.get(decisionId) ?? null;
  }

  protected persist(_review: AiReview): void {
    /* memory */
  }
}

export class FileReviewStore extends MemoryReviewStore {
  constructor(private readonly dir: string) {
    super();
  }

  override async getByDecision(decisionId: string): Promise<AiReview | null> {
    const cached = await super.getByDecision(decisionId);
    if (cached) return cached;
    const path = resolve(this.dir, `${decisionId}.json`);
    if (!existsSync(path)) return null;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as AiReview;
      if (parsed.authority !== "advisory" || parsed.decision_id !== decisionId) return null;
      this.reviews.set(decisionId, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  protected override persist(review: AiReview): void {
    mkdirSync(this.dir, { recursive: true });
    const path = resolve(this.dir, `${review.decision_id}.json`);
    writeFileSync(path, `${JSON.stringify(review, null, 2)}\n`, "utf8");
    writeFileSync(resolve(this.dir, "latest.json"), `${JSON.stringify(review, null, 2)}\n`, "utf8");
  }
}

export function defaultReviewDir(root: string): string {
  return resolve(root, ".guardian", "reviews");
}

export function createReviewStore(root: string): ReviewStore {
  const dir = defaultReviewDir(root);
  const store = new FileReviewStore(dir);
  const latest = resolve(dir, "latest.json");
  if (existsSync(latest)) {
    try {
      const parsed = JSON.parse(readFileSync(latest, "utf8")) as AiReview;
      if (parsed?.decision_id && parsed.authority === "advisory") {
        void store.save(parsed);
      }
    } catch {
      /* empty */
    }
  }
  return store;
}

export function reviewPath(root: string, decisionId: string): string {
  return resolve(defaultReviewDir(root), `${decisionId}.json`);
}
