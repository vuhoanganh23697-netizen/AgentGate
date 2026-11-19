---
name: agentgate-firewall
description: |
  Open-web Pre-Sign Contract Privilege Firewall and 100% nonpayable Soulbound Agent ID (.ai) research unlock protocol on Chain 56.
  Operates via AI Agent chat prompts, MCP (/mcp), HTTP 402 (/api/report), and 3-step baw CLI without browser wallet popups or QR login.
metadata:
  author: agentgate-community
  version: '1.3.0'
---

# AgentGate Pre-Sign Firewall Skill

## Hard Safety Invariants (Never Override)

1. **Open Web — Zero Browser Wallet Login / Zero QR / Zero Stored Sessions (Red Line #1):** Never ask the user to scan a login QR code, enter a pairing code, or connect a browser wallet session. Interact strictly through the user's AI Agent Wallet chat, MCP tools, or local `baw` CLI.
2. **Mandatory Human Confirmation (Red Line #2):** Never execute a state-changing contract call without first simulating / running `preview`, showing `to`, `value: 0`, `approve: 0`, and waiting for explicit human confirmation in a separate turn.
3. **100% Pure-Data Nonpayable Contract — Zero Value Transfers (Red Line #3):** Every entrypoint in `AgentGate.sol` (`unlockGenesisReport()`, `unlockReport(bytes32)`, `recordPreSignAudit(address,uint8,string)`, `logPreSignCheck(address,bytes32)`, `voteNextAudit(address)`, `anchorCommunityReport(bytes32,address)`) is strictly `nonpayable` (`value = 0`, zero ERC-20 approvals). Zero `payable`, tip, `receive()`, or `fallback()` functions exist anywhere in `AgentGate.sol`.
4. **Privacy Protection — `0x` Contract Addresses Only (Red Line #9):** Never pass `.ai` handles into `/api/scan` or attempt to reverse-resolve another person's `.ai` handle to a wallet address.
5. **Neutral Telemetry Only (Red Lines #7 & #8):** Present exact flag counts (`X / 8 flags triggered`) and buy/sell tax numbers without promising returns or giving investment advice.

## Workflow (AI Agent Chat / MCP / CLI)

1. **Scan Target Contract Before Signing:**
   - Call MCP `scan_privileges` or `POST /api/scan` with `{"address": "0x..."}` (42-char hex contract address).
2. **Preview & Confirm Nonpayable Receipt on Chain 56 (`value = 0, approve = 0`):**
   - Ensure **Developer Mode** is enabled in Agentic Wallet Settings when calling external Chain 56 contracts.
   - Call `recordPreSignAudit(address subjectContract, uint8 triggeredFlags, string note)` (selector `0x817b5939`) or zero-arg `unlockGenesisReport()` (selector `0x9bff561c`) after showing the simulation preview and receiving explicit user confirmation.
3. **Verify Confirmed Chain 56 Transaction Hash:**
   - Submit the confirmed 66-character `txHash` (`0x...`) to `POST /api/verify-onchain` (or MCP `verify_onchain_unlock`) to verify the on-chain receipt and retrieve the SHA-256 anchored research essay.
