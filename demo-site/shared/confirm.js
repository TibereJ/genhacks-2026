// Fills the confirmation page from the query string (?doctor=&date=&time=&name=).
// Values are user-controlled, so they are only ever written with textContent.
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);

  function formatDate(raw) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!m) return raw;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (isNaN(d.getTime())) return raw;
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  }

  var fields = document.querySelectorAll("[data-field]");
  for (var i = 0; i < fields.length; i++) {
    var el = fields[i];
    var key = el.getAttribute("data-field");
    var raw = (params.get(key) || "").trim();
    if (!raw) {
      el.textContent = "Not provided";
    } else {
      el.textContent = key === "date" ? formatDate(raw) : raw;
    }
  }
})();
