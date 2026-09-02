import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { ControlPlaneReader } from "./types.js";
import { handleControlPlaneRequest } from "./http.js";

export function startControlPlane(options: {
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
    const response = await handleControlPlaneRequest(
      {
        method: req.method ?? "GET",
        url: req.url ?? "/",
        headers: req.headers,
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
    res.end(`Control plane unavailable: ${message}\nThe dashboard does not decide.\n`);
  }
}
