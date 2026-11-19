/**
 * dev-server.mjs
 * Zero-dependency local Node >= 20 server for previewing AgentGate locally.
 * Usage: node dev-server.mjs
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import worker from "./worker.js";

const pub = fileURLToPath(new URL("./public/", import.meta.url));
const port = Number(process.env.PORT || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

const env = {
  ASSETS: {
    async fetch(request) {
      const url = new URL(request.url);
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const rel = pathname.replace(/^\/+/, "");
      if (rel.includes("\0") || rel.split("/").includes("..")) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = join(pub, rel);
      if (!file.startsWith(pub)) return new Response("Forbidden", { status: 403 });
      try {
        const data = await readFile(file);
        const type = types[extname(file)] || "application/octet-stream";
        return new Response(data, {
          headers: {
            "content-type": type,
            "x-content-type-options": "nosniff",
            "referrer-policy": "no-referrer"
          }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  }
};

const server = createServer(async (req, res) => {
  try {
    const host = req.headers.host || `127.0.0.1:${port}`;
    const url = new URL(req.url || "/", `http://${host}`);
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (value == null) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const request = new Request(url, {
      method: req.method,
      headers,
      body: body.length && req.method !== "GET" && req.method !== "HEAD" ? body : undefined
    });
    const response = await worker.fetch(request, env, {});
    const out = Buffer.from(await response.arrayBuffer());
    const outHeaders = {};
    response.headers.forEach((value, key) => {
      outHeaders[key] = value;
    });
    res.writeHead(response.status, outHeaders);
    res.end(req.method === "HEAD" ? undefined : out);
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(error instanceof Error ? error.message : "Server error");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`AgentGate Sovereign Editorial Deck listening on http://127.0.0.1:${port}`);
});
