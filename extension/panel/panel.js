// AutoResume side panel. Persistent surface that re-renders on tab change.
// Mostly the same wiring as popup.js but with:
//   - chrome.tabs.onActivated / onUpdated listeners
//   - a queue strip fed by GET /pending-jobs
//   - no "open in side panel" button (we are the panel)

import { api } from "../shared/server-api.js";
import { detectAdapterFrame } from "../shared/adapter-detect.js";
import { mountToast } from "../shared/toast.js";
import { mountState } from "../shared/state-templates.js";
import {
  triggerFill,
  saveCurrentJob,
  injectPdfManually,
  refreshAgentSection,
  fillDraftedAnswers,
  refreshHiddenHosts,
  reEnableHost,
} from "../shared/actions.js";

const $ = (s) => document.querySelector(s);

const ctx = {
  tab: null,
  serverOnline: false,
  adapterFrame: null,
  lastState: null,
  pdfs: [],
  filling: false,
};

let toast;
let myWindowId = null;

function rerender() {
  mountState($("#state-host"), ctx, {
    onFill: () => triggerFill(ctx, { rerender, toast }),
    onRetryServer,
    onCopyCmd,
  });
}

async function checkServer() {
  try {
    const d = await api.getStatus();
    ctx.serverOnline = !!d.ok;
  } catch {
    ctx.serverOnline = false;
  }
  const chip = $("#server-chip");
  const hint = document.querySelector(".server-chip-hint");
  const state = ctx.serverOnline ? "online" : "offline";
  chip.dataset.state = state;
  chip.querySelector(".server-chip-text").textContent = state;
  chip.setAttribute("aria-label", `Server status: ${state}`);
  hint.hidden = ctx.serverOnline;
}

async function loadPdfList() {
  const select = $("#pdf-select");
  try {
    const d = await api.getPdfList();
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
  try { ctx.lastState = await api.getState(); }
  catch { ctx.lastState = null; }
}

// ── Queue strip ────────────────────────────────────────────
function compactUrl(u) {
  try {
    const url = new URL(u);
    const path = url.pathname.length > 40
      ? "…" + url.pathname.slice(-40)
      : url.pathname;
    return `${url.hostname}${path}`;
  } catch {
    return u;
  }
}

function relativeTime(iso) {
  const t = Date.parse(iso);
  if (!t || Number.isNaN(t)) return "";
  const sec = Math.max(1, Math.round((Date.now() - t) / 1000));
  if (sec < 60)   return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60)   return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24)    return `${hr}h`;
  const d = Math.round(hr / 24);
  return `${d}d`;
}

async function refreshQueue() {
  const listEl = $("#queue-list");
  const emptyEl = $("#queue-empty");
  const countEl = $("#queue-count");
  if (!ctx.serverOnline) {
    listEl.replaceChildren();
    emptyEl.hidden = true;
    countEl.textContent = "";
    return;
  }
  let jobs = [];
  try {
    const d = await api.getPendingJobs();
    jobs = Array.isArray(d.jobs) ? d.jobs : [];
  } catch {}

  countEl.textContent = jobs.length ? `${jobs.length}` : "";
  if (jobs.length === 0) {
    listEl.replaceChildren();
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;

  // Newest first; cap at 10 to keep the panel scannable.
  const recent = [...jobs]
    .sort((a, b) => Date.parse(b.saved_at || 0) - Date.parse(a.saved_at || 0))
    .slice(0, 10);

  listEl.replaceChildren();
  for (const job of recent) {
    const row = document.createElement("li");
    row.className = "queue-row";
    const a = document.createElement("a");
    a.className = "queue-url";
    a.href = job.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = job.title || job.url;
    a.textContent = compactUrl(job.url);
    const t = document.createElement("span");
    t.className = "queue-time";
    t.textContent = relativeTime(job.saved_at);
    row.appendChild(a);
    row.appendChild(t);
    listEl.appendChild(row);
  }
}

// ── Tab-change re-render ───────────────────────────────────
async function refreshForActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, windowId: myWindowId ?? chrome.windows.WINDOW_ID_CURRENT });
  ctx.tab = tab || null;
  ctx.adapterFrame = ctx.tab?.id != null ? await detectAdapterFrame(ctx.tab.id) : null;
  // Bail re-fetching state per tab change; /state is global last-fill record,
  // not tab-scoped. Refresh it only on init / explicit retry / after a fill.
  rerender();
  await refreshAgent();
}

// ── Misc handlers ──────────────────────────────────────────
function onServerChipClick() {
  if (ctx.serverOnline) toast(`server: localhost:8765`);
  else onRetryServer();
}

async function onRetryServer() {
  toast("checking");
  await checkServer();
  if (ctx.serverOnline) {
    await Promise.all([loadPdfList(), loadLastState(), refreshQueue()]);
    toast("server online", "success");
  } else {
    toast("still offline", "error");
  }
  rerender();
}

async function onCopyCmd() {
  try {
    await navigator.clipboard.writeText("python server/serve.py");
    toast("copied", "success");
  } catch {
    toast("copy failed", "error");
  }
}

async function refreshAgent() {
  await refreshAgentSection(ctx, {
    sectionEl: $("#agent-section"),
    listEl: $("#agent-q-list"),
    fillBtnEl: $("#btn-agent-fill"),
  });
}

async function refreshHosts() {
  await refreshHiddenHosts({
    sectionEl: $("#hidden-hosts-section"),
    listEl: $("#hidden-hosts-list"),
    onReEnable: async (host) => {
      await reEnableHost(host);
      refreshHosts();
      toast(`re-enabled on ${host}`, "success");
    },
  });
}

// ── Init ────────────────────────────────────────────────────
async function init() {
  toast = mountToast($("#toast"));

  const win = await chrome.windows.getCurrent();
  myWindowId = win?.id ?? null;

  const [tab] = await chrome.tabs.query({ active: true, windowId: myWindowId ?? chrome.windows.WINDOW_ID_CURRENT });
  ctx.tab = tab || null;

  await checkServer();
  if (ctx.serverOnline) {
    await Promise.all([loadPdfList(), loadLastState(), refreshQueue()]);
  }

  if (ctx.tab?.id != null) {
    ctx.adapterFrame = await detectAdapterFrame(ctx.tab.id);
  }

  rerender();
  await Promise.all([refreshAgent(), refreshHosts()]);

  // Topbar buttons
  $("#btn-save").addEventListener("click", () => saveCurrentJob(ctx, {
    toast,
    btn: $("#btn-save"),
    onSaved: () => setTimeout(refreshQueue, 300),
  }));
  $("#server-chip").addEventListener("click", onServerChipClick);
  $("#btn-agent-fill").addEventListener("click", () => fillDraftedAnswers(ctx, $("#btn-agent-fill"), {
    toast, refreshAgent,
  }));
  $("#btn-inject").addEventListener("click", () => injectPdfManually(ctx, $("#pdf-select").value, { toast }));

  // Persistent surface listens for tab changes; popup never had to.
  chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
    if (myWindowId != null && windowId !== myWindowId) return;
    refreshForActiveTab();
  });
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.active) return;
    if (myWindowId != null && tab.windowId !== myWindowId) return;
    if (info.url || info.status === "complete") refreshForActiveTab();
  });
}

document.addEventListener("DOMContentLoaded", init);
