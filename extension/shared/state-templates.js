// State-host templates and rendering. Both popup and panel show the same
// six states (idle, detected, filling, done, error, server-offline) for
// the current tab; this module owns the templates, derivation, and DOM
// mount. Handlers are passed in by the surface (each surface owns its
// own onFill / onRetry behavior).

// ── DOM helpers ─────────────────────────────────────────────
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, "");
    else node.setAttribute(k, v);
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return node;
}

export function iconSvg(symbolId, iconBase = "../shared/icons.svg") {
  // createElement("svg") yields HTMLUnknownElement; parse via innerHTML so
  // the SVG namespace is detected.
  const wrap = document.createElement("span");
  wrap.innerHTML =
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<use href="${iconBase}#${symbolId}"/></svg>`;
  return wrap.firstElementChild;
}

export function stripParen(s) {
  return String(s).replace(/\s*\([^)]*\)\s*$/, "");
}

export function isFillablePage(url) {
  return typeof url === "string" && /^https?:/i.test(url);
}

export function urlMatchesTab(entryUrl, tabUrl) {
  try {
    const a = new URL(entryUrl);
    const b = new URL(tabUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return entryUrl === tabUrl;
  }
}

export function originOfUrl(u) {
  try { return new URL(u).hostname; } catch { return ""; }
}

// ── Templates ───────────────────────────────────────────────
export const templates = {
  idle: () => el("section", {},
    el("p", { class: "headline" }, "Nothing to fill here"),
    el("p", { class: "subline" }, "Open a job posting in a normal tab to begin.")
  ),

  detected: ({ atsName, host }) => el("section", {},
    el("p", { class: "ats-line" },
      el("span", { class: "ats" }, (atsName || "form").toUpperCase()),
      host && el("span", { class: "slash" }, " / "),
      host && el("span", { class: "host" }, host)
    ),
    el("div", { class: "action-row" },
      el("button", { id: "btn-fill", class: "btn btn-primary btn-block", type: "button" },
        iconSvg("i-arrow-right"),
        "Fill this page"
      )
    )
  ),

  filling: ({ atsName }) => el("section", {},
    el("p", { class: "ats-line" },
      el("span", { class: "ats" }, (atsName || "form").toUpperCase())
    ),
    el("p", { class: "summary filling-line" },
      el("span", { class: "spinner", "aria-hidden": "true" }),
      el("span", {}, "filling")
    )
  ),

  done: ({ atsName, filled, unfilled }) => {
    const total = (filled || []).length + (unfilled || []).length;
    const f = (filled || []).length;
    const skipped = (unfilled || []).map(stripParen).slice(0, 3);
    const overflow = Math.max(0, (unfilled || []).length - 3);
    const skipText = skipped.length
      ? `skipped ${skipped.join(", ")}${overflow ? ` +${overflow}` : ""}`
      : "";
    return el("section", {},
      el("p", { class: "ats-line" },
        el("span", { class: "ats" }, (atsName || "form").toUpperCase())
      ),
      el("p", { class: "summary" },
        el("span", { class: "ratio" }, `filled ${f} of ${total}`),
        skipText && el("span", { class: "skipped" }, skipText)
      ),
      el("div", { class: "action-row" },
        el("button", { id: "btn-fill", class: "btn btn-ghost btn-block", type: "button" },
          iconSvg("i-rotate"),
          "Re-fill"
        )
      )
    );
  },

  error: ({ message, atsName }) => el("section", {},
    el("p", { class: "ats-line" },
      el("span", { class: "ats" }, (atsName || "error").toUpperCase())
    ),
    el("p", { class: "error-body" }, message || "Fill failed."),
    el("div", { class: "action-row" },
      el("button", { id: "btn-fill", class: "btn btn-primary btn-block", type: "button" },
        iconSvg("i-rotate"),
        "Retry"
      )
    )
  ),

  "server-offline": () => el("section", {},
    el("p", { class: "headline" }, "Server offline"),
    el("p", { class: "subline" }, "The local server reads form fields. Start it with:"),
    el("button", {
      id: "btn-cmd-copy",
      class: "cmd-block",
      type: "button",
      title: "Click to copy",
    },
      el("span", { class: "cmd-text" }, "python server/serve.py"),
      iconSvg("i-copy")
    ),
    el("div", { class: "action-row" },
      el("button", { id: "btn-retry-server", class: "btn btn-ghost btn-block", type: "button" },
        iconSvg("i-rotate"),
        "Retry connection"
      )
    )
  ),
};

// ── Derive state from ctx ───────────────────────────────────
export function deriveState(ctx) {
  if (!ctx.serverOnline) return { name: "server-offline", data: {} };

  if (ctx.filling) {
    const atsName = ctx.adapterFrame?.name || ctx.lastState?.ats || "filling";
    return { name: "filling", data: { atsName } };
  }

  const state = ctx.lastState;
  if (state && state.url && ctx.tab?.url && urlMatchesTab(state.url, ctx.tab.url)) {
    if (state.error) {
      return { name: "error", data: { message: state.error, atsName: state.ats } };
    }
    if (state.status === "complete" || state.status === "partial") {
      return {
        name: "done",
        data: {
          atsName: state.ats,
          filled: state.filled || [],
          unfilled: state.unfilled || [],
        },
      };
    }
  }

  if (ctx.adapterFrame || isFillablePage(ctx.tab?.url)) {
    return {
      name: "detected",
      data: {
        atsName: ctx.adapterFrame?.name || "form",
        host: ctx.tab ? originOfUrl(ctx.tab.url) : "",
      },
    };
  }

  return { name: "idle", data: {} };
}

// ── Mount: render template + wire handlers ──────────────────
// `handlers` may include onFill, onRetryServer, onCopyCmd. Each is wired
// only if its corresponding button appears in the rendered template.
export function mountState(hostEl, ctx, handlers = {}) {
  const { name, data } = deriveState(ctx);
  const node = (templates[name] || templates.idle)(data);
  hostEl.replaceChildren(node);

  if (handlers.onFill) {
    const b = hostEl.querySelector("#btn-fill");
    if (b) b.addEventListener("click", handlers.onFill);
  }
  if (handlers.onRetryServer) {
    const b = hostEl.querySelector("#btn-retry-server");
    if (b) b.addEventListener("click", handlers.onRetryServer);
  }
  if (handlers.onCopyCmd) {
    const b = hostEl.querySelector("#btn-cmd-copy");
    if (b) b.addEventListener("click", handlers.onCopyCmd);
  }

  return name;
}
