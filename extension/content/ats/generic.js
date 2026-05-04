// Generic ATS fallback — autocomplete-first, three-tier field resolver.
// Triggered manually from the popup (never auto-injected). The popup loads
// this together with autofill-core.js + file-injector.js + generic-runner.js
// only after the user clicks "Try generic fill" on an unsupported host.
//
// Resolver tiers, applied per-input in priority order:
//   A. autocomplete attribute (HTML5 standard) — confidence 1.0
//   B. token dictionary against id/name/label[for]/placeholder/aria-label/
//      accumulated section context — confidence 0.4–0.9 by source
//   C. heuristic <select> matching for EEO/gender/race/veteran/disability
//
// Anti-false-positive guard: refuse to commit any value unless the page
// resolved at least 3 distinct profile fields. Prevents wrong-fills on
// contact / login / survey forms that happen to have an "email" input.

(function () {
  // Don't clobber a site-specific adapter that's already installed (Workday,
  // Greenhouse, etc.). The runner re-checks this and reports back to popup.
  const existing = window.__atsModule;
  if (existing && existing.name && existing.name !== "generic") return;

  const MIN_DISTINCT_FIELDS = 3;

  // ── Tier A: autocomplete attribute → personalInfo getter ───────────────
  // Keys are the standardized HTML5 autocomplete tokens. Values are pure
  // functions of the personal-info blob — null/undefined returns mean
  // "we don't have data for this", and the input is left alone.
  const AUTOCOMPLETE_MAP = {
    "given-name":     (p) => p.name?.first,
    "family-name":    (p) => p.name?.last,
    "additional-name":(p) => p.name?.middle,
    "name":           (p) => joinName(p),
    "email":          (p) => p.email,
    "username":       (p) => p.email,
    "tel":            (p) => p.phone,
    "tel-national":   (p) => p.phone,
    "tel-local":      (p) => p.phone,
    "street-address": (p) => p.location?.line1,
    "address-line1":  (p) => p.location?.line1,
    "address-line2":  (p) => p.location?.line2,
    "address-level2": (p) => p.location?.city,
    "address-level1": (p) => p.location?.state,
    "postal-code":    (p) => p.location?.zip,
    "country-name":   (p) => p.location?.country,
    "country":        (p) => p.location?.country,
    "url":            (p) => p.linkedin || p.github,
  };

  // ── Tier B: token dictionary ────────────────────────────────────────────
  // Each entry has a *whole-token* regex. We match against context strings
  // (id/name/label/placeholder/...). Whole-token matching is what stops the
  // dictionary from spuriously firing — e.g. "email" inside "emailable" no
  // longer matches, and "name" no longer fires on "nameless".
  //
  // `key` is what we report as the matched field — also used to count
  // distinct profile fields for the anti-false-positive guard.
  const FIELD_DICTIONARY = [
    { key: "first_name",  re: /\b(first[\s_-]?name|fname|forename|given[\s_-]?name|名|名字)\b/i,
      get: (p) => p.name?.first },
    { key: "last_name",   re: /\b(last[\s_-]?name|lname|surname|family[\s_-]?name|姓)\b/i,
      get: (p) => p.name?.last },
    { key: "full_name",   re: /\b(full[\s_-]?name|your[\s_-]?name|legal[\s_-]?name|candidate[\s_-]?name)\b/i,
      get: (p) => joinName(p) },
    { key: "email",       re: /\b(e[\s_-]?mail|email[\s_-]?address|电子邮件|邮箱)\b/i,
      get: (p) => p.email },
    { key: "phone",       re: /\b(phone|mobile|telephone|tel|cell|电话|手机)\b/i,
      get: (p) => p.phone },
    { key: "linkedin",    re: /\b(linked[\s_-]?in|linkedin[\s_-]?url|linkedin[\s_-]?profile)\b/i,
      get: (p) => p.linkedin },
    { key: "github",      re: /\b(git[\s_-]?hub|github[\s_-]?url|github[\s_-]?profile)\b/i,
      get: (p) => p.github },
    { key: "address1",    re: /\b(address[\s_-]?(line[\s_-]?)?1|street[\s_-]?address|street|address)\b/i,
      get: (p) => p.location?.line1 },
    { key: "address2",    re: /\b(address[\s_-]?(line[\s_-]?)?2|apt|apartment|unit|suite)\b/i,
      get: (p) => p.location?.line2 },
    { key: "city",        re: /\b(city|town|城市)\b/i,
      get: (p) => p.location?.city },
    { key: "state",       re: /\b(state|province|region|省|州)\b/i,
      get: (p) => p.location?.state },
    { key: "zip",         re: /\b(zip|zip[\s_-]?code|postal[\s_-]?code|postcode|邮编)\b/i,
      get: (p) => p.location?.zip },
    { key: "country",     re: /\b(country|nation|国家)\b/i,
      get: (p) => p.location?.country },
  ];

  // Source tiers for context lookup, ranked by signal strength.
  // Higher confidence wins — but ANY tier hit is enough to commit (≥0.4 cut).
  const CONFIDENCE = {
    autocomplete: 1.0,
    idName: 0.9,
    label: 0.8,
    placeholder: 0.7,
    ariaLabel: 0.6,
    sectionText: 0.4,
  };
  const MIN_CONFIDENCE = 0.5; // sectionText alone (0.4) is too weak to trust.

  function joinName(p) {
    const first = p.name?.first || "";
    const last = p.name?.last || "";
    const out = `${first} ${last}`.trim();
    return out || null;
  }

  // Get the text of any <label for="<id>"> for this input.
  function getLabelText(input) {
    if (!input.id) return "";
    try {
      const lbl = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      return (lbl?.textContent || "").trim();
    } catch {
      return "";
    }
  }

  // Section context = legend / [data-automation-id] container label / parent
  // text. AutoFill.findAccumulatedLabel already does this — re-use it.
  function getSectionContext(input) {
    try {
      return AutoFill.findAccumulatedLabel(input) || "";
    } catch {
      return "";
    }
  }

  function matchEntry(text) {
    if (!text) return null;
    for (const entry of FIELD_DICTIONARY) {
      if (entry.re.test(text)) return entry;
    }
    return null;
  }

  // Returns {entry, value, confidence, source} or null. Tries each context
  // source in priority order; the first hit at confidence ≥ MIN_CONFIDENCE
  // wins. Tier A (autocomplete) is checked separately and short-circuits.
  function resolveInput(input, personalInfo) {
    // Tier A — autocomplete attribute (highest signal, language-independent).
    const ac = (input.getAttribute("autocomplete") || "").toLowerCase().trim();
    if (ac && AUTOCOMPLETE_MAP[ac]) {
      const value = AUTOCOMPLETE_MAP[ac](personalInfo);
      if (value != null && value !== "") {
        return {
          key: ac,
          value,
          confidence: CONFIDENCE.autocomplete,
          source: `autocomplete=${ac}`,
        };
      }
    }

    // Tier B — token dictionary across context sources, in confidence order.
    const sources = [
      { text: `${input.id || ""} ${input.name || ""}`, conf: CONFIDENCE.idName },
      { text: getLabelText(input), conf: CONFIDENCE.label },
      { text: input.getAttribute("placeholder") || "", conf: CONFIDENCE.placeholder },
      { text: input.getAttribute("aria-label") || "", conf: CONFIDENCE.ariaLabel },
      { text: getSectionContext(input), conf: CONFIDENCE.sectionText },
    ];

    for (const { text, conf } of sources) {
      if (conf < MIN_CONFIDENCE) continue;
      const entry = matchEntry(text);
      if (!entry) continue;
      const value = entry.get(personalInfo);
      if (value == null || value === "") continue;
      return { key: entry.key, value, confidence: conf, source: text.slice(0, 60) };
    }

    return null;
  }

  // ── Tier C: <select> heuristics for EEO / demographics ──────────────────
  function fillSelectsHeuristic(personalInfo) {
    const filled = [];
    for (const select of document.querySelectorAll("select")) {
      if (select.disabled || select.value) continue;
      const ctx = (
        getLabelText(select) +
        " " +
        (select.getAttribute("name") || "") +
        " " +
        (select.getAttribute("aria-label") || "") +
        " " +
        getSectionContext(select)
      ).toLowerCase();

      let target;
      if (/\bgender\b/.test(ctx)) target = { key: "gender", value: personalInfo.gender || "Male" };
      else if (/\b(race|ethnicity)\b/.test(ctx)) target = { key: "race", value: personalInfo.race_ethnicity || "Asian" };
      else if (/\bveteran\b/.test(ctx)) target = { key: "veteran", value: personalInfo.veteran_status || "No" };
      else if (/\bdisabilit/.test(ctx)) target = { key: "disability", value: personalInfo.disability_status || "No" };
      else if (/\b(country)\b/.test(ctx) && personalInfo.location?.country) {
        target = { key: "country", value: personalInfo.location.country };
      } else if (/\b(state|province)\b/.test(ctx) && personalInfo.location?.state) {
        target = { key: "state", value: personalInfo.location.state };
      }

      if (target && AutoFill.selectOption(select, target.value)) {
        filled.push(target.key);
      }
    }
    return filled;
  }

  // ── Resume upload ───────────────────────────────────────────────────────
  // Only consider <input type="file"> when nearby text mentions resume / cv /
  // upload / attachment. Otherwise we'd inject a PDF into a profile-photo or
  // cover-letter field.
  function isResumeInput(input) {
    const accept = (input.getAttribute("accept") || "").toLowerCase();
    if (accept.includes("pdf") || accept.includes(".doc")) return true;

    const direct = (
      (input.getAttribute("name") || "") + " " +
      (input.getAttribute("id") || "") + " " +
      (input.getAttribute("aria-label") || "")
    ).toLowerCase();
    if (/\b(resume|cv|curriculum)\b/.test(direct)) return true;

    // Walk a bit of nearby DOM text. 200 chars from parent + previous sibling
    // text — enough to catch "Upload your resume" but not so much that the
    // entire page leaks in.
    const parentText = (input.parentElement?.textContent || "").slice(0, 200).toLowerCase();
    if (/\b(resume|cv|curriculum|upload|attach)/.test(parentText)) return true;

    return false;
  }

  async function tryResumeUpload(result) {
    const fileInputs = [...document.querySelectorAll('input[type="file"]')];
    const resumeInputs = fileInputs.filter(isResumeInput);
    if (resumeInputs.length === 0) return; // nothing to do

    let pdfList;
    try {
      pdfList = await AutoFill.serverFetch("/pdf-list");
    } catch (err) {
      result.unfilled.push(`resume_upload (pdf-list fetch failed: ${err.message})`);
      return;
    }
    const pdfs = pdfList?.pdfs || [];
    if (pdfs.length === 0) {
      result.unfilled.push("resume_upload (no PDFs available on server)");
      return;
    }

    const pdfFilename = AutoFill.pickPdfForCurrentPage(pdfs);
    if (!pdfFilename) {
      // Plan: refuse to auto-pick; surface so popup can offer manual chooser.
      result.unfilled.push("resume_upload (no PDF matches this page — use Inject PDF)");
      return;
    }

    const target = resumeInputs[0];
    const inj = await AutoFill.FileInjector.inject(pdfFilename, target);
    if (inj.ok) {
      result.filled.push(`resume_upload: ${pdfFilename}`);
      result.pdf = pdfFilename;
    } else {
      result.unfilled.push(`resume_upload (inject failed: ${inj.error})`);
    }
  }

  // ── Main fill loop ──────────────────────────────────────────────────────
  async function fill(personalInfo, formRules) {
    const result = { filled: [], unfilled: [], pdf: null, aborted: false };

    const inputs = [...document.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea'
    )];

    // PASS 1 — resolve everything, but don't commit yet.
    const resolutions = []; // { input, key, value, confidence, source }
    for (const input of inputs) {
      if (input.disabled || input.readOnly) continue;
      if (input.value && input.value.trim() !== "") continue; // already filled
      const r = resolveInput(input, personalInfo);
      if (r) resolutions.push({ input, ...r });
    }

    // Anti-false-positive guard: require at least N distinct profile fields
    // resolved before committing anything. Otherwise this looks like a
    // contact / search / login form, not a job application.
    const distinctKeys = new Set(resolutions.map((r) => r.key));
    if (distinctKeys.size < MIN_DISTINCT_FIELDS) {
      result.aborted = true;
      result.error =
        `Page does not look like a job application form ` +
        `(only ${distinctKeys.size} field${distinctKeys.size === 1 ? "" : "s"} matched, ` +
        `need ≥${MIN_DISTINCT_FIELDS}).`;
      return result;
    }

    // PASS 2 — commit. Track which input got which key for the report.
    for (const r of resolutions) {
      const ok = AutoFill.setValue(r.input, r.value);
      if (ok) {
        result.filled.push(r.key);
      } else {
        result.unfilled.push(`${r.key} (setValue failed)`);
      }
    }

    // Tier C — selects (EEO, country, state).
    const selectKeys = fillSelectsHeuristic(personalInfo);
    result.filled.push(...selectKeys);

    // Resume upload (best-effort; only if a resume-like file input exists
    // AND we can confidently pick a PDF for this page).
    try {
      await tryResumeUpload(result);
    } catch (err) {
      result.unfilled.push(`resume_upload (${err.message})`);
    }

    // Dedupe filled keys (multiple inputs may map to the same key,
    // e.g. two address-line1 fields on the same form).
    result.filled = [...new Set(result.filled)];
    result.unfilled = [...new Set(result.unfilled)];

    return result;
  }

  window.__atsModule = {
    name: "generic",
    isApplicationForm: () => true, // user explicitly invoked us
    fill,
  };
})();
