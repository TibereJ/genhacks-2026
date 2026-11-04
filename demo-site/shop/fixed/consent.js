// Cookie banner, accessible version: a labelled modal dialog (role="dialog", aria-modal).
// While it is open the rest of the page is inert (out of the accessibility tree and the tab
// order), focus moves to "Accept all", Escape closes it, and focus is restored afterwards.
(function () {
  "use strict";

  var banner = document.getElementById("consent");
  if (!banner || GreenCart.consentGiven()) return;

  var background = Array.prototype.filter.call(document.body.children, function (el) {
    return el !== banner && el.tagName !== "SCRIPT";
  });
  var previous = document.activeElement;

  banner.hidden = false;
  background.forEach(function (el) { el.inert = true; });
  banner.querySelector(".consent-actions button").focus();

  function close() {
    GreenCart.setConsent();
    banner.hidden = true;
    background.forEach(function (el) { el.inert = false; });
    document.removeEventListener("keydown", onKey);
    // Back to where the user was; on page load that is the top of the main content.
    var target = previous && previous !== document.body ? previous : document.querySelector("main h1");
    if (target) {
      if (!target.hasAttribute("tabindex") && target.tagName === "H1") target.setAttribute("tabindex", "-1");
      target.focus();
    }
  }

  function onKey(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  }

  var targets = banner.querySelectorAll("[data-consent-accept]");
  for (var i = 0; i < targets.length; i++) targets[i].addEventListener("click", close);
  document.addEventListener("keydown", onKey);
})();
