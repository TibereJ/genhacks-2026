// Booking form, accessible version: errors go to a role="alert" region, the invalid
// field is marked aria-invalid, described by the error and focused.
(function () {
  "use strict";

  var EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  var form = document.getElementById("booking-form");
  var doctor = document.getElementById("doctor");
  var date = document.getElementById("date");
  var timeGroup = document.getElementById("time-group");
  var nameInput = document.getElementById("name");
  var email = document.getElementById("email");
  var error = document.getElementById("form-error");

  function clearError() {
    error.textContent = "";
    [doctor, date, timeGroup, nameInput, email].forEach(function (el) {
      el.removeAttribute("aria-invalid");
      el.removeAttribute("aria-describedby");
    });
  }

  function showError(field, message) {
    error.textContent = message;
    field.setAttribute("aria-describedby", "form-error");
    if (field === timeGroup) {
      var first = timeGroup.querySelector("input:not(:disabled)");
      if (first) first.focus();
    } else {
      field.setAttribute("aria-invalid", "true");
      field.focus();
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    clearError();

    var time = form.querySelector('input[name="time"]:checked');
    var checks = [
      [!doctor.value, doctor, "Please choose a doctor."],
      [!date.value, date, "Please choose a date."],
      [!time, timeGroup, "Please choose a time slot."],
      [!nameInput.value.trim(), nameInput, "Please enter your full name."],
      [!EMAIL.test(email.value.trim()), email, "Please enter a valid email address."],
    ];
    for (var i = 0; i < checks.length; i++) {
      if (checks[i][0]) {
        showError(checks[i][1], checks[i][2]);
        return;
      }
    }

    var params = new URLSearchParams({
      doctor: doctor.value,
      date: date.value,
      time: time.value,
      name: nameInput.value.trim(),
    });
    window.location.href = "confirm.html?" + params.toString();
  });

  // Picking a time clears the "choose a time" error straight away.
  timeGroup.addEventListener("change", function () {
    if (timeGroup.hasAttribute("aria-describedby")) clearError();
  });
})();
