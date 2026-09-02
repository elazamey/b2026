import { randomBytes } from "node:crypto";

export function decisionId(now = new Date()): string {
  const time = now.getTime().toString(36);
  const entropy = randomBytes(6).toString("hex");
  return `dg_${time}${entropy}`;
}
