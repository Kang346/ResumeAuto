// Lucide icon SVG paths, exported as inline strings for Shadow DOM use.
// The status badge runs in a content-script Shadow DOM where <use href> can't
// reach an external sprite, so we inline the markup at construction time.
// SYNC: keep glyph definitions consistent with extension/shared/icons.svg.

window.AutoResumeIcons = (function () {
  const ATTR =
    'viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"';

  const G = {};
  G["bookmark"] = '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>';
  G["bookmark-check"] =
    '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/>' +
    '<path d="m9 10 2 2 4-4"/>';
  G["circle-check"] =
    '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>';
  G["circle-alert"] =
    '<circle cx="12" cy="12" r="10"/>' +
    '<line x1="12" y1="8" x2="12" y2="12"/>' +
    '<line x1="12" y1="16" x2="12.01" y2="16"/>';
  G["circle-dashed"] =
    '<path d="M10.1 2.18a9.93 9.93 0 0 1 3.8 0"/>' +
    '<path d="M17.6 3.71a9.95 9.95 0 0 1 2.69 2.7"/>' +
    '<path d="M21.82 10.1a9.93 9.93 0 0 1 0 3.8"/>' +
    '<path d="M20.29 17.6a9.95 9.95 0 0 1 -2.7 2.69"/>' +
    '<path d="M13.9 21.82a9.94 9.94 0 0 1 -3.8 0"/>' +
    '<path d="M6.4 20.29a9.95 9.95 0 0 1 -2.69 -2.7"/>' +
    '<path d="M2.18 13.9a9.93 9.93 0 0 1 0 -3.8"/>' +
    '<path d="M3.71 6.4a9.95 9.95 0 0 1 2.7 -2.69"/>';
  G["file-text"] =
    '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>' +
    '<polyline points="14 2 14 8 20 8"/>' +
    '<line x1="9" y1="13" x2="15" y2="13"/>' +
    '<line x1="9" y1="17" x2="13" y2="17"/>';
  G["x"] =
    '<line x1="18" y1="6" x2="6" y2="18"/>' +
    '<line x1="6" y1="6" x2="18" y2="18"/>';
  G["loader"] = '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>';
  G["arrow-right"] =
    '<line x1="5" y1="12" x2="19" y2="12"/>' +
    '<polyline points="12 5 19 12 12 19"/>';
  G["rotate"] =
    '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/>' +
    '<polyline points="3 3 3 8 8 8"/>';

  function svg(name, extraAttr = "") {
    const inner = G[name];
    if (!inner) return "";
    return `<svg ${ATTR} ${extraAttr}>${inner}</svg>`;
  }

  return { svg, glyphs: G };
})();
