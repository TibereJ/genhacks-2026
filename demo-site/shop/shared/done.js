// "Order placed" page (same in bad/ and fixed/). The order comes from localStorage and
// contains user input (name, address), so it is only ever written with textContent.
(function () {
  "use strict";

  GreenCart.updateBadge();
  var order = GreenCart.loadOrder();
  var title = document.querySelector("[data-done-title]");
  var lead = document.querySelector("[data-done-lead]");
  var details = document.querySelector("[data-done-details]");
  var list = document.querySelector("[data-lines]");

  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    title.textContent = "No order found";
    lead.textContent = "We could not find a recent order. Fill your cart in the shop and check out.";
    details.hidden = true;
    return;
  }

  var cart = {};
  order.items.forEach(function (item) {
    var qty = Number(item.qty);
    if (GreenCart.products[item.id] && Number.isInteger(qty) && qty > 0) cart[item.id] = qty;
  });
  GreenCart.renderLines(list, cart);

  var delivery = GreenCart.delivery[order.delivery] || GreenCart.delivery.pickup;
  var values = {
    number: String(order.number || ""),
    name: String(order.name || ""),
    delivery: delivery.label,
    address: order.delivery === "home" ? String(order.address || "") : "4 Market Square (pickup)",
    total: GreenCart.money(Number(order.total) || 0),
  };
  var fields = document.querySelectorAll("[data-field]");
  for (var i = 0; i < fields.length; i++) {
    fields[i].textContent = values[fields[i].getAttribute("data-field")] || "";
  }
  lead.textContent = order.delivery === "home"
    ? "Thanks, " + values.name + ". Your groceries will be delivered tomorrow between 8:00 and 12:00."
    : "Thanks, " + values.name + ". Your groceries will be ready for pickup in 2 hours.";
})();
