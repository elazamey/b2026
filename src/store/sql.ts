export type SqlValue = string | number | null;

export interface SqlRow {
  [column: string]: SqlValue;
}

export interface SqlResult {
  rows: SqlRow[];
  affected: number;
}

export interface SqlExecutor {
  execute(sql: string, args?: SqlValue[]): Promise<SqlResult>;
}

export function libsqlArg(value: SqlValue): { type: string; value: string | null } {
  if (value == null) return { type: "null", value: null };
  if (typeof value === "number") return { type: "integer", value: String(value) };
  return { type: "text", value };
}
