// Probe every frame in a tab to find a loaded ATS adapter. Returns
// `{ name, frameId }` for the first non-generic match, or null.

export async function detectAdapterFrame(tabId) {
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
