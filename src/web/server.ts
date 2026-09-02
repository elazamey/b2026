import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ControlPlaneReader } from "../control-plane/types.js";
import { handleSiteRequest } from "./router.js";

export function startSite(options: {
  host: string;
  port: number;
  reader: ControlPlaneReader;
}): Server {
  const server = createServer((req, res) => {
    void serve(req, res, options.reader);
  });
  server.listen(options.port, options.host);
  return server;
}

async function serve(
  req: IncomingMessage,
  res: ServerResponse,
  reader: ControlPlaneReader,
): Promise<void> {
  try {
    const body = await readBody(req);
    const response = await handleSiteRequest(
      {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
        body,
      },
      reader,
    );
    res.writeHead(response.status, response.headers);
    res.end(response.body);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.writeHead(503, {
      "content-type": "text/plain; charset=utf-8",
      "x-guardian-writable": "false",
    });
    res.end(`Product UI unavailable: ${message}\nGuardian decisions are unchanged.\n`);
  }
}

async function readBody(req: IncomingMessage): Promise<string> {
  if (req.method === "GET" || req.method === "HEAD" || !req.method) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}
