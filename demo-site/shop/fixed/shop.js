// Product grid, accessible version: steppers named per product ("Increase apples quantity"),
// the quantity is a labelled number input, add buttons say what they add, and every change
// is announced through a role="status" live region.
(function () {
  "use strict";

  var status = document.getElementById("cart-status");

  function announce(message) {
    // Clear first so that the same message twice in a row is still announced.
    status.textContent = "";
    window.setTimeout(function () { status.textContent = message; }, 30);
  }

  GreenCart.updateBadge();

  var cards = document.querySelectorAll(".product-card");
  Array.prototype.forEach.call(cards, function (card) {
    var id = card.getAttribute("data-product");
    var product = GreenCart.products[id];
    var input = card.querySelector("[data-qty]");

    function qty() {
      var n = Math.round(Number(input.value));
      return Math.min(20, Math.max(1, Number.isFinite(n) ? n : 1));
    }

    function describe(n) {
      return GreenCart.qtyText({ qty: n, unit: product.unit });
    }

    Array.prototype.forEach.call(card.querySelectorAll("[data-step]"), function (btn) {
      btn.addEventListener("click", function () {
        var next = Math.min(20, Math.max(1, qty() + Number(btn.getAttribute("data-step"))));
        input.value = String(next);
        announce(product.name + " quantity: " + describe(next) + ".");
      });
    });

    input.addEventListener("change", function () {
      input.value = String(qty());
    });

    card.querySelector("[data-add]").addEventListener("click", function () {
      var n = qty();
      input.value = String(n);
      var cart = GreenCart.addToCart(id, n);
      GreenCart.updateBadge();
      announce(product.name + ", " + describe(n) + ", added. Cart: " + GreenCart.itemsText(GreenCart.countLines(cart)) + ".");
    });
  });
})();
