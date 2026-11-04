// GreenCart (fictional grocery store) - catalog, cart storage and rendering helpers shared
// by demo-site/shop/bad and demo-site/shop/fixed. Nothing in here is an accessibility
// barrier or a fix: the differences between the two versions live in their own scripts.
//
// State lives in localStorage, namespaced per version so that bad/ and fixed/ (same origin)
// never share a cart or a cookie choice. Add ?reset to any page URL to start over.
(function () {
  "use strict";

  var VERSION = /\/fixed\//.test(window.location.pathname) ? "fixed" : "bad";
  var PREFIX = "greencart:" + VERSION + ":";

  var PRODUCTS = {
    apples: { name: "Apples", unit: "kg", price: 3.2 },
    bread: { name: "Bread loaf", unit: "loaf", price: 2.8 },
    milk: { name: "Milk", unit: "bottle", price: 1.45 },
    eggs: { name: "Eggs", unit: "box", price: 3.1 },
    bananas: { name: "Bananas", unit: "kg", price: 1.9 },
  };

  var DELIVERY = {
    home: { label: "Home delivery", fee: 4.99 },
    pickup: { label: "Store pickup", fee: 0 },
  };

  function read(key, fallback) {
    try {
      var raw = window.localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(PREFIX + key);
      else window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      /* storage blocked: the demo still works within the page */
    }
  }

  if (new URLSearchParams(window.location.search).has("reset")) {
    ["cart", "consent", "order"].forEach(function (k) { write(k, null); });
  }

  /** The cart as { productId: quantity }, unknown ids and bad quantities dropped. */
  function loadCart() {
    var raw = read("cart", {});
    var cart = {};
    Object.keys(PRODUCTS).forEach(function (id) {
      var qty = Number(raw && raw[id]);
      if (Number.isInteger(qty) && qty > 0 && qty <= 99) cart[id] = qty;
    });
    return cart;
  }

  function addToCart(id, qty) {
    var cart = loadCart();
    cart[id] = Math.min(99, (cart[id] || 0) + qty);
    write("cart", cart);
    return cart;
  }

  function cartLines(cart) {
    return Object.keys(cart).map(function (id) {
      var p = PRODUCTS[id];
      return { id: id, name: p.name, qty: cart[id], unit: p.unit, total: p.price * cart[id] };
    });
  }

  function money(n) {
    return "$" + n.toFixed(2);
  }

  function qtyText(line) {
    if (line.unit === "kg") return line.qty + " kg";
    return line.qty + " " + line.unit + (line.qty > 1 ? (line.unit === "box" ? "es" : "s") : "");
  }

  function subtotal(cart) {
    return cartLines(cart).reduce(function (sum, l) { return sum + l.total; }, 0);
  }

  /** Fills a <ul> with one row per cart line, using textContent only. */
  function renderLines(list, cart) {
    list.textContent = "";
    cartLines(cart).forEach(function (line) {
      var li = document.createElement("li");
      li.className = "line-item";
      var img = document.createElement("img");
      img.className = "line-thumb";
      img.src = "../shared/img/" + line.id + ".svg";
      img.alt = "";
      img.width = 48;
      img.height = 48;
      var text = document.createElement("span");
      text.className = "line-text";
      var name = document.createElement("span");
      name.className = "line-name";
      name.textContent = line.name;
      var qty = document.createElement("span");
      qty.className = "line-qty";
      qty.textContent = qtyText(line);
      text.appendChild(name);
      text.appendChild(qty);
      var price = document.createElement("span");
      price.className = "line-price";
      price.textContent = money(line.total);
      li.appendChild(img);
      li.appendChild(text);
      li.appendChild(price);
      list.appendChild(li);
    });
  }

  function countLines(cart) {
    return Object.keys(cart).length;
  }

  function itemsText(n) {
    return n + (n === 1 ? " item" : " items");
  }

  /** Header cart badge. [data-cart-count-text] only exists in fixed/ (visually hidden). */
  function updateBadge() {
    var n = countLines(loadCart());
    var badges = document.querySelectorAll("[data-cart-badge]");
    for (var i = 0; i < badges.length; i++) {
      badges[i].textContent = String(n);
      badges[i].hidden = n === 0;
    }
    var texts = document.querySelectorAll("[data-cart-count-text]");
    for (var j = 0; j < texts.length; j++) texts[j].textContent = " (" + itemsText(n) + ")";
  }

  /** Order summary: [data-lines], [data-empty], [data-subtotal], [data-fee], [data-total]. */
  function renderSummary(root, deliveryKey) {
    var cart = loadCart();
    var sub = subtotal(cart);
    var fee = deliveryKey && countLines(cart) ? DELIVERY[deliveryKey].fee : 0;
    var lines = root.querySelector("[data-lines]");
    if (lines) renderLines(lines, cart);
    var empty = root.querySelector("[data-empty]");
    if (empty) empty.hidden = countLines(cart) > 0;
    var set = function (sel, text) {
      var el = root.querySelector(sel);
      if (el) el.textContent = text;
    };
    set("[data-subtotal]", money(sub));
    set("[data-fee]", fee ? money(fee) : "Free");
    set("[data-total]", money(sub + fee));
    return { cart: cart, subtotal: sub, fee: fee, total: sub + fee };
  }

  window.GreenCart = {
    version: VERSION,
    products: PRODUCTS,
    delivery: DELIVERY,
    loadCart: loadCart,
    addToCart: addToCart,
    clearCart: function () { write("cart", null); },
    cartLines: cartLines,
    countLines: countLines,
    itemsText: itemsText,
    updateBadge: updateBadge,
    renderSummary: renderSummary,
    subtotal: subtotal,
    money: money,
    qtyText: qtyText,
    renderLines: renderLines,
    consentGiven: function () { return read("consent", null) === "all"; },
    setConsent: function () { write("consent", "all"); },
    saveOrder: function (order) { write("order", order); },
    loadOrder: function () { return read("order", null); },
  };
})();
