/**
 * api/gateway.mjs
 * Vercel Serverless Function Adapter (Node >= 20, zero external dependencies).
 * Handles all /api/* and /mcp routes rewritten via vercel.json.
 */
import { handleAgentGateRequest, json } from "../lib/agentgate-core.mjs";

export default async function handler(req, res) {
  try {
    const proto = req.headers["x-forwarded-proto"] || "https";
    const host = req.headers["x-forwarded-host"] || req.headers.host || "127.0.0.1";
    const incomingUrl = new URL(req.url || "/", `${proto}://${host}`);

    const rewrittenRoute = incomingUrl.searchParams.get("__ag_route");
    if (rewrittenRoute) {
      incomingUrl.pathname = rewrittenRoute.startsWith("/") ? rewrittenRoute : "/" + rewrittenRoute;
      incomingUrl.searchParams.delete("__ag_route");
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers || {})) {
      if (value == null) continue;
      headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
    }

    let bodyBytes;
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
      let parsedBody;
      let hasParsedBody = false;
      try {
        if ("body" in req && req.body !== undefined && req.body !== null) {
          parsedBody = req.body;
          hasParsedBody = true;
        }
      } catch {
        res.statusCode = 400;
        res.setHeader("content-type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
        return;
      }

      if (hasParsedBody) {
        if (Buffer.isBuffer(parsedBody) || parsedBody instanceof Uint8Array) {
          bodyBytes = parsedBody;
        } else if (typeof parsedBody === "string") {
          bodyBytes = Buffer.from(parsedBody, "utf8");
        } else {
          bodyBytes = Buffer.from(JSON.stringify(parsedBody), "utf8");
        }
      } else if (req.readable) {
        const chunks = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        if (chunks.length) bodyBytes = Buffer.concat(chunks);
      }
    }

    const webReq = new Request(incomingUrl.toString(), {
      method: req.method || "GET",
      headers,
      body: bodyBytes && bodyBytes.length ? bodyBytes : undefined
    });

    const webRes = (await handleAgentGateRequest(webReq, process.env)) || json({ ok: false, error: "not_found" }, 404);
    const outBuffer = Buffer.from(await webRes.arrayBuffer());

    res.statusCode = webRes.status;
    webRes.headers.forEach((val, key) => {
      res.setHeader(key, val);
    });
    res.end(req.method === "HEAD" ? undefined : outBuffer);
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "gateway_error" }));
  }
}
