const SERVER = "http://localhost:8765";

const $ = (s) => document.querySelector(s);

// Hosts that have a dedicated content script auto-injected by the manifest.
// On these the generic fallback should NOT be offered — the dedicated adapter
// runs on its own, and overlaying the generic adapter would clobber the
// page-side window.__atsModule.
const SUPPORTED_HOST_PATTERNS = [
  /(^|\.)myworkdayjobs\.com$/i,
  /^boards\.greenhouse\.io$/i,
  /^job-boards\.greenhouse\.io$/i,
  /^jobs\.lever\.co$/i,
  /^jobs\.ashbyhq\.com$/i,
];

function isSupportedHost(urlString) {
  try {
    const host = new URL(urlString).hostname;
    return SUPPORTED_HOST_PATTERNS.some((re) => re.test(host));
  } catch {
    return false;
  }
}

async function init() {
  // Check server
  try {
    const resp = await fetch(`${SERVER}/status`);
    const data = await resp.json();
    if (data.ok) {
      $("#server-status").className = "dot green";
    }
  } catch {
    $("#server-status").className = "dot red";
    showMsg("Server offline — run: python server/serve.py", "error");
  }

  // Load PDFs
  try {
    const resp = await fetch(`${SERVER}/pdf-list`);
    const data = await resp.json();
    const select = $("#pdf-select");
    select.innerHTML = "";
    if (data.pdfs && data.pdfs.length > 0) {
      for (const pdf of data.pdfs) {
        const opt = document.createElement("option");
        opt.value = pdf;
        opt.textContent = pdf;
        select.appendChild(opt);
      }
    } else {
      select.innerHTML = '<option value="">No PDFs available</option>';
    }
  } catch {
    $("#pdf-select").innerHTML = '<option value="">Error loading</option>';
  }

  // Load current tab state
  try {
    const resp = await fetch(`${SERVER}/state`);
    const state = await resp.json();
    if (state.ats) {
      const atsEl = $("#ats-type");
      atsEl.textContent = state.ats;
      atsEl.classList.remove("muted");

      const fillEl = $("#fill-status");
      fillEl.textContent =
        state.status === "complete"
          ? `Done (${state.filled?.length || 0} fields)`
          : `Partial (${state.unfilled?.length || 0} unfilled)`;
      fillEl.classList.remove("muted");

      if (state.unfilled && state.unfilled.length > 0) {
        $("#unfilled-section").style.display = "flex";
        $("#unfilled-list").textContent = state.unfilled.join(", ");
      }
    }
  } catch { }

  // Decide what action surface to show. Three cases:
  //   (1) A dedicated adapter is loaded in some frame (top OR iframe) →
  //       show "Fill via <name>" — the badge inside an iframe is often
  //       hidden behind parent-page CSS, so a popup-driven trigger matters.
  //   (2) Top-level host is supported but no module loaded yet (rare —
  //       SPA still booting) → show nothing extra; user can wait.
  //   (3) No adapter anywhere → show "Try generic fill".
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const adapterFrame = await detectAdapterFrame(tab.id);
    if (adapterFrame) {
      $("#adapter-name").textContent = adapterFrame.name;
      $("#adapter-section").style.display = "block";
      $("#btn-adapter-fill").addEventListener("click", () =>
        onAdapterFill(tab.id, adapterFrame)
      );
    } else if (tab?.url && !isSupportedHost(tab.url)) {
      $("#generic-section").style.display = "block";
    }
  } catch { }

  $("#btn-generic-fill").addEventListener("click", onGenericFill);
  $("#btn-inject").addEventListener("click", onInject);
  $("#btn-save-job").addEventListener("click", onSaveJob);
  $("#btn-agent-fill").addEventListener("click", onAgentFill);

  refreshAgentSection();
}

// ---------- Agent Q&A ----------

// Two URLs are "the same job page" if their origin + pathname agree. Query
// strings often diverge (utm tokens, ATS-injected nonces) but the path
// uniquely identifies the application form, so we ignore search/hash.
function urlMatchesTab(entryUrl, tabUrl) {
  try {
    const a = new URL(entryUrl);
    const b = new URL(tabUrl);
    return a.origin === b.origin && a.pathname === b.pathname;
  } catch {
    return entryUrl === tabUrl;
  }
}

async function refreshAgentSection() {
  const section = $("#agent-section");
  const status = $("#agent-status");
  const qRow = $("#agent-q-row");
  const qList = $("#agent-q-list");
  const fillBtn = $("#btn-agent-fill");

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    section.style.display = "none";
    return;
  }

  const all = await chrome.storage.local.get(null);
  const myEntries = [];
  for (const [key, val] of Object.entries(all)) {
    if (!key.startsWith("agent_q_")) continue;
    if (!val || !val.page_url) continue;
    if (!urlMatchesTab(val.page_url, tab.url)) continue;
    myEntries.push({ id: key.slice("agent_q_".length), ...val });
  }

  if (myEntries.length === 0) {
    section.style.display = "none";
    return;
  }

  let answers = [];
  try {
    const r = await fetch(`${SERVER}/pending-answers`);
    const data = await r.json();
    answers = Array.isArray(data.answers) ? data.answers : [];
  } catch {
    section.style.display = "block";
    status.textContent = "Server offline";
    status.classList.remove("muted");
    qRow.style.display = "none";
    fillBtn.style.display = "none";
    return;
  }
  const answerById = new Map(answers.map((a) => [a.id, a]));

  const ready = myEntries.filter((e) => answerById.has(e.id));
  section.style.display = "block";
  status.textContent = `${myEntries.length} queued, ${ready.length} ready`;
  status.classList.remove("muted");

  qList.innerHTML = "";
  for (const e of myEntries) {
    const row = document.createElement("span");
    row.className = "agent-q" + (answerById.has(e.id) ? " ready" : "");
    const mark = answerById.has(e.id) ? "✓ " : "… ";
    row.textContent = `${mark}id ${e.id} — ${e.company || "?"}`;
    qList.appendChild(row);
  }
  qRow.style.display = "flex";

  fillBtn.style.display = ready.length > 0 ? "inline-flex" : "none";
  fillBtn.dataset.ids = ready.map((e) => e.id).join(",");
}

async function onAgentFill() {
  const fillBtn = $("#btn-agent-fill");
  const ids = (fillBtn.dataset.ids || "").split(",").filter(Boolean);
  if (ids.length === 0) return;

  showMsg(`Filling ${ids.length} answer(s)…`);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  let answersResp;
  try {
    const r = await fetch(`${SERVER}/pending-answers`);
    answersResp = await r.json();
  } catch (err) {
    showMsg(`Server offline: ${err.message}`, "error");
    return;
  }
  const answerById = new Map(
    (answersResp.answers || []).map((a) => [a.id, a.answer])
  );

  const storage = await chrome.storage.local.get(ids.map((id) => `agent_q_${id}`));

  // Make sure AutoFill.setValue exists on every frame before we try to use it.
  // The right-click flow already loaded autofill-core.js, but a popup fill
  // may run on a fresh tab where the manifest content scripts didn't match
  // (generic ATS sites we still queue questions on).
  await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: true },
    files: ["content/autofill-core.js"],
  });

  let filled = 0;
  const errors = [];
  for (const id of ids) {
    const entry = storage[`agent_q_${id}`];
    const answer = answerById.get(id);
    if (!entry || answer == null) continue;

    const frameResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (selector, value) => {
        const el = document.querySelector(selector);
        if (!el) return { ok: false, error: "target not found" };
        if (el.isContentEditable) {
          el.focus();
          el.textContent = value;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          el.dispatchEvent(new Event("blur", { bubbles: true }));
          return { ok: true };
        }
        if (window.AutoFill?.setValue) {
          const ok = window.AutoFill.setValue(el, value);
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
      } catch { }
      await chrome.storage.local.remove(`agent_q_${id}`);
    } else {
      const firstErr = (frameResults || [])
        .map((f) => f?.result?.error)
        .filter(Boolean)[0];
      errors.push(`${id}: ${firstErr || "no frame matched"}`);
    }
  }

  if (filled > 0 && errors.length === 0) {
    showMsg(`Filled ${filled} answer(s)`, "success");
  } else if (filled > 0) {
    showMsg(`Filled ${filled}; ${errors.length} failed`, "error");
  } else {
    showMsg(`No answers filled — ${errors[0] || "see console"}`, "error");
  }
  refreshAgentSection();
}

// Probe every frame in the tab for window.__atsModule. Returns the first
// frame with a non-generic adapter (so iframe-embedded Ashby/Greenhouse/
// Lever/Workday gets surfaced when the user is on a parent careers page),
// or null. Use frameId so we can later target that exact frame.
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
  } catch { }
  return null;
}

async function onAdapterFill(tabId, adapterFrame) {
  showMsg(`Triggering ${adapterFrame.name} fill...`);
  try {
    // detector.js exposes window.AutoFill.triggerFill. Calling it in the
    // exact frame avoids touching the parent page where there's nothing
    // to fill.
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [adapterFrame.frameId] },
      func: async () => {
        if (typeof window.AutoFill?.triggerFill === "function") {
          await window.AutoFill.triggerFill();
          return { ok: true };
        }
        return { ok: false, error: "triggerFill not available in this frame" };
      },
    });
    showMsg(`${adapterFrame.name} fill triggered — check page`, "success");
  } catch (err) {
    showMsg(`Error: ${err.message}`, "error");
  }
}

async function onSaveJob() {
  showMsg("Saving...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      showMsg("No active tab URL", "error");
      return;
    }
    const resp = await fetch(`${SERVER}/save-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, title: tab.title || "" }),
    });
    const data = await resp.json();
    if (data.ok) {
      showMsg(`Saved (${data.count} in queue)`, "success");
    } else {
      showMsg(`Save failed: ${data.error || "unknown"}`, "error");
    }
  } catch (err) {
    showMsg("Save failed — is the server running?", "error");
  }
}

async function onGenericFill() {
  hideGenericResult();
  showMsg("Injecting generic fill scripts...");
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // Step A — load shared utilities + the generic adapter + runner. Order
    // matters: autofill-core defines window.AutoFill, file-injector extends
    // it, generic.js sets window.__atsModule, generic-runner.js exposes the
    // entrypoint we'll invoke in step B.
    //
    // allFrames: true is essential for iframe-embedded ATS forms (very common
    // — e.g. ElevenLabs careers embeds the Ashby form via iframe, Greenhouse
    // / Workable widgets do the same on customer career pages). Without this
    // we'd inject into the parent doc only and never reach the form.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: [
        "content/autofill-core.js",
        "content/file-injector.js",
        "content/ats/generic.js",
        "content/generic-runner.js",
      ],
    });

    // Step B — run the entrypoint in every frame; pick the best result.
    // Empty parent frames will abort with `aborted: true`; the iframe
    // hosting the actual form will return real fill counts.
    const frameResults = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: () => window.__autoresumeRunGeneric?.(),
    });

    renderGenericResult(pickBestFrameResult(frameResults));
  } catch (err) {
    showMsg(`Error: ${err.message}`, "error");
  }
}

// executeScript with allFrames returns one InjectionResult per frame. The
// frame that actually has the form returns real {filled, unfilled}; empty
// parent / sibling frames return {aborted:true} or null. Prefer the frame
// with the highest filled count, then any non-aborted result, then any
// result with an error message we can show.
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

  // All frames aborted — surface the most informative error (longest one).
  return results.reduce((a, b) =>
    (b.error || "").length > (a.error || "").length ? b : a
  );
}

function hideGenericResult() {
  $("#generic-result").style.display = "none";
  for (const id of [
    "generic-filled-row",
    "generic-unfilled-row",
    "generic-pdf-row",
    "generic-error-row",
  ]) {
    $(`#${id}`).style.display = "none";
  }
}

function renderGenericResult(result) {
  if (!result) {
    showMsg("No result returned from page", "error");
    return;
  }

  $("#generic-result").style.display = "flex";

  const filled = result.filled || [];
  const unfilled = result.unfilled || [];

  if (filled.length > 0) {
    $("#generic-filled-row").style.display = "flex";
    $("#generic-filled").textContent = `${filled.length} — ${filled.join(", ")}`;
  }
  if (unfilled.length > 0) {
    $("#generic-unfilled-row").style.display = "flex";
    $("#generic-unfilled").textContent = `${unfilled.length} — ${unfilled.join(", ")}`;
  }
  if (result.pdf) {
    $("#generic-pdf-row").style.display = "flex";
    $("#generic-pdf").textContent = result.pdf;
  }
  if (result.error) {
    $("#generic-error-row").style.display = "flex";
    $("#generic-error").textContent = result.error;
  }

  if (result.aborted) {
    showMsg("Generic fill aborted — see result", "error");
  } else if (filled.length === 0 && !result.error) {
    showMsg("No fields matched on this page", "error");
  } else {
    showMsg(`Filled ${filled.length} field(s)`, "success");
  }
}

async function onInject() {
  const filename = $("#pdf-select").value;
  if (!filename) {
    showMsg("No PDF selected", "error");
    return;
  }
  showMsg(`Injecting ${filename}...`);
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    // On unsupported hosts the manifest's content scripts never ran, so
    // autofill-core / file-injector aren't on the page yet. Inject them
    // up-front so this button works the same everywhere. allFrames so we
    // also reach iframe-embedded forms (Ashby-in-elevenlabs.io etc.).
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ["content/autofill-core.js", "content/file-injector.js"],
    });

    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: async (fname, serverUrl) => {
        if (!window.AutoFill?.FileInjector) {
          console.error("[AutoResume] autofill-core not loaded on this page");
          return;
        }
        const result = await AutoFill.FileInjector.inject(fname);
        if (result.ok) {
          AutoFill.Badge?.update("done", [], [], `PDF injected: ${fname}`);
        } else {
          AutoFill.Badge?.update("error", [], [], `PDF inject failed: ${result.error}`);
        }
      },
      args: [filename, SERVER],
    });
    showMsg(`PDF injected: ${filename}`, "success");
  } catch (err) {
    showMsg(`Error: ${err.message}`, "error");
  }
}

function showMsg(text, type = "") {
  const el = $("#message");
  el.textContent = text;
  el.className = `message ${type}`;
}

document.addEventListener("DOMContentLoaded", init);
