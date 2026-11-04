# Demo site: Maple Grove Clinic (fictional)

A small clinic booking site in two versions, used to demo and evaluate BlindSpot.
Static HTML, CSS and vanilla JS, no build step. `src/server.ts` serves this folder at `/demo/`.

| Version | Entry point | What a screen reader user gets |
|---|---|---|
| `bad/` | `/demo/bad/index.html` | Common accessibility mistakes. Booking is **impossible** without sight (time slots). |
| `fixed/` | `/demo/fixed/index.html` | Same pages, accessible markup. Booking works end to end. |

Both versions use `shared/style.css` and render **pixel-identically**: a sighted viewer cannot tell
them apart. Only the accessibility tree differs. `tests/demo-site.test.ts` checks this with byte-equal
screenshots of every page and of the "slot selected" and "error shown" states.

Demo task:

> Book an appointment with Dr. Lee for any available time. Use the name Alex Doe and the email alex@example.com.

Pages: `index.html` (home) → `book.html` (form) → `confirm.html?doctor=…&date=…&time=…&name=…` (heading "Appointment confirmed").
The date field is pre-filled with the next opening day (`shared/date-default.js`), and the 11:45 slot is taken.

## Answer key: barriers in `bad/`

What BlindSpot should find. Severity is what a blind user experiences; "Blocker" means the task cannot be completed.

| # | Page | Barrier | What the screen reader announces | WCAG 2.2 | Severity | Fix in `fixed/` |
|---|---|---|---|---|---|---|
| 1 | all | Logo `<img>` has no `alt`, so the home link around it has no name | `link` (no name), `image` (no name) | 1.1.1 Non-text Content, 2.4.4 Link Purpose (In Context) | serious | `alt="Maple Grove Clinic home"` |
| 2 | all | Nav "Book" link is an SVG icon with no text and no `aria-label` | `link` (no name) | 2.4.4 Link Purpose (In Context), 4.1.2 Name, Role, Value, 1.1.1 Non-text Content | serious | `aria-label="Book"`, SVG `aria-hidden="true"` |
| 3 | home | Heading levels skip: `h1` → `h4` ("Our doctors"), doctor names are `h5` | heading level 4 right after level 1 | 1.3.1 Info and Relationships | minor | `h2` / `h3` with the same CSS classes |
| 4 | book | Doctor `<select>` has no label; the visible "Doctor" is a separate `<div>` | `combobox` (no name) | 1.3.1 Info and Relationships, 3.3.2 Labels or Instructions, 4.1.2 Name, Role, Value | serious | `<label for="doctor">Doctor</label>` |
| - | book | Date: correctly labelled `<input type="date">` (control case, so the agent makes progress) | `Date "Date"` | - | - | - |
| 5 | book | **Time slots are `<div class="slot" onclick>`: no role, not focusable, selection shown only by a color change. BLOCKER** | plain text "9:00", "10:30"… with nothing to activate | 2.1.1 Keyboard, 4.1.2 Name, Role, Value, 1.3.1 Info and Relationships, 1.4.1 Use of Color | **critical, blocking** | native radio group in `<fieldset><legend>Available times</legend>`, visible focus ring, taken slot is `disabled` |
| 6 | book | Full name input has a placeholder and no label | `textbox "Full name"` (Chromium falls back to the placeholder, which disappears as soon as you type) | 3.3.2 Labels or Instructions, 1.3.1 Info and Relationships | moderate | `<label for="name">Full name</label>` (visually hidden, to keep the identical look) |
| 7 | book | Email input has no label and no placeholder; the visible "Email" is a separate `<div>` | `textbox` (no name) | 1.3.1 Info and Relationships, 3.3.2 Labels or Instructions, 4.1.2 Name, Role, Value | serious | `<label for="email">Email</label>` |
| 8 | book | Submit `<button>` contains only an SVG arrow; the visible "Book appointment" text is outside the button | `button` (no name) | 4.1.2 Name, Role, Value, 1.1.1 Non-text Content, 2.5.3 Label in Name | serious | the whole pill is the `<button>`, its text is "Book appointment" |
| 9 | book | Validation error ("Please choose a time slot.") is inserted as red text, with no `role="alert"` or live region and no focus move | nothing | 4.1.3 Status Messages, 3.3.1 Error Identification | serious | `<p id="form-error" role="alert">`, field gets `aria-describedby="form-error"` (and `aria-invalid`), focus moves to the field (first radio for time) |

A sighted mouse user can complete the booking in `bad/`. Only keyboard and screen reader users are blocked.

## Known limitation of `fixed/`

To keep the before/after visually identical, `fixed/` still shows the selected time slot through
its fill color only. Assistive tech now gets the state (`radio, checked`), which fixes it for screen
readers, but a full 1.4.1 fix for sighted users would add a non-color cue (for example a check icon).
The full name label is visually hidden for the same reason. A production site should show it.

## Second demo: GreenCart

`shop/` is a second fictional site, a grocery store, with different barriers from the clinic:
a cookie modal that is not a dialog, steppers named only "−" / "+", silent cart updates, delivery
options whose selected state is visual only, and a custom terms checkbox that blocks checkout.
Same rules: `shop/bad/` and `shop/fixed/` render pixel-identically. Task, pages and answer key:
[`shop/README.md`](shop/README.md). Entry points: `/demo/shop/bad/index.html` and `/demo/shop/fixed/index.html`.
