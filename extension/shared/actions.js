// Surface-agnostic action handlers. Each takes a `ctx` (the surface's
// state object) and the UI hooks it needs (toast, button elements, etc.)
// so popup and panel share one implementation.

import { api } from "./server-api.js";
import { el, urlMatchesTab } from "./state-templates.js";

// ── Primary fill action ────────────────────────────────────
export async function triggerFill(ctx, { rerender, toast }) {
  if (!ctx.tab) return;
  if (ctx.filling) return;
  ctx.filling = true;
  rerender();
  toast("");

  try {
    if (ctx.adapterFrame) {
      // Don't await executeScript: when popup.js runs in the in-page widget
      // iframe, the adapter's DOM mutations can hang the iframe's promise
      // forever. Fire-and-forget, then poll /state for the detector's POST.
      const beforeTs = ctx.lastState?.timestamp || null;
      const tabUrl = ctx.tab.url;

      chrome.scripting.executeScript({
        target: { tabId: ctx.tab.id, frameIds: [ctx.adapterFrame.frameId] },
        func: async () => {
          if (typeof window.AutoFill?.triggerFill === "function") {
            await window.AutoFill.triggerFill();
          }
        },
      }).catch(() => {});

      const newState = await pollForNewFillState(beforeTs, tabUrl);
      if (newState) {
        ctx.lastState = newState;
      } else {
        ctx.lastState = {
          url: tabUrl,
          ats: ctx.adapterFrame?.name || "form",
          status: "error",
          error: "fill timed out — page didn't respond",
        };
      }
    } else {
      // No adapter for this site: load generic stack and run it.
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
    rerender();
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

// Poll /state until detector posts a new fill result; null on ~30s timeout.
async function pollForNewFillState(beforeTimestamp, currentUrl, maxAttempts = 60, intervalMs = 500) {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      const state = await api.getState();
      if (
        state && state.url && state.timestamp &&
        urlMatchesTab(state.url, currentUrl) &&
        state.timestamp !== beforeTimestamp
      ) {
        return state;
      }
    } catch {
      // transient server hiccup — keep polling
    }
  }
  return null;
}

// ── Save current tab to queue ──────────────────────────────
export async function saveCurrentJob(ctx, { toast, btn, onSaved }) {
  if (!ctx.tab?.url) return;
  toast("saving");
  try {
    const d = await api.saveJob({ url: ctx.tab.url, title: ctx.tab.title || "" });
    if (d.ok) {
      flashSavedButton(btn);
      toast(`saved · ${d.count} in queue`, "success");
      if (typeof onSaved === "function") onSaved(d);
    } else {
      toast(`save failed: ${d.error || "unknown"}`, "error");
    }
  } catch {
    toast("save failed: server offline", "error");
  }
}

function flashSavedButton(btn) {
  if (!btn) return;
  const label = btn.querySelector(".btn-save-label");
  const useEl = btn.querySelector("use");
  btn.dataset.saved = "true";
  if (useEl) useEl.setAttribute("href", "../shared/icons.svg#i-bookmark-check");
  if (label) label.textContent = "Saved";
  setTimeout(() => {
    btn.dataset.saved = "false";
    if (useEl) useEl.setAttribute("href", "../shared/icons.svg#i-bookmark");
    if (label) label.textContent = "Save";
  }, 1500);
}

// ── Manual PDF inject (from "More options") ────────────────
export async function injectPdfManually(ctx, filename, { toast }) {
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

// ── Drafted-answer queue (agent questions) ─────────────────
// Reads chrome.storage.local for `agent_q_*` entries scoped to the
// current tab, cross-references with /pending-answers, and renders into
// the section. Returns the list of "ready" entry ids (answer in hand).
export async function refreshAgentSection(ctx, { sectionEl, listEl, fillBtnEl }) {
  if (!ctx.tab?.url) {
    sectionEl.hidden = true;
    return [];
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
    sectionEl.hidden = true;
    return [];
  }

  let answers = [];
  if (ctx.serverOnline) {
    try {
      const d = await api.getPendingAnswers();
      answers = Array.isArray(d.answers) ? d.answers : [];
    } catch {}
  }
  const ready = new Set(answers.map((a) => a.id));

  sectionEl.hidden = false;
  listEl.replaceChildren();
  for (const e of myEntries) {
    const row = el("span", {
      class: ready.has(e.id) ? "agent-q-ready" : "",
    }, `${ready.has(e.id) ? "ok " : "wait "}id ${e.id} ${e.company || ""}`);
    listEl.appendChild(row);
  }

  const readyEntries = myEntries.filter((e) => ready.has(e.id));
  if (fillBtnEl) {
    fillBtnEl.hidden = readyEntries.length === 0;
    fillBtnEl.dataset.ids = readyEntries.map((e) => e.id).join(",");
  }
  return readyEntries.map((e) => e.id);
}

export async function fillDraftedAnswers(ctx, fillBtnEl, { toast, refreshAgent }) {
  const ids = (fillBtnEl.dataset.ids || "").split(",").filter(Boolean);
  if (ids.length === 0) return;
  toast(`drafting ${ids.length} answer${ids.length === 1 ? "" : "s"}`);

  let answersResp;
  try {
    answersResp = await api.getPendingAnswers();
  } catch {
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
      try { await api.consumeAnswer(id); } catch {}
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
  if (typeof refreshAgent === "function") refreshAgent();
}

// ── Hidden-hosts list (re-enable extension on a domain) ────
export async function refreshHiddenHosts({ sectionEl, listEl, onReEnable }) {
  const all = await chrome.storage.local.get(["autoResumeDisabledDomains"]);
  const hosts = Array.isArray(all.autoResumeDisabledDomains)
    ? all.autoResumeDisabledDomains
    : [];
  if (hosts.length === 0) {
    sectionEl.hidden = true;
    return;
  }
  sectionEl.hidden = false;
  listEl.replaceChildren();
  for (const host of hosts) {
    listEl.appendChild(
      el("li", {},
        el("span", {}, host),
        el("button", {
          type: "button",
          onClick: () => onReEnable(host),
        }, "re-enable")
      )
    );
  }
}

export async function reEnableHost(host) {
  const all = await chrome.storage.local.get(["autoResumeDisabledDomains"]);
  const next = (all.autoResumeDisabledDomains || []).filter((h) => h !== host);
  await chrome.storage.local.set({ autoResumeDisabledDomains: next });
}
