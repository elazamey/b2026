import type { SqlExecutor, SqlResult, SqlValue } from "../store/sql.js";

const WRITE_RE =
  /\b(insert|update|delete|drop|alter|create|replace|attach|detach|pragma|vacuum|reindex|grant|revoke)\b/i;

export class ReadOnlySqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReadOnlySqlError";
  }
}

export function assertReadOnlySql(sql: string): void {
  const stripped = sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!/^select\b/i.test(stripped)) {
    throw new ReadOnlySqlError("Control plane is read-only: only SELECT is allowed.");
  }
  if (WRITE_RE.test(stripped) || /\binto\b/i.test(stripped) || /\bfor update\b/i.test(stripped)) {
    throw new ReadOnlySqlError("Control plane cannot execute a statement that might write.");
  }
}

export class ReadOnlySql implements SqlExecutor {
  constructor(private readonly inner: SqlExecutor) {}

  async execute(sql: string, args: SqlValue[] = []): Promise<SqlResult> {
    assertReadOnlySql(sql);
    return this.inner.execute(sql, args);
  }
}
