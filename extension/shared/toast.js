// Toast helper. Both popup and panel mount the same `<p id="toast">` and
// get a callback `(text, tone) => void` they can pass into shared actions.

export function mountToast(rootEl) {
  return function toast(text, tone = "") {
    rootEl.textContent = text || "";
    if (tone) rootEl.dataset.tone = tone;
    else rootEl.removeAttribute("data-tone");
  };
}
