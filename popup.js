// popup.js
const $ = (id) => document.getElementById(id);

let mode = "replace";

function setStatus(text, isError) {
  const el = $("status");
  el.textContent = text || "";
  el.classList.toggle("error", !!isError);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function rawSend(tabId, message) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, message, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
      } else {
        resolve(resp);
      }
    });
  });
}

// 콘텐츠 스크립트가 없으면(이미 열려있던 탭 등) 주입 후 재시도
async function ensureContentScript(tabId) {
  const ping = await rawSend(tabId, { type: "ping" });
  if (ping && ping.ok) return true;
  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ["content.css"] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return true;
  } catch (e) {
    return false;
  }
}

async function sendToContent(tabId, message) {
  const ready = await ensureContentScript(tabId);
  if (!ready) {
    return { ok: false, error: "이 페이지에는 주입할 수 없습니다." };
  }
  return rawSend(tabId, message);
}

async function init() {
  const settings = await new Promise((resolve) =>
    chrome.runtime.sendMessage({ type: "getSettings" }, (r) => resolve(r?.settings || {}))
  );

  let hasCreds;
  if (settings.provider === "openrouter") hasCreds = settings.openrouterApiKey;
  else if (settings.authMode === "tempCreds")
    hasCreds = settings.accessKeyId && settings.secretAccessKey;
  else if (settings.authMode === "sso")
    hasCreds = settings.ssoStartUrl && settings.ssoAccountId && settings.ssoRoleName;
  else hasCreds = settings.apiKey;
  if (!hasCreds) {
    $("no-key").classList.remove("hidden");
  }
  if (settings.targetLang) $("targetLang").value = settings.targetLang;
  if (settings.mode) {
    mode = settings.mode;
    document.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
  }

  // 언어 변경 → 저장
  $("targetLang").addEventListener("change", () => {
    chrome.storage.local.set({ targetLang: $("targetLang").value });
  });

  // 본문만 토글
  $("bodyOnly").checked = settings.bodyOnly !== false;
  $("bodyOnly").addEventListener("change", () => {
    chrome.storage.local.set({ bodyOnly: $("bodyOnly").checked });
  });

  // 보기 방식 토글
  document.querySelectorAll(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      document.querySelectorAll(".seg-btn").forEach((b) =>
        b.classList.toggle("active", b === btn)
      );
      chrome.storage.local.set({ mode });
    });
  });

  $("translatePage").addEventListener("click", async () => {
    setStatus("번역 요청 중…");
    const tab = await getActiveTab();
    if (!tab || /^(chrome|edge|about|chrome-extension):/.test(tab.url || "")) {
      setStatus("이 페이지에서는 사용할 수 없습니다.", true);
      return;
    }
    const resp = await sendToContent(tab.id, { type: "translatePage", mode });
    if (!resp || !resp.ok) {
      setStatus(resp?.error || "번역 실패", true);
    } else {
      setStatus(`완료: ${resp.count}개 블록`);
    }
  });

  $("restore").addEventListener("click", async () => {
    const tab = await getActiveTab();
    const resp = await sendToContent(tab.id, { type: "restorePage" });
    setStatus(resp?.ok ? "원본 복원됨" : "복원 실패", !resp?.ok);
  });

  const openOpts = (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  };
  $("open-options").addEventListener("click", openOpts);
  $("open-options-link")?.addEventListener("click", openOpts);
}

init();
