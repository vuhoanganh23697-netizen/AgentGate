(function () {
  const FLAGS = {
    owner_retained: ["Owner retained", "Owner còn giữ quyền"],
    mint_selector: ["Mint selector", "Selector mint"],
    pause_selector: ["Pause selector", "Selector pause"],
    tax_selector: ["Transfer-tax selector", "Selector thuế chuyển"],
    blacklist_selector: ["Blacklist selector", "Selector danh sách chặn"],
    proxy_upgrade: ["Proxy upgrade path", "Đường nâng cấp proxy"],
    trading_switch: ["Trading switch", "Công tắc giao dịch"],
    reflection_fee: ["Reflection / deliver selector", "Selector reflection / deliver"]
  };

  const CANDIDATE_ADDRS = {
    cake: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82",
    usdt: "0x55d398326f99059fF775485246999027B3197955",
    btcb: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c",
    eth: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8"
  };

  const ERR = {
    empty: ["Enter a 0x contract address.", "Hãy nhập địa chỉ hợp đồng 0x."],
    ai: ["Names ending in .ai are rejected and are not resolved.", "Tên kết thúc bằng .ai bị từ chối và không được phân giải."],
    invalid: ["Only a 0x address of 42 characters is accepted.", "Chỉ nhận địa chỉ 0x đủ 42 ký tự."],
    rpc: ["The chain read did not answer. No flags were invented for this address.", "Phép đọc chuỗi không trả lời. Không bịa cờ cho địa chỉ này."],
    bad: ["The gateway rejected this input.", "Cổng kiểm tra từ chối dữ liệu này."]
  };

  const ui = {
    scan: null,
    registry: null,
    report: null,
    scanError: "",
    scanStatus: "",
    meta: null,
    promptMode: "presignAudit",
    subjectToken: CANDIDATE_ADDRS.cake,
    triggeredCount: null,
    flagSummary: "",
    voteChoice: "cake",
    prompts: null
  };

  const flow = {
    phase: "idle",
    preview: null,
    human: false,
    confirmMac: "",
    error: ""
  };

  let scanTicket = 0;

  function lang() {
    return document.documentElement.lang === "vi" ? "vi" : "en";
  }

  function t(pair) {
    return pair[lang() === "vi" ? 1 : 0];
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[ch]));
  }

  function shortHex(addr) {
    const s = String(addr || "");
    if (s.length < 14) return s;
    return s.slice(0, 8) + "…" + s.slice(-6);
  }

  function formatInt(value) {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
    return new Intl.NumberFormat(lang() === "vi" ? "vi-VN" : "en-US").format(Number(value));
  }

  function formatNative(wei) {
    try {
      const value = BigInt(wei);
      const whole = value / 10n ** 18n;
      const frac = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "") || "0";
      return whole.toString() + "." + frac + " native · " + value.toString() + " wei";
    } catch {
      return String(wei) + " wei";
    }
  }

  function normalize(value) {
    return String(value ?? "").normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  }

  function mentionsAi(value) {
    return /\.ai\b/i.test(normalize(value));
  }

  function classify(value) {
    const text = normalize(value);
    if (!text) return { error: "empty" };
    if (mentionsAi(text)) return { error: "ai", text };
    if (!/^0x[0-9a-fA-F]{40}$/i.test(text)) return { error: "invalid" };
    return { address: "0x" + text.slice(2).toLowerCase() };
  }

  function measure() {
    const top = document.querySelector(".risk-top");
    const bottom = document.querySelector(".risk-bottom");
    if (top) document.documentElement.style.setProperty("--risk-top-h", top.offsetHeight + "px");
    if (bottom) document.documentElement.style.setProperty("--risk-bottom-h", bottom.offsetHeight + "px");
  }

  function setLang(next) {
    const value = next === "vi" ? "vi" : "en";
    document.documentElement.lang = value;
    try { localStorage.setItem("ag-ui-lang", value); } catch {}
    document.title = value === "vi"
      ? "AgentGate — Bản thảo nghiên cứu biên tập chủ quyền"
      : "AgentGate — Sovereign Editorial Research Deck";
    document.querySelectorAll("[data-act=lang]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.lang === value ? "true" : "false");
    });
    paintAll();
    requestAnimationFrame(measure);
  }

  function show(screen) {
    const names = ["deck", "scan", "sign", "vote"];
    if (!names.includes(screen)) screen = "deck";
    document.querySelectorAll(".screen").forEach((section) => {
      section.hidden = section.dataset.screen !== screen;
    });
    document.querySelectorAll("nav [data-screen]").forEach((button) => {
      button.setAttribute("aria-current", button.dataset.screen === screen ? "page" : "false");
    });
    if (location.hash !== "#" + screen) history.replaceState(null, "", "#" + screen);
    const port = document.getElementById("scrollport");
    if (port) port.scrollTo(0, 0);
  }

  function countLine(triggered, total) {
    return lang() === "vi"
      ? triggered + " / " + total + " cờ đã kích hoạt"
      : triggered + " / " + total + " flags triggered";
  }

  const BANNED_SYM_RE = /^(ignore|override|approve|transfer|send|execute|skip|bypass|system|assistant|instruction|unlimited|wallet|seed|private)$/i;

  // Single source of truth: fetch canonical prompts from /api/prompts
  async function refreshPromptsFromServer() {
    const candidate = CANDIDATE_ADDRS[ui.voteChoice] || CANDIDATE_ADDRS.cake;
    const baseParams = {
      subject: ui.subjectToken || CANDIDATE_ADDRS.cake,
      candidate
    };
    const qs = new URLSearchParams(baseParams);
    const hasSummary = ui.triggeredCount !== null && Boolean(ui.flagSummary);
    if (hasSummary) {
      qs.set("triggered", String(ui.triggeredCount));
      qs.set("summary", ui.flagSummary);
    }
    try {
      let res = await fetch("/api/prompts?" + qs.toString(), { credentials: "omit" });
      if (!res.ok && hasSummary) {
        ui.flagSummary = "";
        res = await fetch("/api/prompts?" + new URLSearchParams(baseParams).toString(), { credentials: "omit" });
      }
      if (!res.ok) return;
      const data = await res.json();
      if (data && data.prompts) {
        ui.prompts = data.prompts;
        paintPrompts();
      }
    } catch {}
  }

  function paintPrompts() {
    const p = ui.prompts || (ui.meta && ui.meta.agentPrompts) || null;
    const promptBox = document.getElementById("agent-prompt-box");
    if (promptBox && p) {
      promptBox.textContent = ui.promptMode === "unlockGenesis" ? p.unlockGenesis : p.presignAudit;
    }
    document.querySelectorAll("[data-act=prompt-tab]").forEach((btn) => {
      btn.setAttribute("aria-pressed", btn.dataset.mode === ui.promptMode ? "true" : "false");
    });
    const voteBox = document.getElementById("vote-prompt-box");
    if (voteBox && p) voteBox.textContent = p.voteNextAudit;
  }

  function buildFactualScanSummary(scan) {
    if (!scan || scan.noBytecode) return "";
    const activeIds = (scan.flags || []).filter((f) => f.triggered).map((f) => FLAGS[f.id] ? FLAGS[f.id][0].toLowerCase() : f.id);
    const rawSym = (scan.symbol || "token").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 12) || "token";
    const sym = BANNED_SYM_RE.test(rawSym) ? "TOKEN" : rawSym;
    const detail = activeIds.length ? activeIds.slice(0, 3).join(", ") : "0 of 8 checks fired";
    return `${scan.triggered}/8 flags on ${sym} - ${detail}`.slice(0, 105);
  }

  function flagCards(flags, owner, getOwner) {
    return flags.map((flag) => {
      const on = flag.triggered;
      let evidence = (flag.signatures || []).join(", ");
      if (flag.id === "owner_retained") {
        if (owner) {
          evidence = "owner() " + owner;
          if (getOwner && getOwner !== owner) evidence += " · getOwner() " + getOwner;
          else if (getOwner) evidence += " · getOwner() matches";
        } else {
          evidence = t(["owner() did not return an address", "owner() không trả về địa chỉ"]);
        }
      } else if (!evidence) {
        evidence = t(["Not in the searched dispatch list.", "Không có trong danh sách dispatch đã tìm."]);
      }
      if (flag.sellTaxPercent) evidence += " · sell tax " + flag.sellTaxPercent + "%";
      const state = on
        ? t(["Triggered", "Đã kích hoạt"])
        : t(["Not observed", "Không thấy"]);
      return '<article class="flag ' + (on ? "is-on" : "is-off") + '"><header><h3>' +
        esc(t(FLAGS[flag.id] || [flag.id, flag.id])) + '</h3><span class="pill">' + esc(state) +
        "</span></header><p>" + esc(evidence) + "</p></article>";
    }).join("");
  }

  function renderScan(scan) {
    const root = document.getElementById("scan-result");
    if (!scan) {
      root.innerHTML = "";
      return;
    }
    const bits = ['<div class="result panel">'];
    if (scan.uiSample) bits.push('<p><span class="sample-tag">[UI Sample]</span> ' + esc(scan.observedAt || scan.source || "") + "</p>");
    else bits.push("<p>" + esc(t(["Live Chain 56 read", "Đọc trực tiếp Chain 56"])) + (scan.blockNumber ? " · block " + esc(scan.blockNumber) : "") + "</p>");
    const title = [scan.name, scan.symbol, scan.decimals != null ? scan.decimals + " decimals" : ""].filter(Boolean).join(" · ");
    if (title) bits.push("<h3>" + esc(title) + "</h3>");
    bits.push('<p class="mono" style="background:transparent;color:inherit;padding:0">' + esc(scan.address) + "</p>");
    bits.push("<p>" + esc(t(["Bytecode", "Bytecode"])) + " " + esc(scan.codeBytes) + " B · " + esc(formatNative(scan.nativeBalanceWei || "0")) + "</p>");
    if (typeof scan.buyTax === "number" || typeof scan.sellTax === "number") {
      bits.push("<p>" + esc(t(["Observed transfer tax", "Thuế chuyển ghi nhận"])) + ": buy " + esc(scan.buyTax ?? 0) + "% · sell " + esc(scan.sellTax ?? 0) + "%</p>");
    }
    if (scan.noBytecode) {
      bits.push("<p>" + esc(t([
        "No contract code at this address. A zero flag count is not a clean bill of health.",
        "Không có mã hợp đồng tại địa chỉ này. Số cờ bằng 0 không phải là một giấy chứng nhận."
      ])) + "</p>");
    }
    bits.push('<p class="count">' + esc(countLine(scan.triggered, scan.total)) + "</p>");
    bits.push('<div class="matrix">' + flagCards(scan.flags || [], scan.owner, scan.getOwner) + "</div>");
    if (scan.otherSelectors && scan.otherSelectors.length) {
      bits.push('<p class="meta-line">' + esc(t(["Also in the dispatch table", "Cũng có trong bảng dispatch"])) + ": " + esc(scan.otherSelectors.join(", ")) + "</p>");
    }
    if (scan.readNote) bits.push('<p class="hint">' + esc(scan.readNote) + "</p>");
    if (!scan.noBytecode && scan.address) {
      bits.push('<div class="actions"><button type="button" data-act="use-in-prompt" data-address="' + esc(scan.address) + '">' +
        esc(t(["Generate AI Agent Pre-Sign Prompt (with pre-filled flags)", "Tạo Prompt AI Agent Ghi Biên Nhận (điền sẵn kết quả quét)"])) +
        "</button></div>");
    }
    if (scan.portrait) {
      const portrait = scan.portrait;
      bits.push('<section class="panel"><p><span class="sample-tag">[UI Sample]</span> ' +
        esc(t(["Teaching portrait. Not a decode of deployed bytecode.", "Chân dung giảng dạy. Không phải giải mã bytecode đã triển khai."])) +
        '</p><p class="count">' + esc(countLine(portrait.triggered, portrait.total)) +
        "</p><p>" + esc(t(["Sell tax", "Thuế bán"])) + " " + esc(portrait.sellTaxPercent) + '% <span class="sample-tag">[UI Sample]</span></p><div class="matrix">' +
        flagCards(portrait.flags || [], null, null) + "</div></section>");
    }
    bits.push("</div>");
    root.innerHTML = bits.join("");
  }

  function renderWall() {
    const wallBody = document.getElementById("wall-body");
    if (!wallBody || !ui.meta) return;
    if (!ui.meta.liveContractConfigured) return;
    if (ui.meta.rpcDegraded) {
      wallBody.innerHTML = '<p class="hint">' + esc(t([
        "Chain 56 RPC read temporarily busy — refresh in a few seconds.",
        "RPC Chain 56 đang bận tạm thời — vui lòng tải lại sau vài giây."
      ])) + "</p>";
      return;
    }
    const rows = Array.isArray(ui.meta.recentReceipts) ? ui.meta.recentReceipts : [];
    if (!rows.length) {
      wallBody.innerHTML = '<p class="hint">' + esc(t([
        "Contract is live on Chain 56. Be the first Agent ID holder to record a pre-sign safety receipt via the AI Agent prompt.",
        "Hợp đồng đã hoạt động trên Chain 56. Hãy là chủ ví Agent ID đầu tiên ghi biên nhận kiểm tra trước khi ký qua Prompt AI Agent."
      ])) + "</p>";
      return;
    }
    let html = '<ul class="wall-list">';
    rows.forEach((r) => {
      const ts = r.recordedAt ? new Date(r.recordedAt * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "";
      const flagText = r.triggeredFlags <= 8 ? (r.triggeredFlags + "/8 flags") : "CLI check";
      html += '<li class="wall-item"><strong>' + esc(shortHex(r.reader)) + "</strong> → <code>" +
        esc(r.subjectContract) + '</code> · <span class="pill" style="background:var(--off);color:var(--emerald-ink)">' +
        esc(flagText) + '</span> · <span class="hint">' + esc(ts) + "</span></li>";
    });
    html += "</ul>";
    wallBody.innerHTML = html;
  }

  function renderRegistry(data) {
    const root = document.getElementById("registry-result");
    if (!data) {
      root.innerHTML = "";
      return;
    }
    if (data.ok === false) {
      root.innerHTML = '<p class="alert">' + esc(data.message || data.error || "") + "</p>";
      return;
    }
    const rows = [
      ["source", data.uiSample ? "snapshot" : "live rpc"],
      ["chain id", data.chainId],
      ["block", data.blockNumber],
      ["name", data.name],
      ["symbol", data.symbol],
      ["owner()", data.owner],
      ["bytecode bytes", data.codeBytes],
      ["native balance", formatNative(data.nativeBalanceWei || "0")],
      ["paused()", data.paused],
      ["EIP-1967", data.eip1967 || t(["empty", "trống"])],
      ["selectors", (data.selectorsFound || []).join(", ")]
    ];
    let html = '<div class="result">';
    if (data.uiSample) html += '<p><span class="sample-tag">[UI Sample]</span> ' + esc(data.observedAt || "") + "</p>";
    html += "<dl>";
    rows.forEach((row) => {
      html += "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1] ?? "—") + "</dd>";
    });
    html += "</dl>";
    if (data.note) html += '<p class="hint">' + esc(data.note) + "</p>";
    html += "</div>";
    root.innerHTML = html;
  }

  function renderEssay(report) {
    if (!report) return;
    document.getElementById("essay-title-en").textContent = report.en.title;
    document.getElementById("essay-title-vi").textContent = report.vi.title;
    document.getElementById("essay-dek-en").textContent = report.en.dek;
    document.getElementById("essay-dek-vi").textContent = report.vi.dek;
    const pack = lang() === "vi" ? report.vi : report.en;
    const modeNote = report.verificationMode === "onchain_verified"
      ? t(["Verified on Chain 56 against AgentGate contract.", "Đã xác thực trực tiếp trên Chain 56 với hợp đồng AgentGate."])
      : t(["Opened via 3-step pre-deploy layout walkthrough.", "Đã mở qua quy trình kiểm thử bố cục 3 bước trước khi deploy."]);
    const parts = [
      '<p class="ok-msg">' + esc(modeNote) + "</p>",
      '<blockquote class="pull">' + esc(pack.pull) + "</blockquote>"
    ];
    pack.sections.forEach((section, index) => {
      parts.push("<h3>" + esc(section.heading) + "</h3>");
      section.paragraphs.forEach((paragraph, paragraphIndex) => {
        parts.push("<p" + (index === 0 && paragraphIndex === 0 ? ' class="lead"' : "") + ">" + esc(paragraph) + "</p>");
      });
    });
    const body = document.getElementById("essay-body");
    body.innerHTML = parts.join("");
    body.hidden = false;
  }

  function renderPreview(preview) {
    const root = document.getElementById("preview-out");
    if (!preview) {
      root.innerHTML = "";
      return;
    }
    const rows = [
      ["step", preview.step],
      ["to", preview.to],
      ["value", preview.value],
      ["approve", preview.approve],
      ["nonpayable", String(preview.nonpayable)],
      ["broadcast", String(preview.broadcast)],
      ["zero-arg function", preview.zeroArgFunction || "unlockGenesisReport()"],
      ["bytes32 function", preview.function],
      ["holds user funds", String(preview.permissions && preview.permissions.holdsUserFunds)],
      ["mint / tax / pause", "false / false / false"]
    ];
    let html = '<div class="panel"><h3>' + esc(t(["Parsed preview", "Preview đã phân tích"])) + "</h3><dl>";
    rows.forEach((row) => { html += "<dt>" + esc(row[0]) + "</dt><dd>" + esc(row[1]) + "</dd>"; });
    html += '</dl><p class="hint">' + esc(preview.targetNote || "") + "</p></div>";
    root.innerHTML = html;
    if (preview.command) document.getElementById("command").textContent = preview.command;
    document.getElementById("value-line").textContent = preview.value;
    document.getElementById("approve-line").textContent = preview.approve;
  }

  function updateFlow() {
    const phase = flow.phase;
    document.querySelectorAll(".step").forEach((step) => {
      const index = step.dataset.step;
      step.classList.remove("current", "done", "locked");
      const order = { idle: 1, previewed: 2, confirmed: 3, done: 4 }[phase] || 1;
      const n = Number(index);
      if (phase === "done" || n < order) step.classList.add("done");
      else if (n === order) step.classList.add("current");
      else step.classList.add("locked");
    });
    const check = document.getElementById("human-check");
    check.disabled = phase === "idle" || phase === "done";
    check.checked = flow.human || phase === "done";
    document.getElementById("btn-confirm").disabled = !(phase === "previewed" && flow.human);
    document.getElementById("btn-execute").disabled = phase !== "confirmed";
    document.getElementById("flow-error").textContent = flow.error ? (t(ERR[flow.error] || ["", ""]) || flow.error) : "";
  }

  function paintVotes() {
    const liveMode = Boolean(ui.meta && ui.meta.liveContractConfigured);
    const liveBallots = ui.meta && ui.meta.liveOnChain && ui.meta.todayBallots ? ui.meta.todayBallots : null;
    document.querySelectorAll(".ballot-sample-tag").forEach((tag) => {
      tag.hidden = liveMode;
    });
    document.querySelectorAll(".tally").forEach((node) => {
      const key = node.dataset.choice;
      if (liveBallots && typeof liveBallots[key] === "number") {
        node.textContent = formatInt(liveBallots[key]);
      } else if (liveMode) {
        node.textContent = "—";
      } else {
        node.textContent = formatInt(Number(node.dataset.base));
      }
    });
    document.querySelectorAll("[data-act=vote]").forEach((button) => {
      button.setAttribute("aria-pressed", button.dataset.choice === ui.voteChoice ? "true" : "false");
    });
    const note = document.getElementById("vote-note");
    note.textContent = liveBallots
      ? t([
        "Live Chain 56 ballot counts for UTC day " + liveBallots.utcDay + ". Copy the AI Agent Vote Prompt below to cast your 1 .ai daily vote.",
        "Số phiếu thực tế trên Chain 56 trong ngày UTC " + liveBallots.utcDay + ". Chép Prompt bên dưới dán vào AI Agent để bỏ 1 phiếu .ai hôm nay."
      ])
      : t([
        "Selected candidate updates the AI Agent Vote Prompt below. Once agentGateContract is configured, tallies switch automatically to live Chain 56 counts.",
        "Bấm chọn ứng viên để cập nhật Prompt Bỏ Phiếu bên dưới. Ngay khi điền agentGateContract, số phiếu sẽ tự động đọc trực tiếp từ Chain 56."
      ]);
  }

  function paintStatus() {
    const status = document.getElementById("scan-status");
    status.textContent = ui.scanStatus ? t(ui.scanStatus) : "";
    document.getElementById("scan-error").textContent = ui.scanError ? t(ERR[ui.scanError] || ERR.bad) : "";
  }

  function paintContractBadge() {
    const badge = document.getElementById("contract-badge");
    const signAddr = document.getElementById("sign-contract-addr");
    if (!ui.meta) return;
    const addr = ui.meta.agentGateContract || "0x0000000000000000000000000000000000000000";
    if (signAddr) signAddr.textContent = addr;
    const live = Boolean(ui.meta.liveContractConfigured);

    ["tag-receipts", "tag-readers", "tag-essay-readers"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.hidden = live;
    });

    if (badge) {
      if (live) {
        badge.className = "contract-pill";
        badge.href = "https://bscscan.com/address/" + addr + "#code";
        badge.target = "_blank";
        badge.rel = "noopener";
        badge.textContent = shortHex(addr) + " ↗";
      } else {
        badge.className = "contract-pill pending";
        badge.href = "#judge";
        badge.removeAttribute("target");
        badge.textContent = t(["Awaiting Contract Config", "Chờ điền địa chỉ Contract"]);
      }
    }
  }

  function paintAll() {
    renderScan(ui.scan);
    renderRegistry(ui.registry);
    renderPreview(flow.preview);
    renderWall();
    if (ui.report) renderEssay(ui.report);
    updateFlow();
    paintVotes();
    paintStatus();
    paintContractBadge();
    paintPrompts();
    if (ui.meta) {
      document.getElementById("sample-receipts").textContent = formatInt(ui.meta.sampleReceipts);
      document.getElementById("sample-readers").textContent = formatInt(ui.meta.uniqueAiReaders);
      document.getElementById("reader-count").textContent = formatInt(ui.meta.uniqueAiReaders);
    }
  }

  async function loadMeta() {
    const response = await fetch("/api/meta", { credentials: "omit" });
    if (!response.ok) return;
    const data = await response.json();
    ui.meta = data;
    if (!ui.prompts && data.agentPrompts) ui.prompts = data.agentPrompts;
    document.getElementById("report-hash").textContent = data.sha256;
    if (data.gasEstimate) document.getElementById("gas-estimate").textContent = data.gasEstimate;
    if (data.previewCommand && !flow.preview) document.getElementById("command").textContent = data.previewCommand;
    document.getElementById("essay-title-en").textContent = data.titles.en;
    document.getElementById("essay-title-vi").textContent = data.titles.vi;
    document.getElementById("essay-dek-en").textContent = data.deks.en;
    document.getElementById("essay-dek-vi").textContent = data.deks.vi;
    paintAll();
  }

  async function scan(raw) {
    const parsed = classify(raw);
    ui.scanError = parsed.error || "";
    paintStatus();
    if (parsed.error === "ai") {
      const text = parsed.text || "";
      if (text.length < 128 && text.split(/\s+/).length <= 4) {
        await fetch("/api/scan", {
          method: "POST",
          credentials: "omit",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address: text })
        });
      }
      ui.scan = null;
      renderScan(null);
      return;
    }
    if (parsed.error) {
      ui.scan = null;
      renderScan(null);
      return;
    }
    const ticket = ++scanTicket;
    ui.scanStatus = ["Reading Chain 56…", "Đang đọc Chain 56…"];
    paintStatus();
    const response = await fetch("/api/scan", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ address: parsed.address })
    });
    const data = await response.json();
    if (ticket !== scanTicket) return;
    ui.scanStatus = "";
    if (!response.ok) {
      ui.scanError = data.error === "ai_name_rejected" ? "ai" : data.error === "rpc_unavailable" ? "rpc" : "bad";
      ui.scan = null;
    } else {
      ui.scanError = "";
      ui.scan = data;
      if (!data.noBytecode && data.address) {
        ui.subjectToken = data.address;
        ui.triggeredCount = data.triggered;
        ui.flagSummary = buildFactualScanSummary(data);
        refreshPromptsFromServer();
      }
    }
    paintStatus();
    renderScan(ui.scan);
  }

  function previewIsClean(preview) {
    return preview && preview.value === "0" && preview.approve === "0" && preview.nonpayable === true &&
      preview.broadcast === false && preview.permissions && preview.permissions.holdsUserFunds === false &&
      preview.permissions.mint === false && preview.permissions.tax === false && preview.permissions.pause === false;
  }

  async function runPreview() {
    flow.error = "";
    flow.human = false;
    flow.confirmMac = "";
    flow.phase = "idle";
    updateFlow();
    const response = await fetch("/api/cli/preview", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "0", approve: "0" })
    });
    const data = await response.json();
    if (!response.ok || !previewIsClean(data)) {
      flow.error = data.message || "Preview refused.";
      flow.preview = null;
      updateFlow();
      return;
    }
    flow.preview = data;
    flow.phase = "previewed";
    renderPreview(data);
    updateFlow();
  }

  async function runConfirm() {
    if (flow.phase !== "previewed" || !flow.human || !previewIsClean(flow.preview)) return;
    const response = await fetch("/api/cli/confirm", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewId: flow.preview.previewId,
        previewMac: flow.preview.previewMac,
        humanConfirm: true,
        value: "0",
        approve: "0"
      })
    });
    const data = await response.json();
    if (!response.ok) {
      flow.error = data.message || "Confirm refused.";
      updateFlow();
      return;
    }
    flow.confirmMac = data.confirmMac;
    flow.phase = "confirmed";
    flow.error = "";
    updateFlow();
  }

  async function runExecute() {
    if (flow.phase !== "confirmed" || !flow.human || !flow.confirmMac) return;
    const response = await fetch("/api/cli/execute", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        previewId: flow.preview.previewId,
        confirmMac: flow.confirmMac,
        humanConfirm: true,
        value: "0",
        approve: "0",
        broadcast: false
      })
    });
    const data = await response.json();
    if (!response.ok || data.broadcast !== false) {
      flow.error = data.message || "Execute refused.";
      updateFlow();
      return;
    }
    flow.phase = "done";
    flow.error = "";
    updateFlow();
    if (data.liveOnChainRequired || !data.report) {
      document.getElementById("verify-ok").textContent = t([
        "Calldata verified (value = 0, approve = 0). Copy Step A's prompt into your AI Agent chat and paste your confirmed Chain 56 0x txHash above.",
        "Đã kiểm tra calldata an toàn (value = 0, approve = 0). Hãy chép Prompt ở Bước A dán vào AI Agent rồi dán mã 0x txHash vào Bước B."
      ]);
      document.getElementById("proof-input").focus();
      return;
    }
    ui.report = data.report;
    try { sessionStorage.setItem("ag-ui-receipt", data.unlockReceipt); } catch {}
    renderEssay(data.report);
    show("scan");
    document.getElementById("essay").scrollIntoView({ block: "start" });
  }

  async function verifyOnChainProof(rawProof) {
    const errEl = document.getElementById("verify-error");
    const okEl = document.getElementById("verify-ok");
    errEl.textContent = "";
    okEl.textContent = "";
    const text = normalize(rawProof);
    if (!text) {
      errEl.textContent = t(["Enter a confirmed 66-char 0x transaction hash.", "Hãy nhập mã giao dịch 0x đủ 66 ký tự."]);
      return;
    }
    if (mentionsAi(text)) {
      errEl.textContent = t(ERR.ai);
      return;
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(text)) {
      errEl.textContent = t(["Only a confirmed 66-character 0x transaction hash is accepted.", "Chỉ chấp nhận mã giao dịch 0x đủ 66 ký tự."]);
      return;
    }
    okEl.textContent = t(["Verifying transaction on Chain 56 RPC…", "Đang kiểm chứng giao dịch trên RPC Chain 56…"]);
    const response = await fetch("/api/verify-onchain", {
      method: "POST",
      credentials: "omit",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ txHash: text })
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      okEl.textContent = "";
      errEl.textContent = data.message || t(["On-chain verification did not pass.", "Kiểm chứng on-chain chưa đạt."]);
      return;
    }
    okEl.textContent = t(["On-chain Agent ID receipt verified! Opening full essay…", "Đã xác thực biên nhận Agent ID on-chain! Đang mở bài viết…"]);
    ui.report = data.report;
    flow.phase = "done";
    flow.human = true;
    try { sessionStorage.setItem("ag-ui-receipt", data.unlockReceipt); } catch {}
    await loadMeta();
    renderEssay(data.report);
    show("scan");
    document.getElementById("essay").scrollIntoView({ block: "start" });
  }

  async function loadJudge() {
    const [report, mcp] = await Promise.all([
      fetch("/api/report", { credentials: "omit" }),
      fetch("/mcp", { credentials: "omit" })
    ]);
    document.getElementById("json-402").textContent = "HTTP " + report.status + "\n" + await report.text();
    document.getElementById("json-mcp").textContent = "HTTP " + mcp.status + "\n" + await mcp.text();
  }

  function openDrawer() {
    const drawer = document.getElementById("judge");
    drawer.hidden = false;
    document.body.classList.add("drawer-open");
    document.getElementById("judge-title").focus();
    loadJudge();
  }

  function closeDrawer() {
    document.getElementById("judge").hidden = true;
    document.body.classList.remove("drawer-open");
    const opener = document.querySelector(".nav-judge");
    if (opener) opener.focus();
  }

  async function restoreReceipt() {
    let receipt = "";
    try { receipt = sessionStorage.getItem("ag-ui-receipt") || ""; } catch {}
    if (!receipt) return;
    const response = await fetch("/api/report?receipt=" + encodeURIComponent(receipt), { credentials: "omit" });
    if (!response.ok) {
      try { sessionStorage.removeItem("ag-ui-receipt"); } catch {}
      return;
    }
    ui.report = await response.json();
    flow.phase = "done";
    flow.human = true;
    renderEssay(ui.report);
    updateFlow();
  }

  function copyText(text, statusId, msgPair) {
    const el = document.getElementById(statusId);
    const done = () => {
      if (el) el.textContent = t(msgPair);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(done);
    } else {
      done();
    }
  }

  document.addEventListener("click", (event) => {
    const el = event.target.closest("[data-act]");
    if (!el || el.disabled) return;
    const act = el.dataset.act;
    if (act === "lang") setLang(el.dataset.lang);
    if (act === "go") show(el.dataset.screen);
    if (act === "fill") {
      document.getElementById("addr").value = el.dataset.address;
      show("scan");
      scan(el.dataset.address);
    }
    if (act === "use-in-prompt") {
      ui.subjectToken = el.dataset.address;
      ui.promptMode = "presignAudit";
      refreshPromptsFromServer();
      show("sign");
    }
    if (act === "prompt-tab") {
      ui.promptMode = el.dataset.mode === "unlockGenesis" ? "unlockGenesis" : "presignAudit";
      document.getElementById("agent-prompt-copied").textContent = "";
      paintPrompts();
    }
    if (act === "copy-agent-prompt") {
      copyText(
        document.getElementById("agent-prompt-box").textContent,
        "agent-prompt-copied",
        ["Copied! Paste into your AI Agent chat.", "Đã chép! Hãy dán vào khung chat AI Agent của bạn."]
      );
    }
    if (act === "copy-vote-prompt") {
      copyText(
        document.getElementById("vote-prompt-box").textContent,
        "vote-prompt-copied",
        ["Vote prompt copied! Paste into your AI Agent chat.", "Đã chép Prompt bỏ phiếu! Hãy dán vào khung chat AI Agent."]
      );
    }
    if (act === "unlock") show("sign");
    if (act === "preview") runPreview();
    if (act === "confirm") runConfirm();
    if (act === "execute") runExecute();
    if (act === "registry") {
      document.getElementById("registry-result").innerHTML = '<p class="hint">…</p>';
      fetch("/api/registry", { credentials: "omit" }).then((response) => response.json()).then((data) => {
        ui.registry = data;
        renderRegistry(data);
      });
    }
    if (act === "copy") {
      copyText(
        document.getElementById("command").textContent,
        "copy-status",
        ["Preview command copied.", "Đã chép lệnh preview."]
      );
    }
    if (act === "vote") {
      ui.voteChoice = el.dataset.choice || "cake";
      document.getElementById("vote-prompt-copied").textContent = "";
      paintVotes();
      refreshPromptsFromServer();
    }
    if (act === "judge") openDrawer();
    if (act === "close-judge") closeDrawer();
    if (act === "probe-ai") {
      const out = document.getElementById("probe-out");
      out.textContent = t(ERR.ai);
      fetch("/api/scan", {
        method: "POST",
        credentials: "omit",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: "example.ai" })
      }).then(async (response) => {
        const data = await response.json();
        out.textContent = t(ERR.ai) + " HTTP " + response.status + " " + (data.error || "");
      });
    }
    if (act === "probe-addr") {
      const sample = "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82";
      const parsed = classify(sample);
      document.getElementById("probe-out").textContent = parsed.address
        ? t(["42-character 0x accepted by the field check.", "Ô kiểm nhận địa chỉ 0x đủ 42 ký tự."]) + " " + parsed.address
        : t(ERR.invalid);
    }
  });

  document.getElementById("scan-form").addEventListener("submit", (event) => {
    event.preventDefault();
    scan(document.getElementById("addr").value);
  });

  document.getElementById("verify-form").addEventListener("submit", (event) => {
    event.preventDefault();
    verifyOnChainProof(document.getElementById("proof-input").value);
  });

  document.getElementById("human-check").addEventListener("change", (event) => {
    if (flow.phase === "idle" || flow.phase === "done") {
      event.target.checked = flow.phase === "done";
      return;
    }
    flow.human = event.target.checked;
    if (!flow.human && flow.phase === "confirmed") {
      flow.phase = "previewed";
      flow.confirmMac = "";
    }
    updateFlow();
  });

  document.addEventListener("keydown", (event) => {
    const drawer = document.getElementById("judge");
    if (drawer.hidden) return;
    if (event.key === "Escape") {
      closeDrawer();
      return;
    }
    if (event.key !== "Tab") return;
    const items = [...drawer.querySelectorAll("button, a, input, [tabindex]")].filter((node) => !node.disabled && node.tabIndex !== -1);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  window.addEventListener("hashchange", () => {
    const name = location.hash.replace("#", "");
    if (name === "judge") openDrawer();
    else if (["deck", "scan", "sign", "vote"].includes(name)) show(name);
  });

  window.addEventListener("resize", measure);
  setLang(lang());
  const initial = location.hash.replace("#", "");
  if (["scan", "sign", "vote"].includes(initial)) show(initial);
  else show("deck");
  measure();
  updateFlow();
  paintVotes();
  loadMeta();
  restoreReceipt();
})();
