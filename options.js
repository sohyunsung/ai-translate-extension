// options.js
const $ = (id) => document.getElementById(id);

const PRESETS = [
  "apac.amazon.nova-lite-v1:0",
  "apac.amazon.nova-micro-v1:0",
  "apac.amazon.nova-pro-v1:0"
];

function syncCustomVisibility() {
  const isCustom = $("modelPreset").value === "__custom__";
  $("customWrap").style.display = isCustom ? "block" : "none";
}

function syncAuthVisibility() {
  const mode = $("authMode").value;
  $("apiKeyBlock").style.display = mode === "apiKey" ? "block" : "none";
  $("credsBlock").style.display = mode === "tempCreds" ? "block" : "none";
  $("ssoBlock").style.display = mode === "sso" ? "block" : "none";
  if (mode === "sso") renderSsoStatus();
}

async function renderSsoStatus() {
  const r = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "ssoStatus" }, (resp) => resolve(resp || {}))
  );
  const el = $("ssoStatus");
  if (!r.sessionExpiresAt) {
    el.textContent = "로그인 필요";
    return;
  }
  const now = Date.now();
  const sess = r.sessionExpiresAt > now;
  if (sess) {
    el.textContent = `로그인됨 (세션 ~${new Date(r.sessionExpiresAt).toLocaleTimeString()}까지)`;
    el.style.color = "#059669";
  } else {
    el.textContent = "세션 만료 — 다시 로그인 필요";
    el.style.color = "#b91c1c";
  }
}

async function load() {
  const s = await chrome.storage.local.get([
    "authMode",
    "apiKey",
    "accessKeyId",
    "secretAccessKey",
    "sessionToken",
    "ssoStartUrl",
    "ssoRegion",
    "ssoAccountId",
    "ssoRoleName",
    "region",
    "modelId",
    "targetLang",
    "persistTranslation"
  ]);
  $("authMode").value = s.authMode || "apiKey";
  if (s.apiKey) $("apiKey").value = s.apiKey;
  if (s.accessKeyId) $("accessKeyId").value = s.accessKeyId;
  if (s.secretAccessKey) $("secretAccessKey").value = s.secretAccessKey;
  if (s.sessionToken) $("sessionToken").value = s.sessionToken;
  if (s.ssoStartUrl) $("ssoStartUrl").value = s.ssoStartUrl;
  if (s.ssoRegion) $("ssoRegion").value = s.ssoRegion;
  if (s.ssoAccountId) $("ssoAccountId").value = s.ssoAccountId;
  if (s.ssoRoleName) $("ssoRoleName").value = s.ssoRoleName;
  if (s.region) $("region").value = s.region;
  if (s.targetLang) $("targetLang").value = s.targetLang;
  $("persistTranslation").checked = s.persistTranslation !== false;
  syncAuthVisibility();

  const modelId = s.modelId || "apac.amazon.nova-lite-v1:0";
  if (PRESETS.includes(modelId)) {
    $("modelPreset").value = modelId;
  } else {
    $("modelPreset").value = "__custom__";
    $("customModel").value = modelId;
  }
  syncCustomVisibility();

  renderUsage();
  renderShortcuts();
  renderCache();
}

// 모델별 참고 단가 ($/1M 토큰, us-east-1 기준)
function rateFor(modelId) {
  if (/nova-micro/.test(modelId)) return { in: 0.035, out: 0.14 };
  if (/nova-lite/.test(modelId)) return { in: 0.06, out: 0.24 };
  if (/nova-pro/.test(modelId)) return { in: 0.8, out: 3.2 };
  return null;
}

function prettyModel(modelId) {
  return modelId
    .replace(/^[a-z]+\./, "") // 리전 접두사 제거 (apac./us.)
    .replace(/^amazon\./, "")
    .replace(/^anthropic\./, "")
    .replace(/-v\d+:\d+$/, "");
}

function costCell(modelId, inTok, outTok) {
  const r = rateFor(modelId);
  if (!r) return { text: "-", value: 0 };
  const cost = (inTok / 1e6) * r.in + (outTok / 1e6) * r.out;
  return { text: "$" + cost.toFixed(4), value: cost };
}

async function renderUsage() {
  const { usageByModel, usageSince } = await chrome.storage.local.get([
    "usageByModel",
    "usageSince"
  ]);
  const byModel = usageByModel || {};
  const body = $("usageBody");
  body.innerHTML = "";

  const models = Object.keys(byModel);
  let tReq = 0,
    tIn = 0,
    tOut = 0,
    tCost = 0;

  if (models.length === 0) {
    body.innerHTML =
      '<tr><td colspan="5" style="color:#9ca3af; padding:6px 0">사용 기록 없음</td></tr>';
  } else {
    for (const modelId of models) {
      const m = byModel[modelId];
      const c = costCell(modelId, m.inputTokens, m.outputTokens);
      tReq += m.requests;
      tIn += m.inputTokens;
      tOut += m.outputTokens;
      tCost += c.value;
      const tr = document.createElement("tr");
      tr.style.textAlign = "right";
      tr.innerHTML =
        `<td style="text-align:left">${prettyModel(modelId)}</td>` +
        `<td>${m.requests.toLocaleString()}</td>` +
        `<td>${m.inputTokens.toLocaleString()}</td>` +
        `<td>${m.outputTokens.toLocaleString()}</td>` +
        `<td>${c.text}</td>`;
      body.appendChild(tr);
    }
    const total = document.createElement("tr");
    total.style.textAlign = "right";
    total.style.fontWeight = "700";
    total.style.borderTop = "1px solid #e5e7eb";
    total.innerHTML =
      `<td style="text-align:left">합계</td>` +
      `<td>${tReq.toLocaleString()}</td>` +
      `<td>${tIn.toLocaleString()}</td>` +
      `<td>${tOut.toLocaleString()}</td>` +
      `<td>$${tCost.toFixed(4)}</td>`;
    body.appendChild(total);
  }

  $("u-since").textContent = usageSince
    ? new Date(usageSince).toLocaleString()
    : "-";
}

async function renderShortcuts() {
  try {
    const cmds = await chrome.commands.getAll();
    const labels = {
      "translate-page": "전체 번역 (원본 대체)",
      "translate-dual": "전체 번역 (원문+번역)",
      "translate-selection": "선택 영역 번역"
    };
    const html = cmds
      .filter((c) => labels[c.name])
      .map(
        (c) =>
          `<div>${labels[c.name]}: <b>${c.shortcut || "(미설정)"}</b></div>`
      )
      .join("");
    $("shortcuts").innerHTML = html || "단축키 정보를 불러올 수 없습니다.";
  } catch (e) {
    $("shortcuts").textContent = "단축키 정보를 불러올 수 없습니다.";
  }
}

async function renderCache() {
  const { trCache } = await chrome.storage.local.get("trCache");
  const n = trCache ? Object.keys(trCache).length : 0;
  $("cacheCount").textContent = n.toLocaleString();
}

$("modelPreset").addEventListener("change", syncCustomVisibility);
$("authMode").addEventListener("change", syncAuthVisibility);

$("save").addEventListener("click", async () => {
  const preset = $("modelPreset").value;
  const modelId =
    preset === "__custom__" ? $("customModel").value.trim() : preset;

  await chrome.storage.local.set({
    authMode: $("authMode").value,
    apiKey: $("apiKey").value.trim(),
    accessKeyId: $("accessKeyId").value.trim(),
    secretAccessKey: $("secretAccessKey").value.trim(),
    sessionToken: $("sessionToken").value.trim(),
    ssoStartUrl: $("ssoStartUrl").value.trim(),
    ssoRegion: $("ssoRegion").value.trim(),
    ssoAccountId: $("ssoAccountId").value.trim(),
    ssoRoleName: $("ssoRoleName").value.trim(),
    region: $("region").value,
    modelId: modelId || "apac.amazon.nova-lite-v1:0",
    targetLang: $("targetLang").value,
    persistTranslation: $("persistTranslation").checked
  });

  $("saved").textContent = "✓ 저장됨";
  setTimeout(() => ($("saved").textContent = ""), 2000);
  renderUsage(); // 단가 모델이 바뀌었을 수 있으니 비용 갱신
});

$("resetUsage").addEventListener("click", async () => {
  await chrome.storage.local.set({ usageByModel: {}, usageSince: Date.now() });
  renderUsage();
});

$("clearCache").addEventListener("click", async () => {
  await chrome.storage.local.set({ trCache: {} });
  renderCache();
});

$("clearAutoPages").addEventListener("click", async () => {
  await chrome.storage.local.set({ autoPages: {} });
  $("clearAutoPages").textContent = "✓ 비움";
  setTimeout(() => ($("clearAutoPages").textContent = "자동 번역 페이지 목록 비우기"), 1500);
});

$("openShortcuts").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

$("ssoLogin").addEventListener("click", () => {
  const el = $("ssoStatus");
  el.style.color = "#2563eb";
  el.textContent = "로그인 진행 중… 열린 탭에서 승인하세요";
  chrome.runtime.sendMessage({ type: "ssoLogin" }, (resp) => {
    if (chrome.runtime.lastError) {
      el.style.color = "#b91c1c";
      el.textContent = "오류: " + chrome.runtime.lastError.message;
      return;
    }
    if (resp && resp.ok) {
      el.style.color = "#059669";
      el.textContent = "✓ 로그인 완료";
      renderSsoStatus();
    } else {
      el.style.color = "#b91c1c";
      el.textContent = "실패: " + (resp?.error || "알 수 없음");
    }
  });
});

load();
