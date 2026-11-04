// BlindSpot report UI: hash router.
//   #/              home (launch a test, past runs)
//   #/report/<id>   live report
// Add ?fixture=1 to the page URL to use fixtures/sample-report.json instead of the API.

import { renderHome } from "./home.js";
import { renderReport } from "./report.js";
import { initLightbox } from "./lightbox.js";
import { stopSpeaking } from "./speech.js";
import { FIXTURE_MODE } from "./api.js";

const root = document.getElementById("main");
let view = null;
let firstRoute = true;

function route() {
  view?.destroy?.();
  stopSpeaking();
  const hash = location.hash || "#/";
  const m = hash.match(/^#\/report\/([^/?#]+)/);
  if (m) {
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
initLightbox();
window.addEventListener("hashchange", route);
route();
