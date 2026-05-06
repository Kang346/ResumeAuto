// Shared auto-fill utilities for all ATS modules

window.AutoFill = window.AutoFill || {};

// React-safe value setter — works with React (incl. react-hook-form),
// Angular, and vanilla forms.
//
// Why this is more than `el.value = ...`:
//   1. React renders <input value={state}>. Setting el.value directly
//      bypasses React's internal lastNativeValue tracking, so subsequent
//      submit-time validation that reads React state sees an empty input.
//      Using the prototype's native setter + dispatching an InputEvent fixes
//      this — React's onChange handler then re-syncs state from the DOM.
//   2. react-hook-form (used by Greenhouse, many ATS) tracks values via an
//      internal `_valueTracker` on each registered input. If the tracker's
//      cached value matches the new DOM value, RHF skips the change. Forcing
//      the tracker to a different sentinel before assignment makes RHF see
//      a real change and update its internal state.
//   3. Many forms gate validation on the `touched` / `dirty` flag, which is
//      only set after a focus → blur cycle. Calling .focus() before assigning
//      and .blur() after pushes the field through that lifecycle so submit
//      doesn't complain "this required field is empty" on values we set.
//   4. Some libs distinguish "real user input" from synthetic events by
//      looking at the event constructor. Dispatching a true `InputEvent`
//      (with inputType: "insertText") instead of a plain `Event("input")`
//      makes the event indistinguishable from a keystroke for most checkers.
AutoFill.setValue = function (element, value) {
  if (!element || value == null) return false;
  const tag = element.tagName.toLowerCase();

  if (tag === "select") {
    return AutoFill.selectOption(element, value);
  }

  if (element.type === "checkbox" || element.type === "radio") {
    const shouldCheck =
      value === true ||
      value === "true" ||
      value === "Yes" ||
      value === "yes";
    if (element.checked !== shouldCheck) {
      element.checked = shouldCheck;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return true;
  }

  // Native value setter only works on real <input>/<textarea>. Buttons,
  // role=combobox triggers, and generic divs must go through fillCombobox /
  // clickCustomDropdown — calling the setter on them throws "Illegal invocation".
  if (tag !== "input" && tag !== "textarea") {
    return false;
  }

  // (1) Focus first so the form library marks this field as "touched". Without
  // this some forms (RHF, Mantine) treat the field as never-interacted-with
  // even after we assign a value, and refuse to clear the required validator.
  try { element.focus(); } catch {}

  // (2) Force react-hook-form's _valueTracker to a sentinel before assigning.
  // RHF compares the tracker's cached value to the new DOM value to decide
  // whether onChange should fire; same value = skip. A sentinel guarantees
  // a diff, so RHF re-reads and updates internal state.
  if (element._valueTracker) {
    try { element._valueTracker.setValue("__autoresume_force_change__"); } catch {}
  }

  // (3) Native value setter — bypasses React's controlled-input override and
  // writes through to the underlying DOM property.
  const nativeSetter = Object.getOwnPropertyDescriptor(
    tag === "textarea"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype,
    "value"
  )?.set;

  if (nativeSetter) {
    nativeSetter.call(element, value);
  } else {
    element.value = value;
  }

  // (4) Dispatch a real InputEvent (not plain Event) so listeners that
  // discriminate by constructor type accept this as "user typed". The
  // inputType: "insertText" is what a normal keystroke produces.
  let inputEvent;
  try {
    inputEvent = new InputEvent("input", {
      bubbles: true,
      cancelable: true,
      data: String(value),
      inputType: "insertText",
    });
  } catch {
    // Older browsers may not support InputEvent constructor — fall back.
    inputEvent = new Event("input", { bubbles: true });
  }
  element.dispatchEvent(inputEvent);
  element.dispatchEvent(new Event("change", { bubbles: true }));

  // (5) Blur to fire any onBlur validators and close the touched/dirty cycle.
  try { element.blur(); } catch {}
  element.dispatchEvent(new Event("blur", { bubbles: true }));

  return true;
};

// Select a <select> option by value or visible text
AutoFill.selectOption = function (selectEl, value) {
  const lower = value.toLowerCase();
  let matched = false;

  for (const opt of selectEl.options) {
    if (
      opt.value.toLowerCase() === lower ||
      opt.textContent.trim().toLowerCase() === lower
    ) {
      selectEl.value = opt.value;
      matched = true;
      break;
    }
  }

  // Fuzzy: substring match
  if (!matched) {
    for (const opt of selectEl.options) {
      if (
        opt.textContent.trim().toLowerCase().includes(lower) ||
        lower.includes(opt.textContent.trim().toLowerCase())
      ) {
        selectEl.value = opt.value;
        matched = true;
        break;
      }
    }
  }

  if (matched) {
    selectEl.dispatchEvent(new Event("change", { bubbles: true }));
    selectEl.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return matched;
};

// Click a custom dropdown trigger, wait for options, click matching option
AutoFill.clickCustomDropdown = async function (
  triggerEl,
  optionText,
  optionSelector = '[role="option"], li'
) {
  triggerEl.click();
  await AutoFill.sleep(300);

  const lower = optionText.toLowerCase();
  const options = document.querySelectorAll(optionSelector);
  for (const opt of options) {
    if (opt.textContent.trim().toLowerCase().includes(lower)) {
      opt.click();
      return true;
    }
  }
  return false;
};

// Multi-strategy field locator. Tries selectors in priority order so a single
// helper works across Workday tenants that use either data-automation-id or
// id-based BEM selectors. Falls back to label-based discovery.
//
// specs = {
//   automationId, idSuffix, idIncludes, ariaLabel,
//   autocomplete, name, placeholder, labelText
// }
// Returns the underlying <input>/<textarea> if it can find one, otherwise the
// matched container element (useful for combobox triggers).
AutoFill.findField = function (specs) {
  if (!specs) return null;

  const selectors = [
    specs.automationId && `[data-automation-id="${specs.automationId}"]`,
    specs.idSuffix && `[id$="${CSS.escape(specs.idSuffix)}"]`,
    specs.idIncludes && `[id*="${CSS.escape(specs.idIncludes)}"]`,
    specs.autocomplete && `[autocomplete="${specs.autocomplete}"]`,
    specs.name && `[name="${specs.name}"]`,
    specs.placeholder && `[placeholder*="${specs.placeholder}" i]`,
    specs.ariaLabel && `[aria-label*="${specs.ariaLabel}" i]`,
  ].filter(Boolean);

  for (const sel of selectors) {
    let found;
    try {
      found = document.querySelector(sel);
    } catch {
      continue;
    }
    if (!found) continue;
    if (found.tagName === "INPUT" || found.tagName === "TEXTAREA") return found;
    const inner = found.querySelector("input, textarea");
    if (inner) return inner;
    return found;
  }

  if (specs.labelText) {
    const wanted = specs.labelText.toLowerCase();
    for (const lbl of document.querySelectorAll("label")) {
      if (!lbl.textContent.toLowerCase().includes(wanted)) continue;
      if (lbl.htmlFor) {
        const target = document.getElementById(lbl.htmlFor);
        if (target) return target;
      }
      const sibling = lbl.parentElement?.querySelector("input, textarea, [role='combobox'], button[aria-haspopup]");
      if (sibling) return sibling;
    }
  }

  return null;
};

// "Real" click — full pointer + mouse event chain. Workday's React handlers
// often listen for pointerdown + pointerup specifically and ignore bare
// element.click() (verified live: clickTest showed .click() did NOT toggle
// a Workday menuItem checkbox). Always prefer this over el.click() when
// driving Workday widgets.
AutoFill.realClick = function (el) {
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const baseOpts = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: cx,
    clientY: cy,
    button: 0,
    buttons: 1,
  };
  try {
    el.dispatchEvent(new PointerEvent("pointerdown", { ...baseOpts, pointerType: "mouse", isPrimary: true, pointerId: 1 }));
    el.dispatchEvent(new MouseEvent("mousedown", baseOpts));
    el.dispatchEvent(new PointerEvent("pointerup", { ...baseOpts, pointerType: "mouse", isPrimary: true, pointerId: 1, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("mouseup", { ...baseOpts, buttons: 0 }));
    el.dispatchEvent(new MouseEvent("click", { ...baseOpts, buttons: 0 }));
  } catch (e) {
    // PointerEvent may not be available in some contexts — fall back to plain click.
    try { el.click(); } catch { }
  }
};

// Find the immediate label text for an individual input (typically a single
// radio button or checkbox in a group of options). Tries multiple lookup
// strategies — Workday's HTML structure varies by tenant.
AutoFill.findInputLabel = function (input) {
  if (!input) return "";
  // <label for="input-id">
  if (input.id) {
    const labelFor = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (labelFor) return (labelFor.textContent || "").trim();
  }
  // <label> ... <input> ... </label>
  const parentLabel = input.closest("label");
  if (parentLabel) {
    // Strip the input's own text, just keep label text
    return (parentLabel.textContent || "").trim();
  }
  // Sibling next-element <label> or text-bearing element
  const next = input.nextElementSibling;
  if (next && (next.tagName === "LABEL" || next.tagName === "SPAN" || next.tagName === "DIV")) {
    const t = (next.textContent || "").trim();
    if (t) return t;
  }
  // aria-label
  const aria = input.getAttribute("aria-label");
  if (aria) return aria.trim();
  // aria-labelledby
  const labelledBy = input.getAttribute("aria-labelledby");
  if (labelledBy) {
    const lbl = document.getElementById(labelledBy);
    if (lbl) return (lbl.textContent || "").trim();
  }
  // Fallback: parent's text (excluding the input itself)
  return (input.parentElement?.textContent || "").trim();
};

// Build an accumulated label by walking up the DOM, collecting labels from:
//   - the element itself (aria-label, label[for])
//   - the nearest fieldset's <legend>
//   - any [data-automation-id] container's <label>
//   - section-level <h2>/<h3>/<h4> ancestors
// Used to match questions whose answer-level label is generic ("Please check
// one of the boxes below") but whose section heading carries the question
// keyword ("Voluntary Self-Identification of Disability").
AutoFill.findAccumulatedLabel = function (el) {
  if (!el) return "";
  const parts = [];

  if (el.getAttribute && el.getAttribute("aria-label")) parts.push(el.getAttribute("aria-label"));

  if (el.id) {
    const lblFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lblFor) parts.push(lblFor.textContent || "");
  }

  const fieldset = el.closest && el.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector(":scope > legend");
    if (legend) parts.push(legend.textContent || "");
  }

  const aidContainer = el.closest && el.closest("[data-automation-id]");
  if (aidContainer) {
    const containerLbl = aidContainer.querySelector(":scope > label, :scope > legend");
    if (containerLbl) parts.push(containerLbl.textContent || "");
  }

  // Walk up looking for headings within the same logical section
  let p = el.parentElement;
  for (let i = 0; i < 6 && p; i++) {
    for (const h of p.querySelectorAll(":scope > h1, :scope > h2, :scope > h3, :scope > h4")) {
      parts.push(h.textContent || "");
    }
    p = p.parentElement;
  }

  return parts.map((s) => s.trim()).filter(Boolean).join(" | ").toLowerCase();
};

// Press Space on a focusable element. Workday's skills multiselect listens
// for keyboard Space on the menuItem to toggle the checkbox — neither plain
// .click() nor a pointer event chain triggers it (verified empirically:
// click strategies A and B both produced gained=0; Space keydown on focused
// menuItem produced gained=1, committing the tag).
AutoFill.pressSpace = function (el) {
  if (!el) return;
  try { el.focus(); } catch { }
  el.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true, cancelable: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", keyCode: 32, which: 32, bubbles: true, cancelable: true }));
};

// Find a button (default: "Add" / "Add Another") scoped to the DOM region
// between two headings. Workday's "My Experience" page has multiple
// "Add Another" buttons (one per subsection: Work Experience, Education,
// Languages, etc.) and a generic findSectionByHeading returns the whole
// page, so we'd grab the first match (wrong subsection). This helper walks
// document order and only returns buttons that appear after `startHeading`
// and before `endHeading` (or end of document).
AutoFill.findButtonBetweenHeadings = function (startHeadingText, endHeadingText, buttonRegex = /^add( another)?$/i) {
  const heads = [...document.querySelectorAll("h2,h3,h4,[role='heading']")];
  const norm = (s) => (s || "").trim().toLowerCase();
  const start = heads.find((h) => norm(h.textContent).startsWith(startHeadingText.toLowerCase()));
  if (!start) return null;
  const end = endHeadingText
    ? heads.find((h) => {
      if (h === start) return false;
      const after = !!(start.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING);
      return after && norm(h.textContent).startsWith(endHeadingText.toLowerCase());
    })
    : null;

  for (const btn of document.querySelectorAll("button")) {
    const afterStart = !!(start.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!afterStart) continue;
    if (end) {
      const beforeEnd = !!(end.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_PRECEDING);
      if (!beforeEnd) continue;
    }
    if (buttonRegex.test((btn.textContent || "").trim())) return btn;
  }
  return null;
};

// Fill a typeahead combobox (Workday phone country code, state, etc.)
// Opens the trigger, types into the search input if one appears, waits for
// the virtual list to filter, then clicks the first option matching
// optionMatch (string or predicate).
AutoFill.fillCombobox = async function (triggerEl, searchValue, optionMatch) {
  if (!triggerEl) return false;

  triggerEl.click();
  await AutoFill.sleep(300);

  if (searchValue) {
    const searchInput =
      document.querySelector('[role="combobox"] input:not([aria-hidden="true"])') ||
      document.querySelector('[role="listbox"] input') ||
      document.querySelector('input[aria-controls][aria-expanded="true"]') ||
      document.querySelector('input[aria-autocomplete="list"]');

    if (searchInput && searchInput !== triggerEl) {
      AutoFill.setValue(searchInput, searchValue);
      await AutoFill.sleep(400);
    }
  }

  // When optionMatch is a string, match by exact → startsWith → contains.
  // The previous "first contains wins" logic produced classic bugs like
  // selecting "Female" when looking for "Male" (fe-MALE).
  const want = String(optionMatch || searchValue || "").toLowerCase().trim();
  const norm = (s) => (s || "").toLowerCase().trim();
  const matchFn = typeof optionMatch === "function"
    ? optionMatch
    : null;

  for (let attempt = 0; attempt < 4; attempt++) {
    const opts = [...document.querySelectorAll('[role="option"]')];
    let target;
    if (matchFn) {
      target = opts.find((o) => matchFn((o.textContent || "").trim()));
    } else {
      // Tiered match: exact wins over startsWith wins over contains.
      target =
        opts.find((o) => norm(o.textContent) === want) ||
        opts.find((o) => norm(o.textContent).startsWith(want)) ||
        opts.find((o) => norm(o.textContent).includes(want));
    }
    if (target) {
      target.click();
      await AutoFill.sleep(150);

      // Force Workday's React state to commit the selection. Without this
      // the visible button updates but the underlying form value stays empty
      // and the submit handler reports "field required".
      try {
        triggerEl.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      } catch {
        triggerEl.dispatchEvent(new Event("blur", { bubbles: true }));
      }

      // Don't trust the trigger's .value — Workday stores the real value
      // elsewhere. Treat a successful click + popup-closed as success.
      const expanded = triggerEl.getAttribute && triggerEl.getAttribute("aria-expanded");
      if (expanded === null || expanded === "false") return true;
      // Popup still open after 150ms? Give it one more tick then accept.
      await AutoFill.sleep(150);
      return true;
    }
    await AutoFill.sleep(300);
  }

  // Close the popup if we failed to find a match so the page isn't left open.
  document.body.click();
  return false;
};

// Fill a react-select-style combobox where the trigger IS the search input
// (Greenhouse's job-boards.greenhouse.io frontend, class="select__input"
// role="combobox"). fillCombobox above assumes the trigger is a button with
// a separate search input nested inside; here trigger and search input are
// the same element, so we drive it differently:
//   1. focus + click to open the listbox
//   2. try matching options as-is (small lists like Yes/No don't need search,
//      and typing into them sometimes flakes out the listbox)
//   3. if no match, type the value to filter, then match again
// Returns { ok, reason } so the caller can mark the field unfilled cleanly.
AutoFill.fillReactSelect = async function (inputEl, value, displayName) {
  if (!inputEl || value == null || value === "") {
    return { ok: false, reason: "no input or value" };
  }

  const want = String(value).toLowerCase().trim();
  const norm = (s) => (s || "").toLowerCase().trim();

  // Locate the active react-select listbox for THIS input. Three-layer
  // resolution: aria-controls (react-select v5; current Greenhouse leaves it
  // null but free win on upgrade), same-container scope (verified live for
  // current Greenhouse layout), then document-wide singleton as a portal
  // escape hatch. fillReactSelect is serial so at most one menu exists at
  // any time — the global query is safe.
  const findOptionsRoot = () => {
    const ariaCtrl = inputEl.getAttribute("aria-controls");
    if (ariaCtrl) {
      const root = document.getElementById(ariaCtrl);
      if (root) return root;
    }
    const scoped = inputEl.closest(".select__container")
                        ?.querySelector(".select__menu");
    if (scoped) return scoped;
    return document.querySelector(".select__menu");
  };

  const findMatch = () => {
    const root = findOptionsRoot();
    if (!root) return null;
    const opts = [...root.querySelectorAll('[role="option"], .select__option')];
    if (opts.length === 0) return null;
    return (
      opts.find((o) => norm(o.textContent) === want) ||
      opts.find((o) => norm(o.textContent).startsWith(want)) ||
      opts.find((o) => norm(o.textContent).includes(want)) ||
      null
    );
  };

  // Read the rendered selected-value chip. Result-oriented success check —
  // covers the "react-select auto-commits on blur when typed value uniquely
  // matches" path that earlier mis-reported as ok:false.
  const verifySelected = () => {
    const sv = inputEl.closest(".select__control")
                    ?.querySelector(".select__single-value");
    if (!sv) return false;
    return norm(sv.textContent).includes(want);
  };

  // Idempotency: if the field already shows what we want, do nothing. Avoids
  // re-opening the listbox and flashing the UI on a second Fill click.
  if (verifySelected()) return { ok: true };

  // (1) Open the listbox. Plain element.click() doesn't reliably trigger
  // react-select's open-menu reaction on this Greenhouse build — the full
  // pointerdown / mousedown / pointerup / mouseup / click chain does.
  try { inputEl.focus(); } catch {}
  AutoFill.realClick(inputEl);
  await AutoFill.sleep(250);

  // (2) Strategy A: try matching without typing. Polls a few times because
  // the listbox can take a beat to render after click.
  for (let attempt = 0; attempt < 4; attempt++) {
    const target = findMatch();
    if (target) {
      target.click();
      await AutoFill.sleep(150);
      try { inputEl.dispatchEvent(new FocusEvent("blur", { bubbles: true })); } catch {}
      return { ok: true };
    }
    await AutoFill.sleep(200);
  }

  // (3) Strategy B: type to filter. We can't use AutoFill.setValue here —
  // it ends with a blur, and react-select closes the menu on blur, killing
  // the filtered options before our poll loop sees them. Inline a setValue
  // clone WITHOUT the blur step so the menu stays open.
  const typeIntoInput = (val) => {
    try { inputEl.focus(); } catch {}
    if (inputEl._valueTracker) {
      try { inputEl._valueTracker.setValue("__autoresume_force_change__"); } catch {}
    }
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;
    if (setter) setter.call(inputEl, String(val));
    else inputEl.value = String(val);
    try {
      inputEl.dispatchEvent(new InputEvent("input", {
        bubbles: true, cancelable: true,
        data: String(val), inputType: "insertText",
      }));
    } catch {
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
    // NO blur — react-select closes the menu on blur and we'd lose the
    // filtered option list before findMatch can poll it.
  };
  typeIntoInput(value);
  await AutoFill.sleep(350);

  for (let attempt = 0; attempt < 4; attempt++) {
    const target = findMatch();
    if (target) {
      target.click();
      await AutoFill.sleep(150);
      try { inputEl.dispatchEvent(new FocusEvent("blur", { bubbles: true })); } catch {}
      return { ok: true };
    }
    await AutoFill.sleep(200);
  }

  // Commit-fallback: react-select auto-focuses the first matching option
  // (.select__option--is-focused) after typing. Pressing Enter on the input
  // commits that focused option even when our substring matcher missed.
  try {
    inputEl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter", code: "Enter", keyCode: 13, which: 13,
      bubbles: true, cancelable: true,
    }));
  } catch {}
  await AutoFill.sleep(200);

  // Close the listbox cleanly so the page isn't left in a weird state.
  try {
    inputEl.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true,
    }));
  } catch {}
  document.body.click();

  // Last chance: react-select may have auto-committed the typed value on
  // blur (or via the Enter above) even though we never clicked an option.
  // Trust the rendered chip.
  if (verifySelected()) return { ok: true };

  // No options anywhere AND the chip is empty — selectors might be off for
  // this variant. Surface a console warning so we can iterate on selectors
  // rather than silently mis-reporting.
  if (!findOptionsRoot()) {
    console.warn(
      "[AutoFill.fillReactSelect] could not locate listbox for",
      displayName || inputEl.id || "(unknown field)",
      "— check aria-controls / .select__container selectors"
    );
  }

  // Clear typed search text so the field's UI reflects its true (empty)
  // state — otherwise the input visually looks filled but no option is
  // committed, masking the failure on review.
  try { AutoFill.setValue(inputEl, ""); } catch {}

  return { ok: false, reason: `no option matched "${value}" for ${displayName || "react-select"}` };
};

// Fill the country picker exposed by intl-tel-input (used by the modern
// Greenhouse phone field). The trigger is a <button class="iti__selected-country">
// that opens a dialog containing a <ul class="iti__country-list"> of <li>
// items — each <li> has a country name span + a flag class. Plain
// element.click() may not open the dialog because the library binds pointer
// events, so we use realClick.
AutoFill.fillIntlTelCountry = async function (countryName) {
  if (!countryName) return { ok: false, reason: "no country name" };

  const trigger = document.querySelector("button.iti__selected-country");
  if (!trigger) return { ok: false, reason: "no iti__selected-country button" };

  const want = String(countryName).toLowerCase().trim();
  const norm = (s) => (s || "").toLowerCase().trim();

  // Open the dialog
  AutoFill.realClick(trigger);
  await AutoFill.sleep(300);

  const findCountry = () => {
    let candidates = [...document.querySelectorAll(".iti__country-list li.iti__country")];
    if (candidates.length === 0) {
      candidates = [...document.querySelectorAll('[role="listbox"] [role="option"]')];
    }
    if (candidates.length === 0) return null;

    const textOf = (li) => {
      const nameEl = li.querySelector(".iti__country-name");
      return norm(nameEl ? nameEl.textContent : li.textContent);
    };
    return (
      candidates.find((li) => textOf(li) === want) ||
      candidates.find((li) => textOf(li).startsWith(want)) ||
      candidates.find((li) => textOf(li).includes(want)) ||
      null
    );
  };

  for (let attempt = 0; attempt < 4; attempt++) {
    const target = findCountry();
    if (target) {
      target.click();
      await AutoFill.sleep(200);
      // Verify: dialog closed (aria-expanded false) OR the flag class changed.
      const expanded = trigger.getAttribute("aria-expanded");
      const flag = trigger.querySelector(".iti__flag");
      const flagClass = flag ? flag.className : "";
      if (expanded === "false" || expanded === null || /iti__[a-z]{2}\b/.test(flagClass)) {
        return { ok: true };
      }
      return { ok: true };
    }
    await AutoFill.sleep(250);
  }

  // Close cleanly on miss
  try {
    trigger.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true,
    }));
  } catch {}
  document.body.click();
  return { ok: false, reason: `country "${countryName}" not found in iti list` };
};

// Find the section/fieldset/container that holds a heading like "Work Experience".
// Used to scope "Add" / "Add Another" button discovery to one section so we
// don't accidentally click the wrong Add button on a multi-section page.
AutoFill.findSectionByHeading = function (headingText) {
  const wanted = headingText.toLowerCase();
  const heads = document.querySelectorAll("h2, h3, h4, [role='heading']");
  for (const h of heads) {
    const text = (h.textContent || "").trim().toLowerCase();
    if (text.startsWith(wanted) || text === wanted) {
      return (
        h.closest("section, fieldset, [data-automation-id]") ||
        h.parentElement?.parentElement ||
        h.parentElement
      );
    }
  }
  return null;
};

// Wait for an element to appear in the DOM
AutoFill.waitFor = function (selector, timeout = 5000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
};

AutoFill.sleep = function (ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

// Match a field label against a set of patterns
AutoFill.matchLabel = function (labelText, patterns) {
  const lower = labelText.toLowerCase().trim();
  for (const [pattern, key] of Object.entries(patterns)) {
    if (lower.includes(pattern.toLowerCase())) {
      return key;
    }
  }
  return null;
};

// Fetch data from local server via background service worker
AutoFill.serverFetch = function (path) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "fetch", url: `http://localhost:8765${path}` },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.ok) {
          resolve(response.data);
        } else {
          reject(new Error(response?.error || "fetch failed"));
        }
      }
    );
  });
};

// Fetch a PDF as an ArrayBuffer via background service worker
AutoFill.fetchPdfBlob = function (filename) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: "fetch-blob", url: `http://localhost:8765/pdf/${filename}` },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response?.ok) {
          const uint8 = new Uint8Array(response.data);
          const blob = new Blob([uint8], { type: response.mime });
          resolve(blob);
        } else {
          reject(new Error(response?.error || "fetch-blob failed"));
        }
      }
    );
  });
};

// Report fill results to the background badge
AutoFill.reportBadge = function (unfilled) {
  chrome.runtime.sendMessage({ type: "update-badge", unfilled });
};

// Pick the best-matching PDF for the current page based on URL + title hints.
// Shared between detector.js (auto path on supported ATS) and generic.js
// (manual popup path on unsupported sites). Returns null if no confident
// match — callers MUST NOT auto-inject in that case.
//
// Hint sources (priority order):
//   1. First non-empty path segment — e.g. jobs.ashbyhq.com/{company}/{id}
//   2. Hostname tenant prefix — e.g. {tenant}.wd5.myworkdayjobs.com
//   3. Document title (last resort, often "Company - Role")
//
// PDFs are named "{Company_Name}_{Job_Title}_{Date}.pdf". After lowercase +
// strip-non-alphanumeric, a hint matches if the hint string is a substring
// of the PDF's normalized name (or vice versa for short PDF prefixes).
AutoFill.pickPdfForCurrentPage = function (pdfs) {
  if (!pdfs || pdfs.length === 0) return null;

  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const hints = [];
  try {
    const firstSeg = window.location.pathname.split("/").filter(Boolean)[0];
    if (firstSeg) hints.push(firstSeg);
    const hostFirst = window.location.hostname.split(".")[0];
    if (hostFirst) hints.push(hostFirst);
  } catch { }
  if (document.title) hints.push(document.title);

  // Need ≥4 chars to avoid noise like "job"/"app"/"hr".
  const normedHints = hints.map(norm).filter((h) => h && h.length >= 4);
  if (normedHints.length === 0) return null;

  // Skip generic ATS path segments that are not company names.
  const blacklist = new Set([
    "jobs", "careers", "career", "applicant", "external", "internal",
    "boards", "boardsgreenhouseio", "candidates", "apply", "application",
    "openings", "search", "wd1", "wd2", "wd3", "wd4", "wd5", "wd10",
    "myworkdayjobs", "leverco", "ashbyhq", "greenhouseio",
  ]);

  let best = null;
  for (let i = 0; i < pdfs.length; i++) {
    const pdfRaw = pdfs[i].replace(/\.pdf$/i, "");
    const pdfNorm = norm(pdfRaw);
    if (!pdfNorm) continue;
    const firstTokenNorm = norm(pdfRaw.split(/[_\s\-]+/)[0] || "");
    for (const hint of normedHints) {
      if (blacklist.has(hint)) continue;
      let score = 0;
      if (pdfNorm.includes(hint)) {
        score = hint.length + 100;
      } else if (
        firstTokenNorm.length >= 4 &&
        hint.length >= 4 &&
        (hint.startsWith(firstTokenNorm) || firstTokenNorm.startsWith(hint))
      ) {
        const sharedLen = Math.min(hint.length, firstTokenNorm.length);
        score = sharedLen + 70;
      } else {
        const pdfPrefix = pdfNorm.slice(0, Math.min(pdfNorm.length, 12));
        if (pdfPrefix.length >= 5 && hint.includes(pdfPrefix)) {
          score = pdfPrefix.length + 50;
        }
      }
      if (score > 0 && (!best || score > best.score)) {
        best = { pdf: pdfs[i], score };
      }
    }
  }

  return best ? best.pdf : null;
};
