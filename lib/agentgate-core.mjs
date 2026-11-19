/**
 * lib/agentgate-core.mjs
 * Universal zero-dependency Web Handler for AgentGate Sovereign Editorial Research Deck.
 * Runs identically on Vercel Serverless (api/gateway.mjs), Cloudflare Workers (worker.js), and local Node >= 20 (dev-server.mjs).
 */

import { AGENTGATE_CONFIG } from "../config/agentgate.config.mjs";

const REGISTRY = AGENTGATE_CONFIG.agentIdRegistry.toLowerCase();
const CAKE = "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82";
const USDT = "0x55d398326f99059ff775485246999027b3197955";
const BTCB = "0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c";
const ETH_BSC = "0x2170ed0880ac9a755fd29b2688956bd959f933f8";
const TRAP = "0xdead00000000000000000000000000000000beef";
const ZERO = "0x0000000000000000000000000000000000000000";
const EIP1967 = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

// Exact 4-byte selectors compiled by solc 0.8.24 from contracts/AgentGate.sol (100% nonpayable / view)
export const SELECTORS_AGENTGATE = {
  unlockGenesisReport: "9bff561c",   // unlockGenesisReport()
  unlockReport: "8944dc76",          // unlockReport(bytes32)
  recordPreSignAudit: "817b5939",    // recordPreSignAudit(address,uint8,string)
  logPreSignCheck: "9c61e435",       // logPreSignCheck(address,bytes32)
  voteNextAudit: "e106a9be",         // voteNextAudit(address)
  anchorCommunityReport: "84010814", // anchorCommunityReport(bytes32,address)
  hasUnlockedGenesis: "e7c3df51",    // hasUnlockedGenesis(address)
  hasUnlockedReport: "87b9064e",     // hasUnlockedReport(bytes32,address)
  checkHoldsAgentId: "39aff541",     // checkHoldsAgentId(address)
  getProtocolStats: "2c35d1ed",      // getProtocolStats(bytes32)
  getBallotTallies: "fe390632",      // getBallotTallies(address[4])
  getRecentReceipts: "72270cbb"      // getRecentReceipts()
};

const TOPIC_REPORT_UNLOCKED = "0x50b2eff4d5fd64769da1ae05a7f56b79121cf13f0a34d14ae97571b2752393a8";
const TOPIC_AUDIT_RECORDED = "0x79ddb5de75bb4c9f3c3d2f7a2514f6c5f2db800fef7dea8700db0138acc443bb";

const VALID_UNLOCK_TX_SELECTORS = new Set([
  "0x" + SELECTORS_AGENTGATE.unlockGenesisReport,
  "0x" + SELECTORS_AGENTGATE.unlockReport,
  "0x" + SELECTORS_AGENTGATE.recordPreSignAudit,
  "0x" + SELECTORS_AGENTGATE.logPreSignCheck
]);

const BALLOT_CANDIDATES = [CAKE, USDT, BTCB, ETH_BSC];
const SAMPLE_LABEL = "[UI Sample]";
const SAMPLE_READERS = 86;
const SAMPLE_RECEIPTS = 1284;
const GAS_ESTIMATE = "~0.00005 BNB (< $0.05)";

// 15-second in-memory cache for public RPC reads under high traffic bursts
let _liveStatsCache = { contract: "", expiresAt: 0, value: null };
const _verifiedTxCache = new Map();

const FLAG_IDS = [
  "owner_retained",
  "mint_selector",
  "pause_selector",
  "tax_selector",
  "blacklist_selector",
  "proxy_upgrade",
  "trading_switch",
  "reflection_fee"
];

const SELECTORS = [
  ["40c10f19", "mint(address,uint256)", "mint_selector"],
  ["a0712d68", "mint(uint256)", "mint_selector"],
  ["8456cb59", "pause()", "pause_selector"],
  ["3f4ba83a", "unpause()", "pause_selector"],
  ["5c975abb", "paused()", "pause_selector"],
  ["c4081a4c", "setTaxFee(uint256)", "tax_selector"],
  ["dc1052e2", "setBuyTax(uint256)", "tax_selector"],
  ["8cd09d50", "setSellTax(uint256)", "tax_selector"],
  ["cc1776d3", "sellTax()", "tax_selector"],
  ["4f7041a5", "buyTax()", "tax_selector"],
  ["a071dcf4", "taxFee()", "tax_selector"],
  ["69fe0e2d", "setFee(uint256)", "tax_selector"],
  ["0b78f9c0", "setFees(uint256,uint256)", "tax_selector"],
  ["437823ec", "excludeFromFee(address)", "tax_selector"],
  ["ea2f0b37", "includeInFee(address)", "tax_selector"],
  ["af9549e0", "setExcludeFromFee(address,bool)", "tax_selector"],
  ["f9f92be4", "blacklist(address)", "blacklist_selector"],
  ["153b0d1e", "setBlacklist(address,bool)", "blacklist_selector"],
  ["fe575a87", "isBlacklisted(address)", "blacklist_selector"],
  ["f3290d75", "blacklistAddress(address)", "blacklist_selector"],
  ["3659cfe6", "upgradeTo(address)", "proxy_upgrade"],
  ["4f1ef286", "upgradeToAndCall(address,bytes)", "proxy_upgrade"],
  ["5c60da1b", "implementation()", "proxy_upgrade"],
  ["ec28438a", "setMaxTxAmount(uint256)", "trading_switch"],
  ["ffb54a99", "tradingOpen()", "trading_switch"],
  ["8a8c523c", "enableTrading()", "trading_switch"],
  ["8f70ccf7", "setTrading(bool)", "trading_switch"],
  ["c9567bf9", "openTrading()", "trading_switch"],
  ["3bd5d173", "deliver(uint256)", "reflection_fee"],
  ["4549b039", "reflectionFromToken(uint256,bool)", "reflection_fee"]
];

// Strictly excludes any handleOf / ownerOfHandle selectors (Red Line #9)
const OTHER = [
  ["42966c68", "burn(uint256)"],
  ["9dc29fac", "burn(address,uint256)"],
  ["715018a6", "renounceOwnership()"],
  ["f2fde38b", "transferOwnership(address)"],
  ["8da5cb5b", "owner()"],
  ["893d20e8", "getOwner()"]
];

const TRAP_PORTRAIT = {
  uiSample: true,
  label: SAMPLE_LABEL,
  sellTaxPercent: 45,
  triggered: 5,
  total: 8,
  flags: [
    { id: "owner_retained", triggered: true, signatures: ["owner()"] },
    { id: "mint_selector", triggered: true, signatures: ["mint(address,uint256)"] },
    { id: "pause_selector", triggered: true, signatures: ["pause()"] },
    { id: "tax_selector", triggered: true, signatures: ["sellTax()"], sellTaxPercent: 45 },
    { id: "blacklist_selector", triggered: true, signatures: ["blacklist(address)"] },
    { id: "proxy_upgrade", triggered: false, signatures: [] },
    { id: "trading_switch", triggered: false, signatures: [] },
    { id: "reflection_fee", triggered: false, signatures: [] }
  ]
};

// Canonical Essay (SHA-256 = 0x08dd1b7400c26066f15693694f4b362c1403d305e773297814eb1ff172917df3, pre-anchored in AgentGate.sol constructor)
export const REPORT = {
  en: {
    title: "Privileges, read before the signature",
    dek: "A method note for agents that sign. Three portraits, eight flags, and a nonpayable unlock.",
    pull: "The only score is a count of flags. A quiet matrix is not a promise.",
    sections: [
      {
        heading: "A receipt, not a rating",
        paragraphs: [
          "This note is a way to read a contract before an agent signs. It is not a rating and it does not promise a profit. The only score on the page is a count of technical flags: how many of eight checks fired.",
          "Zero flags is not a warranty. It means those eight patterns were not observed in this read."
        ]
      },
      {
        heading: "Eight checks",
        paragraphs: [
          "The desk looks for an owner that is still set, a mint selector, a pause selector, a transfer-tax selector, a blacklist selector, a proxy upgrade path, a trading switch, and a reflection-style deliver selector.",
          "Selectors are searched as PUSH4 immediates in deployed bytecode alongside live security telemetry. That matches ordinary compiler dispatch while reminding the reader that unverified proxies or external pair hooks still warrant manual inspection."
        ]
      },
      {
        heading: "PancakeSwap Token",
        paragraphs: [
          "A public Chain 56 read of 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 returns the name PancakeSwap Token, the symbol Cake, and 18 decimals. Both owner() and getOwner() return 0x73feaa1ee314f8c655e354234017be2193c9e24e.",
          "The dispatch table contains mint(address,uint256) and mint(uint256). The pause, tax, blacklist, trading-switch, reflection, and upgrade selectors on the search list are absent, and the EIP-1967 implementation slot is empty. A mint selector is not a price forecast; it is a reason to put the owner on the receipt before any approval."
        ]
      },
      {
        heading: "Tether USD",
        paragraphs: [
          "A Chain 56 read of 0x55d398326f99059fF775485246999027B3197955 returns the name Tether USD, the symbol USDT, and 18 decimals. owner() and getOwner() return 0xf68a4b64162906eff0ff6ae34e2bb1cd42fef62d, and the dispatch table contains mint(uint256) and burn(uint256).",
          "The pause, tax, blacklist, and upgrade selectors on the list are absent. A mint held by an owner is a real privilege; by itself, it is not a transfer tax."
        ]
      },
      {
        heading: "A teaching trap",
        paragraphs: [
          "0xdead00000000000000000000000000000000beef has no deployed bytecode on Chain 56, and this screen never offers a buy or a swap. The portrait beside that fact is an explicitly labeled sample, not a live decode.",
          "In the sample, an owner is retained, mint, pause, and blacklist selectors are present, and sells face a 45 percent tax. Five of the eight flags trigger so a reader can inspect a heavy sell tax in the matrix.",
          "A name ending in .ai is not a contract address. The scanner refuses it and never resolves a handle to a wallet."
        ]
      },
      {
        heading: "The nonpayable unlock",
        paragraphs: [
          "This essay is unlocked by a nonpayable call to the verified AgentGate contract on Chain 56. Value is 0. Approve is 0. Every function in AgentGate is 100 percent pure-data nonpayable or view: zero payable entrypoints, zero tips, zero user fund custody, and no mint, tax, or pause.",
          "AgentGate is an open community web deck for Agent ID with zero browser wallet connection popups, zero QR login, and zero stored sessions. Readers either paste an Agentic Prompt into their AI Agent chat, connect via MCP, or run the three-step baw CLI flow (1. Preview -> 2. Human Confirm -> 3. Execute), then verify the confirmed Chain 56 transaction hash."
        ]
      },
      {
        heading: "The identity registry",
        paragraphs: [
          "Eligibility is checked by reading balanceOf(msg.sender) > 0 on 0x60b9262456de011f7d15a54cdd8c48baaa8b022f (SPACE ID Agent ID, symbol AI, non-transferable ERC-721). AgentGate never queries handle strings or reverse-resolves personal wallets.",
          "Because each Agent ID is non-transferable, reader counts and daily audit nominations represent unique verified identities rather than sybil bots."
        ]
      }
    ]
  },
  vi: {
    title: "Đặc quyền, đọc trước chữ ký",
    dek: "Một ghi chú phương pháp cho tác tử sắp ký. Ba chân dung, tám cờ, và một lệnh mở khóa không chuyển tiền.",
    pull: "Điểm duy nhất là số cờ. Ma trận im lặng không phải là một lời hứa.",
    sections: [
      {
        heading: "Một biên nhận, không phải một xếp hạng",
        paragraphs: [
          "Ghi chú này là cách đọc một hợp đồng trước khi tác tử ký. Đây không phải xếp hạng đầu tư và không hứa hẹn lợi nhuận. Điểm duy nhất trên trang là số cờ kỹ thuật: bao nhiêu trong tám phép kiểm đã kích hoạt.",
          "Số 0 không phải là một bảo đảm. Nó chỉ có nghĩa tám mẫu ấy không xuất hiện trong lần đọc này."
        ]
      },
      {
        heading: "Tám phép kiểm",
        paragraphs: [
          "Bàn đọc tìm owner còn giữ quyền, selector mint, selector pause, selector thuế chuyển, selector danh sách chặn, đường nâng cấp proxy, công tắc giao dịch, và selector deliver kiểu reflection.",
          "Selector được giải mã trực tiếp từ mã máy PUSH4 trong bytecode đã triển khai kết hợp dữ liệu kiểm tra rủi ro trực tuyến — đồng thời nhắc người đọc luôn lưu ý các hợp đồng proxy hoặc cặp thanh khoản tùy biến."
        ]
      },
      {
        heading: "PancakeSwap Token",
        paragraphs: [
          "Phép đọc trực tiếp trên Chain 56 tới 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82 trả về tên PancakeSwap Token, ký hiệu Cake, và 18 chữ số thập phân. Cả owner() và getOwner() đều trả về 0x73feaa1ee314f8c655e354234017be2193c9e24e.",
          "Bảng dispatch có mint(address,uint256) và mint(uint256). Các selector pause, thuế, danh sách chặn, công tắc giao dịch, reflection và nâng cấp đều vắng; ô EIP-1967 trống. Selector mint không phải dự báo giá — nó là lý do cần ghi rõ quyền owner lên biên nhận trước khi ký duyệt."
        ]
      },
      {
        heading: "Tether USD",
        paragraphs: [
          "Phép đọc 0x55d398326f99059fF775485246999027B3197955 trên Chain 56 trả về tên Tether USD, ký hiệu USDT, và 18 chữ số thập phân. owner() và getOwner() trả về 0xf68a4b64162906eff0ff6ae34e2bb1cd42fef62d; bảng dispatch có mint(uint256) và burn(uint256).",
          "Các selector pause, thuế, danh sách chặn và nâng cấp đều vắng. Quyền mint nằm ở owner là một đặc quyền thật; tự nó không phải thuế bán."
        ]
      },
      {
        heading: "Bẫy giảng dạy",
        paragraphs: [
          "0xdead00000000000000000000000000000000beef không có bytecode trên Chain 56, và màn hình này tuyệt đối không mời mua hay đổi token. Chân dung bên cạnh là một mẫu minh họa đã gắn nhãn rõ ràng.",
          "Trong mẫu, owner còn giữ quyền, có selector mint, pause, danh sách chặn và mức thuế bán 45%. Năm trong tám cờ kích hoạt để người đọc quan sát trực quan trên ma trận.",
          "Tên kết thúc bằng .ai không phải địa chỉ hợp đồng. Ô quét từ chối ngay lập tức và không bao giờ phân giải tên .ai sang ví cá nhân."
        ]
      },
      {
        heading: "Lệnh mở khóa không chuyển tiền",
        paragraphs: [
          "Bài nghiên cứu được mở khóa bằng một lệnh nonpayable gọi tới hợp đồng AgentGate đã xác thực mã nguồn mở trên Chain 56. Value bằng 0. Approve bằng 0. Toàn bộ hợp đồng AgentGate là thuần dữ liệu 100% nonpayable hoặc chỉ đọc: 0 hàm payable, không hàm tip, không giữ tiền người dùng, không mint, không thuế, không pause.",
          "AgentGate là dự án cộng đồng mở cho Agent ID, hoàn toàn không có nút Connect Ví trình duyệt, không đăng nhập QR và không lưu phiên. Người đọc chép Prompt cho AI Agent dán vào khung chat Agent, kết nối qua MCP, hoặc đi đủ ba bước CLI baw (1. Preview -> 2. Human Confirm -> 3. Execute), sau đó kiểm chứng mã giao dịch 0x trên Chain 56."
        ]
      },
      {
        heading: "Sổ đăng ký định danh",
        paragraphs: [
          "Điều kiện mở khóa miễn phí được kiểm tra qua balanceOf(msg.sender) > 0 tại 0x60b9262456de011f7d15a54cdd8c48baaa8b022f (SPACE ID Agent ID, ký hiệu AI, chuẩn ERC-721 không chuyển nhượng). AgentGate không bao giờ đọc chuỗi handle hay tra ngược ví người khác.",
          "Vì mỗi Agent ID không thể mua bán chuyển nhượng, số người đọc và phiếu đề cử mỗi ngày phản ánh đúng các định danh thật thay vì dàn ví bot."
        ]
      }
    ]
  }
};

function getEffectiveContract(env) {
  const fromEnv = (env && env.AGENTGATE_CONTRACT) || (typeof process !== "undefined" && process.env && process.env.AGENTGATE_CONTRACT) || "";
  const candidate = String(fromEnv || AGENTGATE_CONFIG.agentGateContract || ZERO).trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(candidate)) return candidate.toLowerCase();
  return ZERO;
}

function isLiveContractConfigured(addr) {
  return Boolean(addr && /^0x[0-9a-f]{40}$/.test(addr) && addr !== ZERO);
}

// Deterministic across serverless instances for the non-privileged 3-step preview walkthrough;
// real unlocks when liveContractConfigured === true are verified directly on Chain 56 RPC via txHash!
function getWalkthroughHmacKey(env) {
  return (
    (env && env.AGENTGATE_HMAC_SECRET) ||
    (typeof process !== "undefined" && process.env && process.env.AGENTGATE_HMAC_SECRET) ||
    "agentgate-walkthrough-step-order-key:" + REGISTRY
  );
}

function getRpcs() {
  return Array.isArray(AGENTGATE_CONFIG.rpcUrls) && AGENTGATE_CONFIG.rpcUrls.length
    ? AGENTGATE_CONFIG.rpcUrls
    : ["https://bsc-dataseed.bnbchain.org", "https://bsc.publicnode.com"];
}

function canonicalEnglish() {
  const note = REPORT.en;
  const lines = [note.title, note.dek, "AgentGate Editorial Desk", note.pull];
  for (const section of note.sections) {
    lines.push("", "# " + section.heading);
    for (const paragraph of section.paragraphs) lines.push(paragraph);
  }
  return lines.join("\n");
}

let reportHashPromise;
function sha256Hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function reportHash() {
  if (!reportHashPromise) {
    reportHashPromise = crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(canonicalEnglish()))
      .then(sha256Hex);
  }
  return reportHashPromise;
}

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return sha256Hex(sig);
}

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "access-control-allow-origin": "*",
      ...extraHeaders
    }
  });
}

function mentionsAiName(value) {
  const norm = String(value ?? "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "");
  return /\.ai\b/i.test(norm);
}

function classifyAddress(input) {
  const norm = String(input ?? "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  if (!norm) return { error: "empty" };
  if (mentionsAiName(norm)) return { error: "ai" };
  if (!/^0x[0-9a-fA-F]{40}$/i.test(norm)) return { error: "invalid" };
  return { address: "0x" + norm.slice(2).toLowerCase() };
}

function aiRejected() {
  return json(
    { ok: false, error: "ai_name_rejected", message: "Names ending in .ai are rejected and are not resolved." },
    400
  );
}

function invalidAddress() {
  return json(
    { ok: false, error: "invalid_address", message: "Only a 0x address of 42 characters is accepted." },
    400
  );
}

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > 8000) {
    const error = new Error("body_too_large");
    error.status = 413;
    throw error;
  }
  if (!raw) return { raw: "", data: {} };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      const error = new Error("invalid_json_object");
      error.status = 400;
      throw error;
    }
    return { raw, data: parsed };
  } catch (err) {
    if (err && err.status === 400) throw err;
    const error = new Error("invalid_json");
    error.status = 400;
    throw error;
  }
}

function hexToDec(hex) {
  if (!hex || hex === "0x") return "0";
  return BigInt(hex).toString(10);
}

function padAddress(address) {
  return address.slice(2).toLowerCase().padStart(64, "0");
}

function decodeAddress(hex) {
  if (!hex || hex === "0x" || hex.length < 66) return null;
  const addr = "0x" + hex.slice(-40).toLowerCase();
  return /^0x0{40}$/.test(addr) ? null : addr;
}

// Sanitize & bound untrusted on-chain ERC-20 strings before returning to UI / MCP agents
function decodeString(hex) {
  if (!hex || hex === "0x") return null;
  const h = hex.slice(2);
  if (h.length < 128) return null;
  const len = Number.parseInt(h.slice(64, 128), 16);
  if (!Number.isFinite(len) || len <= 0 || len > 256) return null;
  const data = h.slice(128, 128 + len * 2);
  if (data.length !== len * 2) return null;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i += 1) bytes[i] = Number.parseInt(data.slice(i * 2, i * 2 + 2), 16);
  const text = new TextDecoder()
    .decode(bytes)
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim()
    .slice(0, 64);
  return text || null;
}

function decodeWord(hex) {
  if (!hex || hex === "0x") return null;
  try {
    return BigInt(hex).toString(10);
  } catch {
    return null;
  }
}

function findPush4(codeHex, table) {
  const code = String(codeHex || "").toLowerCase();
  const found = [];
  for (const row of table) {
    const [sel, sig, flag] = row;
    if (code.includes("63" + sel)) found.push({ selector: sel, signature: sig, flag: flag || null });
  }
  return found;
}

function interpretPaused(entry) {
  if (!entry || entry.error || !entry.result || entry.result === "0x") return "reverted";
  try {
    const value = BigInt(entry.result);
    if (value === 0n) return "false";
    if (value === 1n) return "true";
  } catch {
    return "unparsed";
  }
  return "unparsed";
}

function emptyStorage(hex) {
  if (!hex || hex === "0x") return true;
  return /^0x0+$/.test(hex);
}

async function rpcOnce(url, call, id) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method: call.method, params: call.params }),
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) throw new Error("rpc_http");
  return response.json();
}

async function rpcBatch(url, calls) {
  const payload = calls.map((call, id) => ({
    jsonrpc: "2.0",
    id,
    method: call.method,
    params: call.params
  }));
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(3500)
  });
  if (!response.ok) throw new Error("rpc_http");
  const body = await response.json();
  if (!Array.isArray(body)) {
    if (calls.length <= 4) {
      const rows = [];
      for (let id = 0; id < calls.length; id += 1) rows.push(await rpcOnce(url, calls[id], id));
      return rows;
    }
    throw new Error("rpc_not_batch");
  }
  const byId = new Map(body.map((row) => [row.id, row]));
  return calls.map((_, id) => byId.get(id) || { error: { message: "missing" } });
}

async function withRpc(run) {
  let last;
  for (const url of getRpcs()) {
    try {
      return await run(url);
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error("rpc_unavailable");
}

function readResult(entry) {
  if (!entry || entry.error) return null;
  return entry.result || null;
}

function decodeRecentReceiptsHex(hex) {
  if (!hex || hex.length < 2 + 81 * 64) return [];
  const raw = hex.slice(2);
  const wHex = (idx) => raw.slice(idx * 64, (idx + 1) * 64);
  const totalRecorded = Number(BigInt("0x" + wHex(80)));
  const count = Math.min(totalRecorded, 20);
  const items = [];
  for (let i = 0; i < count; i++) {
    const reader = "0x" + wHex(i).slice(24).toLowerCase();
    const subjectContract = "0x" + wHex(20 + i).slice(24).toLowerCase();
    const recordedAt = Number(BigInt("0x" + wHex(40 + i)));
    const triggeredFlags = Number(BigInt("0x" + wHex(60 + i)));
    if (reader !== ZERO && subjectContract !== ZERO) {
      items.push({ reader, subjectContract, recordedAt, triggeredFlags });
    }
  }
  return items;
}

// Cached (15s) live read of deployed AgentGate.sol stats, ballot tallies & recent receipts
async function readLiveAgentGateStats(contractAddr, hashHex, forceFresh = false) {
  if (!isLiveContractConfigured(contractAddr)) return null;
  const now = Date.now();
  if (!forceFresh && _liveStatsCache.contract === contractAddr && _liveStatsCache.expiresAt > now && _liveStatsCache.value) {
    return _liveStatsCache.value;
  }
  const statsData = "0x" + SELECTORS_AGENTGATE.getProtocolStats + hashHex;
  const ballotData = "0x" + SELECTORS_AGENTGATE.getBallotTallies + BALLOT_CANDIDATES.map(padAddress).join("");
  const wallData = "0x" + SELECTORS_AGENTGATE.getRecentReceipts;
  try {
    const rows = await withRpc((url) =>
      rpcBatch(url, [
        { method: "eth_call", params: [{ to: contractAddr, data: statsData }, "latest"] },
        { method: "eth_call", params: [{ to: contractAddr, data: ballotData }, "latest"] },
        { method: "eth_call", params: [{ to: contractAddr, data: wallData }, "latest"] }
      ])
    );
    const r0 = readResult(rows[0]);
    const r1 = readResult(rows[1]);
    const r2 = readResult(rows[2]);
    if (!r0 || r0.length < 2 + 64 * 7) {
      return { liveOnChain: false, rpcDegraded: true };
    }
    const s = r0.slice(2);
    const word = (i) => Number(BigInt("0x" + s.slice(i * 64, (i + 1) * 64)));
    let todayBallots = null;
    if (r1 && r1.length >= 2 + 64 * 9) {
      const b = r1.slice(2);
      const bWord = (i) => Number(BigInt("0x" + b.slice(i * 64, (i + 1) * 64)));
      todayBallots = {
        utcDay: bWord(0),
        cake: bWord(1),
        usdt: bWord(2),
        btcb: bWord(3),
        eth: bWord(4),
        allTime: {
          cake: bWord(5),
          usdt: bWord(6),
          btcb: bWord(7),
          eth: bWord(8)
        }
      };
    }
    const recentReceipts = decodeRecentReceiptsHex(r2);
    const result = {
      liveOnChain: true,
      rpcDegraded: false,
      uniqueAgentIdUsers: word(0),
      totalPreSignReceipts: word(1),
      totalVotesCast: word(2),
      totalReportsAnchored: word(3),
      reportUniqueReaders: word(4),
      editorialPublisher: "0x" + s.slice(5 * 64 + 24, 6 * 64),
      todayBallots,
      recentReceipts
    };
    _liveStatsCache = { contract: contractAddr, expiresAt: now + 15000, value: result };
    return result;
  } catch {
    return { liveOnChain: false, rpcDegraded: true };
  }
}

async function verifyUnlockTxOnChain(targetContract, txHash) {
  if (!isLiveContractConfigured(targetContract) || !/^0x[0-9a-f]{64}$/.test(txHash)) {
    return { ok: false, error: "invalid_tx_hash", message: "Provide a confirmed 66-character 0x transaction hash." };
  }
  const cacheKey = targetContract + ":" + txHash;
  const cached = _verifiedTxCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  let rows;
  try {
    rows = await withRpc((rpcUrl) =>
      rpcBatch(rpcUrl, [
        { method: "eth_getTransactionByHash", params: [txHash] },
        { method: "eth_getTransactionReceipt", params: [txHash] }
      ])
    );
  } catch {
    return { ok: false, status: 503, error: "rpc_unavailable", message: "Chain 56 RPC temporarily busy. Please retry in a few seconds." };
  }
  const tx = readResult(rows[0]);
  const rcpt = readResult(rows[1]);
  if (!tx || !rcpt || rcpt.status !== "0x1") {
    return { ok: false, error: "tx_not_confirmed", message: "Transaction not found or not yet confirmed on Chain 56." };
  }

  const directToMatch = String(tx.to || "").toLowerCase() === targetContract;
  const inputSelector = String(tx.input || "").slice(0, 10).toLowerCase();
  const matchingLog = Array.isArray(rcpt.logs)
    ? rcpt.logs.find((l) => {
        if (String(l.address || "").toLowerCase() !== targetContract || !Array.isArray(l.topics) || l.topics.length < 3) return false;
        const t0 = String(l.topics[0] || "").toLowerCase();
        return t0 === TOPIC_REPORT_UNLOCKED || t0 === TOPIC_AUDIT_RECORDED;
      })
    : null;

  if (!directToMatch && !matchingLog) {
    return { ok: false, error: "wrong_target_contract", message: `Transaction target does not match ${targetContract}.` };
  }
  if (directToMatch && !VALID_UNLOCK_TX_SELECTORS.has(inputSelector) && !matchingLog) {
    return {
      ok: false,
      error: "not_an_unlock_call",
      message: "Transaction did not invoke unlockGenesisReport, unlockReport, recordPreSignAudit, or logPreSignCheck."
    };
  }

  const senderAddr = matchingLog
    ? "0x" + String(matchingLog.topics[1] || "").slice(-40).toLowerCase()
    : String(tx.from || "").toLowerCase();

  let stateRows;
  try {
    const checkCall = "0x" + SELECTORS_AGENTGATE.hasUnlockedGenesis + padAddress(senderAddr);
    stateRows = await withRpc((rpcUrl) =>
      rpcBatch(rpcUrl, [{ method: "eth_call", params: [{ to: targetContract, data: checkCall }, "latest"] }])
    );
  } catch {
    return { ok: false, status: 503, error: "rpc_unavailable", message: "Chain 56 RPC temporarily busy. Please retry in a few seconds." };
  }
  const resHex = readResult(stateRows[0]);
  const unlocked = Boolean(resHex && resHex !== "0x" && BigInt(resHex) === 1n);
  if (!unlocked) {
    return { ok: false, error: "unlock_state_missing", message: "hasUnlockedGenesis returned false for the transaction sender." };
  }
  const okResult = { ok: true, txHash, from: senderAddr };
  if (_verifiedTxCache.size >= 500) _verifiedTxCache.clear();
  _verifiedTxCache.set(cacheKey, { expiresAt: Date.now() + 60000, result: okResult });
  return okResult;
}

const ALLOWED_SUMMARY_DETAILS = new Set([
  "0 of 8 checks fired",
  "owner retained",
  "mint selector",
  "pause selector",
  "transfer-tax selector",
  "blacklist selector",
  "proxy upgrade path",
  "trading switch",
  "reflection / deliver selector"
]);
const SUMMARY_PARSE_RE = /^([0-8])\/8 flags on ([A-Za-z0-9_-]{1,16}) - ([a-z0-9 ,\/-]{1,90})$/;
const BANNED_SYMBOL_RE = /^(ignore|override|approve|transfer|send|execute|skip|bypass|system|assistant|instruction|unlimited|wallet|seed|private)$/i;

export function isValidPreReadSummary(raw) {
  const s = String(raw || "").trim();
  if (!s) return true;
  const m = s.match(SUMMARY_PARSE_RE);
  if (!m) return false;
  const [, , sym, detail] = m;
  if (BANNED_SYMBOL_RE.test(sym)) return false;
  const parts = detail.split(", ").map((x) => x.trim()).filter(Boolean);
  if (parts.length < 1 || parts.length > 3) return false;
  return parts.every((p) => ALLOWED_SUMMARY_DETAILS.has(p));
}

export function buildAgentPrompts({
  targetContract,
  subjectToken = CAKE,
  candidateToken = CAKE,
  triggeredCount = null,
  flagSummary = ""
}) {
  const safeSubject = /^0x[0-9a-fA-F]{40}$/.test(subjectToken) ? subjectToken : "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
  const safeCandidate = /^0x[0-9a-fA-F]{40}$/.test(candidateToken) ? candidateToken : "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
  const contractDisplay = isLiveContractConfigured(targetContract)
    ? targetContract
    : "<PASTE_DEPLOYED_AGENTGATE_0x_CONTRACT>";
  const voteCalldata = "0x" + SELECTORS_AGENTGATE.voteNextAudit + padAddress(safeCandidate);

  const rawSummary = String(flagSummary || "").trim();
  const hasPrefilledScan =
    Number.isInteger(triggeredCount) &&
    triggeredCount >= 0 &&
    triggeredCount <= 8 &&
    Boolean(rawSummary) &&
    isValidPreReadSummary(rawSummary);

  const presignAudit = hasPrefilledScan
    ? [
        `Prerequisite: Ensure Developer Mode is enabled in your Agentic Wallet Settings when calling external Chain 56 contracts.`,
        `1. Verify smart contract ${safeSubject} on Chain ID 56 across all 8 privilege checks (owner retention, mint selector, pause selector, transfer tax, blacklist selector, proxy upgrade path, trading switch, and reflection/deliver fee).`,
        `   AgentGate scanner pre-read observed: ${triggeredCount}/8 flags — "${rawSummary}"`,
        ``,
        `2. Simulate and preview calling the verified AgentGate contract on Chain ID 56 (nonpayable, value = 0, zero token approvals — do NOT skip confirmation; show me the preview first and wait for my confirmation):`,
        `Contract: ${contractDisplay}`,
        `Function: recordPreSignAudit(address subjectContract, uint8 triggeredFlags, string note)`,
        `subjectContract: ${safeSubject}`,
        `triggeredFlags: ${triggeredCount}`,
        `note: ${rawSummary}`,
        ``,
        `AgentGate is a zero-fee pre-sign firewall for SPACE ID Agent ID holders (value = 0, approve = 0, costs only standard Chain 56 gas). If simulation reverts because a receipt was already logged for this contract, check my wallet's Chain 56 transaction history to ${contractDisplay} and tell me my previous transaction hash (0x...). Otherwise wait for my confirmation, execute the call, and tell me the transaction hash (0x...).`
      ].join("\n")
    : [
        `Prerequisite: Ensure Developer Mode is enabled in your Agentic Wallet Settings when calling external Chain 56 contracts.`,
        `1. Inspect smart contract ${safeSubject} on Chain ID 56 across all 8 technical privilege flags: (1) owner retention, (2) mint selector, (3) pause selector, (4) buy/sell transfer tax, (5) blacklist selector, (6) proxy upgrade path, (7) trading switch, and (8) reflection/deliver fee.`,
        `2. Count how many of the 8 flags triggered (an integer 0 to 8) and write ONE neutral factual summary line in plain English (at most 120 characters, no URLs, no hashtags, no profit or trading advice):`,
        `Format: <X>/8 flags - <factual summary>`,
        `Example: 2/8 flags - owner retained and mint selector present, 0% transfer tax`,
        ``,
        `3. Simulate and preview calling this verified smart contract on Chain ID 56 (nonpayable, value = 0, zero token approvals — do NOT skip confirmation; show me the preview first and wait for my confirmation):`,
        `Contract: ${contractDisplay}`,
        `Function: recordPreSignAudit(address subjectContract, uint8 triggeredFlags, string note)`,
        `subjectContract: ${safeSubject}`,
        `triggeredFlags: <0..8 integer from step 2>`,
        `note: <factual summary line from step 2>`,
        ``,
        `AgentGate is a zero-fee pre-sign firewall for SPACE ID Agent ID holders (value = 0, approve = 0, costs only standard Chain 56 gas). If simulation reverts because a receipt was already logged for this contract, tell me. Otherwise wait for my confirmation, execute the call, and tell me the transaction hash (0x...).`
      ].join("\n");

  const unlockGenesis = [
    `Prerequisite: Ensure Developer Mode is enabled in your Agentic Wallet Settings when calling external Chain 56 contracts.`,
    `1. Check that your Agentic Wallet holds a SPACE ID Agent ID (0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F) on Chain ID 56.`,
    `2. Simulate and preview calling this nonpayable zero-argument function on Chain ID 56 (value = 0, approve = 0 — do NOT skip confirmation; show me the preview first and wait for my confirmation):`,
    `Contract: ${contractDisplay}`,
    `Function: unlockGenesisReport()`,
    `Calldata (hex): 0x${SELECTORS_AGENTGATE.unlockGenesisReport}`,
    ``,
    `If simulation reverts with "AgentGate: report already unlocked by this Agent ID", check my wallet's Chain 56 transaction history to ${contractDisplay} and tell me my previous unlock transaction hash (0x...) without sending a duplicate transaction. Otherwise wait for my confirmation, execute unlockGenesisReport(), and tell me the transaction hash (0x...).`
  ].join("\n");

  const voteNextAudit = [
    `Prerequisite: Ensure Developer Mode is enabled in your Agentic Wallet Settings when calling external Chain 56 contracts.`,
    `1. Simulate and preview calling AgentGate on Chain ID 56 (nonpayable, value = 0, approve = 0 — show me the preview first and wait for my confirmation):`,
    `Contract: ${contractDisplay}`,
    `Function: voteNextAudit(address candidateContract)`,
    `candidateContract: ${safeCandidate}`,
    `Calldata (hex): ${voteCalldata}`,
    ``,
    `Each SPACE ID Agent ID can cast 1 audit nomination vote per UTC day. If simulation reverts with "AgentGate: already voted today (UTC day)", let me know. Otherwise wait for my confirmation, execute the vote, and tell me the transaction hash (0x...).`
  ].join("\n");

  return {
    presignAudit,
    unlockGenesis,
    voteNextAudit
  };
}

function callsFor(address) {
  const call = (data) => ({ method: "eth_call", params: [{ to: address, data }, "latest"] });
  return [
    { method: "eth_chainId", params: [] },
    { method: "eth_blockNumber", params: [] },
    { method: "eth_getCode", params: [address, "latest"] },
    { method: "eth_getBalance", params: [address, "latest"] },
    { method: "eth_getStorageAt", params: [address, EIP1967, "latest"] },
    call("0x06fdde03"),
    call("0x95d89b41"),
    call("0x313ce567"),
    call("0x8da5cb5b"),
    call("0x893d20e8"),
    call("0x5c975abb")
  ];
}

function parseOptionalPercent(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function buildFlags({ owner, found, proxy, buyTax = null, sellTax = null }) {
  const present = new Set(found.map((row) => row.flag));
  if (proxy) present.add("proxy_upgrade");
  const hasObservedTax = (buyTax !== null && buyTax > 0) || (sellTax !== null && sellTax > 0);
  if (hasObservedTax) present.add("tax_selector");

  const flags = FLAG_IDS.map((id) => {
    const sigs = found.filter((row) => row.flag === id).map((row) => row.signature);
    if (id === "tax_selector" && hasObservedTax) {
      sigs.push(`observed tax (buy ${buyTax ?? 0}% / sell ${sellTax ?? 0}%)`);
    }
    return {
      id,
      triggered: id === "owner_retained" ? Boolean(owner) : present.has(id),
      signatures: sigs
    };
  });
  return {
    flags,
    triggered: flags.filter((flag) => flag.triggered).length,
    total: FLAG_IDS.length
  };
}

async function fetchPublicAuditTelemetry(address) {
  try {
    const res = await fetch("https://web3.binance.com/bapi/defi/v1/public/wallet-direct/security/token/audit", {
      method: "POST",
      signal: AbortSignal.timeout(4000),
      headers: {
        "Content-Type": "application/json",
        "source": "agent",
        "Accept-Encoding": "identity",
        "User-Agent": "binance-web3/1.4 (Skill)"
      },
      body: JSON.stringify({
        binanceChainId: "56",
        contractAddress: address,
        requestId: crypto.randomUUID()
      })
    });
    const j = await res.json();
    if (j && j.data && j.data.hasResult === true && j.data.isSupported === true) {
      return {
        buyTax: parseOptionalPercent(j.data.extraInfo?.buyTax),
        sellTax: parseOptionalPercent(j.data.extraInfo?.sellTax),
        isVerified: typeof j.data.extraInfo?.isVerified === "boolean" ? j.data.extraInfo.isVerified : null
      };
    }
  } catch {}
  return null;
}

async function readContract(address) {
  const [rows, secExtra] = await Promise.all([
    withRpc((url) => rpcBatch(url, callsFor(address))),
    fetchPublicAuditTelemetry(address)
  ]);
  const chainId = readResult(rows[0]);
  if (!chainId) throw new Error("rpc_unavailable");
  const code = readResult(rows[2]) || "0x";
  const codeBytes = code === "0x" ? 0 : (code.length - 2) / 2;
  const balance = readResult(rows[3]) || "0x0";
  const storage = readResult(rows[4]);
  const proxy = !emptyStorage(storage);
  const found = codeBytes ? findPush4(code, SELECTORS) : [];
  const other = codeBytes ? findPush4(code, OTHER).map((row) => row.signature) : [];
  const owner = decodeAddress(readResult(rows[8]));
  const getOwner = decodeAddress(readResult(rows[9]));
  const buyTax = secExtra?.buyTax ?? null;
  const sellTax = secExtra?.sellTax ?? null;
  const flagPack = buildFlags({ owner: owner || getOwner, found, proxy, buyTax, sellTax });
  return {
    ok: true,
    source: "rpc",
    uiSample: false,
    sampleLabel: null,
    tokenMetadataUntrusted: true,
    address,
    chainId: Number(hexToDec(chainId)),
    blockNumber: hexToDec(readResult(rows[1])),
    codeBytes,
    noBytecode: codeBytes === 0,
    name: decodeString(readResult(rows[5])),
    symbol: decodeString(readResult(rows[6])),
    decimals: decodeWord(readResult(rows[7])),
    owner,
    getOwner,
    nativeBalanceWei: hexToDec(balance),
    paused: interpretPaused(rows[10]),
    eip1967: proxy ? storage : null,
    buyTax,
    sellTax,
    isVerified: secExtra?.isVerified ?? null,
    selectors: found.map((row) => row.signature),
    otherSelectors: other,
    ...flagPack,
    readNote: "A flag count is not a warranty. Zero means these eight checks did not fire."
  };
}

function cakeSnapshot() {
  return {
    ok: true,
    source: "snapshot-2026-11-18",
    uiSample: true,
    sampleLabel: SAMPLE_LABEL,
    observedAt: "2026-11-18",
    address: CAKE,
    chainId: 56,
    blockNumber: null,
    codeBytes: 7285,
    noBytecode: false,
    name: "PancakeSwap Token",
    symbol: "Cake",
    decimals: "18",
    owner: "0x73feaa1ee314f8c655e354234017be2193c9e24e",
    getOwner: "0x73feaa1ee314f8c655e354234017be2193c9e24e",
    nativeBalanceWei: "250000000000000",
    paused: "reverted",
    eip1967: null,
    selectors: ["mint(address,uint256)", "mint(uint256)"],
    otherSelectors: ["renounceOwnership()", "transferOwnership(address)", "owner()", "getOwner()"],
    flags: FLAG_IDS.map((id) => ({
      id,
      triggered: id === "owner_retained" || id === "mint_selector",
      signatures: id === "mint_selector" ? ["mint(address,uint256)", "mint(uint256)"] : id === "owner_retained" ? ["owner()", "getOwner()"] : []
    })),
    triggered: 2,
    total: 8,
    readNote: "Snapshot of a public read on 2026-11-18. Labeled because the live RPC did not answer."
  };
}

function usdtSnapshot() {
  return {
    ok: true,
    source: "snapshot-2026-11-18",
    uiSample: true,
    sampleLabel: SAMPLE_LABEL,
    observedAt: "2026-11-18",
    address: USDT,
    chainId: 56,
    blockNumber: null,
    codeBytes: 4413,
    noBytecode: false,
    name: "Tether USD",
    symbol: "USDT",
    decimals: "18",
    owner: "0xf68a4b64162906eff0ff6ae34e2bb1cd42fef62d",
    getOwner: "0xf68a4b64162906eff0ff6ae34e2bb1cd42fef62d",
    nativeBalanceWei: "0",
    paused: "reverted",
    eip1967: null,
    selectors: ["mint(uint256)"],
    otherSelectors: ["burn(uint256)", "renounceOwnership()", "transferOwnership(address)", "owner()", "getOwner()"],
    flags: FLAG_IDS.map((id) => ({
      id,
      triggered: id === "owner_retained" || id === "mint_selector",
      signatures: id === "mint_selector" ? ["mint(uint256)"] : id === "owner_retained" ? ["owner()", "getOwner()"] : []
    })),
    triggered: 2,
    total: 8,
    readNote: "Snapshot of a public read on 2026-11-18. Labeled because the live RPC did not answer."
  };
}

function trapLiveShell(extra = {}) {
  return {
    ok: true,
    source: extra.source || "rpc",
    uiSample: false,
    sampleLabel: null,
    address: TRAP,
    chainId: extra.chainId ?? 56,
    blockNumber: extra.blockNumber ?? null,
    codeBytes: 0,
    noBytecode: true,
    name: null,
    symbol: null,
    decimals: null,
    owner: null,
    getOwner: null,
    nativeBalanceWei: "0",
    paused: "reverted",
    eip1967: null,
    selectors: [],
    otherSelectors: [],
    flags: FLAG_IDS.map((id) => ({ id, triggered: false, signatures: [] })),
    triggered: 0,
    total: 8,
    portrait: TRAP_PORTRAIT,
    readNote: "No bytecode at this address. The portrait is a labeled teaching sample, not a live decode. 0 flags here is not a warranty."
  };
}

async function scanAddress(address) {
  try {
    const live = await readContract(address);
    if (address === TRAP) {
      return { ...live, portrait: TRAP_PORTRAIT, readNote: trapLiveShell().readNote };
    }
    return live;
  } catch (error) {
    if (address === CAKE) return { ...cakeSnapshot(), rpcError: String(error.message || "rpc_unavailable") };
    if (address === USDT) return { ...usdtSnapshot(), rpcError: String(error.message || "rpc_unavailable") };
    if (address === TRAP) {
      return { ...trapLiveShell({ source: "snapshot-2026-11-18" }), uiSample: true, sampleLabel: SAMPLE_LABEL, rpcError: String(error.message || "rpc_unavailable") };
    }
    return json({ ok: false, error: "rpc_unavailable", message: "The chain read did not answer. No flags were invented for this address." }, 503);
  }
}

async function readRegistry(walletToCheck = "") {
  const calls = [
    { method: "eth_call", params: [{ to: CAKE, data: "0x70a08231" + padAddress(REGISTRY) }, "latest"] },
    { method: "eth_call", params: [{ to: USDT, data: "0x70a08231" + padAddress(REGISTRY) }, "latest"] }
  ];
  const validWallet = /^0x[0-9a-fA-F]{40}$/.test(walletToCheck) ? walletToCheck.toLowerCase() : "";
  if (validWallet) {
    calls.push({ method: "eth_call", params: [{ to: REGISTRY, data: "0x70a08231" + padAddress(validWallet) }, "latest"] });
  }
  try {
    const base = await readContract(REGISTRY);
    const extra = await withRpc((url) => rpcBatch(url, calls));
    const walletBalance = validWallet ? (decodeWord(readResult(extra[2])) || "0") : null;
    return {
      ok: true,
      source: "rpc",
      uiSample: false,
      address: REGISTRY,
      chainId: base.chainId,
      blockNumber: base.blockNumber,
      name: base.name,
      symbol: base.symbol,
      owner: base.owner,
      codeBytes: base.codeBytes,
      nativeBalanceWei: base.nativeBalanceWei,
      paused: base.paused,
      eip1967: base.eip1967,
      cakeBalance: decodeWord(readResult(extra[0])) || "0",
      usdtBalance: decodeWord(readResult(extra[1])) || "0",
      checkedWallet: validWallet || null,
      checkedWalletHoldsAgentId: validWallet ? BigInt(walletBalance) > 0n : null,
      selectorsFound: [...base.selectors, ...base.otherSelectors],
      readOnly: true,
      sessionStored: false,
      note: "eth_call only. Reads balanceOf without reverse-resolving .ai names."
    };
  } catch (error) {
    return {
      ok: true,
      source: "snapshot-2026-11-18",
      uiSample: true,
      sampleLabel: SAMPLE_LABEL,
      observedAt: "2026-11-18",
      address: REGISTRY,
      chainId: 56,
      name: "SPACE ID Agent ID",
      symbol: "AI",
      owner: "0x457c1fd14750c6c30886a2f2b57f1ef44b095882",
      codeBytes: 8756,
      nativeBalanceWei: "0",
      paused: "reverted",
      eip1967: null,
      cakeBalance: "0",
      usdtBalance: "0",
      selectorsFound: ["owner()", "renounceOwnership()", "transferOwnership(address)"],
      readOnly: true,
      sessionStored: false,
      rpcError: String(error.message || "rpc_unavailable")
    };
  }
}

function permissions(liveMode) {
  return {
    nonpayable: true,
    zeroPayableFunctions: true,
    value: "0",
    approve: "0",
    holdsUserFunds: false,
    accidentalErc20Unrecoverable: true,
    mint: false,
    tax: false,
    pause: false,
    walletPopupConnect: false,
    liveContractConfigured: Boolean(liveMode),
    serverBroadcast: false
  };
}

// Both HTTP 402 branches use amount: "0" so zero ERC-20 tokens can ever be sent to an unmonitored contract address!
function challenge(hash, targetContract, liveStats) {
  const liveMode = isLiveContractConfigured(targetContract);
  const nonpayable = {
    scheme: "agent-id-attestation",
    network: "eip155:56",
    amount: "0",
    asset: ZERO,
    payTo: targetContract,
    maxTimeoutSeconds: 300,
    extra: {
      branch: "A",
      rail: "nonpayable-unlock",
      agentIdRegistry: REGISTRY,
      zeroArgMethod: "unlockGenesisReport()",
      zeroArgCalldata: "0x" + SELECTORS_AGENTGATE.unlockGenesisReport,
      method: "unlockReport(bytes32)",
      calldata: "0x" + SELECTORS_AGENTGATE.unlockReport + hash,
      ...permissions(liveMode),
      description: "Zero-fee nonpayable unlock for any Agent ID (.ai) holder via AI Agent chat, MCP, or baw CLI. 100% pure-data contract: Value = 0, Approve = 0, zero payable functions."
    }
  };
  const registryRead = {
    scheme: "agent-id-registry-read",
    network: "eip155:56",
    amount: "0",
    asset: ZERO,
    payTo: REGISTRY,
    maxTimeoutSeconds: 300,
    extra: {
      branch: "B",
      rail: "registry-read",
      readOnly: true,
      method: "balanceOf(address)",
      selector: "0x70a08231",
      description: "Read-only SPACE ID Agent ID eligibility verification on Chain 56. Paid ERC-20 x402 settlement is intentionally disabled so zero user tokens are transferred."
    }
  };
  return {
    x402Version: 2,
    resource: "/api/report",
    error: "deep_report_locked",
    sha256: hash,
    byline: "Community Project for Agent ID",
    agentGateContract: targetContract,
    liveOnChain: Boolean(liveStats?.liveOnChain),
    sampleLabel: liveMode ? null : SAMPLE_LABEL,
    uniqueAiReaders: liveMode ? (liveStats?.liveOnChain ? liveStats.reportUniqueReaders : null) : SAMPLE_READERS,
    titles: { en: REPORT.en.title, vi: REPORT.vi.title },
    deks: { en: REPORT.en.dek, vi: REPORT.vi.dek },
    branches: { A: nonpayable, B: registryRead },
    accepts: [nonpayable, registryRead]
  };
}

function buildPreviewCommand(hash, targetContract) {
  const data = "0x" + SELECTORS_AGENTGATE.unlockReport + hash;
  return `baw contract-call preview --binanceChainId 56 --from <YOUR_AGENT_WALLET> --to ${targetContract} --value 0 --inputData ${data} --json`;
}

function mcpManifest(hash, targetContract) {
  return {
    protocolVersion: "2025-06-18",
    serverInfo: { name: "agentgate-editorial-deck", version: "1.2.0" },
    agentGateContract: targetContract,
    agentIdRegistry: REGISTRY,
    description: "Open-web Pre-Sign Contract Privilege Firewall and nonpayable Soulbound .ai essay unlock. Zero wallet session, zero .ai handle lookup, mandatory Preview -> Human Confirm -> Execute.",
    reportSha256: hash,
    tools: [
      {
        name: "scan_privileges",
        description: "Read eight privilege flags & tax telemetry for a 42-character 0x contract on Chain 56. Rejects .ai handles.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["address"],
          properties: { address: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } }
        }
      },
      {
        name: "build_agent_prompt",
        description: "Generate a human-confirmed AI Agent chat prompt (presign_audit, unlock_genesis, or vote_next) targeting AgentGate on Chain 56.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: {
            mode: { type: "string", enum: ["presign_audit", "unlock_genesis", "vote_next"] },
            targetAddress: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }
          }
        }
      },
      {
        name: "preview_unlock",
        description: "Build nonpayable unlockGenesisReport() & unlockReport(bytes32) preview calldata (value 0, approve 0). Never broadcasts.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} }
      },
      {
        name: "verify_onchain_unlock",
        description: "Verify a confirmed Chain 56 transaction hash (66-char 0x) against AgentGate on-chain state.",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["txHash"],
          properties: {
            txHash: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" }
          }
        }
      },
      {
        name: "read_registry",
        description: "Read-only check of SPACE ID Agent ID registry (0x60b9...022f). Stores no session.",
        inputSchema: { type: "object", additionalProperties: false, properties: {} }
      }
    ]
  };
}

function reportBody(hash, targetContract, liveStats, verificationMode = "simulated") {
  const liveMode = isLiveContractConfigured(targetContract);
  return {
    ok: true,
    verificationMode,
    agentGateContract: targetContract,
    sha256: hash,
    byline: "Community Project for Agent ID",
    anchoredLanguage: "en",
    liveOnChain: Boolean(liveStats?.liveOnChain),
    sampleLabel: liveMode ? null : SAMPLE_LABEL,
    uniqueAiReaders: liveMode ? (liveStats?.liveOnChain ? liveStats.reportUniqueReaders : null) : SAMPLE_READERS,
    permissions: permissions(liveMode),
    en: REPORT.en,
    vi: REPORT.vi
  };
}

function cleanUnlock(body) {
  return body && body.value === "0" && body.approve === "0" && body.humanConfirm === true && body.tip !== true;
}

function encodeBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function handleVerifyOnChainPayload(data, targetContract, liveMode, hash) {
  if (!liveMode) {
    return json({
      ok: false,
      error: "contract_not_configured",
      message: "Deploy AgentGate.sol on Remix and paste the 0x address into config/agentgate.config.mjs first."
    }, 400);
  }
  const txHash = String(data.txHash || "").trim().toLowerCase();
  const checked = await verifyUnlockTxOnChain(targetContract, txHash);
  if (!checked.ok) {
    return json({ ok: false, error: checked.error, message: checked.message }, checked.status || 400);
  }
  const liveStats = await readLiveAgentGateStats(targetContract, hash, true);
  return json({
    ok: true,
    verifiedVia: "txHash",
    txHash: checked.txHash,
    from: checked.from,
    unlockReceipt: `tx_${checked.txHash.slice(2)}`,
    report: reportBody(hash, targetContract, liveStats, "onchain_verified")
  });
}

export async function handleAgentGateRequest(request, env = {}) {
  const url = new URL(request.url);
  const targetContract = getEffectiveContract(env);
  const liveMode = isLiveContractConfigured(targetContract);
  const walkthroughSecret = getWalkthroughHmacKey(env);

  try {
    if (request.method === "OPTIONS" && (url.pathname === "/mcp" || url.pathname.startsWith("/api/"))) {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, X-Unlock-Receipt",
          "access-control-max-age": "86400"
        }
      });
    }

    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        product: "AgentGate",
        style: "Sovereign Editorial Research Deck",
        chainId: 56,
        agentGateContract: targetContract,
        liveContractConfigured: liveMode,
        agentIdRegistry: REGISTRY,
        walletPopupConnect: false,
        sessionStored: false
      });
    }

    if (url.pathname === "/api/meta" && request.method === "GET") {
      const hash = await reportHash();
      const liveStats = await readLiveAgentGateStats(targetContract, hash);
      const prompts = buildAgentPrompts({ targetContract, subjectToken: CAKE, candidateToken: CAKE });
      return json({
        product: "AgentGate",
        sha256: hash,
        byline: "Community Project for Agent ID",
        agentGateContract: targetContract,
        liveContractConfigured: liveMode,
        liveOnChain: Boolean(liveStats?.liveOnChain),
        rpcDegraded: Boolean(liveMode && liveStats?.rpcDegraded),
        sampleLabel: liveMode ? null : SAMPLE_LABEL,
        sampleReceipts: liveMode ? (liveStats?.liveOnChain ? liveStats.totalPreSignReceipts : null) : SAMPLE_RECEIPTS,
        uniqueAiReaders: liveMode ? (liveStats?.liveOnChain ? liveStats.reportUniqueReaders : null) : SAMPLE_READERS,
        uniqueAgentUsers: liveMode ? (liveStats?.liveOnChain ? liveStats.uniqueAgentIdUsers : null) : SAMPLE_READERS,
        totalVotesCast: liveMode ? (liveStats?.liveOnChain ? liveStats.totalVotesCast : null) : 108,
        todayBallots: liveStats?.todayBallots || null,
        recentReceipts: liveStats?.recentReceipts || [],
        selectors: SELECTORS_AGENTGATE,
        gasEstimate: GAS_ESTIMATE,
        registry: REGISTRY,
        samples: {
          cake: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
          usdt: "0x55d398326f99059fF775485246999027B3197955",
          btcb: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
          eth: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8",
          trap: TRAP
        },
        titles: { en: REPORT.en.title, vi: REPORT.vi.title },
        deks: { en: REPORT.en.dek, vi: REPORT.vi.dek },
        previewCommand: buildPreviewCommand(hash, targetContract),
        agentPrompts: prompts,
        permissions: permissions(liveMode),
        sessionStored: false
      });
    }

    if (url.pathname === "/api/prompts" && request.method === "GET") {
      const subject = url.searchParams.get("subject") || CAKE;
      const candidate = url.searchParams.get("candidate") || CAKE;
      const trigRaw = url.searchParams.get("triggered");
      const summary = url.searchParams.get("summary") || "";
      if (mentionsAiName(subject) || mentionsAiName(candidate) || mentionsAiName(summary)) return aiRejected();
      if (!isValidPreReadSummary(summary)) {
        return json({ ok: false, error: "invalid_summary", message: "Summary must match strict factual scanner format." }, 400);
      }
      const triggeredCount = trigRaw !== null && trigRaw !== "" ? Number.parseInt(trigRaw, 10) : null;
      return json({
        ok: true,
        agentGateContract: targetContract,
        liveContractConfigured: liveMode,
        prompts: buildAgentPrompts({
          targetContract,
          subjectToken: subject,
          candidateToken: candidate,
          triggeredCount,
          flagSummary: summary
        })
      });
    }

    if (url.pathname === "/api/wall" && request.method === "GET") {
      const hash = await reportHash();
      const liveStats = await readLiveAgentGateStats(targetContract, hash);
      return json({
        ok: true,
        liveOnChain: Boolean(liveStats?.liveOnChain),
        agentGateContract: targetContract,
        totalPreSignReceipts: liveStats?.liveOnChain ? liveStats.totalPreSignReceipts : 0,
        recentReceipts: liveStats?.recentReceipts || []
      });
    }

    if ((url.pathname === "/api/report" || url.pathname === "/api/x402/report") && request.method === "GET") {
      const hash = await reportHash();
      const liveStats = await readLiveAgentGateStats(targetContract, hash);
      const receipt = request.headers.get("x-unlock-receipt") || url.searchParams.get("receipt") || "";

      // Live mode: require a real Chain 56 transaction hash receipt (`tx_<64hex>`) verified on-chain!
      if (liveMode && /^tx_[0-9a-fA-F]{64}$/.test(receipt)) {
        const txCheck = await verifyUnlockTxOnChain(targetContract, "0x" + receipt.slice(3).toLowerCase());
        if (txCheck.ok) {
          return json(reportBody(hash, targetContract, liveStats, "onchain_verified"));
        }
      }

      // Pre-deploy mode (`0x000...000`): allow 3-step preview walkthrough receipt for layout inspection
      if (!liveMode && receipt) {
        const [tokenPart, macPart] = receipt.split(".");
        if (tokenPart && macPart && (await hmac(walkthroughSecret, "unlock|" + tokenPart)) === macPart) {
          return json(reportBody(hash, targetContract, liveStats, "preview_confirmed"));
        }
      }

      const chal = challenge(hash, targetContract, liveStats);
      return json(chal, 402, {
        "PAYMENT-REQUIRED": encodeBase64Utf8(JSON.stringify(chal))
      });
    }

    if (url.pathname === "/api/registry" && request.method === "GET") {
      const wallet = url.searchParams.get("wallet") || "";
      if (mentionsAiName(wallet)) return aiRejected();
      return json(await readRegistry(wallet));
    }

    if (url.pathname === "/api/scan" && (request.method === "POST" || request.method === "GET")) {
      let candidate = url.searchParams.get("address") || "";
      let raw = url.search || "";
      if (request.method === "POST") {
        const body = await readJson(request);
        raw += "\n" + body.raw;
        candidate = body.data.address ?? candidate;
      }
      if (mentionsAiName(raw) || mentionsAiName(candidate)) return aiRejected();
      const parsed = classifyAddress(candidate);
      if (parsed.error === "ai") return aiRejected();
      if (parsed.error) return invalidAddress();
      const result = await scanAddress(parsed.address);
      if (result instanceof Response) return result;
      return json(result);
    }

    if (url.pathname === "/api/cli/preview" && request.method === "POST") {
      const body = await readJson(request);
      if (body.data.value != null && body.data.value !== "0" && body.data.value !== 0) {
        return json({ ok: false, error: "value_must_be_zero", message: "The unlock is nonpayable. value must be 0." }, 400);
      }
      if (body.data.approve != null && body.data.approve !== "0" && body.data.approve !== 0) {
        return json({ ok: false, error: "approve_must_be_zero", message: "The unlock does not approve a token. approve must be 0." }, 400);
      }
      if (body.data.tip === true) {
        return json({ ok: false, error: "zero_payable_contract", message: "AgentGate is 100% pure-data nonpayable and exposes zero tip or value-transfer functions." }, 400);
      }
      const hash = await reportHash();
      const previewId = crypto.randomUUID().replace(/-/g, "");
      const previewMac = await hmac(walkthroughSecret, `${previewId}|${hash}|0|0|nonpayable`);
      return json({
        ok: true,
        step: "1. Preview",
        next: "2. Human Confirm",
        executeAllowed: false,
        broadcast: false,
        previewId,
        previewMac,
        to: targetContract,
        liveContractConfigured: liveMode,
        value: "0",
        approve: "0",
        nonpayable: true,
        permissions: permissions(liveMode),
        gasEstimate: GAS_ESTIMATE,
        gasSampleLabel: SAMPLE_LABEL,
        zeroArgFunction: "unlockGenesisReport()",
        zeroArgInputData: "0x" + SELECTORS_AGENTGATE.unlockGenesisReport,
        inputData: "0x" + SELECTORS_AGENTGATE.unlockReport + hash,
        function: "unlockReport(bytes32)",
        command: buildPreviewCommand(hash, targetContract),
        agentPrompts: buildAgentPrompts({ targetContract }),
        targetNote: liveMode
          ? `Targets verified AgentGate contract ${targetContract} on Chain 56. Nonpayable (value = 0, approve = 0).`
          : "agentGateContract in config/agentgate.config.mjs is still 0x000...000 (pre-deploy layout mode). value stays 0.",
        sessionStored: false
      });
    }

    if (url.pathname === "/api/cli/confirm" && request.method === "POST") {
      const body = await readJson(request);
      const hash = await reportHash();
      const expected = await hmac(walkthroughSecret, `${body.data.previewId}|${hash}|0|0|nonpayable`);
      if (!body.data.previewId || body.data.previewMac !== expected) {
        return json({ ok: false, error: "preview_required", message: "Run 1. Preview before 2. Human Confirm." }, 400);
      }
      if (!cleanUnlock(body.data)) {
        return json({ ok: false, error: "human_confirm_required", message: "Human confirm is required. value and approve must stay 0 (100% nonpayable contract)." }, 400);
      }
      const confirmMac = await hmac(walkthroughSecret, "unlock|" + body.data.previewId);
      return json({
        ok: true,
        step: "2. Human Confirm",
        next: "3. Execute",
        previewId: body.data.previewId,
        confirmMac,
        unlockReceipt: body.data.previewId + "." + confirmMac,
        value: "0",
        approve: "0",
        broadcast: false,
        sessionStored: false
      });
    }

    if (url.pathname === "/api/cli/execute" && request.method === "POST") {
      const body = await readJson(request);
      if (body.data.broadcast === true) {
        return json({ ok: false, error: "server_never_broadcasts", message: "Server never holds keys or broadcasts on your behalf. Sign via AI Agent chat or baw CLI." }, 400);
      }
      const expected = await hmac(walkthroughSecret, "unlock|" + String(body.data.previewId || ""));
      if (!body.data.previewId || body.data.confirmMac !== expected || !cleanUnlock(body.data)) {
        return json({ ok: false, error: "confirm_required", message: "3. Execute stays closed until 2. Human Confirm. value and approve must stay 0." }, 400);
      }
      const hash = await reportHash();
      const liveStats = await readLiveAgentGateStats(targetContract, hash);

      // When live contract is configured, full essay requires real Chain 56 Agent ID txHash verification!
      if (liveMode) {
        return json({
          ok: true,
          step: "3. Execute",
          broadcast: false,
          liveOnChainRequired: true,
          value: "0",
          approve: "0",
          permissions: permissions(true),
          agentPrompts: buildAgentPrompts({ targetContract }),
          message: "Calldata confirmed safe (value = 0, approve = 0). Now paste Step A's prompt into your AI Agent chat and submit the resulting Chain 56 0x txHash in Step B to unlock the full essay.",
          report: null,
          sessionStored: false
        });
      }

      const unlockReceipt = body.data.previewId + "." + body.data.confirmMac;
      return json({
        ok: true,
        step: "3. Execute",
        broadcast: false,
        liveOnChainRequired: false,
        value: "0",
        approve: "0",
        permissions: permissions(false),
        unlockReceipt,
        receipt: {
          kind: "pre-sign-receipt",
          broadcast: false,
          value: "0",
          approve: "0",
          sha256: hash
        },
        report: reportBody(hash, targetContract, liveStats, "preview_confirmed"),
        sessionStored: false
      });
    }

    if (url.pathname === "/api/verify-onchain" && request.method === "POST") {
      const body = await readJson(request);
      if (mentionsAiName(body.raw)) return aiRejected();
      const hash = await reportHash();
      return handleVerifyOnChainPayload(body.data, targetContract, liveMode, hash);
    }

    if (url.pathname === "/mcp") {
      const hash = await reportHash();
      if (request.method === "GET") return json(mcpManifest(hash, targetContract));
      if (request.method === "POST") {
        const body = await readJson(request);
        const method = String(body.data.method || "");
        const id = body.data.id ?? null;
        if (method.startsWith("notifications/")) {
          return new Response(null, {
            status: 202,
            headers: {
              "access-control-allow-origin": "*",
              "cache-control": "no-store"
            }
          });
        }
        if (method === "ping") {
          return json({ jsonrpc: "2.0", id, result: {} });
        }
        if (method === "initialize" || method === "tools/list") {
          const manifest = mcpManifest(hash, targetContract);
          return json({
            jsonrpc: "2.0",
            id,
            result: method === "initialize"
              ? { protocolVersion: manifest.protocolVersion, serverInfo: manifest.serverInfo, capabilities: { tools: {} } }
              : { tools: manifest.tools }
          });
        }
        if (method === "tools/call") {
          const params = body.data.params || {};
          const toolName = params.name;
          const args = params.arguments || {};
          if (mentionsAiName(JSON.stringify(args))) {
            return json({
              jsonrpc: "2.0",
              id,
              result: {
                isError: true,
                content: [{ type: "text", text: JSON.stringify({ ok: false, error: "ai_name_rejected", message: "Names ending in .ai are rejected and are not resolved." }) }]
              }
            });
          }
          if (toolName === "scan_privileges") {
            const parsed = classifyAddress(args.address);
            if (parsed.error) {
              return json({
                jsonrpc: "2.0",
                id,
                result: {
                  isError: true,
                  content: [{ type: "text", text: JSON.stringify({ ok: false, error: "invalid_address", message: "Only a 42-char 0x address is accepted." }) }]
                }
              });
            }
            const res = await scanAddress(parsed.address);
            const isErr = res instanceof Response && !res.ok;
            const payload = res instanceof Response ? await res.json() : res;
            return json({ jsonrpc: "2.0", id, result: { isError: isErr, content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] } });
          }
          if (toolName === "build_agent_prompt") {
            const prompts = buildAgentPrompts({
              targetContract,
              subjectToken: args.targetAddress || CAKE,
              candidateToken: args.targetAddress || CAKE
            });
            const selected = args.mode === "unlock_genesis"
              ? prompts.unlockGenesis
              : args.mode === "vote_next"
                ? prompts.voteNextAudit
                : prompts.presignAudit;
            return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: selected }] } });
          }
          if (toolName === "preview_unlock") {
            const previewPayload = {
              to: targetContract,
              value: "0",
              approve: "0",
              nonpayable: true,
              zeroArgFunction: "unlockGenesisReport()",
              zeroArgInputData: "0x" + SELECTORS_AGENTGATE.unlockGenesisReport,
              function: "unlockReport(bytes32)",
              inputData: "0x" + SELECTORS_AGENTGATE.unlockReport + hash,
              command: buildPreviewCommand(hash, targetContract)
            };
            return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(previewPayload, null, 2) }] } });
          }
          if (toolName === "verify_onchain_unlock") {
            const verifyRes = await handleVerifyOnChainPayload(args, targetContract, liveMode, hash);
            const verifyPayload = await verifyRes.json();
            return json({
              jsonrpc: "2.0",
              id,
              result: {
                isError: !verifyPayload.ok,
                content: [{ type: "text", text: JSON.stringify(verifyPayload, null, 2) }]
              }
            });
          }
          if (toolName === "read_registry") {
            const regPayload = await readRegistry("");
            return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(regPayload, null, 2) }] } });
          }
          return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Unknown tool: " + String(toolName) } }, 400);
        }
        return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } }, 400);
      }
    }

    return null;
  } catch (error) {
    const status = error && error.status ? error.status : 500;
    return json({ ok: false, error: error.message || "error" }, status);
  }
}
