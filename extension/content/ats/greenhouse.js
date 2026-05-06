// Greenhouse ATS module — standard HTML forms

window.__atsModule = {
  name: "greenhouse",

  isApplicationForm() {
    return (
      // Older boards.greenhouse.io: <form id="application_form">
      !!document.querySelector("#application_form") ||
      // Newer job-boards.greenhouse.io: <form id="application-form" class="application--form">
      !!document.querySelector("#application-form") ||
      !!document.querySelector("form.application--form") ||
      !!document.querySelector('form[action*="application"]') ||
      !!document.querySelector("#s2_progressive") ||
      window.location.hash.includes("application")
    );
  },

  async fill(personalInfo, formRules) {
    const filled = [];
    const unfilled = [];

    // Wait for form to be ready
    await AutoFill.sleep(1000);

    // Direct ID-based fields
    const fieldMap = {
      "#first_name": personalInfo.name?.first,
      "#last_name": personalInfo.name?.last,
      "#email": personalInfo.email,
      "#phone": personalInfo.phone,
      "#job_application_location": `${personalInfo.location?.city}, ${personalInfo.location?.state}`,
    };

    for (const [selector, value] of Object.entries(fieldMap)) {
      const el = document.querySelector(selector);
      if (el && value) {
        AutoFill.setValue(el, value);
        filled.push(selector.replace("#", ""));
      } else if (value) {
        unfilled.push(selector.replace("#", ""));
      }
    }

    // LinkedIn field. Modern job-boards.greenhouse.io collapses URL inputs
    // under generated question_* ids with null name/autocomplete; the only
    // stable identity hook is aria-label (or the linked <label>).
    const linkedinInput = document.querySelector(
      'input[name*="linkedin" i], input[id*="linkedin" i], ' +
      'input[autocomplete*="linkedin" i], input[aria-label*="linkedin" i]'
    ) || (() => {
      for (const lbl of document.querySelectorAll("label")) {
        if (/linkedin/i.test(lbl.textContent)) {
          const id = lbl.getAttribute("for");
          if (id) {
            const el = document.getElementById(id);
            if (el) return el;
          }
        }
      }
      return null;
    })();
    if (linkedinInput && personalInfo.linkedin) {
      AutoFill.setValue(linkedinInput, personalInfo.linkedin);
      filled.push("linkedin");
    } else if (personalInfo.linkedin) {
      unfilled.push("linkedin");
    }

    // Phone country flag (intl-tel-input on job-boards.greenhouse.io). Run
    // before fillLabeledFields so its dialog doesn't conflict with later
    // listboxes opened by fillEEO.
    await this.fillPhoneCountry(personalInfo, filled, unfilled);

    // Education entries — drives off personalInfo.education[], handles
    // multi-row "Add another" on modern job-boards.greenhouse.io.
    await this.fillEducation(personalInfo, filled, unfilled);

    // Remaining labeled fields (GPA, salary, yes/no defaults). School/Degree
    // are handled in fillEducation above.
    await this.fillLabeledFields(personalInfo, formRules, filled, unfilled);

    // Work authorization dropdowns / radios
    this.fillWorkAuth(personalInfo, formRules, filled, unfilled);

    // EEO section — dispatches between native <select> (legacy) and
    // react-select combobox (modern job-boards.greenhouse.io)
    await this.fillEEO(personalInfo, filled, unfilled);

    // "How did you hear about this position?"
    this.fillSource(filled, unfilled);

    return { filled, unfilled };
  },

  // Modern job-boards.greenhouse.io renders one repeated sub-form per
  // education entry, with stable id pattern: school--{i}, degree--{i},
  // start-year--{i}, end-year--{i}. Clicking <button class="add-another-button">
  // materialises the next index. Drive off personalInfo.education[] so all
  // entries get filled rather than label-scanning (which only catches [0]).
  async fillEducation(personalInfo, filled, unfilled) {
    const edus = personalInfo.education || [];
    if (edus.length === 0) return;

    // Modern UI sentinel — if the indexed school input isn't present we're
    // probably on legacy boards.greenhouse.io; let fillLabeledFields handle
    // its single school/degree the old way (the school/degree branches were
    // removed from fillLabeledFields, so legacy will need a follow-up; for
    // now this returns silently).
    if (!document.getElementById("school--0")) return;

    for (let i = 0; i < edus.length; i++) {
      if (i > 0) {
        const btn = document.querySelector("button.add-another-button");
        if (!btn) break;
        btn.click();
        const appeared = await AutoFill.waitFor(`#school--${i}`, 3000);
        if (!appeared) {
          unfilled.push(`education[${i}]`);
          break;
        }
        // small settle so the new sub-form's other inputs are also mounted
        await AutoFill.sleep(200);
      }

      const edu = edus[i];

      const school = document.getElementById(`school--${i}`);
      if (school && edu.school) {
        const r = await AutoFill.fillReactSelect(school, edu.school, `school[${i}]`);
        if (r.ok) filled.push(`school[${i}]`);
        else unfilled.push(`school[${i}]`);
        await AutoFill.sleep(200);
      }

      const degree = document.getElementById(`degree--${i}`);
      if (degree && edu.degree) {
        // Greenhouse's degree dropdown uses level-only labels
        // ("Master's Degree", "Bachelor's Degree", "Doctorate"). Map
        // resume-style "Master of Science" → "Master's Degree" by first word.
        const degreeMap = { master: "Master's Degree", bachelor: "Bachelor's Degree", doctor: "Doctorate" };
        const key = String(edu.degree).toLowerCase().split(/[\s.,]/)[0];
        const r = await AutoFill.fillReactSelect(degree, degreeMap[key] || edu.degree, `degree[${i}]`);
        if (r.ok) filled.push(`degree[${i}]`);
        else unfilled.push(`degree[${i}]`);
        await AutoFill.sleep(200);
      }

      // Year inputs are <input type="number">. personalInfo.education stores
      // dates as "YYYY-MM"; take just the year. Skip end-year when null
      // (current/in-progress).
      const sy = document.getElementById(`start-year--${i}`);
      if (sy && edu.start) {
        AutoFill.setValue(sy, String(edu.start).split("-")[0]);
        filled.push(`start year[${i}]`);
      }

      const ey = document.getElementById(`end-year--${i}`);
      if (ey && edu.end) {
        AutoFill.setValue(ey, String(edu.end).split("-")[0]);
        filled.push(`end year[${i}]`);
      }
    }
  },

  async fillLabeledFields(personalInfo, formRules, filled, unfilled) {
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      const text = label.textContent.trim().toLowerCase();
      const inputId = label.getAttribute("for");
      const input = inputId
        ? document.getElementById(inputId)
        : label.querySelector("input, select, textarea");
      if (!input) continue;

      // GPA
      if (text.includes("gpa")) {
        AutoFill.setValue(input, formRules.numeric?.["gpa"] || "3.8");
        filled.push("gpa");
      }

      // Salary
      if (text.includes("salary") || text.includes("compensation")) {
        AutoFill.setValue(
          input,
          formRules.numeric?.["expected / desired salary"] || "150000"
        );
        filled.push("salary");
      }

      // Yes/No defaults from form_rules
      if (formRules.yes_no_defaults) {
        for (const [pattern, answer] of Object.entries(formRules.yes_no_defaults)) {
          if (text.includes(pattern.toLowerCase())) {
            AutoFill.setValue(input, answer);
            filled.push(pattern.substring(0, 30));
            break;
          }
        }
      }
    }
  },

  fillWorkAuth(personalInfo, formRules, filled, unfilled) {
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      const text = label.textContent.trim().toLowerCase();
      const inputId = label.getAttribute("for");
      const input = inputId
        ? document.getElementById(inputId)
        : label.querySelector("input, select, textarea");
      if (!input) continue;

      if (text.includes("authorized") && text.includes("work")) {
        AutoFill.setValue(input, "Yes");
        filled.push("work_auth");
      }
      if (text.includes("sponsorship") || text.includes("sponsor")) {
        AutoFill.setValue(input, "Yes");
        filled.push("sponsorship");
      }
      if (text.includes("visa") || text.includes("work authorization type")) {
        AutoFill.setValue(input, personalInfo.work_authorization || "");
        filled.push("visa_type");
      }
    }
  },

  async fillEEO(personalInfo, filled, unfilled) {
    // Legacy boards.greenhouse.io uses native <select>; modern
    // job-boards.greenhouse.io uses <input role="combobox" class="select__input">.
    // If neither shape is present, there's nothing to do.
    const hasNativeSelect = document.querySelectorAll("select").length > 0;
    const hasReactSelect =
      document.querySelectorAll('input.select__input[role="combobox"]').length > 0;

    if (hasReactSelect) {
      await this.fillEEO_modern(personalInfo, filled, unfilled);
    } else if (hasNativeSelect) {
      this.fillEEO_legacy(personalInfo, filled, unfilled);
    }
  },

  fillEEO_legacy(personalInfo, filled, unfilled) {
    const selects = document.querySelectorAll("select");
    for (const select of selects) {
      const label = select.closest(".field")?.querySelector("label")?.textContent?.toLowerCase() || "";
      const name = (select.name || select.id || "").toLowerCase();

      if (label.includes("gender") || name.includes("gender")) {
        AutoFill.selectOption(select, personalInfo.gender || "Male");
        filled.push("gender");
      }
      if (label.includes("race") || label.includes("ethnicity") || name.includes("race")) {
        AutoFill.selectOption(select, personalInfo.race_ethnicity || "Asian");
        filled.push("race");
      }
      if (label.includes("veteran") || name.includes("veteran")) {
        AutoFill.selectOption(select, "not a protected veteran");
        filled.push("veteran");
      }
      if (label.includes("disability") || name.includes("disability")) {
        AutoFill.selectOption(select, personalInfo.disability_status || "No");
        filled.push("disability");
      }
    }
  },

  // Modern job-boards.greenhouse.io: scan every react-select combobox and
  // dispatch by its label text. Earlier we tried a hardcoded id list but it
  // missed Hispanic/Latino (id "hispanic_ethnicity") and generated false
  // unfilled entries for ids that don't exist on a given board. Label-driven
  // scan is robust to id variation across Greenhouse customers.
  //
  // We deliberately skip school/degree (handled by fillLabeledFields) and
  // any "question_*" custom question whose label we don't classify — those
  // shouldn't count against the unfilled count.
  async fillEEO_modern(personalInfo, filled, unfilled) {
    const comboboxes = document.querySelectorAll(
      'input.select__input[role="combobox"]'
    );

    const getLabelText = (input) => {
      if (input.id) {
        const lbl = document.querySelector(
          `label[for="${CSS.escape(input.id)}"]`
        );
        if (lbl) return lbl.textContent.trim().toLowerCase();
      }
      const container = input.closest("fieldset, div");
      const fallback = container?.querySelector("label");
      return (fallback?.textContent || "").trim().toLowerCase();
    };

    const disabilityValue = (() => {
      const v = String(personalInfo.disability_status || "No").toLowerCase();
      if (v.startsWith("y")) return "have a disability";
      if (v.includes("decline") || v.includes("wish") || v.includes("prefer")) {
        return "do not wish";
      }
      return "do not have a disability";
    })();

    const isHispanic = /hispanic|latino/i.test(personalInfo.race_ethnicity || "");

    const classify = (label) => {
      // Skip school / degree — fillLabeledFields handles them upstream.
      if (label.includes("school") || label.includes("degree")) return null;

      if (label.includes("veteran")) {
        return { displayName: "veteran", value: "not a protected veteran" };
      }
      if (label.includes("disability")) {
        return { displayName: "disability", value: disabilityValue };
      }
      if (label.includes("gender")) {
        return { displayName: "gender", value: personalInfo.gender || "Male" };
      }
      if (label.includes("hispanic") || label.includes("latino")) {
        return { displayName: "hispanic/latino", value: isHispanic ? "Yes" : "No" };
      }
      // race / ethnicity AFTER hispanic/latino check — the latter is more
      // specific and can also contain the word "ethnicity".
      if (label.includes("race") || label.includes("ethnicity")) {
        return {
          displayName: "race / ethnicity",
          value: personalInfo.race_ethnicity || "Asian",
        };
      }
      // Address country. Exclude any label mentioning phone so a future
      // phone-country react-select isn't treated as the address field.
      if (label.includes("country") && !label.includes("phone")) {
        return {
          displayName: "country",
          value: personalInfo.location?.country || "United States",
        };
      }
      return null;
    };

    for (const cb of comboboxes) {
      const label = getLabelText(cb);
      const target = classify(label);
      if (!target) continue;

      const result = await AutoFill.fillReactSelect(cb, target.value, target.displayName);
      if (result.ok) {
        filled.push(target.displayName);
      } else {
        unfilled.push(target.displayName);
      }
      // Brief pause so a just-closed listbox doesn't fight the next open.
      await AutoFill.sleep(200);
    }
  },

  async fillPhoneCountry(personalInfo, filled, unfilled) {
    // Only the modern frontend ships intl-tel-input. On legacy boards.greenhouse.io
    // there's no flag picker — the phone field is a plain <input>.
    if (!document.querySelector("button.iti__selected-country")) return;

    const country = personalInfo.location?.country || "United States";
    const result = await AutoFill.fillIntlTelCountry(country);
    if (result.ok) {
      filled.push("phone country");
    } else {
      unfilled.push("phone country");
    }
  },

  fillSource(filled, unfilled) {
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      const text = label.textContent.trim().toLowerCase();
      if (text.includes("how did you hear") || text.includes("source") || text.includes("where did you")) {
        const inputId = label.getAttribute("for");
        const input = inputId
          ? document.getElementById(inputId)
          : label.querySelector("input, select, textarea");
        if (input) {
          AutoFill.setValue(input, "LinkedIn");
          filled.push("source");
          return;
        }
      }
    }
  },
};
