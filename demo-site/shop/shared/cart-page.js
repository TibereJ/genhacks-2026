// Cart page (same in bad/ and fixed/): lists the cart lines and the subtotal.
(function () {
  "use strict";
  GreenCart.updateBadge();
  GreenCart.renderSummary(document.querySelector("main"), null);
})();
