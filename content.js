// content.js — Event listeners, navigation handling, and initialization for Jump Return
(function () {
  "use strict";

  var st = JR.state;
  var mouseIsDown = false;

  document.addEventListener("mousedown", function () { mouseIsDown = true; }, true);
  document.addEventListener("mouseup", function () { mouseIsDown = false; }, true);

  // --- Selection listener ---

  function handleSelectionChange() {
    if (st.confirmingDelete) return;
    JR.removeAllPopups();
    var result = JR.getSelectedTextInAIResponse();
    if (!result) return;
    JR.createPopup({ text: result.text, sentence: result.sentence, blockTypes: result.blockTypes, rect: result.rect, range: result.range });
  }

  document.addEventListener("mouseup", function (e) {
    if (e.target.closest(".jr-popup-disable-btn")) return;
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
    // Ignore clicks on the "Ask ChatGPT" dismiss button — don't close our popup
    if (e.target.closest(".jr-popup-disable-btn")) return;
    if (!st.activePopup && st.popupStack.length === 0) return;
    if (st.confirmingDelete) {
      // Click outside popup cancels delete confirmation
      if (st.activePopup && !st.activePopup.contains(e.target)) {
        st.confirmingDelete = false;
        JR.removeAllPopups();
      }
      return;
    }
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
    if (st.confirmingDelete) return;
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

  // --- Strip hidden turn content from DOM so Cmd+F can't find it ---
  //
  // Hidden Q&A turns use display:none, which Chrome's Cmd+F should skip.
  // But as extra insurance, we also empty their text content and stash it
  // in a JS Map so it's completely unfindable by find-in-page.

  var strippedTurns = new Map(); // element → original innerHTML

  JR.stripHiddenTurnContent = function () {
    var hidden = document.querySelectorAll(".jr-hidden");
    for (var i = 0; i < hidden.length; i++) {
      var el = hidden[i];
      if (strippedTurns.has(el)) {
        // React may have re-rendered content into a previously stripped element
        if (el.innerHTML) {
          strippedTurns.set(el, el.innerHTML);
          el.textContent = "";
        }
        continue;
      }
      if (!el.innerHTML) continue; // already empty
      strippedTurns.set(el, el.innerHTML);
      el.textContent = "";
    }
  };

  JR.restoreHiddenTurnContent = function (el) {
    if (strippedTurns.has(el)) {
      el.innerHTML = strippedTurns.get(el);
      strippedTurns.delete(el);
    }
  };

  // Re-strip periodically to catch React re-renders that restore content
  // into previously stripped elements.  We do NOT use a MutationObserver
  // because it would fire during waitForResponse polling and strip the
  // response turn's content before we can read/capture it.
  setInterval(function () {
    if (st.responseWatchActive) return; // response in progress — don't strip
    JR.stripHiddenTurnContent();
  }, 2000);

  // --- Cmd+F search through popup content ---
  //
  // hidden="until-found" containers hold popup Q&A text so Chrome's
  // Cmd+F can find it.  Hidden turns are stripped (above) so there are
  // no duplicate matches.  A MutationObserver detects when Chrome
  // reveals a container (removes hidden attr) and opens the popup.
  //
  // One container per version per highlight — so we know exactly which
  // version to switch to.  Containers are depth-first ordered:
  // L1-A v0, L1-A v1, A-child v0, L1-B v0, etc.

  var searchObserver = null;

  JR.buildSearchContainers = function () {
    var old = document.querySelectorAll(".jr-search-popup");
    for (var oi = 0; oi < old.length; oi++) old[oi].remove();
    if (searchObserver) { searchObserver.disconnect(); searchObserver = null; }

    var l1Items = JR.getLevel1HighlightIds();
    if (l1Items.length === 0) return;

    function getDescendantIds(parentId) {
      var children = [];
      st.completedHighlights.forEach(function (entry, id) {
        if (entry.parentId === parentId && entry.responseHTML) children.push(id);
      });
      var result = [];
      for (var ci = 0; ci < children.length; ci++) {
        result.push(children[ci]);
        var gc = getDescendantIds(children[ci]);
        for (var gi = 0; gi < gc.length; gi++) result.push(gc[gi]);
      }
      return result;
    }

    var cc = null;

    // Create one container per version.  If no versions array, create one
    // container for the single question+response.
    function makeContainers(hlId, insertAfter) {
      var entry = st.completedHighlights.get(hlId);
      if (!entry || !entry.responseHTML) return insertAfter;

      var versions = entry.versions && entry.versions.length > 0
        ? entry.versions
        : [{ question: entry.question, responseHTML: entry.responseHTML }];

      var last = insertAfter;
      for (var vi = 0; vi < versions.length; vi++) {
        var v = versions[vi];
        var container = document.createElement("div");
        container.className = "jr-search-popup";
        container.setAttribute("hidden", "until-found");
        container.setAttribute("data-jr-search-hl-id", hlId);
        container.setAttribute("data-jr-search-version", String(vi));

        if (v.question) {
          var qEl = document.createElement("p");
          qEl.textContent = v.question;
          container.appendChild(qEl);
        }
        if (v.responseHTML) {
          var rEl = document.createElement("div");
          rEl.innerHTML = v.responseHTML;
          container.appendChild(rEl);
        }

        last.parentNode.insertBefore(container, last.nextSibling);
        if (!cc) cc = last.parentNode;
        last = container;
      }
      return last;
    }

    for (var i = 0; i < l1Items.length; i++) {
      var l1Id = l1Items[i];
      var l1Entry = st.completedHighlights.get(l1Id);
      if (!l1Entry || !l1Entry.spans || l1Entry.spans.length === 0) continue;
      var anchor = l1Entry.spans[0].closest("article") || l1Entry.spans[0].parentElement;
      if (!anchor || !anchor.parentNode) continue;
      var last = makeContainers(l1Id, anchor);
      var desc = getDescendantIds(l1Id);
      for (var di = 0; di < desc.length; di++) last = makeContainers(desc[di], last);
    }

    if (!cc) return;

    // Detect when Chrome reveals a container (removes hidden attr)
    searchObserver = new MutationObserver(function (mutations) {
      var revealedHlId = null;
      var revealedVersion = null;
      for (var mi = 0; mi < mutations.length; mi++) {
        var m = mutations[mi];
        if (m.attributeName !== "hidden") continue;
        var t = m.target;
        if (!t.classList || !t.classList.contains("jr-search-popup")) continue;
        if (t.hasAttribute("hidden")) continue;
        var hlId = t.getAttribute("data-jr-search-hl-id");
        if (hlId) {
          revealedHlId = hlId;
          var vStr = t.getAttribute("data-jr-search-version");
          revealedVersion = vStr != null ? parseInt(vStr, 10) : null;
        }
      }
      if (!revealedHlId) return;

      openHighlightChain(revealedHlId, revealedVersion);

      // Re-hide after a delay so Chrome finishes processing this match
      // before the container becomes findable again for the next Cmd+G
      setTimeout(function () {
        var revealed = document.querySelectorAll(".jr-search-popup:not([hidden])");
        for (var ri = 0; ri < revealed.length; ri++) {
          revealed[ri].setAttribute("hidden", "until-found");
        }
      }, 200);
    });

    searchObserver.observe(cc, {
      attributes: true,
      subtree: true,
      attributeFilter: ["hidden"],
    });
  };

  /**
   * Figure out which L1 ancestor and deepest nested highlight this
   * hlId belongs to.  Returns { chain: [L1, …, hlId], l1Id }.
   */
  function buildChain(hlId) {
    var chain = [hlId];
    var entry = st.completedHighlights.get(hlId);
    while (entry && entry.parentId) {
      chain.unshift(entry.parentId);
      entry = st.completedHighlights.get(entry.parentId);
    }
    return chain;
  }

  /**
   * Get the highlight ID the currently-open popup is displaying.
   * Looks at the active source highlights first, then the popup stack.
   */
  function getCurrentPopupHlId() {
    if (st.activeSourceHighlights.length > 0) {
      return st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id");
    }
    return null;
  }

  /**
   * Scroll the chat scroll parent so that the popup is vertically
   * centered in the viewport.
   */
  function scrollPopupToCenter() {
    if (!st.activePopup) return;
    var popup = st.activePopup;
    var scrollParent = JR.getScrollParent(popup);
    if (!scrollParent) return;

    function doScroll() {
      if (!popup.isConnected) return;
      var popupRect = popup.getBoundingClientRect();
      var vpH = scrollParent === document.documentElement
        ? window.innerHeight
        : scrollParent.clientHeight;
      var popupCenter = popupRect.top + popupRect.height / 2;
      var vpCenter = vpH / 2;
      scrollParent.scrollTop += popupCenter - vpCenter;
    }

    // Scroll now, and again next frame to override Chrome's find-in-page
    // scroll which fires asynchronously after the observer callback.
    doScroll();
    requestAnimationFrame(doScroll);
  }

  /**
   * Open the full popup chain for a highlight, switch to the right
   * version, scroll the page so the popup is centered, and scroll the
   * popup response to show the nested highlight if applicable.
   *
   * If the right popup is already open, skip recreation to avoid
   * flicker — just switch version / scroll as needed.
   */
  function openHighlightChain(hlId, versionIdx) {
    var chain = buildChain(hlId);
    var l1Id = chain[0];

    // Verify the L1 highlight has been restored (has spans in the DOM).
    // If not, we can't open its popup — bail out silently.
    var l1Entry = st.completedHighlights.get(l1Id);
    if (!l1Entry) return;

    var currentHlId = getCurrentPopupHlId();

    // ── Determine if we can reuse the existing popup ──
    var canReuse = false;
    if (currentHlId) {
      // Same L1, no nesting needed
      if (chain.length === 1 && currentHlId === l1Id) canReuse = true;
      // Same deepest nested highlight already showing
      if (chain.length > 1 && currentHlId === hlId) canReuse = true;
    }

    if (canReuse) {
      // Single DOM update — no flicker
      switchVersionIfNeeded(hlId, versionIdx);
      scrollPopupToCenter();
      return;
    }

    // ── Open fresh popup chain ──
    JR.removeAllPopups();

    // Switch version on the target highlight BEFORE opening the popup
    // so createPopup reads the correct activeVersion/question/responseHTML.
    switchVersionInMemory(hlId, versionIdx);

    JR.createPopup({ completedId: l1Id });
    if (!st.activePopup) return; // popup creation failed

    if (chain.length === 1) {
      // L1 only — scroll page to center the popup
      scrollPopupToCenter();
      return;
    }

    // For nested chains, child highlights are loaded from storage
    // asynchronously inside restoreChainedHighlights.  Wait briefly
    // so the child spans exist before we try to scroll / open them.
    var remainingChain = chain.slice(1);
    setTimeout(function () {
      for (var i = 0; i < remainingChain.length; i++) {
        scrollResponseToChild(remainingChain[i]);
        JR.pushPopupState();
        JR.createPopup({ completedId: remainingChain[i] });
      }
      scrollPopupToCenter();
    }, 100);
  }

  /**
   * Sync in-memory entry fields to a specific version (and persist).
   */
  function switchVersionInMemory(hlId, versionIdx) {
    if (versionIdx == null) return;
    var entry = st.completedHighlights.get(hlId);
    if (!entry || !entry.versions || entry.versions.length <= 1) return;
    var v = entry.versions[versionIdx];
    if (!v) return;
    entry.activeVersion = versionIdx;
    entry.question = v.question;
    entry.responseHTML = v.responseHTML;
    setHighlightActiveVersion(hlId, versionIdx);
  }

  /**
   * If the popup for hlId is already open, switch to the target
   * version in a single DOM update (no arrow-click loop).
   */
  function switchVersionIfNeeded(hlId, versionIdx) {
    if (versionIdx == null) return;
    if (JR.switchPopupToVersion) JR.switchPopupToVersion(hlId, versionIdx);
  }

  /**
   * Scroll the currently-open popup's response area so that a child
   * highlight's spans are centered within it.
   */
  function scrollResponseToChild(childHlId) {
    var childEntry = st.completedHighlights.get(childHlId);
    if (!childEntry || !childEntry.spans || childEntry.spans.length === 0) return;
    var responseDiv = childEntry.spans[0].closest(".jr-popup-response");
    if (!responseDiv) return;
    var spanRect = childEntry.spans[0].getBoundingClientRect();
    var respRect = responseDiv.getBoundingClientRect();
    var offset = spanRect.top - respRect.top + responseDiv.scrollTop;
    responseDiv.scrollTop = offset - responseDiv.clientHeight / 2;
  }

  // --- SPA navigation ---

  function onNavigate() {
    var currentUrl = location.href;
    if (currentUrl === st.lastKnownUrl) return;
    st.lastKnownUrl = currentUrl;

    strippedTurns.clear();
    if (searchObserver) { searchObserver.disconnect(); searchObserver = null; }
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

  // --- Inject disable × on ChatGPT's native "Ask ChatGPT" selection button ---

  function hideAskBtn(askBtn) {
    // Hide the native "Ask ChatGPT" popover container
    var container = askBtn.closest('[popover], [style*="position"]') || askBtn.parentElement;
    if (container) container.style.display = "none";
  }

  function injectDisableBtn(askBtn) {
    if (askBtn._jrDisableInjected) return;
    askBtn._jrDisableInjected = true;

    // Make the button a positioning context and slightly wider for the ×
    if (getComputedStyle(askBtn).position === "static") {
      askBtn.style.position = "relative";
    }
    askBtn.style.paddingRight = (parseInt(getComputedStyle(askBtn).paddingRight, 10) + 16) + "px";

    var btn = document.createElement("span");
    btn.className = "jr-popup-disable-btn";
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>';

    // Tooltip as a fixed-position element on document.body (escapes all clipping)
    var tooltip = document.createElement("div");
    tooltip.className = "jr-disable-tooltip";
    tooltip.textContent = "Hide until reload";

    btn.addEventListener("mouseenter", function () {
      var r = btn.getBoundingClientRect();
      tooltip.style.top = (r.top + r.height / 2) + "px";
      tooltip.style.left = (r.right + 6) + "px";
      document.body.appendChild(tooltip);
    });
    btn.addEventListener("mouseleave", function () {
      if (tooltip.parentNode) tooltip.remove();
    });

    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
      if (tooltip.parentNode) tooltip.remove();
      st.askBtnHidden = true;
      hideAskBtn(askBtn);
    });

    askBtn.appendChild(btn);
  }

  var askBtnObserver = new MutationObserver(function () {
    var candidates = document.querySelectorAll('button');
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (c.textContent.trim() === "Ask ChatGPT" && !c._jrDisableInjected && !c.closest(".jr-popup")) {
        // If disabled, just hide the native button — don't inject ×
        if (st.askBtnHidden) {
          c._jrDisableInjected = true;
          hideAskBtn(c);
        } else {
          injectDisableBtn(c);
        }
      }
    }
  });
  askBtnObserver.observe(document.body, { childList: true, subtree: true });

  // Restore saved highlights on initial page load
  JR.restoreHighlights();
})();
