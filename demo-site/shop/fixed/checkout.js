// Checkout, accessible version: delivery is a native radio group in a fieldset, the terms
// are a native labelled checkbox, and errors go to a role="alert" region; the invalid field
// gets aria-invalid, is described by the error and receives focus.
(function () {
  "use strict";

  var form = document.getElementById("checkout-form");
  var summary = document.querySelector(".summary-card");
  var terms = document.getElementById("terms");
  var nameInput = document.getElementById("name");
  var address = document.getElementById("address");
  var error = document.getElementById("form-error");

  function delivery() {
    var checked = form.querySelector('input[name="delivery"]:checked');
    return checked ? checked.value : "pickup";
  }

  GreenCart.updateBadge();
  GreenCart.renderSummary(summary, delivery());

  form.addEventListener("change", function (event) {
    if (event.target.name === "delivery") GreenCart.renderSummary(summary, delivery());
    if (event.target === terms && terms.checked && terms.hasAttribute("aria-invalid")) clearError();
  });

  function clearError() {
    error.textContent = "";
    [nameInput, address, terms].forEach(function (el) {
      el.removeAttribute("aria-invalid");
      var ids = (el.getAttribute("aria-describedby") || "").split(" ").filter(function (x) { return x && x !== "form-error"; });
      if (ids.length) el.setAttribute("aria-describedby", ids.join(" "));
      else el.removeAttribute("aria-describedby");
    });
  }

  function showError(field, message) {
    error.textContent = message;
    field.setAttribute("aria-invalid", "true");
    var ids = (field.getAttribute("aria-describedby") || "").split(" ").filter(Boolean);
    if (ids.indexOf("form-error") === -1) ids.push("form-error");
    field.setAttribute("aria-describedby", ids.join(" "));
    field.focus();
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearError();

    var cart = GreenCart.loadCart();
    var method = delivery();
    var checks = [
      [GreenCart.countLines(cart) === 0, nameInput, "Your cart is empty. Add some groceries first."],
      [!nameInput.value.trim(), nameInput, "Please enter your full name."],
      [method === "home" && !address.value.trim(), address, "Please enter your delivery address."],
      [!terms.checked, terms, "Please accept the terms of sale to place your order."],
    ];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i][0]) {
        showError(checks[i][1], checks[i][2]);
        return;
      }
    }

    var totals = GreenCart.renderSummary(summary, method);
    GreenCart.saveOrder({
      number: "GC-" + String(Date.now()).slice(-6),
      items: GreenCart.cartLines(cart).map(function (l) { return { id: l.id, qty: l.qty }; }),
      name: nameInput.value.trim(),
      address: address.value.trim(),
      delivery: method,
      total: totals.total,
    });
    GreenCart.clearCart();
    window.location.href = "done.html";
  });
})();
