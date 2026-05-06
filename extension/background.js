const SERVER_URL = "http://localhost:8765";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetch") {
    fetch(msg.url, {
      method: msg.method || "GET",
      headers: msg.headers || { "Content-Type": "application/json" },
      body: msg.body || undefined,
    })
      .then((r) => r.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  if (msg.type === "fetch-blob") {
    fetch(msg.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const arr = Array.from(new Uint8Array(buf));
        sendResponse({ ok: true, data: arr, mime: "application/pdf" });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "update-badge") {
    const text = msg.unfilled > 0 ? String(msg.unfilled) : "";
    const color = msg.unfilled > 0 ? "#e74c3c" : "#27ae60";
    chrome.action.setBadgeText({ text, tabId: sender.tab?.id });
    chrome.action.setBadgeBackgroundColor({ color, tabId: sender.tab?.id });
    sendResponse({ ok: true });
    return false;
  }
});

chrome.runtime.onInstalled.addListener(() => {
  fetch(`${SERVER_URL}/status`)
    .then((r) => r.json())
    .then(() => console.log("[AutoResume] Server is running"))
    .catch(() =>
      console.warn(
        "[AutoResume] Server not running. Start with: python server/serve.py"
      )
    );

  // Register context menu only when text is selected or focus is in an
  // editable field, so we don't pollute every right-click.
  chrome.contextMenus.create({
    id: "ask-agent",
    title: "Ask Agent to draft an answer",
    contexts: ["selection", "editable"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "ask-agent") return;
  if (!tab?.id) return;

  // Target the exact frame the user right-clicked in. Selection /
  // contenteditable focus belongs to one frame; running across all frames
  // would queue the same question multiple times.
  const target =
    info.frameId !== undefined
      ? { tabId: tab.id, frameIds: [info.frameId] }
      : { tabId: tab.id };

  try {
    await chrome.scripting.executeScript({
      target,
      files: [
        "content/autofill-core.js",
        "content/agent-question.js",
      ],
    });

    await chrome.scripting.executeScript({
      target,
      func: (selectedText) => window.__agentQueueQuestion?.(selectedText),
      args: [info.selectionText || ""],
    });
  } catch (err) {
    console.warn("[AutoResume] context menu inject failed:", err.message);
  }
});

// ──────────────────────────────────────────────────────────────────────
// Keyboard shortcut: save current job. Mirrors the popup's Save button
// (POST /save-job) and flashes the toolbar badge so the user gets feedback
// without the popup being open. The user binds the actual key in
// chrome://extensions/shortcuts (default suggestion: Alt+S).
// ──────────────────────────────────────────────────────────────────────

async function flashBadge(tabId, text, color, durationMs = 1500) {
  let prevText = "";
  let prevColor = null;
  try {
    prevText = await chrome.action.getBadgeText({ tabId });
    prevColor = await chrome.action.getBadgeBackgroundColor({ tabId });
  } catch {}

  await chrome.action.setBadgeText({ text, tabId });
  await chrome.action.setBadgeBackgroundColor({ color, tabId });

  setTimeout(async () => {
    try {
      await chrome.action.setBadgeText({ text: prevText || "", tabId });
      if (prevColor) {
        await chrome.action.setBadgeBackgroundColor({ color: prevColor, tabId });
      }
    } catch {}
  }, durationMs);
}

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== "save-job") return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) return;

  let result;
  try {
    const r = await fetch(`${SERVER_URL}/save-job`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: tab.url, title: tab.title || "" }),
    });
    result = await r.json();
  } catch {
    result = { ok: false, error: "server offline" };
  }

  if (result.ok) {
    flashBadge(tab.id, "✓", "#27ae60");
  } else {
    flashBadge(tab.id, "✗", "#e74c3c");
    console.warn("[AutoResume] save-job failed:", result.error || "unknown");
  }
});

// ──────────────────────────────────────────────────────────────────────
// External agent bridge (Agent / Claude in Chrome / scripted browsers)
// Reachable via:  chrome.runtime.sendMessage(EXT_ID, { action: "..." })
// from any page whose origin matches manifest.externally_connectable.matches.
// ──────────────────────────────────────────────────────────────────────

const EXT_BRIDGE_ACTIONS = new Set(["fill", "inject_pdf", "state", "ping"]);

chrome.runtime.onMessageExternal.addListener((msg, sender, sendResponse) => {
  if (!sender.tab?.id) {
    sendResponse({ ok: false, error: "no tab on sender" });
    return false;
  }
  const action = msg?.action;
  if (!EXT_BRIDGE_ACTIONS.has(action)) {
    sendResponse({ ok: false, error: `unknown action: ${action}` });
    return false;
  }

  (async () => {
    const tabId = sender.tab.id;
    try {
      if (action === "ping") {
        sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
        return;
      }

      if (action === "fill") {
        const probes = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => window.__atsModule?.name || null,
        });
        const adapterFrame = probes.find(p => p.result && p.result !== "generic");

        if (adapterFrame) {
          await chrome.scripting.executeScript({
            target: { tabId, frameIds: [adapterFrame.frameId] },
            func: async () => {
              if (typeof window.AutoFill?.triggerFill === "function") {
                await window.AutoFill.triggerFill();
                return { ok: true };
              }
              return { ok: false, error: "triggerFill not available" };
            },
          });
          sendResponse({ ok: true, mode: "adapter", adapter: adapterFrame.result });
          return;
        }

        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: [
            "content/autofill-core.js",
            "content/file-injector.js",
            "content/ats/generic.js",
            "content/generic-runner.js",
          ],
        });
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: () => window.__autoresumeRunGeneric?.(),
        });
        sendResponse({
          ok: true,
          mode: "generic",
          results: results.map(r => r.result).filter(Boolean),
        });
        return;
      }

      if (action === "inject_pdf") {
        const filename = msg.filename;
        if (!filename) {
          sendResponse({ ok: false, error: "filename required" });
          return;
        }
        await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          files: ["content/autofill-core.js", "content/file-injector.js"],
        });
        const results = await chrome.scripting.executeScript({
          target: { tabId, allFrames: true },
          func: async (f) => {
            if (!window.AutoFill?.FileInjector) {
              return { ok: false, error: "core not loaded in this frame" };
            }
            return await window.AutoFill.FileInjector.inject(f);
          },
          args: [filename],
        });
        const frameResults = results.map(r => r.result).filter(Boolean);
        const winner = frameResults.find(r => r.ok);
        sendResponse(winner || {
          ok: false,
          error: "no frame succeeded",
          details: frameResults,
        });
        return;
      }

      if (action === "state") {
        const r = await fetch("http://localhost:8765/state");
        const data = await r.json();
        sendResponse({ ok: true, state: data });
        return;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message || String(err) });
    }
  })();

  return true;
});
