// BlindSpot report UI: hash router.
//   #/              home (launch a test, past runs)
//   #/report/<id>   live report
//   #/compare/<before>/<after>   before / after comparison of two runs
// Add ?fixture=1 to the page URL to use fixtures/sample-report.json instead of the API.
// The static demo build (src/build-static.ts) reads pre-built files instead of the API (see api.js).

import { renderHome } from "./home.js";
import { renderReport } from "./report.js";
import { renderCompare } from "./compare.js";
import { initLightbox } from "./lightbox.js";
import { stopSpeaking } from "./speech.js";
import { FIXTURE_MODE, STATIC_MODE } from "./api.js";

const root = document.getElementById("main");
let view = null;
let firstRoute = true;

function decode(part) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

function route() {
  view?.destroy?.();
  stopSpeaking();
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/report\/([^/?#]+)/);
  const cmp = hash.match(/^#\/compare\/([^/?#]+)\/([^/?#]+)/);
  if (cmp) {
    view = renderCompare(root, decode(cmp[1]), decode(cmp[2]));
  } else if (m) {
    let id;
    try {
      id = decodeURIComponent(m[1]);
    } catch {
      id = m[1];
    }
    view = renderReport(root, id);
  } else {
    view = renderHome(root);
  }
  if (!firstRoute) {
    window.scrollTo(0, 0);
    // Move focus to the new page's heading so screen reader users know the view changed.
    requestAnimationFrame(() => document.getElementById("page-title")?.focus({ preventScroll: true }));
  }
  firstRoute = false;
}

if (FIXTURE_MODE) document.getElementById("fixture-flag")?.removeAttribute("hidden");
if (STATIC_MODE) {
  const flag = document.getElementById("fixture-flag");
  if (flag) {
    flag.textContent = "Read-only demo";
    flag.removeAttribute("hidden");
  }
}
initLightbox();
window.addEventListener("hashchange", route);
route();
