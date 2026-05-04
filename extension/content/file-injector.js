// PDF file injection — bypasses OS file dialog

window.AutoFill = window.AutoFill || {};

AutoFill.FileInjector = {
  async inject(filename, inputEl) {
    if (!inputEl) {
      inputEl = this.findFileInput();
    }
    if (!inputEl) {
      return { ok: false, error: "No file input found on page" };
    }

    try {
      const blob = await AutoFill.fetchPdfBlob(filename);
      const file = new File([blob], filename, { type: "application/pdf" });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      inputEl.files = dataTransfer.files;

      inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      inputEl.dispatchEvent(new Event("input", { bubbles: true }));

      return { ok: true, filename };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  findFileInput() {
    // Look for file inputs, prefer ones labeled "resume" or "cv"
    const inputs = document.querySelectorAll('input[type="file"]');
    if (inputs.length === 0) return null;
    if (inputs.length === 1) return inputs[0];

    // Multiple file inputs — find the resume one
    for (const input of inputs) {
      const context = (
        input.getAttribute("aria-label") ||
        input.getAttribute("name") ||
        input.getAttribute("id") ||
        input.closest("label")?.textContent ||
        input.closest("[class*='upload']")?.textContent ||
        ""
      ).toLowerCase();

      if (
        context.includes("resume") ||
        context.includes("cv") ||
        context.includes("curriculum")
      ) {
        return input;
      }
    }

    // Fallback: also check nearby labels / text
    for (const input of inputs) {
      const parent = input.closest("div, section, fieldset");
      if (parent) {
        const text = parent.textContent.toLowerCase();
        if (text.includes("resume") || text.includes("cv")) {
          return input;
        }
      }
    }

    // Default to first file input
    return inputs[0];
  },
};
