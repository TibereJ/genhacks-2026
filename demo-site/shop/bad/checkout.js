// Checkout, INACCESSIBLE version (on purpose, for the BlindSpot demo).
// - delivery method cards are <div role="button">: not focusable, and the selected card is
//   only shown visually (no aria-pressed / aria-checked);
// - the terms "checkbox" is a <div> with a click handler: no role, not focusable, so a
//   screen reader user cannot tick it. Placing the order requires it: BLOCKER;
// - errors are red text with no role="alert", no focus move, no aria-invalid.
(function () {
  "use strict";

  var form = document.getElementById("checkout-form");
  var summary = document.querySelector(".summary-card");
  var cards = document.querySelectorAll("[data-delivery]");
  var terms = document.querySelector("[data-terms]");
  var box = document.querySelector("[data-terms-box]");
  var nameInput = document.getElementById("name");
  var address = document.getElementById("address");
  var error = document.getElementById("form-error");

  var delivery = "pickup";
  var accepted = false;

  GreenCart.updateBadge();
  GreenCart.renderSummary(summary, delivery);

  Array.prototype.forEach.call(cards, function (card) {
    card.addEventListener("click", function () {
      if (!GreenCart.consentGiven()) return;
      delivery = card.getAttribute("data-delivery");
      Array.prototype.forEach.call(cards, function (c) { c.classList.toggle("is-selected", c === card); });
      GreenCart.renderSummary(summary, delivery);
    });
  });

  terms.addEventListener("click", function () {
    if (!GreenCart.consentGiven()) return;
    accepted = !accepted;
    box.classList.toggle("is-checked", accepted);
    if (accepted) {
      terms.classList.remove("has-error");
      if (error.getAttribute("data-for") === "terms") error.textContent = "";
    }
  });

  function showError(field, message) {
    error.textContent = message;
    error.setAttribute("data-for", field === terms ? "terms" : field.id);
    field.classList.add("has-error");
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!GreenCart.consentGiven()) return;
    error.textContent = "";
    [nameInput, address, terms].forEach(function (el) { el.classList.remove("has-error"); });

    var cart = GreenCart.loadCart();
    var checks = [
      [GreenCart.countLines(cart) === 0, nameInput, "Your cart is empty. Add some groceries first."],
      [!nameInput.value.trim(), nameInput, "Please enter your full name."],
      [delivery === "home" && !address.value.trim(), address, "Please enter your delivery address."],
      [!accepted, terms, "Please accept the terms of sale to place your order."],
    ];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i][0]) {
        showError(checks[i][1], checks[i][2]);
        return;
      }
    }

    var totals = GreenCart.renderSummary(summary, delivery);
    GreenCart.saveOrder({
      number: "GC-" + String(Date.now()).slice(-6),
      items: GreenCart.cartLines(cart).map(function (l) { return { id: l.id, qty: l.qty }; }),
      name: nameInput.value.trim(),
      address: address.value.trim(),
      delivery: delivery,
      total: totals.total,
    });
    GreenCart.clearCart();
    window.location.href = "done.html";
  });
})();
