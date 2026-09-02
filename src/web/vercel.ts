import type { ControlPlaneReader } from "../control-plane/types.js";
import { createControlPlaneReader } from "../control-plane/reader.js";
import { vercelRequestUrl, type VercelLikeRequest, type VercelLikeResponse } from "../control-plane/vercel.js";
import { createIdentityStore } from "../identity/store.js";
import type { IdentityStore } from "../identity/types.js";
import { handleSiteRequest } from "./router.js";

export { vercelRequestUrl } from "../control-plane/vercel.js";

export function createVercelHandler(options: {
  root?: string;
  env?: NodeJS.ProcessEnv;
  reader?: ControlPlaneReader;
  identity?: IdentityStore;
} = {}) {
  return async function vercelHandler(
    req: VercelLikeRequest & { body?: string },
    res: VercelLikeResponse,
  ): Promise<void> {
    try {
      const root = options.root ?? process.cwd();
      const env = options.env ?? process.env;
      const reader =
        options.reader ??
        createControlPlaneReader({
          root,
          env,
        });
      const identity = options.identity ?? createIdentityStore({ root, env });
      const response = await handleSiteRequest(
        {
          method: req.method ?? "GET",
          url: vercelRequestUrl(req),
          headers: req.headers,
          body: typeof req.body === "string" ? req.body : "",
        },
        reader,
        identity,
      );
      res.statusCode = response.status;
      for (const [name, value] of Object.entries(response.headers)) {
        res.setHeader(name, value);
      }
      res.end(response.body);
    } catch {
      res.statusCode = 503;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-guardian-writable", "false");
      res.end(
        "Product UI unavailable. Dashboard is degraded. Guardian decisions are unchanged.\n",
      );
    }
  };
}

const handler = createVercelHandler();
export default handler;
