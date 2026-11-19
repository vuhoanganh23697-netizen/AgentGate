# AgentGate — Sovereign Editorial Research Deck

**Verify smart contract privileges before your AI Agent signs — Free for every `.ai` on Chain 56.**

`AgentGate` is an open-web Pre-Sign Privilege Firewall, Soulbound `.ai` Research Registry, and Zero-Fee Dual-Rail `HTTP 402` + `MCP` server built natively for AI Agent Wallets on Chain 56.

- **Open Web · Zero Browser Wallet Popup:** Because AI Agent Wallets act via natural-language chat and MCP rather than browser `window.ethereum` popups, `AgentGate` generates ready-to-paste **AI Agent Prompts** (with pre-filled 8-flag scan telemetry) alongside live `/mcp` JSON-RPC tools and `baw` CLI calldata. Zero QR login, zero pairing codes, zero session cookies.
- **100% Pure-Data Nonpayable Contract (`value = 0, approve = 0`):** Every entrypoint in `AgentGate.sol` (`unlockGenesisReport()`, `unlockReport(bytes32)`, `recordPreSignAudit`, `logPreSignCheck`, `voteNextAudit`, `anchorCommunityReport`, `anchorEditorialReport`) is strictly `nonpayable` or `view`. Zero `payable`, tip, `receive()`, or `fallback()` functions exist anywhere in bytecode.
- **Zero-Token-Risk `HTTP 402` (`GET /api/report`):** Returns `HTTP 402` with `PAYMENT-REQUIRED` header offering **Branch A (`0` fee nonpayable attestation on `AgentGate`)** and **Branch B (`0` fee read-only SPACE ID Agent ID registry verification)** — both `amount: "0"` so no ERC-20 tokens can ever be sent to an unmonitored address.

---

## Quick Deploy Workflow (Remix IDE -> GitHub -> Vercel)

### 1. Deploy & Verify `contracts/AgentGate.sol` on Chain 56
1. Open [Remix IDE](https://remix.ethereum.org) using a **fresh dedicated deployer EOA wallet** funded with only `~0.003–0.005 BNB` for deployment gas (best operational hygiene: never use a main personal vault wallet to deploy public contracts). Upload `contracts/AgentGate.sol`.
2. Select **Solidity Compiler `0.8.24`**, enable **Optimization (`200` runs)**, **EVM Version: `paris`**.
3. Deploy `AgentGate` on **Chain ID 56** (`0` constructor arguments — the Genesis `SHA-256` hash is pre-anchored automatically).
4. Verify single-file source code on BscScan (`MIT` license, `v0.8.24+commit.e11b9ed9`, Optimization `Yes / 200`, EVM `paris`).

### 2. Paste Deployed Contract Address into Config (`1` line)
Either edit [`config/agentgate.config.mjs`](./config/agentgate.config.mjs) (and [`config/agentgate.config.json`](./config/agentgate.config.json)) directly on GitHub:
```js
agentGateContract: "0xYourDeployedAgentGateAddress",
```
or run locally:
```bash
node scripts/set-contract.mjs 0xYourDeployedAgentGateAddress
```
*(Optional Vercel Environment Variables: `AGENTGATE_CONTRACT=0x...` and `AGENTGATE_HMAC_SECRET=<random-secret>`).*

### 3. Push to GitHub & Import on Vercel
1. Push this repository to a Public GitHub repo.
2. In **Vercel** -> **Add New Project** -> Import the GitHub repository -> Click **Deploy** (zero build step, zero npm dependencies, Node `>= 20` Serverless `/api/gateway` + static `/public`).

---

## Disclosed Smart Contract Permissions & Anti-Farming Invariants (`contracts/AgentGate.sol`)

- **License:** `MIT` (`pragma solidity 0.8.24;`)
- **100% Pure-Data Nonpayable (`Zero Money`):** Exposes **ZERO** `payable` functions, **ZERO** `receive()`, **ZERO** `fallback()`, **ZERO** native value transfers, and **ZERO** ERC-20 token approvals. Any transaction sent with `msg.value > 0` reverts immediately. Any ERC-20 tokens mistakenly transferred directly to the contract address cannot be recovered because no admin sweep function exists.
- **Privileges:** Exposes **NO** `mint`, **NO** `tax`, **NO** `pause`, **NO** `freeze`, **NO** `blacklist`, and **NO** `proxy` upgradeability.
- **`editorialPublisher` (`immutable`):** Set once at deployment; can only call `anchorEditorialReport(bytes32,address)` to anchor new SHA-256 research hashes and holds zero financial privileges.
- **Anti-Farming & Anti-Wash-Volume Caps:**
  - `unlockGenesisReport()` / `unlockReport(bytes32)`: max **1** unlock per `(wallet, reportHash)` ever.
  - `recordPreSignAudit` / `logPreSignCheck`: requires `subjectContract.code.length > 0` (rejects random EOAs), max **1** receipt per `(wallet, subjectContract)` lifetime, and max **5** receipts per wallet per UTC day.
  - `voteNextAudit(address)`: requires `candidateContract.code.length > 0`, max **1** vote per `(wallet, UTC day)`.
  - `anchorCommunityReport`: requires `subjectContract.code.length > 0`, max **1** community anchor per `(wallet, UTC day)`.

---

## Local Verification & Self-Test

```bash
node scripts/verify-production.mjs
node dev-server.mjs
```
