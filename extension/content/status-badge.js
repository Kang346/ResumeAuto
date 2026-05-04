// Floating status badge — visible to the orchestrating agent via screenshot
// Includes a primary "Fill this page" button. Filling no longer auto-runs;
// the user (or an agent posting a window message) must trigger it.
//
// Implementation note: we wrap the badge in a Shadow DOM so the host page's
// CSS (Ashby in particular ships rules that affect generic <div>s and caused
// text to overlap) cannot leak in. The host element itself uses `all: initial`
// on the off chance the Shadow host inherits a transform/position rule.

window.AutoFill = window.AutoFill || {};

// In iframe-embedded ATS forms (e.g. Ashby inside elevenlabs.io), this
// content script runs in the iframe's window. Appending the badge to the
// iframe's body covers the form. The popup already shows the same status,
// and we now expose a "Fill via <adapter>" trigger from the popup, so the
// in-page badge is redundant inside iframes — suppress it there.
const IS_TOP_FRAME = (() => {
  try { return window === window.top; } catch { return false; }
})();

AutoFill.Badge = {
  host: null,       // the element appended to document.body (Shadow host)
  root: null,       // the ShadowRoot
  bodyEl: null,     // status text container inside the shadow tree
  fillBtn: null,    // the action button inside the shadow tree

  create() {
    if (!IS_TOP_FRAME) return;
    // Always remove ANY badge hosts left over from previous script injections
    // or SPA navigations (Ashby/React can re-render the body in ways that
    // detach our state). We then recreate a single fresh host below.
    for (const stale of document.querySelectorAll("#autoresume-status-badge")) {
      if (stale !== this.host) stale.remove();
    }
    // If our tracked host got detached from DOM (e.g. SPA wiped body), reset.
    if (this.host && !document.body.contains(this.host)) {
      this.host = null;
      this.root = null;
      this.bodyEl = null;
      this.fillBtn = null;
    }
    if (this.host && this.root) return;

    // ── Shadow host ────────────────────────────────────────────────────────
    // `all: initial` neutralises any inherited host-page styles. We then set
    // the bare minimum of positioning props with !important so e.g. Ashby's
    // `* { position: absolute }`-style rules cannot pull the badge around.
    const host = document.createElement("div");
    host.id = "autoresume-status-badge";
    host.setAttribute("data-autoresume", "badge");
    host.style.cssText = `
      all: initial !important;
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 2147483647 !important;
      width: auto !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      transform: none !important;
      pointer-events: auto !important;
    `;

    const root = host.attachShadow({ mode: "open" });

    // All visible styling lives inside the shadow root, where Ashby's CSS
    // cannot reach. Using a <style> block with explicit resets on every
    // descendant is belt-and-suspenders against any inherited weirdness.
    root.innerHTML = `
      <style>
        :host { all: initial; }
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
          position: static;
          float: none;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          color: #ecf0f1;
          line-height: 1.5;
        }
        .badge {
          display: block;
          background: #2c3e50;
          color: #ecf0f1;
          padding: 12px 16px;
          border-radius: 8px;
          font-size: 13px;
          line-height: 1.5;
          max-width: 350px;
          min-width: 220px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          transition: opacity 0.3s;
        }
        .body { display: block; }
        .body > div { display: block; }
        .title { font-weight: bold; margin-bottom: 4px; }
        .counts { display: block; }
        .unfilled-list {
          margin-top: 6px;
          font-size: 11px;
          color: #bdc3c7;
          word-break: break-word;
        }
        .details {
          margin-top: 4px;
          font-size: 11px;
          color: #95a5a6;
          word-break: break-word;
        }
        button.fill {
          display: block;
          margin-top: 10px;
          width: 100%;
          padding: 8px 12px;
          background: #3498db;
          color: white;
          border: none;
          border-radius: 6px;
          font-family: inherit;
          font-size: 12px;
          font-weight: bold;
          cursor: pointer;
          transition: background 0.15s;
          line-height: 1.2;
        }
        button.fill:hover:not(:disabled) { background: #2980b9; }
        button.fill:disabled { opacity: 0.6; cursor: wait; }
      </style>
      <div class="badge" part="badge">
        <div class="body" id="body"></div>
        <button class="fill" id="fill" type="button">Fill this page</button>
      </div>
    `;

    const btn = root.getElementById("fill");
    btn.addEventListener("click", () => {
      if (window.AutoFill?.triggerFill) window.AutoFill.triggerFill();
    });

    document.body.appendChild(host);
    this.host = host;
    this.root = root;
    this.bodyEl = root.getElementById("body");
    this.fillBtn = btn;
  },

  update(status, filled, unfilled, details) {
    if (!IS_TOP_FRAME) return;
    this.create();
    const colors = {
      detecting: "#f39c12",
      filling: "#3498db",
      ready: "#1abc9c",
      done: "#27ae60",
      error: "#e74c3c",
      waiting: "#9b59b6",
    };
    const color = colors[status] || "#7f8c8d";

    // Build with safe DOM ops (no innerHTML re-parsing of arbitrary text).
    const body = this.bodyEl;
    body.textContent = "";

    const title = document.createElement("div");
    title.className = "title";
    title.style.color = color;
    title.textContent = `[AutoResume] ${String(status).toUpperCase()}`;
    body.appendChild(title);

    if (filled !== undefined) {
      const counts = document.createElement("div");
      counts.className = "counts";
      counts.textContent = `Filled: ${filled.length} | Unfilled: ${unfilled.length}`;
      body.appendChild(counts);
    }

    if (unfilled && unfilled.length > 0) {
      const u = document.createElement("div");
      u.className = "unfilled-list";
      u.textContent = `Unfilled: ${unfilled.join(", ")}`;
      body.appendChild(u);
    }

    if (details) {
      const d = document.createElement("div");
      d.className = "details";
      d.textContent = details;
      body.appendChild(d);
    }

    // Disable the button while a fill is in progress; relabel based on state.
    if (this.fillBtn) {
      const isFilling = status === "filling";
      this.fillBtn.disabled = isFilling;
      if (status === "done") this.fillBtn.textContent = "Re-fill";
      else if (status === "filling") this.fillBtn.textContent = "Filling...";
      else if (status === "error") this.fillBtn.textContent = "Retry";
      else this.fillBtn.textContent = "Fill this page";
    }
  },

  hide() {
    if (this.host) this.host.style.setProperty("opacity", "0", "important");
  },

  show() {
    if (this.host) this.host.style.setProperty("opacity", "1", "important");
  },
};
