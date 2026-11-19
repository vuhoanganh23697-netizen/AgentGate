/**
 * worker.js
 * Optional Cloudflare Workers / Pages Edge entrypoint sharing 100% of lib/agentgate-core.mjs.
 */
import { handleAgentGateRequest } from "./lib/agentgate-core.mjs";

export default {
  async fetch(request, env = {}) {
    const apiRes = await handleAgentGateRequest(request, env);
    if (apiRes) return apiRes;
    if (env && env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  }
};
