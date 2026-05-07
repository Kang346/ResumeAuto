// AutoResume popup. Surface-specific glue only — heavy lifting lives in
// `../shared/`. Same state machine as before; the popup is the
// fixed-width quick action and a launchpad for the side panel.

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

function rerender() {
  mountState($("#state-host"), ctx, {
    onFill: () => triggerFill(ctx, { rerender, toast }),
    onRetryServer,
    onCopyCmd,
  });
}

async function checkServer() {
  try {
    const d = await Promise.race([
      api.getStatus(),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 3000)),
    ]);
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

function onServerChipClick() {
  if (ctx.serverOnline) toast(`server: localhost:8765`);
  else onRetryServer();
}

async function onRetryServer() {
  toast("checking");
  await checkServer();
  if (ctx.serverOnline) {
    await Promise.all([loadPdfList(), loadLastState()]);
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

async function onOpenPanel() {
  if (!ctx.tab?.windowId) return;
  try {
    await chrome.sidePanel.open({ windowId: ctx.tab.windowId });
    window.close();
  } catch (err) {
    toast(`open panel failed: ${err.message}`, "error");
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

async function init() {
  toast = mountToast($("#toast"));

  // Report content height to the in-page widget parent so it can size the
  // panel. Set up before any await so it works even if init stalls. Observe
  // body, not documentElement: in an iframe documentElement.scrollHeight is
  // floored by viewport height and won't shrink when content collapses.
  const sendHeightToParent = () => {
    try {
      const h = document.body.scrollHeight;
      window.parent.postMessage({ type: "autoresume-widget-height", h }, "*");
    } catch {}
  };
  new ResizeObserver(sendHeightToParent).observe(document.body);
  sendHeightToParent();

  // Render with default ctx so state-host isn't blank if a later await stalls.
  rerender();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    ctx.tab = tab || null;
  } catch {
    ctx.tab = null;
  }

  await checkServer();
  if (ctx.serverOnline) {
    await Promise.all([loadPdfList(), loadLastState()]);
  }

  if (ctx.tab?.id != null) {
    try {
      ctx.adapterFrame = await detectAdapterFrame(ctx.tab.id);
    } catch {
      ctx.adapterFrame = null;
    }
  }

  rerender();
  await Promise.all([refreshAgent(), refreshHosts()]);

  $("#btn-save").addEventListener("click", () => saveCurrentJob(ctx, {
    toast, btn: $("#btn-save"),
  }));
  $("#btn-open-panel").addEventListener("click", onOpenPanel);
  $("#server-chip").addEventListener("click", onServerChipClick);
  $("#btn-agent-fill").addEventListener("click", () => fillDraftedAnswers(ctx, $("#btn-agent-fill"), {
    toast, refreshAgent,
  }));
  $("#btn-inject").addEventListener("click", () => injectPdfManually(ctx, $("#pdf-select").value, { toast }));
}

document.addEventListener("DOMContentLoaded", init);
