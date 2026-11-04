// Booking form, INACCESSIBLE version (on purpose, for the BlindSpot demo).
// Time slots are plain divs with click handlers, and errors are inserted as red text
// that screen readers never announce. See demo-site/README.md for the full list.

var selectedTime = null;

function selectSlot(el) {
  if (el.classList.contains("is-taken")) return;
  var slots = document.querySelectorAll(".slot");
  for (var i = 0; i < slots.length; i++) slots[i].classList.remove("selected");
  el.classList.add("selected");
  selectedTime = el.getAttribute("data-time");
  var err = document.querySelector(".form-error");
  if (err && err.getAttribute("data-kind") === "time") err.remove();
}

(function () {
  "use strict";

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var form = document.getElementById("booking-form");

  function showError(message, kind) {
    var err = form.querySelector(".form-error");
    if (!err) {
      err = document.createElement("p");
      err.className = "form-error";
      var actions = form.querySelector(".form-actions");
      actions.parentNode.insertBefore(err, actions);
    }
    err.setAttribute("data-kind", kind);
    err.textContent = message;
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    var doctor = document.getElementById("doctor").value;
    var date = document.getElementById("date").value;
    var name = document.getElementById("name").value.trim();
    var email = document.getElementById("email").value.trim();

    if (!doctor) return showError("Please choose a doctor.", "doctor");
    if (!date) return showError("Please choose a date.", "date");
    if (!selectedTime) return showError("Please choose a time slot.", "time");
    if (!name) return showError("Please enter your full name.", "name");
    if (!EMAIL.test(email)) return showError("Please enter a valid email address.", "email");

    var params = new URLSearchParams({ doctor: doctor, date: date, time: selectedTime, name: name });
    window.location.href = "confirm.html?" + params.toString();
  });
})();
