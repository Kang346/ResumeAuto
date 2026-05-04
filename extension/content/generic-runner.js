// Generic-mode entrypoint — invoked by the popup after autofill-core,
// file-injector, and ats/generic.js have been injected into the active tab.
// Exposes a single global (window.__autoresumeRunGeneric) that the popup
// calls via a follow-up chrome.scripting.executeScript({func}). The function
// returns a plain object with {filled, unfilled, pdf, aborted, error} so the
// popup can render results without piping anything through chrome.runtime.
//
// This file MUST stay free of any auto-execution. The popup is the only
// trigger; running on its own would defeat the whole "manual-only" guarantee.

window.__autoresumeRunGeneric = async function () {
  try {
    const mod = window.__atsModule;
    if (!mod || mod.name !== "generic") {
      return {
        filled: [],
        unfilled: [],
        aborted: true,
        error:
          "Generic adapter not loaded (or a site-specific ATS adapter is " +
          "already active on this page).",
      };
    }

    const [personalInfo, formRules] = await Promise.all([
      AutoFill.serverFetch("/personal-info"),
      AutoFill.serverFetch("/form-rules"),
    ]);

    const result = await mod.fill(personalInfo, formRules);
    return {
      filled: result.filled || [],
      unfilled: result.unfilled || [],
      pdf: result.pdf || null,
      aborted: !!result.aborted,
      error: result.error || null,
    };
  } catch (err) {
    return {
      filled: [],
      unfilled: [],
      aborted: true,
      error: err && err.message ? err.message : String(err),
    };
  }
};
