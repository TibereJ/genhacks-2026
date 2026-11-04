// Product grid, INACCESSIBLE version (on purpose, for the BlindSpot demo).
// - steppers are buttons named only "−" / "+", the same for every product;
// - the quantity is a <span>, so it is not announced as the stepper's value and can't be edited;
// - every add button is named "Add";
// - the cart badge changes silently (no live region);
// - until the cookie banner is accepted, every button silently does nothing.
(function () {
  "use strict";

  GreenCart.updateBadge();

  var cards = document.querySelectorAll(".product-card");
  Array.prototype.forEach.call(cards, function (card) {
    var id = card.getAttribute("data-product");
    var qtyEl = card.querySelector("[data-qty]");
    var qty = function () { return Number(qtyEl.textContent) || 1; };

    Array.prototype.forEach.call(card.querySelectorAll("[data-step]"), function (btn) {
      btn.addEventListener("click", function () {
        if (!GreenCart.consentGiven()) return; // the cookie banner is still open
        var next = qty() + Number(btn.getAttribute("data-step"));
        qtyEl.textContent = String(Math.min(20, Math.max(1, next)));
      });
    });

    card.querySelector("[data-add]").addEventListener("click", function () {
      if (!GreenCart.consentGiven()) return;
      GreenCart.addToCart(id, qty());
      GreenCart.updateBadge();
    });
  });
})();
