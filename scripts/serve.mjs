import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_FILES } from "./site-files.mjs";

// Only the public manifest is accessible; .env, scripts, tests and config stay private.
const root = fileURLToPath(new URL("../", import.meta.url));
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end("Method not allowed");
    return;
  }
  let route;
  try { route = new URL(req.url, "http://localhost").pathname; }
  catch { res.writeHead(400).end("Bad request"); return; }
  const path = route === "/" ? "index.html" : route.slice(1);
  const type = SITE_FILES.get(path);
  if (!type) { res.writeHead(404).end("Not found"); return; }
  try {
    const body = await readFile(resolve(root, path));
    res.writeHead(200, { "Content-Type": type });
    res.end(req.method === "HEAD" ? undefined : body);
  } catch { res.writeHead(404).end("Not found"); }
});
const requestedPort = process.env.PORT ?? "4173";
if (!/^\d{1,5}$/.test(requestedPort) || Number(requestedPort) > 65535) {
  throw new RangeError("PORT must be a number from 0 to 65535");
}
server.listen(Number(requestedPort), "127.0.0.1", () => {
  const { port } = server.address();
  console.log(`F1 Start Timer running at http://127.0.0.1:${port}/`);
});
