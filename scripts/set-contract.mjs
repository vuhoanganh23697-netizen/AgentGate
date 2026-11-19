/**
 * scripts/set-contract.mjs
 * One-command helper to set the deployed Remix contract address in both config files.
 * Usage:
 *   node scripts/set-contract.mjs 0xYourDeployedContractAddress
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const jsonPath = join(root, "config", "agentgate.config.json");
const mjsPath = join(root, "config", "agentgate.config.mjs");

const rawAddr = (process.argv[2] || "").trim();

if (!/^0x[0-9a-fA-F]{40}$/.test(rawAddr)) {
  console.error("Error: Please pass a valid 42-character 0x contract address.");
  console.error("Example: node scripts/set-contract.mjs 0x1234567890abcdef1234567890abcdef12345678");
  process.exit(1);
}

const cfg = JSON.parse(readFileSync(jsonPath, "utf8"));
cfg.agentGateContract = rawAddr;

writeFileSync(jsonPath, JSON.stringify(cfg, null, 2) + "\n", "utf8");

const mjsContent = `/**
 * config/agentgate.config.mjs
 * ============================================================================
 * STEP 4 AFTER REMIX DEPLOY:
 * Paste your deployed & BscScan-verified AgentGate contract address into
 * \`agentGateContract\` below (or run \`node scripts/set-contract.mjs 0x...\`),
 * push to GitHub, and Vercel switches automatically to Live On-Chain Mode.
 * ============================================================================
 */
export const AGENTGATE_CONFIG = ${JSON.stringify(cfg, null, 2)};

export default AGENTGATE_CONFIG;
`;

writeFileSync(mjsPath, mjsContent, "utf8");
console.log("Updated config/agentgate.config.mjs & config/agentgate.config.json:");
console.log("  agentGateContract =", cfg.agentGateContract);
