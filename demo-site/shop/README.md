# Demo site 2: GreenCart grocery store (fictional)

A small grocery store in two versions, used to show that BlindSpot finds more than the clinic's
unlabeled controls. Static HTML, CSS and vanilla JS, no build step. Served by `src/server.ts` at
`/demo/shop/`.

| Version | Entry point | What a screen reader user gets |
|---|---|---|
| `bad/` | `/demo/shop/bad/index.html` | Common e-commerce barriers. Checkout is **impossible** without sight (terms checkbox). |
| `fixed/` | `/demo/shop/fixed/index.html` | Same pages, accessible markup. The order can be placed end to end. |

Both versions use `shared/shop.css` and render **pixel-identically**: a sighted viewer cannot tell
them apart. Only the accessibility tree differs. `tests/demo-shop.test.ts` checks this with byte-equal
screenshots (cookie banner open, product grid with a changed quantity, cart, checkout, checkout with
the error shown, checkout with the terms ticked, order placed).

Demo task:

> Buy 2 kg of apples and a loaf of bread, then check out with home delivery. Use the name Alex Doe, address 12 Elm Street, and accept the terms.

Pages: `index.html` (product grid) → `cart.html` → `checkout.html` → `done.html` (heading "Order placed",
items and details read from localStorage and written with `textContent` only).

State (cookie choice, cart, last order) is kept in `localStorage` under `greencart:bad:*` and
`greencart:fixed:*`, so the two versions never share it. The cookie banner shows on the first
visit only; BlindSpot starts each test with a fresh browser, so it always sees it. To see it again
in your own browser, open any page with `?reset` (for example `/demo/shop/bad/index.html?reset`).

## Answer key: barriers in `bad/`

What BlindSpot should find. Severity is what a blind user experiences; "Blocker" means the task
cannot be completed.

| # | Page | Barrier | What the screen reader announces | WCAG 2.2 | Severity | Fix in `fixed/` |
|---|---|---|---|---|---|---|
| 1 | all (first visit) | Cookie consent modal is a plain `<div>` overlay: no `role="dialog"`, no `aria-modal`, no label, focus stays at the top of the page, and the page behind stays in the accessibility tree. Every button on the page **silently does nothing** until consent is given. "Accept all" is a non-focusable `<div onclick>`; the only control a keyboard or screen reader user can reach is the corner close icon, a `<div tabindex="0">` holding an SVG with no name (it accepts on click / Enter / Space). | The banner text at the very end of the page, after the footer: `generic (focusable) ""`, `text "We value your privacy"`, …, `text "Accept all"`. Pressing "+" or "Add" before that: nothing happens, nothing is announced | 4.1.2 Name, Role, Value, 2.4.3 Focus Order, 1.3.1 Info and Relationships, 2.1.1 Keyboard | serious (a careful user can guess the unnamed element, so it is worked around) | `role="dialog" aria-modal="true" aria-labelledby` on the box, rest of the page `inert` while open, focus moved to a real `<button>Accept all</button>`, close button `aria-label="Accept all and close"`, Escape closes, focus restored to the main heading |
| 2 | home | Quantity steppers are real buttons, but named only "−" and "+", the same for all 5 products | `button "−"`, `button "+"` ×5 | 2.4.6 Headings and Labels, 4.1.2 Name, Role, Value | moderate | `aria-label="Decrease apples quantity"` / `"Increase apples quantity"` |
| 3 | home | The quantity is a `<span>`: not exposed as the stepper's value, not editable, and its change is not announced | `text "1"` between the buttons | 4.1.2 Name, Role, Value, 1.3.1 Info and Relationships | moderate | `<input type="number">` with a (visually hidden) label "Apples quantity in kg", styled like the span |
| 4 | home | Every add-to-cart button is named "Add" | `button "Add"` ×5 | 2.4.6 Headings and Labels, 4.1.2 Name, Role, Value | moderate | `Add<span class="visually-hidden"> apples to cart</span>`, name "Add apples to cart" (visible text kept, 2.5.3 Label in Name) |
| 5 | all | Adding to the cart only updates the badge on the cart link; nothing is announced | nothing (the link name becomes "Cart 1" silently) | 4.1.3 Status Messages | serious | `role="status"` region: "Apples, 2 kg, added. Cart: 1 item."; stepper changes announced too ("Apples quantity: 2 kg."); link named "Cart (1 item)" |
| 6 | checkout | Delivery method cards are `<div role="button">` without `tabindex` and without `aria-pressed` / `aria-checked`. Which one is selected (pickup by default) is shown only by a green border and a filled dot | `button "Home delivery Tomorrow, 8:00 to 12:00 $4.99"`, `button "Store pickup …"`, no state; after a click: "nothing announced, but the page content changed" | 1.4.1 Use of Color, 4.1.2 Name, Role, Value, 2.1.1 Keyboard, 1.3.1 Info and Relationships | serious | native radio group in `<fieldset><legend>Delivery method</legend>`, each radio named "Home delivery $4.99" and described by its time slot |
| - | checkout | Full name and Address are correctly labelled (control case, so the agent makes progress) | `textbox "Full name"`, `textbox "Address"` | - | - | - |
| 7 | checkout | **Terms checkbox is a `<div class="checkbox" onclick>` next to plain text: no role, not focusable, no state. Placing the order requires it. BLOCKER** | `text "I accept the terms of sale and the privacy policy"` with nothing to activate | 4.1.2 Name, Role, Value, 2.1.1 Keyboard, 1.3.1 Info and Relationships | **critical, blocking** | native `<input type="checkbox" id="terms">` with `<label for="terms">`, styled like the div |
| 8 | checkout | Validation errors ("Please accept the terms of sale to place your order.") are red text only: no `role="alert"`, no focus move, no `aria-invalid` | nothing; the agent only sees the "Place order" button keep focus | 4.1.3 Status Messages, 3.3.1 Error Identification | serious | `<p id="form-error" role="alert">`, field gets `aria-invalid="true"` and `aria-describedby="form-error"`, focus moves to it |
| - | checkout | "Place order" is a real, named button (so the agent reaches the blocker and gets the silent error) | `button "Place order"` | - | - | - |

A sighted mouse user can complete the order in `bad/`. Only keyboard and screen reader users are blocked.

Barriers 1 to 8 are deliberately different from the clinic demo (missing alt text, unlabeled
fields, clickable div slots): this site is about modals, ambiguous repeated controls, missing
state and silent status changes.

## Known limitations of `fixed/`

- To stay visually identical, the quantity label ("Apples quantity in kg") is visually hidden.
- The selected delivery card is still shown by colour and a filled dot only (assistive tech now
  gets `radio, checked`); a full 1.4.1 fix for sighted users would add a text cue such as "Selected".
- Real sites should let users refuse non-essential cookies; the banner only has "Accept all" (and
  Escape / close, which also accept) to keep the demo short.
