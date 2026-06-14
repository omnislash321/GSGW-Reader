// Swaps theme-aware images (favicon, logo) to match the active theme. Themes are
// user-selected (data-theme), not OS-driven, so this can't be done in CSS.
//
// Asset naming = the COLOR of the artwork, not the theme it appears in:
//   *-dark  = dark-coloured art, for LIGHT themes (office, daydream)
//   *-light = light-coloured art, for DARK themes (everything else)
// Keep LIGHT_THEMES in sync with the light entries in assets/css/themes.css.
export var LIGHT_THEMES = { office: 1, daydream: 1 };

export function assetVariant(theme) {
  return LIGHT_THEMES[theme] ? "dark" : "light";
}

// Point every themed <link>/<img> at the variant for `theme`. Safe to call before
// or after DOMContentLoaded; it only touches elements that exist.
export function applyThemeAssets(theme) {
  var v = assetVariant(theme);
  document.querySelectorAll("link.themed-icon").forEach(function (l) {
    l.href = "/assets/img/" + l.dataset.icon + "-" + v + ".png";
  });
  // Logos use the inverse of the favicon: dark themes show logo-dark, light show logo-light.
  var lv = LIGHT_THEMES[theme] ? "light" : "dark";
  document.querySelectorAll("img[data-logo]").forEach(function (img) {
    img.src = "/assets/img/logo-" + lv + ".png";
  });
}
