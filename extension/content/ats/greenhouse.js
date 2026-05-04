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

    // LinkedIn field
    const linkedinInput = document.querySelector(
      'input[name*="linkedin"], input[id*="linkedin"], input[autocomplete*="url"]'
    );
    if (linkedinInput && personalInfo.linkedin) {
      AutoFill.setValue(linkedinInput, personalInfo.linkedin);
      filled.push("linkedin");
    }

    // Education fields — look for labels
    this.fillLabeledFields(personalInfo, formRules, filled, unfilled);

    // Work authorization dropdowns / radios
    this.fillWorkAuth(personalInfo, formRules, filled, unfilled);

    // EEO section (often in iframe)
    this.fillEEO(personalInfo, filled, unfilled);

    // "How did you hear about this position?"
    this.fillSource(filled, unfilled);

    return { filled, unfilled };
  },

  fillLabeledFields(personalInfo, formRules, filled, unfilled) {
    const labels = document.querySelectorAll("label");
    for (const label of labels) {
      const text = label.textContent.trim().toLowerCase();
      const inputId = label.getAttribute("for");
      const input = inputId
        ? document.getElementById(inputId)
        : label.querySelector("input, select, textarea");
      if (!input) continue;

      // School / University
      if (text.includes("school") || text.includes("university") || text.includes("college")) {
        const edu = personalInfo.education?.[0];
        if (edu) {
          AutoFill.setValue(input, edu.school);
          filled.push("school");
        }
      }

      // Degree
      if (text.includes("degree")) {
        const edu = personalInfo.education?.[0];
        if (edu) {
          AutoFill.setValue(input, `${edu.degree} in ${edu.major}`);
          filled.push("degree");
        }
      }

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

  fillEEO(personalInfo, filled, unfilled) {
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
