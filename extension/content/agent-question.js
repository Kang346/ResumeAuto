// Queues an open-ended job-application question to the local server so a
// human-driven Agent session can draft an answer offline. Injected on
// demand by background.js when the user clicks the
// "Ask Agent to draft an answer" context menu item.
//
// Single global entry point: window.__agentQueueQuestion(selectedText).
// AutoFill helpers (findAccumulatedLabel) come from autofill-core.js, which
// background.js injects right before this file.

(function () {
  const SERVER = "http://127.0.0.1:8765";
  const PROMPT_KEYWORDS = [
    "why", "tell us", "describe", "cover letter",
    "passionate", "motivated", "interest", "excite",
  ];

  function findTargetTextarea() {
    // 1) currently focused editable
    const a = document.activeElement;
    if (a && (a.tagName === "TEXTAREA" || a.isContentEditable)) return a;

    // 2) nearest editable to the selection anchor
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount > 0) {
      let node = sel.anchorNode;
      while (node && node !== document.body) {
        const el = node.nodeType === 1 ? node : node.parentElement;
        if (!el) break;
        if (el.tagName === "TEXTAREA" || el.isContentEditable) return el;
        const inner = el.querySelector
          ? el.querySelector('textarea, [contenteditable="true"]')
          : null;
        if (inner) return inner;
        node = el.parentElement;
      }
    }

    // 3) any textarea whose accumulated label looks like an open-ended prompt
    const textareas = [...document.querySelectorAll('textarea, [contenteditable="true"]')];
    for (const t of textareas) {
      const label = (window.AutoFill?.findAccumulatedLabel?.(t) || "").toLowerCase();
      if (PROMPT_KEYWORDS.some((kw) => label.includes(kw))) return t;
    }
    return null;
  }

  function ensureSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    // Prefer a data-attribute so React rerenders preserve it.
    const tag = `autoresume-q-${Date.now()}`;
    el.setAttribute("data-autoresume-target", tag);
    return `[data-autoresume-target="${tag}"]`;
  }

  function extractCompany() {
    try {
      const seg = location.pathname.split("/").filter(Boolean)[0];
      if (seg && seg.length >= 2) return seg.toLowerCase();
      return location.hostname.split(".")[0].toLowerCase();
    } catch {
      return "";
    }
  }

  function extractJobTitle() {
    const wd = document.querySelector('[data-automation-id="jobPostingHeader"]');
    if (wd && wd.textContent.trim()) return wd.textContent.trim();
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return (document.title || "").trim();
  }

  function showBadge(text, type = "info") {
    const existing = document.getElementById("agent-q-badge");
    if (existing) existing.remove();
    const el = document.createElement("div");
    el.id = "agent-q-badge";
    el.style.cssText = [
      "position:fixed",
      "right:16px",
      "bottom:16px",
      "max-width:340px",
      "padding:10px 12px",
      "background:" + (type === "error" ? "#7f1d1d" : "#1e293b"),
      "color:#f1f5f9",
      "border-radius:8px",
      "font:13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      "box-shadow:0 8px 24px rgba(0,0,0,.35)",
      "z-index:2147483647",
      "white-space:pre-wrap",
    ].join(";");
    const close = document.createElement("span");
    close.textContent = "×";
    close.style.cssText =
      "float:right;margin-left:8px;cursor:pointer;font-weight:700;opacity:.7";
    close.addEventListener("click", () => el.remove());
    el.appendChild(close);
    el.appendChild(document.createTextNode(text));
    document.documentElement.appendChild(el);
    setTimeout(() => {
      if (el.parentNode) el.remove();
    }, 30000);
  }

  async function postJSON(path, payload) {
    const r = await fetch(`${SERVER}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return r.json();
  }

  window.__agentQueueQuestion = async function (selectedText) {
    const question = (selectedText || "").trim();
    if (!question) {
      showBadge("Agent: select the question text first.", "error");
      return;
    }

    const target = findTargetTextarea();
    if (!target) {
      showBadge(
        "Agent: couldn't find a textarea to fill on this page.",
        "error"
      );
      return;
    }

    const target_selector = ensureSelector(target);
    const company = extractCompany();
    const job_title = extractJobTitle();
    const page_url = location.href;

    let resp;
    try {
      resp = await postJSON("/queue-question", {
        question,
        company,
        job_title,
        page_url,
        target_selector,
      });
    } catch (err) {
      showBadge(`Agent: server offline (${err.message}).`, "error");
      return;
    }
    if (!resp || !resp.ok) {
      showBadge(`Agent: ${resp?.error || "queue failed"}.`, "error");
      return;
    }

    // Persist the mapping so the popup can find this question by tab URL.
    try {
      await chrome.storage.local.set({
        [`agent_q_${resp.id}`]: {
          page_url,
          target_selector,
          company,
          job_title,
          queued_at: Date.now(),
        },
      });
    } catch {
      // storage may not be available from injected context in rare cases —
      // queueing on the server already succeeded, so don't fail loudly.
    }

    const preview = question.length > 60 ? question.slice(0, 60) + "…" : question;
    showBadge(
      `Agent queued (id ${resp.id})\n"${preview}"\n` +
        "Drain in Agent, then open the popup → Fill answers."
    );
  };
})();
