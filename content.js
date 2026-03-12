// content.js — Event listeners, navigation handling, and initialization for Jump Return
(function () {
  "use strict";

  var st = JR.state;
  var mouseIsDown = false;

  document.addEventListener("mousedown", function () { mouseIsDown = true; }, true);
  document.addEventListener("mouseup", function () { mouseIsDown = false; }, true);

  // --- Selection listener ---

  function handleSelectionChange() {
    if (st.confirmingDelete) { JR.shineDeleteConfirm(); return; }
    JR.removeAllPopups();
    var result = JR.getSelectedTextInAIResponse();
    if (!result) return;
    JR.createPopup({ text: result.text, sentence: result.sentence, blockTypes: result.blockTypes, rect: result.rect, range: result.range });
  }

  document.addEventListener("mouseup", function (e) {
    if (st.navWidget && st.navWidget.contains(e.target)) return;
    if (st.activePopup && st.activePopup.contains(e.target)) return;
    if (st.hoverToolbar && st.hoverToolbar.contains(e.target)) return;
    if (st.activePopup) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        var sel = window.getSelection();
        if (sel.isCollapsed) JR.selectSourceHighlightText();
        return;
      }
    }
    if (e.target.closest(".jr-source-highlight-done")) return;
    setTimeout(handleSelectionChange, 10);
  });

  // --- Dismissal ---

  document.addEventListener("mousedown", function (e) {
    if (!st.activePopup && st.popupStack.length === 0) return;
    if (st.confirmingDelete) {
      if (!st.hoverToolbar || !st.hoverToolbar.contains(e.target)) JR.shineDeleteConfirm();
      return;
    }
    if (st.hoverToolbar && st.hoverToolbar.contains(e.target)) return;
    var hlSpan = e.target.closest(".jr-source-highlight");
    if (hlSpan) {
      if (st.activeSourceHighlights.indexOf(hlSpan) !== -1) return;
      for (var i = 0; i < st.popupStack.length; i++) {
        if (st.popupStack[i].sourceHighlights.indexOf(hlSpan) !== -1) return;
      }
      if (st.activeHighlightId && hlSpan.getAttribute("data-jr-highlight-id") === st.activeHighlightId) return;
    }
    JR.removeAllPopups();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && st.activePopup) {
      if (st.confirmingDelete) { JR.shineDeleteConfirm(); return; }
      JR.removePopup();
    }
  });

  // Click on active source highlight → select text for copy;
  // click on completed highlight → open popup
  document.addEventListener("click", function (e) {
    if (st.confirmingDelete) {
      if (!st.hoverToolbar || !st.hoverToolbar.contains(e.target)) JR.shineDeleteConfirm();
      return;
    }
    if (st.activePopup) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        JR.selectSourceHighlightText();
        return;
      }
    }
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !st.completedHighlights.has(hlId)) return;
    if (st.activePopup && st.activeHighlightId && hlId === st.activeHighlightId) {
      JR.selectSourceHighlightText();
      return;
    }
    e.stopPropagation();
    if (span.closest(".jr-popup")) {
      JR.pushPopupState();
    } else {
      JR.removeAllPopups();
    }
    JR.createPopup({ completedId: hlId });
  });

  // --- Underline on highlights (hover + active) ---

  var hoverUnderlines = [];
  var hoveredHlId = null;
  var activeUnderlines = [];
  var lastMouseX = 0;
  var lastMouseY = 0;
  document.addEventListener("mousemove", function (e) {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
  }, true);

  function removeElems(arr) {
    for (var i = 0; i < arr.length; i++) arr[i].remove();
    arr.length = 0;
  }

  /**
   * Create underline elements for a highlight entry.
   * Works for page-level and popup-level highlights.
   */
  JR.createUnderlines = function (entry) {
    var elems = [];
    if (!entry || !entry.spans || entry.spans.length === 0) return elems;

    var allRects = [];
    var hlId = entry.spans[0].getAttribute("data-jr-highlight-id");
    for (var i = 0; i < entry.spans.length; i++) {
      var span = entry.spans[i];
      var range = document.createRange();
      range.selectNodeContents(span);
      var rRects = range.getClientRects();
      for (var r = 0; r < rRects.length; r++) allRects.push(rRects[r]);

      // If there's a next span, collect rects from any inner highlight spans
      // sitting between this span and the next (wrapping case).
      if (i < entry.spans.length - 1) {
        var sib = span.nextElementSibling;
        while (sib && sib !== entry.spans[i + 1]) {
          if (sib.classList.contains("jr-source-highlight-done")) {
            var innerRange = document.createRange();
            innerRange.selectNodeContents(sib);
            var iRects = innerRange.getClientRects();
            for (var ir = 0; ir < iRects.length; ir++) allRects.push(iRects[ir]);
          }
          sib = sib.nextElementSibling;
        }
      }
    }
    if (allRects.length === 0) return elems;

    // Group rects by line (same approximate bottom)
    var lines = [];
    for (var ri = 0; ri < allRects.length; ri++) {
      var rect = allRects[ri];
      if (rect.width === 0 && rect.height === 0) continue;
      var found = false;
      for (var li = 0; li < lines.length; li++) {
        if (Math.abs(lines[li].bottom - rect.bottom) < 8) {
          lines[li].left = Math.min(lines[li].left, rect.left);
          lines[li].right = Math.max(lines[li].right, rect.right);
          found = true;
          break;
        }
      }
      if (!found) {
        lines.push({ left: rect.left, right: rect.right, bottom: rect.bottom });
      }
    }

    // Find the nearest positioned ancestor for underline placement
    var posParent = null;
    var el = entry.spans[0].parentElement;
    while (el) {
      var pos = getComputedStyle(el).position;
      if (pos === "relative" || pos === "absolute" || pos === "fixed") {
        posParent = el;
        break;
      }
      el = el.parentElement;
    }
    if (!posParent) {
      posParent = entry.contentContainer;
      if (!posParent || !posParent.isConnected) {
        var article = entry.spans[0].closest("article");
        posParent = article ? article.parentElement : document.body;
      }
    }
    var pRect = posParent.getBoundingClientRect();

    for (var ui = 0; ui < lines.length; ui++) {
      var line = lines[ui];
      var underline = document.createElement("div");
      underline.className = "jr-highlight-underline";
      underline.style.left = (line.left - pRect.left) + "px";
      underline.style.top = (line.bottom - pRect.top + 1) + "px";
      underline.style.width = (line.right - line.left) + "px";
      posParent.appendChild(underline);
      elems.push(underline);
    }
    return elems;
  };

  // Hover underline — works on any highlight except the currently active one
  document.addEventListener("mouseover", function (e) {
    if (mouseIsDown) return;
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) {
      removeElems(hoverUnderlines);
      hoveredHlId = null;
      return;
    }
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !st.completedHighlights.has(hlId)) return;
    // Active highlight already has its own underline
    if (hlId === st.activeHighlightId) return;
    if (hoveredHlId === hlId) return;
    removeElems(hoverUnderlines);
    hoveredHlId = hlId;
    hoverUnderlines = JR.createUnderlines(st.completedHighlights.get(hlId));
  });

  document.addEventListener("mouseout", function (e) {
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var related = e.relatedTarget;
    if (related) {
      var relatedSpan = related.closest && related.closest(".jr-source-highlight-done");
      if (relatedSpan && relatedSpan.getAttribute("data-jr-highlight-id") === hoveredHlId) return;
    }
    removeElems(hoverUnderlines);
    hoveredHlId = null;
  });

  // On scroll, check if mouse is still over the hovered highlight — remove underline if not
  document.addEventListener("scroll", function () {
    if (!hoveredHlId) return;
    var entry = st.completedHighlights.get(hoveredHlId);
    if (!entry || !entry.spans || entry.spans.length === 0) {
      removeElems(hoverUnderlines);
      hoveredHlId = null;
      return;
    }
    var elUnder = document.elementFromPoint(lastMouseX, lastMouseY);
    if (!elUnder || !elUnder.closest || !elUnder.closest(".jr-source-highlight-done[data-jr-highlight-id=\"" + hoveredHlId + "\"]")) {
      removeElems(hoverUnderlines);
      hoveredHlId = null;
    }
  }, true);

  // Active underline — shown while popup is open
  JR.showActiveUnderline = function (hlId) {
    removeElems(activeUnderlines);
    var entry = st.completedHighlights.get(hlId);
    if (entry) activeUnderlines = JR.createUnderlines(entry);
    // Clear any hover underline
    removeElems(hoverUnderlines);
    hoveredHlId = null;
  };

  JR.removeActiveUnderline = function () {
    removeElems(activeUnderlines);
  };

  // --- SPA navigation ---

  function onNavigate() {
    var currentUrl = location.href;
    if (currentUrl === st.lastKnownUrl) return;
    st.lastKnownUrl = currentUrl;

    JR.removeAllPopups();
    JR.hideToolbar();
    if (st.navWidget) {
      if (st.navWidget._jrScrollCleanup) st.navWidget._jrScrollCleanup();
      st.navWidget.remove();
      st.navWidget = null;
    }
    if (st.restoreTimer) {
      clearTimeout(st.restoreTimer);
      st.restoreTimer = null;
    }
    st.completedHighlights.forEach(function (entry) {
      for (var i = 0; i < entry.spans.length; i++) {
        var span = entry.spans[i];
        var parent = span.parentNode;
        if (!parent) continue;
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        parent.removeChild(span);
        parent.normalize();
      }
    });
    st.completedHighlights.clear();
    setTimeout(JR.restoreHighlights, 1000);
  }

  window.addEventListener("popstate", onNavigate);

  var origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    onNavigate();
  };

  var origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    onNavigate();
  };

  // Fallback navigation detection
  setInterval(function () {
    if (location.href !== st.lastKnownUrl) {
      onNavigate();
    }
  }, 500);

  // Restore saved highlights on initial page load
  JR.restoreHighlights();
})();
