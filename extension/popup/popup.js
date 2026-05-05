// AutoResume popup : explicit state machine.
//
// State derivation order:
//   1. Server unreachable                → server-offline
//   2. Filling triggered from this popup → filling (transient)
//   3. Server has a recent /state record → done | error
//   4. Adapter loaded in current frame   → detected
//   5. Otherwise                         → idle
//
// The popup's primary action collapses Fill + PDF inject into a single press
// (PRODUCT.md design principle: press once, do everything). The legacy
// "Inject PDF" surface is moved into More options as a manual override.

const SERVER = "http://localhost:8765";
const $ = (s) => document.querySelector(s);

function isFillablePage(url) {
  return typeof url === "string" && /^https?:/i.test(url);
}

function urlMatchesTab(entryUrl, tabUrl) {
  try {
    const a = new URL(entryUrl);
    const b = new URL(tabUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return entryUrl === tabUrl;
  }
}

function originOfUrl(u) {
  try { return new URL(u).hostname; } catch { return ""; }
}

// ── DOM helpers ─────────────────────────────────────────────
function el(tag, attrs = {}, ...children) {
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

function iconSvg(symbolId) {
  // createElement("svg") yields an HTMLUnknownElement, not a real SVG node.
  // Parsing via innerHTML on a span lets HTML5 detect the SVG namespace.
  const wrap = document.createElement("span");
  wrap.innerHTML =
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
    `stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">` +
    `<use href="../shared/icons.svg#${symbolId}"/></svg>`;
  return wrap.firstElementChild;
}

// ── Templates ───────────────────────────────────────────────
const t = {
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

function stripParen(s) {
  return String(s).replace(/\s*\([^)]*\)\s*$/, "");
}

// ── Render ──────────────────────────────────────────────────
const ctx = {
  tab: null,
  serverOnline: false,
  adapterFrame: null,
  lastState: null,
  pdfs: [],
  filling: false,
};

function render(stateName, data = {}) {
  const host = $("#state-host");
  const node = (t[stateName] || t.idle)(data);
  host.replaceChildren(node);
  const fillBtn = $("#btn-fill");
  if (fillBtn) fillBtn.addEventListener("click", onFillClick);
  const retryBtn = $("#btn-retry-server");
  if (retryBtn) retryBtn.addEventListener("click", onRetryServer);
  const cmdBtn = $("#btn-cmd-copy");
  if (cmdBtn) cmdBtn.addEventListener("click", onCopyCmd);
}

function deriveAndRender() {
  if (!ctx.serverOnline) return render("server-offline");
  if (ctx.filling) {
    const atsName = ctx.adapterFrame?.name || ctx.lastState?.ats || "filling";
    return render("filling", { atsName });
  }
  const state = ctx.lastState;
  if (state && state.url && ctx.tab?.url && urlMatchesTab(state.url, ctx.tab.url)) {
    if (state.error) {
      return render("error", { message: state.error, atsName: state.ats });
    }
    if (state.status === "complete" || state.status === "partial") {
      return render("done", {
        atsName: state.ats,
        filled: state.filled || [],
        unfilled: state.unfilled || [],
      });
    }
  }
  if (ctx.adapterFrame || isFillablePage(ctx.tab?.url)) {
    return render("detected", {
      atsName: ctx.adapterFrame?.name || "form",
      host: ctx.tab ? originOfUrl(ctx.tab.url) : "",
    });
  }
  return render("idle");
}

// ── Data fetch ──────────────────────────────────────────────
async function checkServer() {
  try {
    const r = await fetch(`${SERVER}/status`);
    const d = await r.json();
    ctx.serverOnline = !!d.ok;
  } catch {
    ctx.serverOnline = false;
  }
  $("#server-status").dataset.state = ctx.serverOnline ? "online" : "offline";
  $("#server-status").setAttribute(
    "aria-label",
    `Server status: ${ctx.serverOnline ? "online" : "offline"}`
  );
}

async function loadPdfList() {
  const select = $("#pdf-select");
  try {
    const r = await fetch(`${SERVER}/pdf-list`);
    const d = await r.json();
    ctx.pdfs = Array.isArray(d.pdfs) ? d.pdfs : [];
  } catch {
    ctx.pdfs = [];
  }
  select.innerHTML = "";
  if (ctx.pdfs.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "no pdfs available";
    select.appendChild(opt);
    return;
  }
  for (const pdf of ctx.pdfs) {
    const opt = document.createElement("option");
    opt.value = pdf;
    opt.textContent = pdf;
    select.appendChild(opt);
  }
}

async function loadLastState() {
  try {
    const r = await fetch(`${SERVER}/state`);
    ctx.lastState = await r.json();
  } catch {
    ctx.lastState = null;
  }
}

async function detectAdapterFrame(tabId) {
  try {
    const probes = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: () => window.__atsModule?.name || null,
    });
    for (const p of probes || []) {
      if (p.result && p.result !== "generic") {
        return { name: p.result, frameId: p.frameId };
      }
    }
  } catch {}
  return null;
}

// ── Primary action ─────────────────────────────────────────
async function onFillClick() {
  if (!ctx.tab) return;
  ctx.filling = true;
  deriveAndRender();
  toast("");

  try {
    if (ctx.adapterFrame) {
      await chrome.scripting.executeScript({
        target: { tabId: ctx.tab.id, frameIds: [ctx.adapterFrame.frameId] },
        func: async () => {
          if (typeof window.AutoFill?.triggerFill === "function") {
            await window.AutoFill.triggerFill();
            return { ok: true };
          }
          return { ok: false, error: "triggerFill missing" };
        },
      });
      // Detector posts /state after fill completes; brief delay then re-render.
      await new Promise((r) => setTimeout(r, 400));
      await loadLastState();
    } else {
      // No adapter for this site: load the generic stack and run it.
      await chrome.scripting.executeScript({
        target: { tabId: ctx.tab.id, allFrames: true },
        files: [
          "content/autofill-core.js",
          "content/file-injector.js",
          "content/ats/generic.js",
          "content/generic-runner.js",
        ],
      });
      const frameResults = await chrome.scripting.executeScript({
        target: { tabId: ctx.tab.id, allFrames: true },
        func: () => window.__autoresumeRunGeneric?.(),
      });
      const best = pickBestFrameResult(frameResults);
      const filled = best?.filled || [];
      const unfilled = best?.unfilled || [];
      if (filled.length === 0 && unfilled.length === 0 && !best?.error) {
        toast("no form fields found on this page", "error");
        ctx.lastState = null;
      } else {
        ctx.lastState = {
          url: ctx.tab.url,
          ats: "form",
          status: best?.error ? "error" : (unfilled.length > 0 ? "partial" : "complete"),
          filled,
          unfilled,
          error: best?.error || null,
        };
      }
    }
  } catch (err) {
    ctx.lastState = { ...(ctx.lastState || {}), error: err.message, url: ctx.tab.url };
  } finally {
    ctx.filling = false;
    deriveAndRender();
  }
}

function pickBestFrameResult(frameResults) {
  if (!frameResults || frameResults.length === 0) return null;
  const results = frameResults.map((f) => f?.result).filter(Boolean);
  if (results.length === 0) return null;
  const withFills = results.filter((r) => (r.filled || []).length > 0);
  if (withFills.length > 0) {
    return withFills.reduce((a, b) =>
      (b.filled?.length || 0) > (a.filled?.length || 0) ? b : a
    );
  }
  const nonAborted = results.find((r) => !r.aborted);
  if (nonAborted) return nonAborted;
  return results.reduce((a, b) =>
    (b.error || "").length > (a.error || "").length ? b : a
  );
}

// ── Bookmark accessory ─────────────────────────────────────
async function onSaveJob() {
  if (!ctx.tab?.url) return;
  const btn = $("#btn-save");
  toast("saving");
  try {
    const r = await fetch(`${SERVER}/save-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: ctx.tab.url, title: ctx.tab.title || "" }),
    });
    const d = await r.json();
    if (d.ok) {
      btn.dataset.saved = "true";
      btn.querySelector("use").setAttribute("href", "../shared/icons.svg#i-bookmark-check");
      toast(`saved · ${d.count} in queue`, "success");
    } else {
      toast(`save failed: ${d.error || "unknown"}`, "error");
    }
  } catch {
    toast("save failed: server offline", "error");
  }
}

// ── More options sections ──────────────────────────────────
async function refreshAgentSection() {
  const section = $("#agent-section");
  const list = $("#agent-q-list");
  const fillBtn = $("#btn-agent-fill");
  if (!ctx.tab?.url) {
    section.hidden = true;
    return;
  }

  const all = await chrome.storage.local.get(null);
  const myEntries = [];
  for (const [key, val] of Object.entries(all)) {
    if (!key.startsWith("agent_q_")) continue;
    if (!val || !val.page_url) continue;
    if (!urlMatchesTab(val.page_url, ctx.tab.url)) continue;
    myEntries.push({ id: key.slice("agent_q_".length), ...val });
  }
  if (myEntries.length === 0) {
    section.hidden = true;
    return;
  }

  let answers = [];
  if (ctx.serverOnline) {
    try {
      const r = await fetch(`${SERVER}/pending-answers`);
      const d = await r.json();
      answers = Array.isArray(d.answers) ? d.answers : [];
    } catch {}
  }
  const ready = new Set(answers.map((a) => a.id));

  section.hidden = false;
  list.replaceChildren();
  for (const e of myEntries) {
    const row = el("span", {
      class: ready.has(e.id) ? "agent-q-ready" : "",
    }, `${ready.has(e.id) ? "ok " : "wait "}id ${e.id} ${e.company || ""}`);
    list.appendChild(row);
  }

  const readyEntries = myEntries.filter((e) => ready.has(e.id));
  fillBtn.hidden = readyEntries.length === 0;
  fillBtn.dataset.ids = readyEntries.map((e) => e.id).join(",");
}

async function onAgentFill() {
  const fillBtn = $("#btn-agent-fill");
  const ids = (fillBtn.dataset.ids || "").split(",").filter(Boolean);
  if (ids.length === 0) return;
  toast(`drafting ${ids.length} answer${ids.length === 1 ? "" : "s"}`);

  let answersResp;
  try {
    const r = await fetch(`${SERVER}/pending-answers`);
    answersResp = await r.json();
  } catch (err) {
    toast("server offline", "error");
    return;
  }
  const answerById = new Map(
    (answersResp.answers || []).map((a) => [a.id, a.answer])
  );
  const storage = await chrome.storage.local.get(ids.map((id) => `agent_q_${id}`));

  await chrome.scripting.executeScript({
    target: { tabId: ctx.tab.id, allFrames: true },
    files: ["content/autofill-core.js"],
  });

  let filled = 0;
  const errors = [];
  for (const id of ids) {
    const entry = storage[`agent_q_${id}`];
    const answer = answerById.get(id);
    if (!entry || answer == null) continue;

    const frameResults = await chrome.scripting.executeScript({
      target: { tabId: ctx.tab.id, allFrames: true },
      func: (selector, value) => {
        const t = document.querySelector(selector);
        if (!t) return { ok: false, error: "target not found" };
        if (t.isContentEditable) {
          t.focus();
          t.textContent = value;
          t.dispatchEvent(new Event("input", { bubbles: true }));
          t.dispatchEvent(new Event("change", { bubbles: true }));
          t.dispatchEvent(new Event("blur", { bubbles: true }));
          return { ok: true };
        }
        if (window.AutoFill?.setValue) {
          const ok = window.AutoFill.setValue(t, value);
          return ok ? { ok: true } : { ok: false, error: "setValue rejected" };
        }
        return { ok: false, error: "AutoFill.setValue missing" };
      },
      args: [entry.target_selector, answer],
    });

    const success = (frameResults || []).some((f) => f?.result?.ok);
    if (success) {
      filled += 1;
      try {
        await fetch(`${SERVER}/consume-answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
      } catch {}
      await chrome.storage.local.remove(`agent_q_${id}`);
    } else {
      const firstErr = (frameResults || [])
        .map((f) => f?.result?.error)
        .filter(Boolean)[0];
      errors.push(`${id}: ${firstErr || "no frame matched"}`);
    }
  }

  if (filled > 0 && errors.length === 0) {
    toast(`filled ${filled} draft${filled === 1 ? "" : "s"}`, "success");
  } else if (filled > 0) {
    toast(`filled ${filled}, ${errors.length} failed`, "error");
  } else {
    toast(`no drafts filled: ${errors[0] || "see console"}`, "error");
  }
  refreshAgentSection();
}

async function onPdfManualInject() {
  const filename = $("#pdf-select").value;
  if (!filename) {
    toast("no pdf selected", "error");
    return;
  }
  toast(`injecting ${filename}`);
  try {
    await chrome.scripting.executeScript({
      target: { tabId: ctx.tab.id, allFrames: true },
      files: ["content/autofill-core.js", "content/file-injector.js"],
    });
    await chrome.scripting.executeScript({
      target: { tabId: ctx.tab.id, allFrames: true },
      func: async (fname) => {
        if (!window.AutoFill?.FileInjector) return { ok: false };
        return await window.AutoFill.FileInjector.inject(fname);
      },
      args: [filename],
    });
    toast(`pdf injected: ${filename}`, "success");
  } catch (err) {
    toast(`error: ${err.message}`, "error");
  }
}

async function refreshHiddenHosts() {
  const section = $("#hidden-hosts-section");
  const list = $("#hidden-hosts-list");
  const all = await chrome.storage.local.get(["autoResumeDisabledDomains"]);
  const hosts = Array.isArray(all.autoResumeDisabledDomains)
    ? all.autoResumeDisabledDomains
    : [];
  if (hosts.length === 0) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  list.replaceChildren();
  for (const host of hosts) {
    list.appendChild(
      el("li", {},
        el("span", {}, host),
        el("button", {
          type: "button",
          onClick: () => reEnableHost(host),
        }, "re-enable")
      )
    );
  }
}

async function reEnableHost(host) {
  const all = await chrome.storage.local.get(["autoResumeDisabledDomains"]);
  const next = (all.autoResumeDisabledDomains || []).filter((h) => h !== host);
  await chrome.storage.local.set({ autoResumeDisabledDomains: next });
  refreshHiddenHosts();
  toast(`re-enabled on ${host}`, "success");
}

// ── Server-offline handlers ────────────────────────────────
async function onRetryServer() {
  toast("checking");
  await checkServer();
  if (ctx.serverOnline) {
    await Promise.all([loadPdfList(), loadLastState()]);
    toast("server online", "success");
  } else {
    toast("still offline", "error");
  }
  deriveAndRender();
}

async function onCopyCmd() {
  try {
    await navigator.clipboard.writeText("python server/serve.py");
    toast("copied", "success");
  } catch {
    toast("copy failed", "error");
  }
}

// ── Toast ───────────────────────────────────────────────────
function toast(text, tone = "") {
  const node = $("#toast");
  node.textContent = text || "";
  if (tone) node.dataset.tone = tone;
  else node.removeAttribute("data-tone");
}

// ── Init ────────────────────────────────────────────────────
async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  ctx.tab = tab || null;

  await checkServer();
  if (ctx.serverOnline) {
    await Promise.all([loadPdfList(), loadLastState()]);
  }

  if (ctx.tab?.id != null) {
    ctx.adapterFrame = await detectAdapterFrame(ctx.tab.id);
  }

  deriveAndRender();
  await Promise.all([refreshAgentSection(), refreshHiddenHosts()]);

  $("#btn-save").addEventListener("click", onSaveJob);
  $("#btn-agent-fill").addEventListener("click", onAgentFill);
  $("#btn-inject").addEventListener("click", onPdfManualInject);
}

document.addEventListener("DOMContentLoaded", init);
