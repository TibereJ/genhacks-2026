// Cookie banner, INACCESSIBLE version (on purpose, for the BlindSpot demo).
// - plain <div> overlay: no role="dialog", no aria-modal, no label;
// - focus is not moved into it, and the page behind stays in the accessibility tree;
// - the page's buttons silently do nothing until consent is given (see shop.js, checkout.js);
// - "Accept all" is a non-focusable <div>; the only keyboard-reachable control is the
//   corner close icon, a focusable <div> with an SVG and no accessible name.
(function () {
  "use strict";

  var banner = document.getElementById("consent");
  if (!banner || GreenCart.consentGiven()) return;
  banner.hidden = false;

  function accept() {
    GreenCart.setConsent();
    banner.hidden = true;
  }

  var targets = banner.querySelectorAll("[data-consent-accept]");
  for (var i = 0; i < targets.length; i++) targets[i].addEventListener("click", accept);

  banner.querySelector(".consent-close").addEventListener("keydown", function (event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      accept();
    }
  });
})();
