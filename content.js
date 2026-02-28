// content.js — Event listeners, navigation handling, and initialization for Jump Return
(function () {
  "use strict";

  var st = JR.state;

  // --- Selection listener ---

  function handleSelectionChange() {
    if (st.confirmingDelete) return;
    JR.removeAllPopups();
    var result = JR.getSelectedTextInAIResponse();
    if (!result) return;
    JR.createPopup({ text: result.text, sentence: result.sentence, blockTypes: result.blockTypes, rect: result.rect, range: result.range });
  }

  document.addEventListener("mouseup", function (e) {
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
    if (st.confirmingDelete) return;
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
      if (st.confirmingDelete) return;
      JR.removePopup();
    }
  });

  // Click on active source highlight → select text for copy;
  // click on completed highlight → open popup
  document.addEventListener("click", function (e) {
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

  // --- Hover toolbar on completed highlights ---

  var hoveredHlId = null;

  function setHighlightHover(hlId) {
    if (hoveredHlId === hlId) return;
    clearHighlightHover();
    hoveredHlId = hlId;
    var entry = st.completedHighlights.get(hlId);
    if (!entry || !entry.spans) return;
    for (var i = 0; i < entry.spans.length; i++) {
      entry.spans[i].classList.add("jr-source-highlight-hover");
    }
  }

  function clearHighlightHover() {
    if (!hoveredHlId) return;
    var entry = st.completedHighlights.get(hoveredHlId);
    if (entry && entry.spans) {
      for (var i = 0; i < entry.spans.length; i++) {
        entry.spans[i].classList.remove("jr-source-highlight-hover");
      }
    }
    hoveredHlId = null;
  }

  document.addEventListener("mouseover", function (e) {
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !st.completedHighlights.has(hlId)) return;
    // Don't activate hover on other highlights while a popup is open
    // (allow the active highlight itself and children inside the active popup)
    if (st.activeHighlightId && hlId !== st.activeHighlightId) {
      if (!span.closest(".jr-popup")) return;
    }
    setHighlightHover(hlId);
    // Already showing toolbar for this highlight
    if (st.hoverToolbarHlId === hlId) {
      if (st.hoverToolbarTimer) {
        clearTimeout(st.hoverToolbarTimer);
        st.hoverToolbarTimer = null;
      }
      return;
    }
    JR.showToolbar(hlId);
  });

  document.addEventListener("mouseout", function (e) {
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !st.completedHighlights.has(hlId)) return;
    // Check if mouse moved to another span of the same highlight
    var related = e.relatedTarget;
    if (related) {
      var relatedSpan = related.closest && related.closest(".jr-source-highlight-done");
      if (relatedSpan && relatedSpan.getAttribute("data-jr-highlight-id") === hlId) return;
    }
    clearHighlightHover();
    if (hlId !== st.hoverToolbarHlId) return;
    st.hoverToolbarTimer = setTimeout(function () {
      JR.hideToolbar();
    }, 80);
  });

  // --- SPA navigation ---

  function onNavigate() {
    var currentUrl = location.href;
    if (currentUrl === st.lastKnownUrl) return;
    st.lastKnownUrl = currentUrl;

    JR.removeAllPopups();
    JR.hideToolbar();
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
