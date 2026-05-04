// Lever ATS module — jobs.lever.co/{company}/{id}/apply

window.__atsModule = {
  name: "lever",

  isApplicationForm() {
    return (
      window.location.pathname.includes("/apply") &&
      (
        !!document.querySelector("form.application-form") ||
        !!document.querySelector('[data-qa="btn-submit"]') ||
        !!document.querySelector('input[name="name"]') ||
        !!document.querySelector(".application-page")
      )
    );
  },

  async fill(personalInfo, formRules) {
    const filled = [];
    const unfilled = [];

    await AutoFill.sleep(1500);

    // ── Standard fields ──────────────────────────────────────────────────────

    const fullName = [personalInfo.name?.first, personalInfo.name?.last].filter(Boolean).join(" ");
    const nameEl = document.querySelector('input[name="name"], input[autocomplete="name"]');
    if (nameEl && fullName) { AutoFill.setValue(nameEl, fullName); filled.push("name"); }
    else {
      const f = document.querySelector('input[name="first_name"], input[autocomplete="given-name"]');
      const l = document.querySelector('input[name="last_name"],  input[autocomplete="family-name"]');
      if (f) { AutoFill.setValue(f, personalInfo.name?.first); filled.push("first_name"); }
      if (l) { AutoFill.setValue(l, personalInfo.name?.last);  filled.push("last_name");  }
      if (!f && !l && fullName) unfilled.push("name");
    }

    const emailEl = document.querySelector('input[name="email"], input[type="email"]');
    if (emailEl && personalInfo.email) { AutoFill.setValue(emailEl, personalInfo.email); filled.push("email"); }

    const phoneEl = document.querySelector('input[name="phone"], input[type="tel"]');
    if (phoneEl && personalInfo.phone) { AutoFill.setValue(phoneEl, personalInfo.phone); filled.push("phone"); }

    const orgEl = document.querySelector('input[name="org"], input[name="company"]');
    if (orgEl) {
      AutoFill.setValue(orgEl, personalInfo.current_company || personalInfo.education?.[0]?.school || "");
      filled.push("org");
    }

    const linkedinEl = document.querySelector('input[name="urls[LinkedIn]"], input[name*="linkedin" i]');
    if (linkedinEl && personalInfo.linkedin) { AutoFill.setValue(linkedinEl, personalInfo.linkedin); filled.push("linkedin"); }

    const githubEl = document.querySelector('input[name="urls[GitHub]"], input[name*="github" i]');
    if (githubEl && personalInfo.github) { AutoFill.setValue(githubEl, personalInfo.github); filled.push("github"); }

    const portfolioEl = document.querySelector('input[name="urls[Portfolio]"], input[name="urls[Other]"]');
    if (portfolioEl && personalInfo.website) { AutoFill.setValue(portfolioEl, personalInfo.website); filled.push("portfolio"); }

    const locationEl = document.querySelector('input[name="location"], input[id="location-input"]');
    if (locationEl && personalInfo.location) {
      AutoFill.setValue(locationEl, `${personalInfo.location.city}, ${personalInfo.location.state}`);
      filled.push("location");
    }

    // ── EEO selects (identified by name attribute, very reliable) ────────────
    this.fillEEO(personalInfo, filled);

    // ── Custom / compliance questions ────────────────────────────────────────
    this.fillCustomQuestions(personalInfo, formRules, filled, unfilled);

    return { filled, unfilled };
  },

  // ── EEO ───────────────────────────────────────────────────────────────────
  fillEEO(personalInfo, filled) {
    const gender = document.querySelector('select[name="eeo[gender]"]');
    if (gender) { AutoFill.selectOption(gender, personalInfo.gender || "Male"); filled.push("eeo_gender"); }

    const race = document.querySelector('select[name="eeo[race]"]');
    if (race) { AutoFill.selectOption(race, personalInfo.race_ethnicity || "Asian"); filled.push("eeo_race"); }

    const veteran = document.querySelector('select[name="eeo[veteran]"]');
    if (veteran) { AutoFill.selectOption(veteran, "I am not a veteran"); filled.push("eeo_veteran"); }

    const disability = document.querySelector('select[name="eeo[disability]"]');
    if (disability) { AutoFill.selectOption(disability, "No"); filled.push("eeo_disability"); }
  },

  // ── Custom questions ───────────────────────────────────────────────────────
  fillCustomQuestions(personalInfo, formRules, filled, unfilled) {
    const coreNames = new Set([
      "name", "email", "phone", "org", "location",
      "urls[LinkedIn]", "urls[GitHub]", "urls[Portfolio]", "urls[Other]",
      "eeo[gender]", "eeo[race]", "eeo[veteran]", "eeo[disability]",
    ]);

    const containers = document.querySelectorAll(".application-question, .custom-question");

    for (const q of containers) {
      // Skip core fields already handled above
      const firstInp = q.querySelector("input, textarea, select");
      if (!firstInp) continue;
      if (coreNames.has(firstInp.name)) continue;
      // Skip EEO divs (already handled)
      if (firstInp.name?.startsWith("eeo[")) continue;

      // Build context: section title + any non-radio body text
      const context = this.getContext(q);

      const hasRadios   = !!q.querySelector('input[type="radio"]');
      const hasSelect   = !!q.querySelector("select");
      const hasTextarea = !!q.querySelector("textarea");
      const hasText     = !!q.querySelector('input[type="text"], input:not([type])');

      // ── Work authorization (legaly authorized to work) ─────────────────────
      if (
        context.includes("work authorization") ||
        (context.includes("authorized") && context.includes("work")) ||
        (context.includes("legally") && context.includes("work")) ||
        (context.includes("eligible") && context.includes("work"))
      ) {
        // Two questions share the same section: field0 = work auth, field1 = sponsorship
        // Distinguish by field index in name attribute
        const fname = firstInp.name || "";
        const isSponsorship = fname.includes("field1") ||
          this.prevQuestionsInSection(q, containers) >= 1;

        if (isSponsorship) {
          if (hasRadios) this.pickRadio(q, "Yes");
          else if (firstInp) AutoFill.setValue(firstInp, "Yes");
          filled.push("sponsorship");
        } else {
          if (hasRadios) this.pickRadio(q, "Yes");
          else if (firstInp) AutoFill.setValue(firstInp, "Yes");
          filled.push("work_auth");
        }
        continue;
      }

      // ── Sponsorship (standalone section) ──────────────────────────────────
      if (
        context.includes("sponsorship") ||
        (context.includes("sponsor") && context.includes("visa")) ||
        (context.includes("require") && context.includes("visa"))
      ) {
        if (hasRadios) this.pickRadio(q, "Yes");
        else if (firstInp) AutoFill.setValue(firstInp, "Yes");
        filled.push("sponsorship");
        continue;
      }

      // ── Visa type ──────────────────────────────────────────────────────────
      if (context.includes("visa type") || context.includes("work authorization type")) {
        if (hasSelect) AutoFill.selectOption(q.querySelector("select"), personalInfo.work_authorization || "");
        else if (firstInp) AutoFill.setValue(firstInp, personalInfo.work_authorization || "");
        filled.push("visa_type");
        continue;
      }

      // ── Office / hybrid / in-person / on-site ─────────────────────────────
      if (
        context.includes("in office") || context.includes("in-office") ||
        context.includes("office expectation") || context.includes("on-site") ||
        context.includes("onsite") || context.includes("on site") ||
        context.includes("hybrid") || context.includes("commute") ||
        (context.includes("office") && context.includes("day")) ||
        (context.includes("setup") && context.includes("work")) ||
        (context.includes("align") && context.includes("environment")) ||
        context.includes("working environment") ||
        (context.includes("in person") && context.includes("work"))
      ) {
        if (hasRadios) this.pickRadio(q, "Yes");
        else if (firstInp) AutoFill.setValue(firstInp, "Yes");
        filled.push("office_expectation");
        continue;
      }

      // ── Relocation ────────────────────────────────────────────────────────
      if (context.includes("relocat")) {
        if (hasRadios) this.pickRadio(q, "Yes");
        else if (firstInp) AutoFill.setValue(firstInp, "Yes");
        filled.push("relocate");
        continue;
      }

      // ── Travel ────────────────────────────────────────────────────────────
      if (context.includes("travel")) {
        if (hasRadios) this.pickRadio(q, "Yes");
        else if (firstInp) AutoFill.setValue(firstInp, "Yes");
        filled.push("travel");
        continue;
      }

      // ── Salary ────────────────────────────────────────────────────────────
      if (context.includes("salary") || context.includes("compensation") || context.includes("pay expectation")) {
        const val = formRules?.numeric?.["expected / desired salary"] || "150000";
        if (hasText) AutoFill.setValue(q.querySelector('input[type="text"], input:not([type])'), val);
        else if (hasTextarea) AutoFill.setValue(q.querySelector("textarea"), val);
        filled.push("salary");
        continue;
      }

      // ── Source / referral ─────────────────────────────────────────────────
      if (context.includes("how did you hear") || context.includes("how did you find") ||
          (context.includes("where") && context.includes("learn") && context.includes("role"))) {
        if (hasSelect) AutoFill.selectOption(q.querySelector("select"), "LinkedIn");
        else if (firstInp) AutoFill.setValue(firstInp, "LinkedIn");
        filled.push("source");
        continue;
      }

      // ── GPA ───────────────────────────────────────────────────────────────
      if (context.includes("gpa") || context.includes("grade point")) {
        if (firstInp) AutoFill.setValue(firstInp, formRules?.numeric?.["gpa"] || "3.8");
        filled.push("gpa");
        continue;
      }

      // ── Standard "No" answers ─────────────────────────────────────────────
      const noPatterns = [
        "previously worked", "worked here before", "former employee",
        "know anyone at", "employee referral", "family member", "relative",
        "government official", "felony", "convicted",
        "non-compete", "non compete",
      ];
      const hitNo = noPatterns.find(p => context.includes(p));
      if (hitNo) {
        if (hasRadios) this.pickRadio(q, "No");
        else if (firstInp) AutoFill.setValue(firstInp, "No");
        filled.push(hitNo.substring(0, 30));
        continue;
      }

      // ── Open-ended / unknown → flag ───────────────────────────────────────
      if (hasTextarea || (hasRadios && context.length > 10)) {
        // Only flag if we have meaningful context (i.e. not already handled)
        const snippet = context.substring(0, 60).trim();
        if (snippet && snippet !== "yes" && snippet !== "no") {
          unfilled.push(`⚠️ UNFILLED: "${snippet}"`);
        }
      }
    }
  },

  // ── Helpers ───────────────────────────────────────────────────────────────

  // Build context string: section title + non-trivial body text
  // Relies on section title because Lever often puts the question description
  // in the section wrapper, not inside the <li> question container.
  getContext(container) {
    const parts = [];

    // 1. Walk up the DOM to find any ancestor with "section" in its class
    let el = container.parentElement;
    while (el && el !== document.body) {
      const cls = (el.className || "").toLowerCase();
      if (cls.includes("section") || el.tagName === "SECTION") {
        // Heading inside this ancestor (but outside our container)
        const h = el.querySelector("h1,h2,h3,h4,[class*='title'],[class*='header'],[class*='label']");
        if (h && !container.contains(h)) {
          parts.push(h.textContent.trim());
        }
        // Description <p> inside ancestor but outside container
        for (const p of el.querySelectorAll("p")) {
          if (!container.contains(p) && !p.closest(".application-question")) {
            const t = p.textContent.trim();
            if (t.length > 10) parts.push(t);
          }
        }
        break;
      }
      el = el.parentElement;
    }

    // 2. Any meaningful text inside the container that isn't a radio/checkbox label value
    for (const node of container.querySelectorAll("p, .question-body, legend, [class*='description'], [class*='prompt']")) {
      const t = node.textContent.trim();
      // Skip bare "Yes" / "No" strings — those are just option labels
      if (t && t.toLowerCase() !== "yes" && t.toLowerCase() !== "no" && t.length > 4) {
        parts.push(t);
        break;
      }
    }

    return parts.join(" ").toLowerCase();
  },

  // Count how many questions before `q` share the same section
  prevQuestionsInSection(q, allContainers) {
    let count = 0;
    const sec = this.findSection(q);
    for (const c of allContainers) {
      if (c === q) break;
      if (this.findSection(c) === sec) count++;
    }
    return count;
  },

  findSection(container) {
    let el = container.parentElement;
    while (el && el !== document.body) {
      if ((el.className || "").toLowerCase().includes("section") || el.tagName === "SECTION") return el;
      el = el.parentElement;
    }
    return null;
  },

  // Click the radio whose visible label text matches `answer` ("Yes" / "No")
  pickRadio(container, answer) {
    const radios = Array.from(container.querySelectorAll('input[type="radio"]'));
    if (!radios.length) return false;
    const target = answer.trim().toLowerCase();

    for (const radio of radios) {
      // Match by value attribute (Lever uses value="Yes" / value="No")
      if ((radio.value || "").trim().toLowerCase() === target) {
        if (!radio.checked) radio.click();
        return true;
      }
    }

    // Fallback: match by associated label or sibling text
    for (const radio of radios) {
      const lblEl = radio.id
        ? document.querySelector(`label[for="${radio.id}"]`)
        : radio.closest("label");
      const lblTxt = (lblEl?.textContent || "").trim().toLowerCase();
      if (lblTxt === target || lblTxt.startsWith(target)) {
        if (!radio.checked) radio.click();
        return true;
      }
      // Next sibling text node
      let sib = radio.nextSibling;
      while (sib) {
        const t = (sib.textContent || "").trim().toLowerCase();
        if (t === target) { if (!radio.checked) radio.click(); return true; }
        sib = sib.nextSibling;
      }
    }
    return false;
  },
};
