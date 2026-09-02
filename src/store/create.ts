import { FileDecisionStore } from "./file-store.js";
import { LibsqlHttpClient } from "./libsql-http.js";
import { CompositeDecisionStore } from "./composite-store.js";
import { SqlTursoDriver } from "./turso-driver.js";
import { TursoDecisionStore } from "./turso-store.js";
import type { DecisionStore } from "./types.js";

export interface TursoConfig {
  url: string;
  token: string;
}

export function readTursoConfig(
  env: NodeJS.ProcessEnv = process.env,
  onWarning?: (message: string) => void,
): TursoConfig | null {
  const url = env.TURSO_DATABASE_URL?.trim();
  const token = env.TURSO_AUTH_TOKEN?.trim();
  if (!url && !token) return null;
  if (!url || !token) {
    onWarning?.(
      "Turso skipped: both TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are required. Local ledger retained.",
    );
    return null;
  }
  return { url, token };
}

export function createDecisionStore(options: {
  root: string;
  extraPath?: string;
  env?: NodeJS.ProcessEnv;
  disableTurso?: boolean;
  onWarning?: (message: string) => void;
}): DecisionStore {
  const local = new FileDecisionStore(options.root, options.extraPath);
  if (options.disableTurso) {
    return new CompositeDecisionStore(local, null, options.onWarning);
  }
  const config = readTursoConfig(options.env);
  if (!config) {
    return new CompositeDecisionStore(local, null, options.onWarning);
  }
  const remote = new TursoDecisionStore(
    new SqlTursoDriver(
      new LibsqlHttpClient({
        url: config.url,
        token: config.token,
      }),
    ),
  );
  return new CompositeDecisionStore(local, remote, options.onWarning);
}
