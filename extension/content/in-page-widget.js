// In-page widget: top-right floating panel that iframes popup.html.
// Toolbar click toggles via {type:"toggle-widget"}; X tears down.
//
// SYNC: token values below mirror shared/tokens.css. Shadow DOM can't see
// host-page CSS variables, so we keep two copies.

(() => {
  const IS_TOP_FRAME = (() => {
    try { return window === window.top; } catch { return false; }
  })();
  if (!IS_TOP_FRAME) return;

  // Idempotent: content scripts re-run on every match; bail if already mounted.
  if (window.__autoResumeWidgetMounted) return;
  window.__autoResumeWidgetMounted = true;

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
      --on-ink:   oklch(98% 0.008 80);
      --shadow-md: 0 4px 12px oklch(22% 0.025 250 / 0.08);
      --shadow-lg: 0 12px 28px oklch(22% 0.025 250 / 0.12);
      --r-sm: 6px;
      --r-md: 8px;
      --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI Variable",
                   "Segoe UI", system-ui, sans-serif;
      --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
      --dur-fast: 120ms;
      --dur-med:  180ms;
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
        --on-ink:   oklch(15% 0.015 250);
        --shadow-md: 0 4px 12px oklch(0% 0 0 / 0.5);
        --shadow-lg: 0 12px 28px oklch(0% 0 0 / 0.6);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .root { --dur-fast: 0ms; --dur-med: 0ms; }
    }
  `;

  const SHADOW_CSS = `
    * { box-sizing: border-box; margin: 0; padding: 0; }

    .root {
      font-family: var(--font-sans);
      color: var(--ink);
    }

    /* ── Expanded panel ──────────────────────────────────────── */
    .panel {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 380px;
      height: 240px;                            /* fallback until iframe reports */
      max-height: calc(100vh - 32px);
      background: var(--paper);
      border: 1px solid var(--rule);
      border-radius: var(--r-md);
      box-shadow: var(--shadow-lg);
      overflow: hidden;
      display: flex;
      flex-direction: column;
      transition: height 150ms var(--ease-out);
    }

    .panel-chrome {
      flex-shrink: 0;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 4px;
      border-bottom: 1px solid var(--rule);
      background: var(--paper);
    }

    .panel iframe {
      flex: 1;
      width: 100%;
      border: none;
      background: var(--paper);
    }

    .panel-close {
      width: 24px;
      height: 24px;
      padding: 0;
      border: 1px solid transparent;
      background: transparent;
      color: var(--ink-mute);
      border-radius: var(--r-sm);
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: color var(--dur-fast) var(--ease-out),
                  border-color var(--dur-fast) var(--ease-out),
                  background var(--dur-fast) var(--ease-out);
    }
    .panel-close:hover {
      color: var(--ink);
      border-color: var(--rule);
      background: var(--surface);
    }
    .panel-close:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .panel-close svg {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.75;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    /* ── Motion ──────────────────────────────────────────────── */
    .panel[data-anim="enter"] {
      animation: panel-in var(--dur-med) var(--ease-out);
    }

    @keyframes panel-in {
      from { transform: translateX(8px); opacity: 0; }
      to   { transform: translateX(0);   opacity: 1; }
    }
  `;

  const X_SVG = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
  `;

  const state = {
    host: null,
    root: null,
    expanded: false,
  };

  function ensureMounted() {
    if (state.host && document.body.contains(state.host)) return;

    // Clean stale hosts from soft-reloads.
    for (const stale of document.querySelectorAll("#autoresume-in-page-widget")) {
      stale.remove();
    }

    const host = document.createElement("div");
    host.id = "autoresume-in-page-widget";
    host.style.cssText = `
      all: initial !important;
      position: fixed !important;
      inset: 0 0 auto auto !important;
      width: 0 !important;
      height: 0 !important;
      z-index: 2147483646 !important;
      pointer-events: none !important;
    `;

    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${SHADOW_TOKENS}${SHADOW_CSS}</style><div class="root" id="root"></div>`;
    document.body.appendChild(host);

    state.host = host;
    state.root = root;
  }

  function render() {
    if (!state.expanded) {
      tearDown();
      return;
    }

    ensureMounted();
    const rootEl = state.root.getElementById("root");
    if (!rootEl) return;

    const iframeSrc = chrome.runtime.getURL("popup/popup.html");
    rootEl.innerHTML = `
      <div class="panel" data-anim="enter" role="dialog" aria-label="AutoResume">
        <div class="panel-chrome">
          <button class="panel-close" id="aw-close" type="button" aria-label="Close AutoResume">
            ${X_SVG}
          </button>
        </div>
        <iframe src="${iframeSrc}" title="AutoResume" allow="clipboard-write"></iframe>
      </div>
    `;
    // Host has pointer-events:none for layout safety; panel needs them on.
    const panel = rootEl.querySelector(".panel");
    panel.style.pointerEvents = "auto";
    const closeBtn = state.root.getElementById("aw-close");
    closeBtn.addEventListener("click", () => toggle(false));
  }

  function tearDown() {
    if (state.host && state.host.parentNode) {
      state.host.parentNode.removeChild(state.host);
    }
    state.host = null;
    state.root = null;
  }

  function toggle(force) {
    const target = typeof force === "boolean" ? force : !state.expanded;
    if (target === state.expanded) return;
    state.expanded = target;
    render();
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "toggle-widget") {
      toggle();
    }
  });

  // Panel = iframe content + 28px chrome strip + 2px borders + 2px pad.
  const PANEL_OVERHEAD = 32;
  window.addEventListener("message", (e) => {
    if (e.data?.type !== "autoresume-widget-height") return;
    if (!state.root) return;
    const iframe = state.root.querySelector("iframe");
    if (!iframe || e.source !== iframe.contentWindow) return;
    const panel = state.root.querySelector(".panel");
    if (!panel) return;
    const max = window.innerHeight - 32;
    const h = Math.max(120, Math.min((e.data.h | 0) + PANEL_OVERHEAD, max));
    panel.style.height = h + "px";
  });
})();
