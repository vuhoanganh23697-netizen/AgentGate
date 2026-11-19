/**
 * config/agentgate.config.mjs
 * ============================================================================
 * STEP 4 AFTER REMIX DEPLOY:
 * Paste your deployed & BscScan-verified AgentGate contract address into
 * `agentGateContract` below (or run `node scripts/set-contract.mjs 0x...`),
 * push to GitHub, and Vercel switches automatically to Live On-Chain Mode.
 * ============================================================================
 */
export const AGENTGATE_CONFIG = {
  chainId: 56,
  agentGateContract: "0x0990922719B453988A054Fa4d6337aeB8884cB75",
  agentIdRegistry: "0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F",
  rpcUrls: [
    "https://bsc-dataseed.bnbchain.org",
    "https://bsc.publicnode.com"
  ]
};

export default AGENTGATE_CONFIG;
