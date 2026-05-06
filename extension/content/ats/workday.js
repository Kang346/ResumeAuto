// Workday ATS module — multi-strategy selectors so we work across tenants
// that use either data-automation-id or id-based BEM selectors (e.g. NVIDIA).

window.__atsModule = {
  name: "workday",

  isApplicationForm() {
    return (
      window.location.href.includes("/apply") ||
      !!document.querySelector('[data-automation-id="jobApplicationForm"]') ||
      !!document.querySelector('[data-automation-id="legalNameSection_firstName"]') ||
      !!document.querySelector('[id$="--firstName"]')
    );
  },

  async fill(personalInfo, formRules) {
    const filled = [];
    const unfilled = [];

    await AutoFill.sleep(2000);

    // ---- Name ----
    await this.fillField(
      {
        automationId: "legalNameSection_firstName",
        idSuffix: "--firstName",
        autocomplete: "given-name",
        labelText: "First Name",
      },
      personalInfo.name?.first,
      "first_name",
      filled,
      unfilled
    );
    await this.fillField(
      {
        automationId: "legalNameSection_lastName",
        idSuffix: "--lastName",
        autocomplete: "family-name",
        labelText: "Last Name",
      },
      personalInfo.name?.last,
      "last_name",
      filled,
      unfilled
    );

    // ---- Contact ----
    await this.fillField(
      {
        automationId: "email",
        idIncludes: "email",
        autocomplete: "email",
        labelText: "Email",
      },
      personalInfo.email,
      "email",
      filled,
      unfilled
    );

    // ---- Address ----
    await this.fillField(
      {
        automationId: "addressSection_addressLine1",
        idSuffix: "--addressLine1",
        autocomplete: "address-line1",
        labelText: "Address Line 1",
      },
      personalInfo.location?.line1,
      "address_line1",
      filled,
      unfilled
    );
    await this.fillField(
      {
        automationId: "addressSection_addressLine2",
        idSuffix: "--addressLine2",
        autocomplete: "address-line2",
        labelText: "Address Line 2",
      },
      personalInfo.location?.line2,
      "address_line2",
      filled,
      unfilled
    );
    await this.fillField(
      {
        automationId: "addressSection_city",
        idSuffix: "--city",
        autocomplete: "address-level2",
        labelText: "City",
      },
      personalInfo.location?.city,
      "city",
      filled,
      unfilled
    );
    await this.fillField(
      {
        automationId: "addressSection_postalCode",
        idSuffix: "--postalCode",
        autocomplete: "postal-code",
        labelText: "Postal Code",
      },
      personalInfo.location?.zip,
      "postal_code",
      filled,
      unfilled
    );

    // ---- Country (top of address) ----
    await this.fillComboboxField(
      {
        automationId: "addressSection_countryRegion",
        idSuffix: "country--country",
        idIncludes: "country--country",
        labelText: "Country",
      },
      "United States",
      (text) => /united states/i.test(text),
      "country",
      filled,
      unfilled
    );

    // ---- State / Region ----
    await this.fillComboboxField(
      {
        automationId: "addressSection_region",
        idSuffix: "--countryRegion",
        idIncludes: "address--countryRegion",
        labelText: "State",
      },
      this.stateName(personalInfo.location?.state) || "",
      this.stateName(personalInfo.location?.state) || "",
      "state",
      filled,
      unfilled
    );

    // ---- Phone ----
    // Phone country code (combobox) — try first since Workday sometimes
    // resets the phone number when the country code changes.
    await this.fillComboboxField(
      {
        idSuffix: "--countryPhoneCode",
        idIncludes: "countryPhoneCode",
        labelText: "Phone Code",
      },
      "United States",
      (text) => /united states.*\+1|\+1\b/i.test(text),
      "phone_country_code",
      filled,
      unfilled
    );

    await this.fillField(
      {
        automationId: "phone-number",
        idSuffix: "--phoneNumber",
        autocomplete: "tel-national",
        labelText: "Phone Number",
      },
      personalInfo.phone,
      "phone",
      filled,
      unfilled
    );

    // Phone device type — try several labels in order
    await this.fillPhoneDeviceType(filled, unfilled);

    // ---- Source ("How did you hear about us?") ----
    await this.fillComboboxField(
      {
        automationId: "source",
        idIncludes: "source",
        labelText: "How did you hear",
      },
      "LinkedIn",
      "LinkedIn",
      "source",
      filled,
      unfilled
    );

    // ---- Step 2: My Experience (no-ops on step 1 because the sections
    //      and pre-rendered slots don't exist there) ----
    await this.fillWorkExperience(personalInfo.work_experience, filled, unfilled);
    await this.fillEducationEntries(personalInfo.education, filled, unfilled);
    await this.fillSkills(personalInfo.skills_list, filled, unfilled);

    // ---- LinkedIn URL ----
    const linkedinInput = AutoFill.findField({
      automationId: "linkedinUrl",
      idIncludes: "linkedin",
      placeholder: "linkedin",
      ariaLabel: "linkedin",
    });
    if (linkedinInput && personalInfo.linkedin) {
      AutoFill.setValue(linkedinInput, personalInfo.linkedin);
      filled.push("linkedin");
    }

    await this.fillQuestions(personalInfo, formRules, filled, unfilled);
    await this.fillEEO(personalInfo, filled, unfilled);

    return { filled, unfilled };
  },

  // ---- Multi-instance fillers (Workday Step 2 / "My Experience") ----

  // Scan all existing workExperience cards on the page and return them as
  // {prefix, title, company} objects. Used for rerun-aware logic.
  scanWorkExperienceCards() {
    return [...document.querySelectorAll('[id^="workExperience-"][id$="--jobTitle"]')]
      .map((el) => {
        const prefix = el.id.match(/^(workExperience-\d+)/)?.[1];
        const company = document.getElementById(`${prefix}--companyName`)?.value || "";
        return { prefix, title: el.value || "", company };
      })
      .filter((c) => c.prefix);
  },

  async fillWorkExperienceSlot(prefix, job) {
    const setById = (suffix, value) => {
      const el = document.getElementById(`${prefix}--${suffix}`);
      if (el && value != null && value !== "") AutoFill.setValue(el, value);
    };

    AutoFill.setValue(document.getElementById(`${prefix}--jobTitle`), job.title);
    setById("companyName", job.company);
    setById("location", job.location);

    // Currently-work-here checkbox. Use the defensive helper since Workday
    // sometimes wraps the real checkbox in a styled div.
    this.setCurrentlyWorkHere(prefix, !!job.current);

    // Date inputs — commitDateInput is async (awaits a tick for React, then
    // dispatches focusout/blur to commit to wrapper-level form state).
    const [sy, sm] = String(job.start || "").split("-");
    await this.commitDateInput(`${prefix}--startDate-dateSectionMonth-input`, sm);
    await this.commitDateInput(`${prefix}--startDate-dateSectionYear-input`, sy);
    if (!job.current && job.end) {
      const [ey, em] = String(job.end).split("-");
      await this.commitDateInput(`${prefix}--endDate-dateSectionMonth-input`, em);
      await this.commitDateInput(`${prefix}--endDate-dateSectionYear-input`, ey);
    } else if (job.current) {
      // Current job: ensure end date is cleared (in case a stale end date
      // from a previous buggy run leaked through).
      this.clearDateInput(`${prefix}--endDate-dateSectionMonth-input`);
      this.clearDateInput(`${prefix}--endDate-dateSectionYear-input`);
    }

    let desc;
    if (Array.isArray(job.bullets)) {
      desc = job.bullets.map((b) => `• ${b}`).join("\n");
    } else {
      desc = String(job.description || "");
    }
    const truncated = desc.length > 3950 ? desc.slice(0, 3950) + "..." : desc;
    setById("roleDescription", truncated);
  },

  async fillWorkExperience(workArray, filled, unfilled) {
    if (!Array.isArray(workArray) || workArray.length === 0) return;

    // Rerun-aware: scan existing cards FIRST. Three cases per personal_info entry:
    //   1. A card with matching title+company already exists → skip (push as
    //      "already present"), don't create a duplicate.
    //   2. An empty card exists (no title) → reuse it, don't click Add.
    //   3. No matching or empty card → click Add Another, fill the new slot.
    // This prevents the "rerun creates extra empty cards" bug.
    const usedPrefixes = new Set();
    const existingCards = this.scanWorkExperienceCards();

    for (let i = 0; i < workArray.length; i++) {
      const job = workArray[i] || {};

      // Case 1: already-correct card by title+company?
      const matchingCard = existingCards.find(
        (c) =>
          !usedPrefixes.has(c.prefix) &&
          c.title.trim() === String(job.title || "").trim() &&
          c.company.trim() === String(job.company || "").trim() &&
          c.title.trim().length > 0
      );
      if (matchingCard) {
        usedPrefixes.add(matchingCard.prefix);
        // Even though title/company match, force-patch state fields that
        // could be stale from a previous buggy run: currentlyWorkHere
        // checkbox and end date (when job.current=true).
        this.setCurrentlyWorkHere(matchingCard.prefix, !!job.current);
        if (job.current) {
          this.clearDateInput(`${matchingCard.prefix}--endDate-dateSectionMonth-input`);
          this.clearDateInput(`${matchingCard.prefix}--endDate-dateSectionYear-input`);
        }
        filled.push(`work_experience[${i}] (already present, state patched)`);
        continue;
      }

      // Case 2: empty card to reuse?
      const emptyCard = existingCards.find(
        (c) => !usedPrefixes.has(c.prefix) && !c.title.trim() && !c.company.trim()
      );
      let prefix;
      if (emptyCard) {
        prefix = emptyCard.prefix;
        usedPrefixes.add(prefix);
      } else {
        // Case 3: click Add to create a new slot. Use heading-bounded scoping —
        // the page has multiple "Add Another" buttons (one per subsection),
        // and a section-wide search picks the wrong one.
        const addBtn = AutoFill.findButtonBetweenHeadings(
          "Work Experience",
          "Education"
        );
        if (!addBtn) {
          unfilled.push(`work_experience[${i}]`);
          break;
        }
        AutoFill.realClick(addBtn);
        await AutoFill.sleep(800);

        const jobTitleInput = await this.waitForFreshSlot(
          '[id^="workExperience-"][id$="--jobTitle"]',
          /^(workExperience-\d+)/,
          usedPrefixes,
          4000
        );
        if (!jobTitleInput) {
          unfilled.push(`work_experience[${i}]`);
          continue;
        }
        prefix = jobTitleInput.id.match(/^(workExperience-\d+)/)[1];
        usedPrefixes.add(prefix);

        // Refresh existingCards in case Workday rendered the new card with
        // a prefix higher than what we already saw.
        existingCards.push({ prefix, title: "", company: "" });
      }

      await this.fillWorkExperienceSlot(prefix, job);
      filled.push(`work_experience[${i}]`);
    }
  },

  // Poll until a target input matching `selector` exists with a prefix
  // (extracted via `prefixRegex`) that isn't in `usedPrefixes`. Returns the
  // element or null on timeout.
  async waitForFreshSlot(selector, prefixRegex, usedPrefixes, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const candidates = [...document.querySelectorAll(selector)];
      const match = candidates.find((el) => {
        const p = el.id.match(prefixRegex)?.[1];
        return p && !usedPrefixes.has(p);
      });
      if (match) return match;
      await AutoFill.sleep(150);
    }
    return null;
  },

  scanEducationCards() {
    return [...document.querySelectorAll('[id^="education-"][id$="--schoolName"]')]
      .map((el) => {
        const prefix = el.id.match(/^(education-\d+)/)?.[1];
        return { prefix, school: el.value || "" };
      })
      .filter((c) => c.prefix);
  },

  async fillEducationSlot(prefix, edu) {
    // School name is a regular text input — Workday accepts it as free text.
    AutoFill.setValue(document.getElementById(`${prefix}--schoolName`), edu.school);

    const setById = (suffix, value) => {
      const el = document.getElementById(`${prefix}--${suffix}`);
      if (el && value != null && value !== "") AutoFill.setValue(el, value);
    };

    // Field of Study is NOT a plain text input — it's the same searchable
    // multiselect widget as the skills field. Have to type → Enter to search
    // → Space on the highlighted match to commit. Plain setValue gets the
    // text into the visual input but doesn't commit it as a tag, so Workday
    // treats the field as empty.
    const fosInput = document.getElementById(`${prefix}--fieldOfStudy`);
    if (fosInput && edu.major) {
      await this.fillSearchableMultiSelect(fosInput, edu.major);
    }

    if (edu.gpa) setById("gradeAverage", edu.gpa);

    const startYear = String(edu.start || "").match(/\d{4}/)?.[0];
    const endYear = String(edu.end || "").match(/\d{4}/)?.[0];
    const startMonth = String(edu.start || "").match(/-(\d{2})/)?.[1];
    const endMonth = String(edu.end || "").match(/-(\d{2})/)?.[1];

    // commitDateInput is async — focuses, sets value, then dispatches
    // focusout/blur after a tick so the wrapper-level form state commits.
    await this.commitDateInput(`${prefix}--firstYearAttended-dateSectionMonth-input`, startMonth);
    await this.commitDateInput(`${prefix}--firstYearAttended-dateSectionYear-input`, startYear);
    await this.commitDateInput(`${prefix}--lastYearAttended-dateSectionMonth-input`, endMonth);
    await this.commitDateInput(`${prefix}--lastYearAttended-dateSectionYear-input`, endYear);

    const degreeBtn = document.getElementById(`${prefix}--degree`);
    if (degreeBtn && edu.degree) {
      const target = /master/i.test(edu.degree) ? "Master"
        : /bachelor/i.test(edu.degree) ? "Bachelor"
        : /phd|doctor/i.test(edu.degree) ? "Doctorate"
        : edu.degree;
      await AutoFill.fillCombobox(degreeBtn, target, (text) =>
        text.toLowerCase().includes(target.toLowerCase())
      );
    }
  },

  // Set a date sub-input. Workday's date widget has TWO layers of state:
  //   - Inner input state (controls what `display` div shows)
  //   - Outer wrapper / form-level state (what Save and Continue validates)
  //
  // Native setter + input + change updates the inner layer (display shows
  // the value). To commit to the outer layer, the wrapper needs to see a
  // focus-leaving event — that's how Workday knows "user finished editing
  // this field, lock the value into form state".
  //
  // Sequence:
  //   1. focus the input (simulates user clicking in)
  //   2. native setter + input + change events (updates inner state, display)
  //   3. wait a tick so React processes the input event
  //   4. focusout (bubbles up to wrapper, triggers outer commit) + blur
  async commitDateInput(elementId, value) {
    if (value == null || value === "") return;
    const el = document.getElementById(elementId);
    if (!el) return;

    // Step 1: focus
    el.focus();
    el.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
    el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));

    // Step 2: set value
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, String(value));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(value) }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    // Step 3: let React's onChange propagate to wrapper state.
    await AutoFill.sleep(60);

    // Step 4: leave focus — focusout bubbles, blur doesn't, but we dispatch
    // both so wrapper-level listeners and input-level listeners fire.
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    el.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
    el.blur();
  },

  // Toggle the currentlyWorkHere checkbox to a desired state. Defensive against
  // the case where Workday wraps the actual checkbox in a styled div (in which
  // case AutoFill.setValue(el, true) is a no-op because element.type isn't
  // "checkbox" on the wrapper).
  setCurrentlyWorkHere(prefix, want) {
    const el = document.getElementById(`${prefix}--currentlyWorkHere`);
    if (!el) return;
    const realCb = el.type === "checkbox" ? el : el.querySelector('input[type="checkbox"]');
    if (realCb) {
      if (realCb.checked !== !!want) {
        AutoFill.realClick(realCb);
      }
    } else {
      // Styled div — toggle by clicking if aria-checked doesn't match.
      const isChecked = el.getAttribute("aria-checked") === "true";
      if (isChecked !== !!want) AutoFill.realClick(el);
    }
  },

  // Clear an end-date sub-input. Same minimal approach as commitDateInput.
  clearDateInput(elementId) {
    const el = document.getElementById(elementId);
    if (!el || !el.value) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    setter.call(el, "");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  },

  async fillEducationEntries(eduArray, filled, unfilled) {
    if (!Array.isArray(eduArray) || eduArray.length === 0) return;

    // Same rerun-aware strategy as fillWorkExperience:
    //   1. existing card with matching school name → skip
    //   2. empty card → reuse (covers the pre-rendered first slot)
    //   3. no match → click Add Another, fill new slot
    const usedPrefixes = new Set();
    const existingCards = this.scanEducationCards();

    for (let i = 0; i < eduArray.length; i++) {
      const edu = eduArray[i] || {};

      // Case 1: already-correct card?
      const matchingCard = existingCards.find(
        (c) =>
          !usedPrefixes.has(c.prefix) &&
          c.school.trim() === String(edu.school || "").trim() &&
          c.school.trim().length > 0
      );
      if (matchingCard) {
        usedPrefixes.add(matchingCard.prefix);
        filled.push(`education[${i}] (already present)`);
        continue;
      }

      // Case 2: empty card to reuse (includes Workday's pre-rendered first slot)?
      const emptyCard = existingCards.find(
        (c) => !usedPrefixes.has(c.prefix) && !c.school.trim()
      );
      let prefix;
      if (emptyCard) {
        prefix = emptyCard.prefix;
        usedPrefixes.add(prefix);
      } else {
        // Case 3: click Add Another. Use heading-bounded scoping — the page
        // has multiple "Add Another" buttons (one for Work Experience, one
        // for Education, etc.) and section-wide search picks the wrong one.
        const addBtn = AutoFill.findButtonBetweenHeadings("Education", "Skills");
        if (!addBtn) {
          unfilled.push(`education[${i}]`);
          break;
        }
        AutoFill.realClick(addBtn);
        await AutoFill.sleep(800);

        const target = await this.waitForFreshSlot(
          '[id^="education-"][id$="--schoolName"]',
          /^(education-\d+)/,
          usedPrefixes,
          4000
        );
        if (!target) {
          unfilled.push(`education[${i}]`);
          continue;
        }
        prefix = target.id.match(/^(education-\d+)/)[1];
        usedPrefixes.add(prefix);
        existingCards.push({ prefix, school: "" });
      }

      await this.fillEducationSlot(prefix, edu);
      filled.push(`education[${i}]`);
    }
  },

  // Skills field. Mirrors a real user's manual interaction, which on this
  // Workday tenant is a TWO-Enter pattern (verified empirically):
  //   1. Type the skill into the search input.
  //   2. Press Enter — this triggers the server-side search (Workday does NOT
  //      fetch on InputEvent alone, only on explicit Enter / search action).
  //   3. Wait for the dropdown to render with results; Workday auto-highlights
  //      the best match.
  //   4. Press Enter again — commits the highlighted match as a tag pill.
  //   5. Input clears; cursor stays / refocuses on the search input.
  //   6. Repeat for next skill.
  //
  // Strategy:
  //   1. Clear leftover, focus, type skill.
  //   2. 200ms settle (let typed text register).
  //   3. FIRST Enter — fires the search.
  //   4. Wait 800ms for dropdown to render with results.
  //   5. Verify a matching [data-automation-id="promptOption"] exists
  //      (proof results came back). If not, skill isn't in the catalog →
  //      bail without the second Enter (avoids weird state).
  //   6. 200ms more — let auto-highlight settle on the matched item.
  //   7. SECOND Enter — commits.
  //   8. Wait up to 2s for input.value to clear (commit signal).
  //   9. NEVER click as a fallback — clicks toggle (select → deselect).
  //  10. 300ms cooldown between skills.
  async fillSkills(skillsList, filled, unfilled) {
    if (!Array.isArray(skillsList) || skillsList.length === 0) return;

    const input = document.getElementById("skills--skills");
    if (!input) {
      unfilled.push("skills");
      return;
    }

    const cap = Math.min(skillsList.length, 15);
    const added = [];
    const skipped = [];

    for (let i = 0; i < cap; i++) {
      const skill = skillsList[i];
      const ok = await this.tryAddSkill(input, skill);
      if (ok) added.push(skill);
      else skipped.push(skill);
      await AutoFill.sleep(300); // settle between skills
    }

    if (added.length) filled.push(`skills (${added.length}/${cap})`);
    if (skipped.length) unfilled.push(`skills_skipped: ${skipped.join(", ")}`);
  },

  // The Workday skills dropdown is a multi-select with checkboxes. Each row
  // is a [data-automation-id="menuItem"][role="option"] inside the container
  // [data-automation-id="activeListContainer"]. The highlighted (active) row
  // has aria-selected="true". CLICKING a row toggles its checkbox — checking
  // it commits the skill as a tag. (DO NOT confuse this with promptOption,
  // which is a child element used internally by Workday's renderer.)
  findSkillSuggestions() {
    const container = document.querySelector('[data-automation-id="activeListContainer"]');
    if (!container) return [];
    return [...container.querySelectorAll('[data-automation-id="menuItem"][role="option"]')]
      .filter((el) => {
        const text = (el.textContent || "").trim().split("\n")[0].trim();
        return text && text !== "No Items.";
      });
  },

  // Find the row Workday auto-highlighted (aria-selected="true").
  findHighlightedSkillRow() {
    const container = document.querySelector('[data-automation-id="activeListContainer"]');
    if (!container) return null;
    return container.querySelector('[data-automation-id="menuItem"][role="option"][aria-selected="true"]');
  },

  pickBestSuggestion(suggestions, skill) {
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, "").trim();
    const want = norm(skill);
    return (
      suggestions.find((s) => norm(s.textContent) === want) ||
      suggestions.find((s) => norm(s.textContent).startsWith(want)) ||
      suggestions.find((s) => norm(s.textContent).includes(want)) ||
      null
    );
  },

  // Generic "type into Workday searchable multiselect, find the highlighted
  // match, commit via Space". Used for skills--skills AND for any other
  // searchable multiselect widget on a Workday form (e.g. education's
  // fieldOfStudy is the same widget, not a plain text input).
  //
  // Returns true if a tag/item was committed within the timeout, false if
  // the search returned nothing matching or the commit didn't take.
  async fillSearchableMultiSelect(input, value) {
    if (!input || !value) return false;

    if (input.value) {
      AutoFill.setValue(input, "");
      await AutoFill.sleep(150);
    }

    input.focus();
    AutoFill.setValue(input, value);
    await AutoFill.sleep(200);

    // Press Enter on the input to trigger Workday's server search.
    const ev = (type, opts) => new KeyboardEvent(type, { ...opts, bubbles: true });
    input.dispatchEvent(ev("keydown", { key: "Enter", code: "Enter", keyCode: 13, which: 13 }));
    input.dispatchEvent(ev("keyup",   { key: "Enter", code: "Enter", keyCode: 13, which: 13 }));

    // Poll up to 2.5s for a matching highlighted menuItem to render.
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, "").trim();
    const want = norm(value);
    let highlighted = null;
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const container = document.querySelector('[data-automation-id="activeListContainer"]');
      if (container) {
        // First try the auto-highlighted row.
        const auto = container.querySelector('[data-automation-id="menuItem"][role="option"][aria-selected="true"]');
        if (auto && this.skillRowMatches(auto, want)) {
          highlighted = auto;
          break;
        }
        // Fall back to any matching row (preferring exact, then prefix, then contains).
        const rows = [...container.querySelectorAll('[data-automation-id="menuItem"][role="option"]')]
          .filter((el) => {
            const t = (el.textContent || "").trim().split("\n")[0].trim();
            return t && t !== "No Items.";
          });
        const exact = rows.find((r) => norm(r.textContent.split("\n")[0]) === want);
        const prefix = rows.find((r) => norm(r.textContent.split("\n")[0]).startsWith(want));
        const contains = rows.find((r) => norm(r.textContent.split("\n")[0]).includes(want));
        const match = exact || prefix || contains;
        if (match) {
          highlighted = match;
          break;
        }
      }
      await AutoFill.sleep(150);
    }

    if (!highlighted) {
      AutoFill.setValue(input, "");
      return false;
    }

    // Press Space on the focused menuItem to toggle the checkbox = commit.
    AutoFill.pressSpace(highlighted);

    // Wait up to 2s for input.value to clear (commit signal).
    const commitDeadline = Date.now() + 2000;
    while (Date.now() < commitDeadline) {
      if (!input.value) return true;
      await AutoFill.sleep(100);
    }

    AutoFill.setValue(input, "");
    return false;
  },

  skillRowMatches(rowEl, normalizedWant) {
    const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9+#./ ]/g, "").trim();
    const text = norm((rowEl.textContent || "").split("\n")[0]);
    return text === normalizedWant || text.startsWith(normalizedWant) || text.includes(normalizedWant);
  },

  // Thin wrapper for the skills field — the public API stays the same.
  async tryAddSkill(input, skill) {
    return this.fillSearchableMultiSelect(input, skill);
  },

  // Convert a 2-letter state code to full name (Workday dropdowns want full names).
  stateName(code) {
    if (!code) return null;
    const map = {
      AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
      CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
      HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
      KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
      MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
      MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
      NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
      OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
      SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
      VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
      DC: "District of Columbia",
    };
    return map[code.toUpperCase()] || code;
  },

  async fillField(specs, value, fieldName, filled, unfilled) {
    if (value == null || value === "" || /^REPLACE_WITH/i.test(String(value))) {
      unfilled.push(fieldName);
      return;
    }
    const el = AutoFill.findField(specs);
    if (!el) {
      unfilled.push(fieldName);
      return;
    }
    const input = el.tagName === "INPUT" || el.tagName === "TEXTAREA"
      ? el
      : el.querySelector("input, textarea") || el;
    if (input.tagName !== "INPUT" && input.tagName !== "TEXTAREA") {
      unfilled.push(fieldName);
      return;
    }
    AutoFill.setValue(input, value);
    filled.push(fieldName);
  },

  async fillComboboxField(specs, searchValue, optionMatch, fieldName, filled, unfilled) {
    if (!searchValue) {
      unfilled.push(fieldName);
      return;
    }
    let trigger = AutoFill.findField(specs);
    if (!trigger) {
      unfilled.push(fieldName);
      return;
    }
    // findField may return an inner input — for Workday comboboxes we want
    // the button or [role=combobox] container.
    if (trigger.tagName === "INPUT" || trigger.tagName === "TEXTAREA") {
      const container =
        trigger.closest('[role="combobox"], button, [data-automation-id]') ||
        trigger.parentElement;
      if (container) trigger = container;
    }
    const ok = await AutoFill.fillCombobox(trigger, searchValue, optionMatch);
    if (ok) filled.push(fieldName);
    else unfilled.push(fieldName);
  },

  async fillPhoneDeviceType(filled, unfilled) {
    const trigger = AutoFill.findField({
      idSuffix: "--phoneType",
      idIncludes: "phoneType",
      automationId: "phone-device-type",
      labelText: "Phone Device Type",
    });
    if (!trigger) {
      unfilled.push("phone_device_type");
      return;
    }
    const triggerEl = (trigger.tagName === "INPUT" || trigger.tagName === "TEXTAREA")
      ? trigger.closest('[role="combobox"], button, [data-automation-id]') || trigger.parentElement
      : trigger;

    // Try mobile/cell synonyms in order.
    const candidates = ["Mobile", "Cell", "Cellular", "Home Cellular", "Personal Cell"];
    for (const candidate of candidates) {
      const ok = await AutoFill.fillCombobox(triggerEl, "", (text) =>
        text.toLowerCase().includes(candidate.toLowerCase())
      );
      if (ok) {
        filled.push("phone_device_type");
        return;
      }
    }
    unfilled.push("phone_device_type");
  },

  async fillQuestions(personalInfo, formRules, filled, unfilled) {
    // Workday uses several container patterns for questions across different
    // pages. Application Questions step uses formField-*; My Information
    // step uses inline question containers; older tenants use css-1wc3gq1.
    const containerSelectors = [
      '[data-automation-id^="formField-"]',
      '[data-automation-id*="question" i]',
      '.css-1wc3gq1',
    ];
    const containers = new Set();
    for (const sel of containerSelectors) {
      for (const el of document.querySelectorAll(sel)) containers.add(el);
    }

    // Skip containers we've handled in Step 1/2 (name, address, phone, dates).
    // Those have specific id patterns; question fields don't.
    const skipIfDescendantSelector =
      '[id*="legalName"], [id*="addressLine"], [id*="phoneNumber"], [id*="--firstName"], [id*="--lastName"], [id*="dateSection"], [id*="--workExperience"], [id*="--education"], [id*="--currentlyWorkHere"], [id="skills--skills"]';

    const seenLabelTexts = new Set();

    for (const container of containers) {
      // Skip if this container is a Step-1/2 field we already handle.
      if (container.querySelector(skipIfDescendantSelector)) continue;

      const labelEl = container.querySelector(
        "label, legend, [data-automation-id*='label'], [data-automation-id*='Label']"
      );
      if (!labelEl) continue;
      const text = labelEl.textContent.trim().toLowerCase();
      if (!text || seenLabelTexts.has(text)) continue;
      seenLabelTexts.add(text);

      // CRITICAL: prefer combobox button over input.
      // Workday wraps every dropdown question with BOTH a hidden <input> (the
      // backing form field) AND a visible <button aria-haspopup="listbox">.
      // Setting input.value via setValue does NOT update Workday's React state —
      // the React state is bound to the button. The button must be opened and
      // an option clicked for Workday to register the answer.
      const comboboxEl = container.querySelector(
        "button[aria-haspopup='listbox'], button[aria-haspopup], [role='combobox']"
      );
      const inputEl = !comboboxEl
        ? container.querySelector(
            "input:not([type='hidden']):not([type='file']), select, textarea"
          )
        : null;
      if (!inputEl && !comboboxEl) continue;

      const apply = async (answer) => {
        if (comboboxEl) {
          await AutoFill.fillCombobox(comboboxEl, answer, (txt) =>
            txt.trim().toLowerCase() === String(answer).toLowerCase()
          );
        } else if (inputEl) {
          AutoFill.setValue(inputEl, answer);
        }
      };

      if (text.includes("authorized") && text.includes("work")) {
        await apply("Yes");
        filled.push("work_auth");
        continue;
      }
      if (text.includes("sponsorship") || text.includes("sponsor")) {
        await apply("Yes");
        filled.push("sponsorship");
        continue;
      }
      if (text.includes("previously worked") || text.includes("worked.*before") || /worked.*employee/i.test(text)) {
        await apply("No");
        filled.push("previous_employment");
        continue;
      }

      let matched = false;
      if (formRules.yes_no_defaults) {
        for (const [pattern, answer] of Object.entries(formRules.yes_no_defaults)) {
          if (text.includes(pattern.toLowerCase())) {
            await apply(answer);
            filled.push(pattern.substring(0, 30));
            matched = true;
            break;
          }
        }
      }
      if (matched) continue;

      if (formRules.location_logistics) {
        for (const [pattern, answer] of Object.entries(formRules.location_logistics)) {
          if (text.includes(pattern.toLowerCase())) {
            await apply(answer);
            filled.push(pattern.substring(0, 30));
            matched = true;
            break;
          }
        }
      }
    }
  },

  // ============================================================
  //  Generic question filler — widget-type-agnostic dispatcher.
  // ============================================================
  // Tries each widget pattern in order:
  //   1. Native <select>
  //   2. Workday combobox button (aria-haspopup="listbox")
  //   3. Radio button group
  //   4. Checkbox group (one-of-N "please check one box" pattern)
  //   5. Workday menuItem listbox (skill-style multiselect)
  //
  // labelMatch: (accumulatedLabel) => boolean. Decides whether a widget on
  //   the page is the question we're trying to answer.
  // optionMatch: (optionText) => boolean. Decides which option among the
  //   widget's choices is the right answer.
  // commitLabel: string. Used as the search input for combobox typeahead
  //   (e.g. "Asian"), and as the human-readable label in `filled`.
  async fillFormQuestion(labelMatch, optionMatch, commitLabel) {
    // 1. Native <select>
    for (const sel of document.querySelectorAll("select")) {
      const lbl = AutoFill.findAccumulatedLabel(sel);
      if (!labelMatch(lbl)) continue;
      const opt = [...sel.options].find((o) => optionMatch(o.textContent || ""));
      if (opt) {
        sel.value = opt.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        sel.dispatchEvent(new Event("input", { bubbles: true }));
        return { ok: true, widget: "select", commitLabel };
      }
    }

    // 2. Workday combobox button
    for (const btn of document.querySelectorAll('button[aria-haspopup="listbox"], button[aria-haspopup]')) {
      const lbl = AutoFill.findAccumulatedLabel(btn);
      if (!labelMatch(lbl)) continue;
      const ok = await AutoFill.fillCombobox(btn, commitLabel || "", optionMatch);
      if (ok) return { ok: true, widget: "combobox", commitLabel };
    }

    // 3. Radio group — group radios by name, then check accumulated label of
    //    one representative radio.
    const radioGroups = new Map();
    for (const radio of document.querySelectorAll('input[type="radio"]')) {
      const key = radio.name || radio.closest("fieldset")?.id || `r_${radio.id}`;
      if (!radioGroups.has(key)) radioGroups.set(key, []);
      radioGroups.get(key).push(radio);
    }
    for (const radios of radioGroups.values()) {
      if (!radios.length) continue;
      const groupLbl = AutoFill.findAccumulatedLabel(radios[0]);
      if (!labelMatch(groupLbl)) continue;
      const target = radios.find((r) => optionMatch(AutoFill.findInputLabel(r)));
      if (target) {
        AutoFill.realClick(target);
        return { ok: true, widget: "radio_group", commitLabel };
      }
    }

    // 4. Checkbox group — find checkboxes that share an accumulated label
    //    matching this question. For one-of-N "please check one box" patterns.
    //    We DON'T uncheck others — Workday's group state usually allows only
    //    one checked box anyway.
    const seenGroups = new Set();
    for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
      const groupLbl = AutoFill.findAccumulatedLabel(cb);
      if (seenGroups.has(groupLbl)) continue;
      seenGroups.add(groupLbl);
      if (!labelMatch(groupLbl)) continue;
      // Collect siblings sharing the same group label
      const siblings = [...document.querySelectorAll('input[type="checkbox"]')]
        .filter((c) => AutoFill.findAccumulatedLabel(c) === groupLbl);
      const target = siblings.find((c) => optionMatch(AutoFill.findInputLabel(c)));
      if (target) {
        if (!target.checked) AutoFill.realClick(target);
        return { ok: true, widget: "checkbox_group", commitLabel };
      }
    }

    // 5. Workday menuItem listbox (skill-style)
    const containers = document.querySelectorAll('[data-automation-id="activeListContainer"]');
    for (const container of containers) {
      const lbl = AutoFill.findAccumulatedLabel(container);
      if (!labelMatch(lbl)) continue;
      const items = [...container.querySelectorAll('[data-automation-id="menuItem"][role="option"]')];
      const target = items.find((it) => optionMatch((it.textContent || "").trim().split("\n")[0]));
      if (target) {
        AutoFill.pressSpace(target);
        return { ok: true, widget: "menuItem_listbox", commitLabel };
      }
    }

    return { ok: false };
  },

  async fillEEO(personalInfo, filled, unfilled) {
    const gender = personalInfo.gender || "Male";
    const race = personalInfo.race_ethnicity || "Asian";

    // Each EEO question is a (labelMatch, optionMatch, commitLabel) triple.
    // The fillFormQuestion dispatcher handles whether the widget is a select,
    // combobox, radio group, checkbox group, or menuItem listbox.
    const questions = [
      {
        name: "gender",
        labelMatch: (l) => l.includes("gender"),
        optionMatch: (txt) => txt.trim().toLowerCase() === gender.toLowerCase(),
        commitLabel: gender,
      },
      {
        // Race / combined Race+Ethnicity. Two Workday layouts:
        //   A (older): separate "Race" + "Hispanic or Latino?" dropdowns
        //   B (NVIDIA): single "Ethnicity" dropdown whose options combine the
        //              two ("Asian (Not Hispanic or Latino)")
        // The labelMatch catches either; the optionMatch covers both formats.
        name: "race",
        labelMatch: (l) =>
          (l.includes("race") || l.includes("ethnicit")) &&
          !/are you hispanic|are you latino/i.test(l),
        optionMatch: (txt) => {
          const t = txt.toLowerCase().trim();
          const want = race.toLowerCase();
          return t === want || t.startsWith(want + " ") || t.startsWith(want + "(");
        },
        commitLabel: race,
      },
      {
        // Separate Hispanic/Latino Yes/No question (Layout A only).
        name: "hispanic",
        labelMatch: (l) => /are you hispanic|are you latino|hispanic or latino\?/i.test(l),
        optionMatch: (txt) => /^no(\b|,)/i.test(txt.trim()),
        commitLabel: "No",
      },
      {
        name: "veteran",
        labelMatch: (l) => l.includes("veteran"),
        optionMatch: (txt) => {
          const t = txt.toLowerCase();
          // Reject options affirming vet status
          if (/i identify|^i am a protected|^yes,? i am a (veteran|protected)/i.test(t)) return false;
          // Accept "not a veteran" / "I am not a protected veteran" / "No, I am not"
          return /not a protected veteran|i am not a (veteran|protected)|^no,? i am not/i.test(t);
        },
        commitLabel: "Not a veteran",
      },
      {
        name: "disability",
        labelMatch: (l) => l.includes("disability"),
        // The Self-Identify form (CC-305) uses three checkboxes:
        //   "Yes, I have a disability..."
        //   "No, I do not have a disability and have not had one in the past"
        //   "I do not want to answer"
        // We want the second one — must START with "no" to avoid the "I do
        // not want to answer" trap (which contains "do not" but not "no").
        optionMatch: (txt) => /^no,? i do not have/i.test(txt.trim()),
        commitLabel: "No disability",
      },
    ];

    for (const q of questions) {
      const result = await this.fillFormQuestion(q.labelMatch, q.optionMatch, q.commitLabel);
      if (result.ok) {
        filled.push(`${q.name} → ${q.commitLabel} (${result.widget})`);
      }
    }

    // Self-Identify (CC-305) form has signature fields that aren't covered
    // by fillFormQuestion (text + date inputs, not multi-choice questions).
    await this.fillSelfIdentifySignature(personalInfo, filled, unfilled);
  },

  // Fill the Name + Date signature on the CC-305 Voluntary Self-Identification
  // of Disability form. The page also has an "Employee ID (if applicable)"
  // text input which we leave blank — applicants don't have employee IDs yet.
  async fillSelfIdentifySignature(personalInfo, filled, unfilled) {
    // Only run if this page is actually the Self-Identify form.
    const onSelfIdentify = [...document.querySelectorAll("h1, h2, h3, h4")]
      .some((h) => /voluntary self.?identification|self.identify/i.test((h.textContent || "").trim()));
    if (!onSelfIdentify) return;

    const fullName = `${personalInfo.name?.first || ""} ${personalInfo.name?.last || ""}`.trim();
    const today = new Date();
    const dateStr = `${String(today.getMonth() + 1).padStart(2, "0")}/${String(today.getDate()).padStart(2, "0")}/${today.getFullYear()}`;

    // Name field — labelMatch picks up "Name *" inside a Self-Identification
    // section (accumulated label includes both the input's own "Name" label
    // AND the section heading mentioning self-identification).
    const nameMatched = await this.fillLabeledTextField(
      (l) =>
        /\bname\b/i.test(l) &&
        /voluntary self.?identification|self.identif/i.test(l) &&
        // Don't match Legal Name from step 1 or Preferred Name fields
        !/legal name|preferred|first name|last name/i.test(l),
      fullName
    );
    if (nameMatched) filled.push(`self_identify_name → ${fullName}`);

    // Date field. CC-305 uses Workday's split date widget (Month/Day/Year
    // sub-inputs inside a [data-automation-id="dateInputWrapper"]) — same
    // pattern as step 2 work-experience dates. Find the Self-Identify date
    // wrapper, commit each sub-input individually so wrapper-state locks in.
    const dateWrapper = [...document.querySelectorAll('[data-automation-id="dateInputWrapper"]')]
      .find((w) => {
        const lbl = AutoFill.findAccumulatedLabel(w);
        return (
          /voluntary self.?identif|self.identif/i.test(lbl) &&
          // Skip wrappers that are obviously something else
          !/start date|end date|expires|date of birth/i.test(lbl)
        );
      });
    if (dateWrapper) {
      const ok = await this.fillSplitDate(dateWrapper, dateStr);
      if (ok) filled.push(`self_identify_date → ${dateStr}`);
    }
  },

  // Generic split-date filler. Workday wraps MM/DD/YYYY (or MM/YYYY) in a
  // single dateInputWrapper with separate dateSection{Month,Day,Year}-input
  // sub-inputs. Each sub-input must be committed via the focus → set →
  // focusout sequence (commitDateInput) for the wrapper to lock in form-state.
  async fillSplitDate(wrapper, dateStr) {
    if (!wrapper || !dateStr) return false;
    // Accept "YYYY-MM" / "YYYY-MM-DD" / "MM/DD/YYYY" inputs.
    let mm, dd, yyyy;
    if (dateStr.includes("/")) {
      [mm, dd, yyyy] = dateStr.split("/");
    } else if (dateStr.includes("-")) {
      const parts = dateStr.split("-");
      yyyy = parts[0]; mm = parts[1]; dd = parts[2];
    }

    const monthInput = wrapper.querySelector('[data-automation-id="dateSectionMonth-input"]');
    const dayInput = wrapper.querySelector('[data-automation-id="dateSectionDay-input"]');
    const yearInput = wrapper.querySelector('[data-automation-id="dateSectionYear-input"]');

    if (monthInput && mm) await this.commitDateInput(monthInput.id, mm);
    if (dayInput && dd) await this.commitDateInput(dayInput.id, dd);
    if (yearInput && yyyy) await this.commitDateInput(yearInput.id, yyyy);

    // Wrapper-level commit: some Workday tenants additionally need a
    // focusout/change on the wrapper to recompute the composite date value.
    wrapper.dispatchEvent(new Event("change", { bubbles: true }));
    wrapper.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    return !!(monthInput && yearInput);
  },

  // Generic labeled-text-field filler — finds an input whose accumulated label
  // matches the predicate and writes the value. For date inputs, dispatches
  // focusout after setValue so Workday commits to wrapper state (same trick
  // we use for split date inputs).
  async fillLabeledTextField(labelMatch, value, opts = {}) {
    if (value == null || value === "") return false;

    for (const input of document.querySelectorAll(
      "input[type='text'], input:not([type]), textarea"
    )) {
      const lbl = AutoFill.findAccumulatedLabel(input);
      if (!labelMatch(lbl)) continue;
      if (input.value && input.value === value) return true; // already correct

      input.focus();
      AutoFill.setValue(input, value);

      if (opts.isDate) {
        // Date inputs need focus to leave for Workday to commit form-state.
        await AutoFill.sleep(60);
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        input.dispatchEvent(new FocusEvent("blur", { bubbles: false }));
        input.blur();
      }
      return true;
    }
    return false;
  },
};
