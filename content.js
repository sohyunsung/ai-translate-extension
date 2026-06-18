// content.js — 선택 번역 UI, 전체 번역, 원본+번역 비교 보기, 복원
(() => {
  if (window.__bedrockTranslatorLoaded) return;
  window.__bedrockTranslatorLoaded = true;

  // 전체 번역 시 복원을 위한 원본 저장소
  const originalStore = new Map(); // element -> { html }
  const insertedNodes = []; // dual 모드에서 삽입한 노드들

  // ---------- 공통 ----------
  function sendBg(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(resp);
        }
      });
    });
  }

  // ---------- 새로고침 후 번역 유지 ----------
  async function markAutoPage(mode) {
    try {
      const { autoPages = {} } = await chrome.storage.local.get("autoPages");
      autoPages[location.href] = mode;
      const keys = Object.keys(autoPages);
      if (keys.length > 300) delete autoPages[keys[0]];
      await chrome.storage.local.set({ autoPages });
    } catch (e) {}
  }
  async function unmarkAutoPage() {
    try {
      const { autoPages = {} } = await chrome.storage.local.get("autoPages");
      if (autoPages[location.href]) {
        delete autoPages[location.href];
        await chrome.storage.local.set({ autoPages });
      }
    } catch (e) {}
  }

  // ---------- 선택 영역 번역 ----------
  let floatBtn = null;
  let bubble = null;

  function removeFloatBtn() {
    if (floatBtn) {
      floatBtn.remove();
      floatBtn = null;
    }
  }
  function removeBubble() {
    if (bubble) {
      bubble.remove();
      bubble = null;
    }
  }

  function getSelectionText() {
    const sel = window.getSelection();
    return sel ? sel.toString().trim() : "";
  }

  document.addEventListener("mouseup", (e) => {
    // 우리 UI 위에서의 클릭은 무시
    if (e.target.closest && e.target.closest(".bedrock-tr-ui")) return;
    setTimeout(() => {
      const text = getSelectionText();
      removeFloatBtn();
      if (!text) return;
      const sel = window.getSelection();
      if (!sel.rangeCount) return;
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return;

      floatBtn = document.createElement("div");
      floatBtn.className = "bedrock-tr-ui bedrock-tr-floatbtn";
      floatBtn.textContent = "번역";
      floatBtn.style.top = `${window.scrollY + rect.bottom + 6}px`;
      floatBtn.style.left = `${window.scrollX + rect.left}px`;
      floatBtn.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        showSelectionTranslation(text, rect);
        removeFloatBtn();
      });
      document.body.appendChild(floatBtn);
    }, 10);
  });

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest && e.target.closest(".bedrock-tr-ui")) return;
    removeFloatBtn();
    removeBubble();
  });

  async function showSelectionTranslation(text, rect) {
    removeBubble();
    bubble = document.createElement("div");
    bubble.className = "bedrock-tr-ui bedrock-tr-bubble";

    let top, left;
    if (rect) {
      top = window.scrollY + rect.bottom + 8;
      left = window.scrollX + rect.left;
    } else {
      top = window.scrollY + 80;
      left = window.scrollX + 80;
    }
    bubble.style.top = `${top}px`;
    bubble.style.left = `${left}px`;

    const close = document.createElement("div");
    close.className = "bedrock-tr-close";
    close.textContent = "×";
    close.addEventListener("click", removeBubble);

    const body = document.createElement("div");
    body.className = "bedrock-tr-bubble-body";
    body.innerHTML = '<span class="bedrock-tr-spinner"></span> 번역 중…';

    bubble.appendChild(close);
    bubble.appendChild(body);
    document.body.appendChild(bubble);

    const resp = await sendBg({ type: "translateText", text });
    if (!resp || !resp.ok) {
      body.innerHTML = "";
      const err = document.createElement("div");
      err.className = "bedrock-tr-error";
      err.textContent = "⚠ " + (resp?.error || "번역 실패");
      body.appendChild(err);
      return;
    }
    body.innerHTML = "";
    const orig = document.createElement("div");
    orig.className = "bedrock-tr-orig";
    orig.textContent = text;
    const tr = document.createElement("div");
    tr.className = "bedrock-tr-result";
    tr.textContent = resp.result;
    body.appendChild(orig);
    body.appendChild(tr);
  }

  // ---------- 전체 번역 ----------
  const BLOCK_SELECTOR =
    "p,h1,h2,h3,h4,h5,h6,li,td,th,caption,blockquote,dd,dt,figcaption,summary";
  const SKIP_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "CODE", "PRE", "TEXTAREA", "INPUT", "SELECT"
  ]);

  // 페이지 배경이 어두운지 감지 → 번역문 색을 동적으로 결정
  function parseRgb(s) {
    const m = (s || "").match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
  }
  function isDarkBackground() {
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      const rgb = parseRgb(getComputedStyle(el).backgroundColor);
      if (rgb && rgb.a > 0) {
        const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
        return lum < 0.5;
      }
    }
    return (
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches
    );
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  }

  // 본문만 번역 모드: 헤더/푸터/내비/사이드바 등 페이지 크롬 제외
  const CHROME_SELECTOR =
    'header, footer, nav, aside, [role="banner"], [role="navigation"], ' +
    '[role="contentinfo"], [role="complementary"], [aria-hidden="true"]';

  // 본문 컨테이너 추정 (리더 모드 비슷): main / [role=main] / 가장 긴 article
  function pickMainRoot() {
    const explicit = document.querySelector('main, [role="main"]');
    if (explicit && explicit.innerText.trim().length > 200) return explicit;
    let best = null;
    let bestLen = 0;
    for (const a of document.querySelectorAll("article")) {
      const len = a.innerText.trim().length;
      if (len > bestLen) {
        best = a;
        bestLen = len;
      }
    }
    return best && bestLen > 200 ? best : null;
  }

  // 텍스트를 가진 "잎(leaf) 블록" 요소만 수집 (중복 번역 방지)
  function collectLeafBlocks(bodyOnly) {
    const root = bodyOnly ? pickMainRoot() || document.body : document.body;
    const all = Array.from(root.querySelectorAll(BLOCK_SELECTOR));
    const result = [];
    for (const el of all) {
      if (SKIP_TAGS.has(el.tagName)) continue;
      if (el.closest(".bedrock-tr-ui")) continue;
      if (el.dataset.bedrockTr) continue; // 이미 번역됨
      // 본문만 모드: 페이지 크롬(헤더/푸터/내비/사이드바) 안의 요소 제외
      if (bodyOnly && el.closest(CHROME_SELECTOR)) continue;
      // 후손에 또 다른 블록이 있으면 잎이 아님 → 건너뜀(후손이 번역됨)
      if (el.querySelector(BLOCK_SELECTOR)) continue;
      if (!isVisible(el)) continue;
      const text = el.innerText.trim();
      if (text.length < 1) continue;
      if (!/[A-Za-z가-힣ぁ-んァ-ン一-龥]/.test(text)) continue; // 의미있는 문자 없음
      result.push(el);
    }
    return result;
  }

  function chunkBlocks(blocks) {
    const chunks = [];
    let cur = [];
    let curLen = 0;
    for (const el of blocks) {
      const len = el.innerText.length;
      if (cur.length >= 40 || (curLen + len > 3000 && cur.length > 0)) {
        chunks.push(cur);
        cur = [];
        curLen = 0;
      }
      cur.push(el);
      curLen += len;
    }
    if (cur.length) chunks.push(cur);
    return chunks;
  }

  let translating = false;

  async function translatePage(mode) {
    if (translating) return { ok: false, error: "이미 번역 중입니다." };
    translating = true;
    showToast("페이지 번역 중…", true);
    try {
      const { bodyOnly = true } = await chrome.storage.local.get("bodyOnly");
      const blocks = collectLeafBlocks(bodyOnly);
      if (blocks.length === 0) {
        showToast("번역할 텍스트를 찾지 못했습니다.");
        return { ok: true, count: 0 };
      }
      const chunks = chunkBlocks(blocks);
      // 여러 묶음을 동시에 호출(직렬 → 병렬)해 속도 향상
      const CONCURRENCY = 4;
      let next = 0;
      let done = 0;
      let failedBlocks = 0;
      let lastError = null;

      async function worker() {
        while (next < chunks.length) {
          const chunk = chunks[next++];
          const segments = chunk.map((el) => el.innerText.trim());
          const resp = await sendBg({ type: "translateBatch", segments });
          if (!resp || !resp.ok) {
            // 실패한 묶음은 원문 유지하고 계속 진행
            failedBlocks += chunk.length;
            lastError = resp?.error || "번역 실패";
          } else {
            chunk.forEach((el, i) => applyTranslation(el, resp.result[i], mode));
          }
          done += chunk.length;
          showToast(`페이지 번역 중… (${done}/${blocks.length})`, true);
        }
      }

      const workers = Math.min(CONCURRENCY, chunks.length);
      await Promise.all(Array.from({ length: workers }, () => worker()));

      if (failedBlocks > 0) {
        showToast(`완료 — 일부 실패 ${failedBlocks}블록 (${lastError || ""})`);
      } else {
        showToast(`번역 완료 (${blocks.length}개 블록)`);
      }
      markAutoPage(mode);
      return { ok: true, count: blocks.length - failedBlocks, failed: failedBlocks };
    } finally {
      translating = false;
    }
  }

  function applyTranslation(el, translated, mode) {
    if (!translated) return;
    if (mode === "dual") {
      if (el.dataset.bedrockTr === "dual") return;
      el.dataset.bedrockTr = "dual";
      const node = document.createElement("div");
      node.className =
        "bedrock-tr-ui bedrock-tr-dual" +
        (isDarkBackground() ? " bedrock-tr-dual-dark" : "");
      node.textContent = translated;
      el.insertAdjacentElement("afterend", node);
      insertedNodes.push(node);
    } else {
      // replace 모드: 원본 보관 후 텍스트 교체
      if (!originalStore.has(el)) {
        originalStore.set(el, { html: el.innerHTML });
      }
      el.dataset.bedrockTr = "replace";
      el.textContent = translated;
    }
  }

  function restorePage() {
    // dual 삽입 노드 제거
    for (const n of insertedNodes) n.remove();
    insertedNodes.length = 0;
    // replace 원복
    for (const [el, data] of originalStore.entries()) {
      el.innerHTML = data.html;
      delete el.dataset.bedrockTr;
    }
    originalStore.clear();
    // dual 표시 제거
    document.querySelectorAll('[data-bedrock-tr="dual"]').forEach((el) => {
      delete el.dataset.bedrockTr;
    });
    unmarkAutoPage();
    showToast("원본 복원 완료");
  }

  // ---------- 토스트 ----------
  let toast = null;
  let toastTimer = null;
  function showToast(text, sticky) {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "bedrock-tr-ui bedrock-tr-toast";
      document.body.appendChild(toast);
    }
    toast.textContent = text;
    if (toastTimer) clearTimeout(toastTimer);
    if (!sticky) {
      toastTimer = setTimeout(() => {
        if (toast) {
          toast.remove();
          toast = null;
        }
      }, 2500);
    }
  }

  // ---------- 메시지 수신 (popup / 우클릭 메뉴) ----------
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === "showSelectionTranslation") {
      const text = msg.text || getSelectionText();
      if (text) {
        const sel = window.getSelection();
        let rect = null;
        if (sel && sel.rangeCount) rect = sel.getRangeAt(0).getBoundingClientRect();
        showSelectionTranslation(text, rect);
      }
      sendResponse({ ok: true });
    } else if (msg.type === "translatePage") {
      translatePage(msg.mode).then((r) => sendResponse(r));
      return true;
    } else if (msg.type === "restorePage") {
      restorePage();
      sendResponse({ ok: true });
    } else if (msg.type === "ping") {
      sendResponse({ ok: true });
    }
    return true;
  });

  // ---------- 새로고침 시 자동 재번역 (캐시 사용 → 무료·즉시) ----------
  (async function initAutoTranslate() {
    try {
      const { persistTranslation = true, autoPages = {} } =
        await chrome.storage.local.get(["persistTranslation", "autoPages"]);
      const mode = autoPages[location.href];
      if (persistTranslation && mode) {
        // 페이지가 어느 정도 렌더된 뒤 적용
        setTimeout(() => translatePage(mode), 800);
      }
    } catch (e) {}
  })();
})();
