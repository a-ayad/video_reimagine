/**
 * Custom HTTPS server for production Next.js.
 *
 * `next start` doesn't speak HTTPS natively; for the systemd "always on"
 * deployment we wrap Next with a tiny https.createServer() that loads the
 * Tailscale-issued Let's Encrypt cert. Plain HTTP would also work — but
 * WebGPU requires a secure context everywhere except localhost, so HTTPS
 * is required for the preview to function from any tailnet device.
 *
 * Env:
 *   PORT          listen port (default 8091)
 *   HOST          listen host (default 0.0.0.0)
 *   HTTPS_KEY     path to TLS private key
 *   HTTPS_CERT    path to TLS certificate
 *
 * If HTTPS_KEY/HTTPS_CERT are unset or unreadable, we fall back to plain
 * HTTP so the service can still boot.
 */
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "node:url";

import next from "next";

const port = parseInt(process.env.PORT || "8091", 10);
const hostname = process.env.HOST || "0.0.0.0";
const certPath = process.env.HTTPS_CERT;
const keyPath = process.env.HTTPS_KEY;

const useHttps =
  certPath && keyPath && existsSync(certPath) && existsSync(keyPath);

const app = next({ dev: false, hostname, port });
const handle = app.getRequestHandler();

await app.prepare();

const requestHandler = (req, res) => {
  const parsedUrl = parse(req.url, true);
  handle(req, res, parsedUrl);
};

let server;
let scheme;
if (useHttps) {
  server = createHttpsServer(
    {
      key: readFileSync(keyPath),
      cert: readFileSync(certPath),
    },
    requestHandler,
  );
  scheme = "https";
} else {
  server = createHttpServer(requestHandler);
  scheme = "http";
  if (certPath || keyPath) {
    console.warn(
      `[server] cert/key not found at ${certPath} / ${keyPath} — falling back to HTTP`,
    );
  }
}

server.listen(port, hostname, () => {
  console.log(`> video_reimagine ready on ${scheme}://${hostname}:${port}`);
});

const shutdown = (signal) => {
  console.log(`> received ${signal}, shutting down`);
  server.close(() => {
    process.exit(0);
  });
  // hard exit if close hangs
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
