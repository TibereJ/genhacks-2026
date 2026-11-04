// Pre-fills the booking date with the next opening day (Mon to Sat, from tomorrow on)
// and stops people from picking a day in the past. Shared by both versions.
(function () {
  "use strict";

  var input = document.getElementById("date");
  if (!input) return;

  function iso(d) {
    var mm = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + mm + "-" + dd;
  }

  var day = new Date();
  day.setHours(12, 0, 0, 0);
  day.setDate(day.getDate() + 1);
  input.min = iso(day);
  while (day.getDay() === 0) day.setDate(day.getDate() + 1); // closed on Sundays
  if (!input.value) input.value = iso(day);
})();
