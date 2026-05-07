// AutoResume status badge : Quiet workshop tool.
//
// Two visible modes:
//   1. Collapsed circle (28×28, bottom-right) : default
//   2. Expanded card (280px) : opens on click, mirrors popup
//
// Hidden entirely on hosts the user has disabled via the popup's
// More options → "hidden on" list (localStorage.autoResumeDisabledDomains).
//
// SYNC: token values below mirror extension/shared/tokens.css. Two manually
// kept copies are acceptable here because the badge runs in Shadow DOM and
// host-page CSS variables aren't reachable across the shadow boundary.

window.AutoFill = window.AutoFill || {};

const IS_TOP_FRAME = (() => {
  try { return window === window.top; } catch { return false; }
})();

const SHADOW_TOKENS = `
  :host {
    all: initial;
    color-scheme: light dark;
  }
  .root {
    --paper:    oklch(97% 0.012 80);
    --surface:  oklch(94% 0.014 80);
    --rule:     oklch(82% 0.008 80);
    --ink:      oklch(22% 0.025 250);
    --ink-mute: oklch(40% 0.020 250);
    --ink-faint:oklch(55% 0.015 240);
    --accent:   oklch(50% 0.18 25);
    --success:  oklch(50% 0.13 145);
    --warning:  oklch(70% 0.14 75);
    --tint-success: oklch(94% 0.04 145);
    --tint-accent:  oklch(95% 0.04 25);
    --on-ink:   oklch(98% 0.008 80);
    --shadow-md: 0 4px 12px oklch(22% 0.025 250 / 0.08);
    --shadow-lg: 0 12px 28px oklch(22% 0.025 250 / 0.12);
    --r-sm: 6px;
    --r-md: 8px;
    --r-lg: 10px;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable",
                 "Segoe UI", system-ui, sans-serif;
    --font-mono: ui-monospace, "SF Mono", "Cascadia Mono", "Cascadia Code",
                 "Roboto Mono", Menlo, Consolas, monospace;
    --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
    --dur-fast: 120ms;
    --dur-med:  220ms;
  }
  @media (prefers-color-scheme: dark) {
    .root {
      --paper:    oklch(15% 0.015 250);
      --surface:  oklch(22% 0.018 250);
      --rule:     oklch(35% 0.014 250);
      --ink:      oklch(94% 0.012 80);
      --ink-mute: oklch(75% 0.012 80);
      --ink-faint:oklch(62% 0.012 80);
      --accent:   oklch(68% 0.16 25);
      --success:  oklch(72% 0.14 145);
      --warning:  oklch(78% 0.13 75);
      --tint-success: oklch(28% 0.04 145);
      --tint-accent:  oklch(28% 0.05 25);
      --on-ink:   oklch(15% 0.015 250);
      --shadow-md: 0 4px 12px oklch(0% 0 0 / 0.5);
      --shadow-lg: 0 12px 28px oklch(0% 0 0 / 0.6);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .root { --dur-fast: 0ms; --dur-med: 0ms; }
    .spinner-icon { animation: none !important; }
  }
`;

const SHADOW_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }

  .root {
    font-family: var(--font-sans);
    color: var(--ink);
    line-height: 1.5;
    font-variant-numeric: tabular-nums;
  }

  .circle {
    display: inline-flex;
    align-items: center;
    width: 28px;
    height: 28px;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: 999px;
    box-shadow: var(--shadow-md);
    color: var(--ink-faint);
    cursor: pointer;
    overflow: hidden;
    transition: width var(--dur-med) var(--ease-out),
                color var(--dur-fast) var(--ease-out),
                border-color var(--dur-fast) var(--ease-out);
  }

  .circle[data-state="detected"] { color: var(--ink); }
  .circle[data-state="filling"]  { color: var(--accent); }
  .circle[data-state="done"]     { color: var(--success); border-color: var(--success); }
  .circle[data-state="error"]    { color: var(--accent);  border-color: var(--accent); }

  .circle:hover,
  .circle[data-pinned="true"] {
    width: auto;
    padding-right: 12px;
  }

  .circle .glyph {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .circle .glyph svg {
    width: 16px;
    height: 16px;
  }

  .circle .label {
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.04em;
    text-transform: lowercase;
    color: var(--ink-mute);
    white-space: nowrap;
    max-width: 0;
    opacity: 0;
    transition: max-width var(--dur-med) var(--ease-out),
                opacity var(--dur-fast) var(--ease-out);
  }

  .circle:hover .label,
  .circle[data-pinned="true"] .label {
    max-width: 180px;
    opacity: 1;
    margin-left: 4px;
  }

  .spinner-icon {
    animation: badge-spin 1s linear infinite;
  }

  @keyframes badge-spin { to { transform: rotate(360deg); } }

  /* ── Card ───────────────────────────────────────────── */
  .card {
    width: 280px;
    padding: 16px;
    background: var(--paper);
    border: 1px solid var(--rule);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-lg);
    color: var(--ink);
    font-size: 15px;
  }

  .card-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--rule);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 15px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .brand-mark {
    width: 8px;
    height: 8px;
    background: var(--accent);
    border-radius: 1px;
  }

  .top-actions {
    display: flex;
    gap: 4px;
  }

  .icon-btn {
    width: 28px;
    height: 28px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-mute);
    border-radius: var(--r-sm);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: color var(--dur-fast) var(--ease-out),
                background var(--dur-fast) var(--ease-out);
  }
  .icon-btn:hover { color: var(--ink); background: var(--surface); }
  .icon-btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .icon-btn[data-saved="true"] { color: var(--success); }
  .icon-btn svg { width: 16px; height: 16px; }

  .card-body {
    padding: 20px 0 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .headline {
    font-size: 17px;
    font-weight: 500;
    letter-spacing: -0.01em;
  }

  .ats {
    font-family: var(--font-mono);
    font-size: 15px;
    font-weight: 400;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-mute);
  }

  .subline {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--ink-mute);
    word-break: break-all;
  }

  .summary {
    font-family: var(--font-mono);
    font-size: 15px;
    color: var(--ink);
  }

  .summary .skipped {
    color: var(--ink-mute);
  }

  .summary .skipped::before {
    content: " · ";
    color: var(--ink-faint);
  }

  .error-body {
    font-size: 14px;
    background: var(--tint-accent);
    border: 1px solid var(--accent);
    padding: 8px 12px;
    border-radius: var(--r-sm);
    word-break: break-word;
  }

  .filling-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: var(--font-mono);
    font-size: 15px;
  }

  .filling-row .spin {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    border: 1.5px solid var(--ink-faint);
    border-top-color: var(--ink);
    animation: badge-spin 0.9s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .filling-row .spin {
      animation: none;
      border-top-color: var(--ink-faint);
    }
  }

  .btn {
    margin-top: 4px;
    width: 100%;
    padding: 9px 16px;
    border-radius: var(--r-md);
    border: 1px solid transparent;
    background: var(--ink);
    color: var(--on-ink);
    font-family: inherit;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .btn:hover { background: oklch(from var(--ink) calc(l + 0.05) c h); }
  .btn:disabled { opacity: 0.6; cursor: progress; }
  .btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
  .btn svg { width: 14px; height: 14px; }

  .btn-ghost {
    background: transparent;
    color: var(--ink);
    border-color: var(--rule);
  }
  .btn-ghost:hover {
    background: var(--surface);
    border-color: var(--ink-faint);
  }

  .card-foot {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--rule);
    display: flex;
    justify-content: flex-end;
  }

  .link-btn {
    background: none;
    border: none;
    color: var(--ink-mute);
    font-family: var(--font-mono);
    font-size: 13px;
    letter-spacing: 0.04em;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 3px;
  }
  .link-btn:hover { color: var(--ink); background: var(--surface); }
`;

const STATE_LABELS = {
  idle: "no form",
  detected: "form detected",
  filling: "filling",
  done: "filled",
  error: "error",
};

// detector.js still uses the legacy update("detecting"|"waiting"|"ready"|"filling"|"done"|"error", filled, unfilled, details).
// Keep that signature; map to the new state internally.
function mapStatus(legacy) {
  switch (legacy) {
    case "detecting": return "detected";
    case "waiting":   return "idle";
    case "ready":     return "detected";
    case "filling":   return "filling";
    case "done":      return "done";
    case "error":     return "error";
    default:          return "idle";
  }
}

function currentHost() {
  try { return window.location.hostname; } catch { return ""; }
}

function isDisabledHost() {
  try {
    const raw = localStorage.getItem("autoResumeDisabledDomains");
    if (!raw) return false;
    const list = JSON.parse(raw);
    return Array.isArray(list) && list.includes(currentHost());
  } catch {
    return false;
  }
}

function disableForCurrentHost() {
  try {
    const raw = localStorage.getItem("autoResumeDisabledDomains");
    const list = raw ? JSON.parse(raw) : [];
    const host = currentHost();
    if (!list.includes(host)) list.push(host);
    localStorage.setItem("autoResumeDisabledDomains", JSON.stringify(list));
    // Mirror to chrome.storage.local so the popup's hidden-hosts list sees it.
    if (chrome?.storage?.local?.set) {
      chrome.storage.local.set({ autoResumeDisabledDomains: list });
    }
  } catch {}
}

function stripParen(s) {
  return String(s).replace(/\s*\([^)]*\)\s*$/, "");
}

function svgIcon(name, extraClass = "") {
  const ATTR =
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ' +
    'aria-hidden="true"';
  const glyph = window.AutoResumeIcons?.glyphs?.[name] || "";
  return `<svg ${ATTR} class="${extraClass}">${glyph}</svg>`;
}

function glyphForState(state) {
  switch (state) {
    case "filling": return svgIcon("circle-dashed", "spinner-icon");
    case "done":    return svgIcon("circle-check");
    case "error":   return svgIcon("circle-alert");
    case "detected":return svgIcon("circle-dashed");
    case "idle":
    default:        return svgIcon("file-text");
  }
}

AutoFill.Badge = {
  host: null,
  root: null,
  state: "idle",
  filled: [],
  unfilled: [],
  details: "",
  expanded: false,
  saved: false,
  autoCollapseTimer: null,

  create() {
    if (!IS_TOP_FRAME) return;
    if (isDisabledHost()) return;

    for (const stale of document.querySelectorAll("#autoresume-status-badge")) {
      if (stale !== this.host) stale.remove();
    }
    if (this.host && !document.body.contains(this.host)) {
      this.host = null;
      this.root = null;
    }
    if (this.host && this.root) return;

    const host = document.createElement("div");
    host.id = "autoresume-status-badge";
    host.setAttribute("data-autoresume", "badge");
    host.style.cssText = `
      all: initial !important;
      position: fixed !important;
      bottom: 16px !important;
      right: 16px !important;
      z-index: 2147483647 !important;
      width: auto !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      transform: none !important;
      pointer-events: auto !important;
    `;

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>${SHADOW_TOKENS}${SHADOW_CSS}</style>
      <div class="root" id="root">
        <div class="circle" id="circle" data-state="idle" role="button" tabindex="0"
             aria-label="AutoResume status">
          <span class="glyph" id="circle-glyph">${glyphForState("idle")}</span>
          <span class="label" id="circle-label">${STATE_LABELS.idle}</span>
        </div>
      </div>
    `;
    document.body.appendChild(host);
    this.host = host;
    this.root = root;

    const circle = root.getElementById("circle");
    circle.addEventListener("click", () => this.toggleExpanded());
    circle.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.toggleExpanded();
      }
    });

    document.addEventListener("keydown", this._onKeydown = (e) => {
      if (e.key === "Escape" && this.expanded) {
        this.toggleExpanded(false);
      }
    });
    document.addEventListener("click", this._onDocClick = (e) => {
      if (!this.expanded) return;
      if (this.host && this.host.contains(e.target)) return;
      this.toggleExpanded(false);
    }, true);
  },

  toggleExpanded(force) {
    const target = typeof force === "boolean" ? force : !this.expanded;
    this.expanded = target;
    this._render();
  },

  update(legacyStatus, filled, unfilled, details) {
    if (!IS_TOP_FRAME) return;
    if (isDisabledHost()) return;
    this.create();
    if (!this.host) return;

    const state = mapStatus(legacyStatus);
    const prev = this.state;
    this.state = state;
    this.filled = filled || [];
    this.unfilled = unfilled || [];
    this.details = details || "";

    if (this.autoCollapseTimer) {
      clearTimeout(this.autoCollapseTimer);
      this.autoCollapseTimer = null;
    }

    // After Done: if expanded, hold for 5s then collapse to circle. The circle
    // keeps the success tint via data-state="done" indefinitely until the next
    // detect pass overwrites it.
    if (state === "done" && this.expanded) {
      const delay = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 5000;
      this.autoCollapseTimer = setTimeout(() => {
        if (this.state === "done") this.toggleExpanded(false);
      }, delay);
    }

    this._render();
  },

  _render() {
    if (!this.root) return;
    const rootEl = this.root.getElementById("root");
    if (!rootEl) return;

    if (this.expanded) {
      rootEl.innerHTML = this._renderCard();
      this._wireCardEvents();
    } else {
      rootEl.innerHTML = `
        <div class="circle" id="circle" data-state="${this.state}"
             role="button" tabindex="0" aria-label="AutoResume: ${STATE_LABELS[this.state] || this.state}">
          <span class="glyph">${glyphForState(this.state)}</span>
          <span class="label">${STATE_LABELS[this.state] || this.state}</span>
        </div>
      `;
      const circle = this.root.getElementById("circle");
      circle.addEventListener("click", () => this.toggleExpanded(true));
      circle.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.toggleExpanded(true);
        }
      });
    }
  },

  _renderCard() {
    const atsName = (window.__atsModule?.name || this.state || "form").toUpperCase();
    const host = currentHost();
    const body = this._renderBody();
    const action = this._renderAction();
    const bookmarkIcon = this.saved ? "bookmark-check" : "bookmark";

    return `
      <div class="card" role="dialog" aria-label="AutoResume status">
        <div class="card-top">
          <div class="brand">
            <span class="brand-mark" aria-hidden="true"></span>
            <span>AutoResume</span>
          </div>
          <div class="top-actions">
            <button class="icon-btn" id="badge-save" type="button"
                    aria-label="Save this job" data-saved="${this.saved}">
              ${svgIcon(bookmarkIcon)}
            </button>
            <button class="icon-btn" id="badge-close" type="button" aria-label="Close">
              ${svgIcon("x")}
            </button>
          </div>
        </div>
        <div class="card-body">
          <div class="headline"><span class="ats">${atsName}</span></div>
          <div class="subline">${escapeHtml(host)}</div>
          ${body}
          ${action}
        </div>
        <div class="card-foot">
          <button class="link-btn" id="badge-disable" type="button">hide on this site</button>
        </div>
      </div>
    `;
  },

  _renderBody() {
    if (this.state === "filling") {
      return `<div class="filling-row"><span class="spin" aria-hidden="true"></span><span>filling</span></div>`;
    }
    if (this.state === "done") {
      const total = this.filled.length + this.unfilled.length;
      const skipped = this.unfilled.map(stripParen).slice(0, 3);
      const overflow = Math.max(0, this.unfilled.length - 3);
      const skipText = skipped.length
        ? `<span class="skipped">skipped ${escapeHtml(skipped.join(", "))}${overflow ? ` +${overflow}` : ""}</span>`
        : "";
      return `<p class="summary">filled ${this.filled.length} of ${total}${skipText}</p>`;
    }
    if (this.state === "error") {
      return `<div class="error-body">${escapeHtml(this.details || "Fill failed.")}</div>`;
    }
    if (this.state === "detected") {
      return `<p class="summary">ready when you are</p>`;
    }
    return `<p class="summary">no application form here</p>`;
  },

  _renderAction() {
    if (this.state === "detected" || this.state === "idle") {
      return `<button class="btn" id="badge-fill" type="button">${svgIcon("arrow-right")} Fill this page</button>`;
    }
    if (this.state === "filling") {
      return `<button class="btn" id="badge-fill" type="button" disabled>filling</button>`;
    }
    if (this.state === "done") {
      return `<button class="btn btn-ghost" id="badge-fill" type="button">${svgIcon("rotate")} Re-fill</button>`;
    }
    if (this.state === "error") {
      return `<button class="btn" id="badge-fill" type="button">${svgIcon("rotate")} Retry</button>`;
    }
    return "";
  },

  _wireCardEvents() {
    const r = this.root;
    const fillBtn = r.getElementById("badge-fill");
    if (fillBtn) {
      fillBtn.addEventListener("click", () => {
        if (window.AutoFill?.triggerFill) window.AutoFill.triggerFill();
      });
    }
    const closeBtn = r.getElementById("badge-close");
    if (closeBtn) closeBtn.addEventListener("click", () => this.toggleExpanded(false));

    const saveBtn = r.getElementById("badge-save");
    if (saveBtn) {
      saveBtn.addEventListener("click", async () => {
        try {
          const resp = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(
              {
                type: "fetch",
                url: "http://localhost:8765/save-job",
                method: "POST",
                body: JSON.stringify({
                  url: window.location.href,
                  title: document.title || "",
                }),
              },
              (r) => (r ? resolve(r) : reject(new Error("save failed")))
            );
          });
          // Background returns { ok, data } where data is the server's JSON
          // body. Both must be ok for a real save.
          if (resp?.ok && resp?.data?.ok) {
            this.saved = true;
            saveBtn.dataset.saved = "true";
            saveBtn.innerHTML = svgIcon("bookmark-check");
          }
        } catch {}
      });
    }

    const disableBtn = r.getElementById("badge-disable");
    if (disableBtn) {
      disableBtn.addEventListener("click", () => {
        disableForCurrentHost();
        if (this.host) this.host.remove();
        this.host = null;
        this.root = null;
      });
    }
  },

  hide() {
    if (this.host) this.host.style.setProperty("opacity", "0", "important");
  },

  show() {
    if (this.host) this.host.style.setProperty("opacity", "1", "important");
  },
};

function escapeHtml(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
