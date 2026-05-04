// Ashby ATS module — jobs.ashbyhq.com/{company}/{id}

window.__atsModule = {
  name: "ashby",

  isApplicationForm() {
    return (
      !!document.querySelector('[name="_systemfield_name"]') ||
      !!document.querySelector('[name="_systemfield_email"]') ||
      !!document.querySelector('[id="_systemfield_resume"]')
    );
  },

  async fill(personalInfo, formRules) {
    const filled = [];
    const unfilled = [];

    // Ashby React SPA can be slow — wait for fields to render
    await AutoFill.sleep(2000);

    // ── Standard fields ──────────────────────────────────────────────────────

    const fullName = [personalInfo.name?.first, personalInfo.name?.last].filter(Boolean).join(" ");

    // Wait up to 4s for name field to be in DOM (Ashby renders asynchronously)
    let nameEl = null;
    for (let i = 0; i < 8; i++) {
      nameEl = document.querySelector('[name="_systemfield_name"], #_systemfield_name');
      if (nameEl) break;
      await AutoFill.sleep(500);
    }
    if (nameEl && fullName) { this.reactSet(nameEl, fullName); filled.push("name"); }
    else if (!nameEl) unfilled.push("name (not found)");

    const emailEl = document.querySelector('[name="_systemfield_email"], #_systemfield_email');
    if (emailEl && personalInfo.email) { this.reactSet(emailEl, personalInfo.email); filled.push("email"); }

    const phoneEl = document.querySelector(
      '[name="_systemfield_phone"], #_systemfield_phone, input[type="tel"], input[name*="phone" i]'
    );
    if (phoneEl && personalInfo.phone) { this.reactSet(phoneEl, personalInfo.phone); filled.push("phone"); }

    const linkedinEl = document.querySelector('[name*="linkedin" i], input[placeholder*="linkedin" i]');
    if (linkedinEl && personalInfo.linkedin) { this.reactSet(linkedinEl, personalInfo.linkedin); filled.push("linkedin"); }

    const githubEl = document.querySelector('[name*="github" i], input[placeholder*="github" i]');
    if (githubEl && personalInfo.github) { this.reactSet(githubEl, personalInfo.github); filled.push("github"); }

    const websiteEl = document.querySelector('[name*="website" i], [name*="portfolio" i]');
    if (websiteEl && personalInfo.website) { this.reactSet(websiteEl, personalInfo.website); filled.push("website"); }

    // ── Custom questions via label → input mapping ───────────────────────────
    this.fillCustomQuestions(personalInfo, formRules, filled, unfilled);

    return { filled, unfilled };
  },

  // ── Custom questions ───────────────────────────────────────────────────────
  // Ashby ties question text to inputs via <label for="inputId">.
  // We iterate labels, read text, then act on the associated input.
  fillCustomQuestions(personalInfo, formRules, filled, unfilled) {
    // Build id → element AND name → element maps.
    // Ashby uses UUIDs as both the label[for] value AND the input[name],
    // but often leaves input[id] empty — so we need the name-based fallback.
    const byId   = {};
    const byName = {};
    for (const el of document.querySelectorAll("input, textarea, select")) {
      if (el.id)   byId[el.id]     = el;
      if (el.name) byName[el.name] = el;
    }

    for (const label of document.querySelectorAll("label")) {
      const forId = label.htmlFor;
      const context = label.textContent.trim().toLowerCase();
      if (!context || context.length < 5) continue;

      // Skip system fields
      if (forId && forId.startsWith("_systemfield_")) continue;

      // Try id first, then name (Ashby checkbox UUIDs match name, not id)
      const input = forId
        ? (byId[forId] || document.getElementById(forId) || byName[forId])
        : null;
      const inputType = input?.type?.toLowerCase();

      // ── URL profile fields (custom questions) ─────────────────────────────
      // Ashby uses UUID names + generic "Type here..." placeholders for these,
      // so the standard top-level selectors (name*="linkedin") miss them. We
      // recognise them here by label text and write via the React-safe setter.
      if (
        context.includes("linkedin") ||
        (context.includes("linked") && context.includes("in") && context.includes("profile"))
      ) {
        if (input && (inputType === "text" || inputType === "url" || !input.type) && personalInfo.linkedin) {
          this.reactSet(input, personalInfo.linkedin);
          filled.push("linkedin");
        }
        continue;
      }

      if (context.includes("github")) {
        if (input && (inputType === "text" || inputType === "url" || !input.type) && personalInfo.github) {
          this.reactSet(input, personalInfo.github);
          filled.push("github");
        }
        continue;
      }

      if (
        context.includes("portfolio") ||
        context.includes("personal website") ||
        context.includes("personal site") ||
        (context.includes("website") && !context.includes("company"))
      ) {
        if (input && (inputType === "text" || inputType === "url" || !input.type) && personalInfo.website) {
          this.reactSet(input, personalInfo.website);
          filled.push("website");
        }
        continue;
      }

      if (context.includes("twitter") || context.includes("x profile") || context.includes("x handle")) {
        if (input && (inputType === "text" || inputType === "url" || !input.type) && personalInfo.twitter) {
          this.reactSet(input, personalInfo.twitter);
          filled.push("twitter");
        }
        continue;
      }

      // ── Currently based in the US ────────────────────────────────────────
      if (
        context.includes("currently based in the united states") ||
        context.includes("currently based in the us") ||
        context.includes("based in the united states") ||
        (context.includes("currently") && context.includes("united states"))
      ) {
        if (input && inputType === "checkbox") {
          // User is in the US (per personal_info.json location)
          this.setCheckbox(input, true);
          filled.push("us_based");
        }
        continue;
      }

      // ── Sponsorship ────────────────────────────────────────────────────────
      // Default answer: YES (Kang requires sponsorship). Some forms phrase the
      // question as "will you require sponsorship" (answer Yes) and some as
      // "are you legally authorized to work" (handled in the work-auth branch
      // below — answer Yes). We match by Yes/No prefix on the option label so
      // the No radio is left alone even though it shares the question keywords.
      if (
        context.includes("sponsorship") ||
        context.includes("require employment") ||
        (context.includes("sponsor") && context.includes("visa")) ||
        (context.includes("now or in the future") && context.includes("work"))
      ) {
        if (input && inputType === "checkbox") {
          this.setCheckbox(input, true);
          filled.push("sponsorship");
        } else if (input && inputType === "radio") {
          // Only click the "Yes" option label — skip "No" and the question
          // wrapper (which usually has no input or points to a fieldset).
          const isYes =
            context.startsWith("yes") ||
            context.includes("i will require") ||
            context.includes("yes,");
          const isNo =
            context.startsWith("no") ||
            context.includes("i do not require") ||
            context.includes("do not require sponsorship");
          if (isYes && !isNo) {
            this.setRadio(input);
            filled.push("sponsorship_yes");
          }
          // else: question label or "No" option — leave alone.
        }
        continue;
      }

      // ── Work authorization ────────────────────────────────────────────────
      if (
        (context.includes("authorized") && context.includes("work")) ||
        (context.includes("legally") && context.includes("work")) ||
        (context.includes("eligible") && context.includes("work"))
      ) {
        if (input && inputType === "checkbox") { this.setCheckbox(input, true); filled.push("work_auth"); }
        else if (input && inputType === "radio") { this.setRadio(input); filled.push("work_auth"); }
        continue;
      }

      // ── In-office / on-site radio OPTION labels ───────────────────────────
      // These are option labels for a radio group, not question labels.
      // Pick "Yes … open to relocation" if available, otherwise first "Yes" option.
      if (input && inputType === "radio") {
        // Option: "Yes, and … open to relocation"
        if (context.includes("open to relocation") && context.startsWith("yes")) {
          this.setRadio(input);
          filled.push("office_relocation_yes");
          continue;
        }
        // Option: "Yes, and I currently live in [city]" — only pick if no relocation option exists
        // We'll handle this in a second pass below; skip for now.
        // Option: "No, I cannot work in-office" — skip
        if (context.startsWith("no") && context.includes("in-office")) continue;
      }

      // ── Startup / culture yes ─────────────────────────────────────────────
      if (context.includes("prepared to work at a startup") || context.includes("work at a startup")) {
        if (input && inputType === "checkbox") { this.setCheckbox(input, true); filled.push("startup_ready"); }
        continue;
      }

      // ── Generic in-office question label (points to a fieldset/legend, no input) ──
      // Handled by the radio option labels above; skip the question label itself.
      if (
        context.includes("work in-person") || context.includes("work in person") ||
        context.includes("in-office") || context.includes("on-site") ||
        context.includes("five days per week")
      ) {
        // This label is likely the question wrapper, not a radio option.
        // The options are handled when we encounter the individual radio labels.
        continue;
      }

      // ── Relocation ────────────────────────────────────────────────────────
      if (context.includes("relocat")) {
        if (input && inputType === "checkbox") { this.setCheckbox(input, true); filled.push("relocate"); }
        else if (input && inputType === "radio") { this.setRadio(input); filled.push("relocate"); }
        continue;
      }

      // ── Travel ────────────────────────────────────────────────────────────
      if (context.includes("travel")) {
        if (input && inputType === "checkbox") { this.setCheckbox(input, true); filled.push("travel"); }
        continue;
      }

      // ── Salary ────────────────────────────────────────────────────────────
      if (context.includes("salary") || context.includes("compensation") || context.includes("pay expectation")) {
        const val = formRules?.numeric?.["expected / desired salary"] || "150000";
        if (input && (inputType === "text" || !input.type)) this.reactSet(input, val);
        else if (input?.tagName === "TEXTAREA") this.reactSet(input, val);
        filled.push("salary");
        continue;
      }

      // ── Source ────────────────────────────────────────────────────────────
      if (
        context.includes("how did you hear") || context.includes("how did you find") ||
        (context.includes("where") && context.includes("learn"))
      ) {
        if (input?.tagName === "SELECT") AutoFill.selectOption(input, "LinkedIn");
        else if (input) this.reactSet(input, "LinkedIn");
        filled.push("source");
        continue;
      }

      // ── Standard "No" answers ─────────────────────────────────────────────
      const noPatterns = [
        "previously worked", "worked here before", "former employee",
        "know anyone at", "employee referral", "family member", "relative",
        "government official", "felony", "convicted", "non-compete", "non compete",
      ];
      const hitNo = noPatterns.find(p => context.includes(p));
      if (hitNo && input) {
        if (inputType === "checkbox") { this.setCheckbox(input, false); filled.push(hitNo.substring(0, 30)); }
        continue;
      }

      // ── Open-ended textarea → flag ─────────────────────────────────────────
      if (input?.tagName === "TEXTAREA" && context.length > 10) {
        const snippet = label.textContent.trim().substring(0, 60);
        if (snippet.toLowerCase() !== "yes" && snippet.toLowerCase() !== "no") {
          unfilled.push(`⚠️ UNFILLED: "${snippet}"`);
        }
        continue;
      }
    }

    // ── Second pass: handle "Yes, live in [city]" radio options that weren't covered ──
    // If a radio group has no "open to relocation" option, pick the first "Yes" radio.
    this.handleOfficeRadioGroups(filled);
  },

  // For radio groups about in-office work: if no "relocation" option was selected,
  // find all "yes" options and pick the first one if none in the group are selected.
  handleOfficeRadioGroups(filled) {
    // Find all radio inputs whose associated label mentions "yes" and live/bay area/sf
    const officeRadios = Array.from(document.querySelectorAll('input[type="radio"]')).filter(r => {
      const lbl = r.id ? document.querySelector(`label[for="${r.id}"]`) : null;
      const txt = (lbl?.textContent || "").trim().toLowerCase();
      return txt.startsWith("yes") && (
        txt.includes("live in") || txt.includes("bay area") ||
        txt.includes("san francisco") || txt.includes("relocat")
      );
    });

    // Group by name attribute
    const groups = {};
    for (const r of officeRadios) {
      (groups[r.name] = groups[r.name] || []).push(r);
    }

    for (const [, radios] of Object.entries(groups)) {
      // Check if any radio in this group is already selected
      const anyChecked = radios.some(r => r.checked);
      if (anyChecked) continue;
      // Pick "open to relocation" if available, else first "yes"
      const reloc = radios.find(r => {
        const lbl = document.querySelector(`label[for="${r.id}"]`);
        return (lbl?.textContent || "").toLowerCase().includes("relocat");
      });
      const toClick = reloc || radios[0];
      if (toClick) { this.setRadio(toClick); }
    }
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  // React-safe value setter for Ashby's react-hook-form controlled inputs.
  //
  // Why all this ceremony: Ashby uses react-hook-form, which validates a
  // field as "empty" until the value passes through React's _valueTracker.
  // Without the tracker reset, React's onChange handler sees old value ===
  // new value and skips its update — so submit-time validation still thinks
  // the field is empty, and the user has to click into it to "wake it up".
  //
  // The sentinel-then-real-value trick forces the tracker to register a
  // change. focusin/focusout (bubbling versions of focus/blur) mark the
  // field as touched so react-hook-form runs onBlur validation.
  reactSet(el, value) {
    if (!el || value == null) return;
    try { el.focus(); } catch {}
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    // Reset _valueTracker to a sentinel so React detects the next setter call
    // as a real change (defeats the "value didn't change" optimization).
    if (el._valueTracker) {
      try { el._valueTracker.setValue("__autoresume_force_change__"); } catch {}
    }

    const proto = el.tagName.toLowerCase() === "textarea"
      ? window.HTMLTextAreaElement.prototype
      : window.HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }

    // InputEvent (with inputType) mimics a real keystroke — more reliable for
    // react-hook-form than plain Event("input").
    let inputEvent;
    try {
      inputEvent = new InputEvent("input", {
        bubbles: true,
        cancelable: true,
        data: String(value),
        inputType: "insertText",
      });
    } catch {
      inputEvent = new Event("input", { bubbles: true });
    }
    el.dispatchEvent(inputEvent);
    el.dispatchEvent(new Event("change", { bubbles: true }));

    // Blur cycle marks the field as touched so onBlur validators rerun and
    // the empty-required error clears.
    try { el.blur(); } catch {}
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  },

  // React-safe checkbox setter
  setCheckbox(el, checked) {
    if (el.checked === checked) return;
    el.click(); // click() toggles and fires all synthetic events
  },

  // React-safe radio setter
  setRadio(el) {
    if (!el.checked) el.click();
  },
};
