// Enlarged screenshot in a native modal <dialog>: focus is trapped, Escape closes it,
// and focus returns to the thumbnail that opened it.

let returnFocus = null;

function dialog() {
  return document.getElementById("lightbox");
}

export function openLightbox({ src, alt, caption }, opener) {
  const dlg = dialog();
  if (!dlg || typeof dlg.showModal !== "function") {
    window.open(src, "_blank", "noopener");
    return;
  }
  const img = dlg.querySelector("img");
  img.src = src;
  img.alt = alt;
  dlg.querySelector(".lightbox-caption").textContent = caption;
  returnFocus = opener ?? document.activeElement;
  dlg.showModal();
  dlg.querySelector(".lightbox-close").focus();
}

export function initLightbox() {
  const dlg = dialog();
  if (!dlg) return;
  dlg.querySelector(".lightbox-close").addEventListener("click", () => dlg.close());
  // Click on the backdrop (outside the content box) closes too.
  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) dlg.close();
  });
  dlg.addEventListener("close", () => {
    dlg.querySelector("img").removeAttribute("src");
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = null;
  });
}
