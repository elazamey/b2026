import { query } from "../server/db.js";

export function User(): string {
  const api_key = "sk-supersecret-live-key-value-123456";
  return query() + api_key;
}
