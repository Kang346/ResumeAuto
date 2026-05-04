// Entry point — detects ATS, caches data, exposes a manual trigger.
// The fill phase NO LONGER runs automatically; user clicks "Fill this page"
// in the badge or an agent posts AUTORESUME_TRIGGER_FILL.

(function () {
  let detecting = false;
  let filling = false;
  let lastDetectedUrl = null;

  // PDF picker lives in autofill-core (shared with the generic adapter).
  const pickPdfForCurrentPage = (pdfs) => AutoFill.pickPdfForCurrentPage(pdfs);

  async function runDetector() {
    if (detecting) return;
    if (window.__autoResumeDetectedForUrl === window.location.href) return;
    detecting = true;
    window.__autoResumeDetectedForUrl = window.location.href;
    lastDetectedUrl = window.location.href;

    const badge = AutoFill.Badge;
    badge.update("detecting", [], [], "Checking page...");

    const atsModule = window.__atsModule;
    if (!atsModule) {
      badge.update("waiting", [], [], "No ATS module — use popup to trigger generic fill");
      detecting = false;
      return;
    }

    if (atsModule.isApplicationForm) {
      // Ashby/Workday React SPAs render the form async — poll up to 6s before
      // giving up. Without this, document_idle fires before the inputs exist
      // and detection bails immediately.
      let isForm = atsModule.isApplicationForm();
      if (!isForm) {
        for (let i = 0; i < 12 && !isForm; i++) {
          await new Promise((r) => setTimeout(r, 500));
          isForm = atsModule.isApplicationForm();
        }
      }
      if (!isForm) {
        badge.update("waiting", [], [], "Job listing page — not an application form");
        detecting = false;
        return;
      }
    }

    try {
      const [personalInfo, formRules, pdfList] = await Promise.all([
        AutoFill.serverFetch("/personal-info"),
        AutoFill.serverFetch("/form-rules"),
        AutoFill.serverFetch("/pdf-list"),
      ]);

      window.__autoResumeCachedData = { personalInfo, formRules, pdfList, atsModule };
      badge.update(
        "ready",
        [],
        [],
        `Detected: ${atsModule.name}. Click Fill to start.`
      );
    } catch (err) {
      badge.update("error", [], [], `Detect failed: ${err.message}`);
      AutoFill.reportBadge(-1);
    } finally {
      detecting = false;
    }
  }

  async function runFill() {
    if (filling) return;
    // If detection never produced a cache (or it was cleared after SPA nav),
    // re-run detect inline before bailing. This makes the badge's "Retry"
    // button actually retry, instead of looping on "Detection has not
    // completed yet."
    if (!window.__autoResumeCachedData) {
      // Force a fresh detect attempt for the current URL.
      window.__autoResumeDetectedForUrl = null;
      await runDetector();
    }
    const cached = window.__autoResumeCachedData;
    if (!cached) {
      AutoFill.Badge.update("error", [], [], "Detection has not completed yet.");
      return;
    }

    filling = true;
    const badge = AutoFill.Badge;
    const { personalInfo, formRules, pdfList, atsModule } = cached;
    badge.update("filling", [], [], `Filling: ${atsModule.name}`);

    try {
      const result = await atsModule.fill(personalInfo, formRules);
      const filled = result.filled || [];
      const unfilled = result.unfilled || [];

      let pdfResult = { ok: false, error: "no pdf" };
      if (pdfList.pdfs && pdfList.pdfs.length > 0) {
        const pdfFilename = pickPdfForCurrentPage(pdfList.pdfs);
        if (!pdfFilename) {
          // No PDF matches the current company — refuse to inject. The
          // extension popup is the safe fallback (user picks explicitly).
          unfilled.push("resume_upload (no PDF matches this company — use popup)");
          pdfResult = { ok: false, error: "no matching pdf for current page" };
        } else {
          badge.update("filling", filled, unfilled, `Injecting PDF: ${pdfFilename}`);
          pdfResult = await AutoFill.FileInjector.inject(pdfFilename);
          if (pdfResult.ok) filled.push(`resume_upload: ${pdfFilename}`);
          else unfilled.push("resume_upload");
        }
      } else {
        unfilled.push("resume_upload (no PDF available)");
      }

      badge.update("done", filled, unfilled);
      AutoFill.reportBadge(unfilled.length);

      try {
        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            {
              type: "fetch",
              url: "http://localhost:8765/state",
              method: "POST",
              body: JSON.stringify({
                url: window.location.href,
                ats: atsModule.name,
                status: unfilled.length === 0 ? "complete" : "partial",
                filled,
                unfilled,
                pdf: pdfResult.ok ? pdfResult.filename : null,
                timestamp: new Date().toISOString(),
              }),
            },
            (resp) => (resp?.ok ? resolve() : reject())
          );
        });
      } catch {
        // best-effort
      }
    } catch (err) {
      badge.update("error", [], [], err.message);
      AutoFill.reportBadge(-1);
    } finally {
      filling = false;
    }
  }

  function scheduleRedetect(_reason) {
    window.__autoResumeDetectedForUrl = null;
    setTimeout(runDetector, 600);
    setTimeout(runDetector, 1500);
  }

  if (!window.__autoResumeSpaWatcher) {
    window.__autoResumeSpaWatcher = true;

    for (const method of ["pushState", "replaceState"]) {
      const orig = history[method];
      history[method] = function (...args) {
        const result = orig.apply(this, args);
        scheduleRedetect(method);
        return result;
      };
    }
    window.addEventListener("popstate", () => scheduleRedetect("popstate"));

    setInterval(() => {
      if (window.location.href !== lastDetectedUrl && !detecting && !filling) {
        scheduleRedetect("poll");
      }
    }, 1000);
  }

  // Public trigger surface — used by the badge button and by agents.
  window.AutoFill = window.AutoFill || {};
  AutoFill.triggerFill = runFill;
  AutoFill.triggerDetect = runDetector;

  // Agent-facing trigger: any script can run
  //   window.postMessage({ type: "AUTORESUME_TRIGGER_FILL" }, "*")
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    if (event.data?.type === "AUTORESUME_TRIGGER_FILL") runFill();
    if (event.data?.type === "AUTORESUME_TRIGGER_DETECT") runDetector();
  });

  runDetector();
})();
