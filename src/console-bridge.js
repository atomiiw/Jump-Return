// console-bridge.js — Runs in MAIN world so JR.go() works from the browser console.
// Communicates with the content script (ISOLATED world) via CustomEvents on document.
(function () {
  window.JR = window.JR || {};
  window.JR.go = function (itemId) {
    document.dispatchEvent(new CustomEvent("jr-go", { detail: itemId || null }));
  };
  window.JR.open = function (quoteId, itemIndex) {
    document.dispatchEvent(new CustomEvent("jr-open", { detail: { quoteId: quoteId, itemIndex: itemIndex } }));
  };
})();
