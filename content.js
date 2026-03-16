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
    if (e.target.closest(".jr-search-bar")) return;
    if (st.navWidget && st.navWidget.contains(e.target)) return;
    if (st.activePopup && st.activePopup.contains(e.target)) return;
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
    // Ignore clicks on the "Ask ChatGPT" dismiss button or search bar
    if (e.target.closest(".jr-popup-disable-btn")) return;
    if (e.target.closest(".jr-search-bar")) return;
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
    if (e.key === "Escape") {
      if (!st.activePopup) return;
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
      // Only include spans that belong to this same highlight (same hlId).
      if (i < entry.spans.length - 1) {
        var sib = span.nextElementSibling;
        while (sib && sib !== entry.spans[i + 1]) {
          if (sib.classList.contains("jr-source-highlight-done") &&
              sib.getAttribute("data-jr-highlight-id") === hlId) {
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
    var scrollOffsetX = posParent.scrollLeft || 0;
    var scrollOffsetY = posParent.scrollTop || 0;

    for (var ui = 0; ui < lines.length; ui++) {
      var line = lines[ui];
      var underline = document.createElement("div");
      underline.className = "jr-highlight-underline";
      underline.style.left = (line.left - pRect.left + scrollOffsetX) + "px";
      underline.style.top = (line.bottom - pRect.top + scrollOffsetY + 1) + "px";
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


  // --- Helper functions for popup navigation ---

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

  // --- Popup open / transition API ---

  /**
   * Get the current item id from the active popup state.
   * Returns null if no popup is open or no items.
   */
  function getCurrentItemId() {
    if (!st.activeHighlightId) return null;
    var entry = st.completedHighlights.get(st.activeHighlightId);
    if (!entry || !entry.items || entry.items.length === 0) return null;
    var idx = entry.activeItemIndex != null ? entry.activeItemIndex : 0;
    return entry.items[idx] ? entry.items[idx].id : null;
  }

  /**
   * Find quoteId and item index for a given item id.
   * Searches all in-memory entries.
   * Returns { quoteId, entry, itemIndex } or null.
   */
  function findItemById(itemId) {
    var result = null;
    st.completedHighlights.forEach(function (entry, quoteId) {
      if (result) return;
      if (!entry.items) return;
      for (var i = 0; i < entry.items.length; i++) {
        if (entry.items[i].id === itemId) {
          result = { quoteId: quoteId, entry: entry, itemIndex: i };
          return;
        }
      }
    });
    return result;
  }

  /**
   * Open a highlight popup by quoteId. Handles L1 and nested highlights.
   * Scrolls the page to center the popup. For nested highlights, opens
   * the full parent chain first, scrolling within each popup response.
   *
   * @param {string} quoteId - The highlight's quoteId
   * @param {number} [itemIndex] - Optional item index to show (version)
   * @param {object} [opts] - Options: { _skipScroll: true } to suppress scrollIntoView
   */
  JR.openHighlight = function (quoteId, itemIndex, opts) {
    opts = opts || {};
    var entry = st.completedHighlights.get(quoteId);
    if (!entry) return;

    // Build the chain from L1 root to this quoteId
    var chain = buildChain(quoteId);
    var l1Id = chain[0];

    // Switch to desired item index before opening
    if (itemIndex != null && entry.items && entry.items[itemIndex]) {
      entry.activeItemIndex = itemIndex;
      var v = entry.items[itemIndex];
      entry.question = v.question;
      entry.responseHTML = v.responseHTML;
      setActiveItem(quoteId, v.id);
    }

    // Close everything and open the L1
    JR.removeAllPopups();
    var l1Entry = st.completedHighlights.get(l1Id);
    if (!l1Entry) return;
    if (!opts._skipScroll && l1Entry.spans && l1Entry.spans.length > 0) {
      l1Entry.spans[0].scrollIntoView({ block: "center" });
    }
    JR.createPopup({ completedId: l1Id });
    if (!st.activePopup) return;

    if (chain.length === 1) {
      scrollPopupToCenter();
      return;
    }

    // Open nested chain after chained highlights have been restored
    var remaining = chain.slice(1);
    setTimeout(function () {
      for (var i = 0; i < remaining.length; i++) {
        scrollResponseToChild(remaining[i]);
        JR.pushPopupState();
        JR.createPopup({ completedId: remaining[i] });
      }
      scrollPopupToCenter();
    }, 120);
  };

  /**
   * Close one popup layer (peel back). Returns the quoteId that is
   * now active after peeling, or null if everything is closed.
   */
  function peelOne() {
    JR.removePopup();
    return st.activeHighlightId || null;
  }

  /**
   * Open one nested popup layer on top of the current one.
   * The child quoteId must be a child of the currently active quoteId.
   * Scrolls the parent's response to center the child highlight first.
   */
  function openChildLayer(childQuoteId) {
    scrollResponseToChild(childQuoteId);
    JR.pushPopupState();
    JR.createPopup({ completedId: childQuoteId });
  }

  /**
   * Flip through versions one step at a time with animation delay.
   * Goes from currentIdx to targetIdx on the given entry, stepping ±1.
   * Calls callback when done.
   */
  function flipVersions(quoteId, entry, currentIdx, targetIdx, delay, callback) {
    if (currentIdx === targetIdx) {
      if (callback) callback();
      return;
    }
    var step = currentIdx < targetIdx ? 1 : -1;
    var nextIdx = currentIdx + step;

    // Use the version nav's switchVersion if popup is open
    var nav = st.activePopup ? st.activePopup.querySelector(".jr-popup-version-nav") : null;
    if (nav && nav._jrSwitchTo) {
      nav._jrSwitchTo(nextIdx);
    } else {
      // Fallback: update in-memory
      entry.activeItemIndex = nextIdx;
      var v = entry.items[nextIdx];
      entry.question = v.question;
      entry.responseHTML = v.responseHTML;
      setActiveItem(quoteId, v.id);
    }

    if (nextIdx === targetIdx) {
      if (callback) callback();
    } else {
      setTimeout(function () {
        flipVersions(quoteId, entry, nextIdx, targetIdx, delay, callback);
      }, delay);
    }
  }

  /**
   * Transition from the current popup state to a target item.
   *
   * If same quoteId (same highlight, different version): flip through
   * versions one by one to reach the target.
   *
   * If different quoteIds: find closest common parent, peel back to it
   * step by step, then open popups one by one down to the target.
   *
   * @param {string} targetItemId - The target item's id
   */
  JR.transitionTo = function (targetItemId, onDone) {
    // Every transition ends by centering the popup, then calling onDone.
    function done() {
      scrollPopupToCenter();
      if (onDone) onDone();
    }

    if (!targetItemId) {
      JR.removeAllPopups();
      done();
      return;
    }
    var target = findItemById(targetItemId);
    if (!target) {
      console.warn("[JR] transitionTo: item not found:", targetItemId);
      done();
      return;
    }

    var currentItemId = getCurrentItemId();
    if (currentItemId === targetItemId) {
      done();
      return;
    }

    var currentQuoteId = st.activeHighlightId;
    var targetQuoteId = target.quoteId;
    var STEP_DELAY = 350;

    // --- Case 1: Same quoteId, different version ---
    if (currentQuoteId === targetQuoteId) {
      var entry = target.entry;
      var currentIdx = entry.activeItemIndex != null ? entry.activeItemIndex : 0;
      flipVersions(targetQuoteId, entry, currentIdx, target.itemIndex, STEP_DELAY, done);
      return;
    }

    // --- Case 2: Different quoteIds — find common ancestor and navigate ---

    // Build ancestor chains (quoteId chains from root to leaf)
    var currentChain = currentQuoteId ? buildChain(currentQuoteId) : [];
    var targetChain = buildChain(targetQuoteId);

    // Find the longest common prefix
    var commonLen = 0;
    var minLen = Math.min(currentChain.length, targetChain.length);
    for (var i = 0; i < minLen; i++) {
      if (currentChain[i] === targetChain[i]) {
        commonLen = i + 1;
      } else {
        break;
      }
    }

    // Steps to peel: close from current depth down to commonLen
    var peelCount = currentChain.length - commonLen;
    // Steps to open: open from commonLen up to target depth
    var openSteps = targetChain.slice(commonLen);

    // --- Pre-compute version switches needed along the open path ---
    // Each child in openSteps may require its parent to be at a specific
    // version (identified by parentItemId). For entries that will be freshly
    // created (not yet a popup), set activeItemIndex in-memory so createPopup
    // renders the right version. For the common ancestor (already displayed),
    // we must call switchPopupToVersion after peeling to update the DOM.
    var ancestorSwitch = null; // { quoteId, version } — for the already-open common ancestor
    for (var osi = 0; osi < openSteps.length; osi++) {
      var childEnt = st.completedHighlights.get(openSteps[osi]);
      if (!childEnt || !childEnt.parentItemId) continue;
      var parentQid = childEnt.parentId;
      var parentEnt = st.completedHighlights.get(parentQid);
      if (!parentEnt || !parentEnt.items || parentEnt.items.length <= 1) continue;
      for (var pvi = 0; pvi < parentEnt.items.length; pvi++) {
        if (parentEnt.items[pvi].id !== childEnt.parentItemId) continue;
        var curIdx = parentEnt.activeItemIndex != null ? parentEnt.activeItemIndex : 0;
        if (curIdx === pvi) break; // already correct
        if (commonLen > 0 && parentQid === targetChain[commonLen - 1]) {
          // Parent is the common ancestor (popup already open) — need DOM switch after peeling
          ancestorSwitch = { quoteId: parentQid, version: pvi };
        } else {
          // Parent will be freshly opened — set in-memory so createPopup uses the right version
          parentEnt.activeItemIndex = pvi;
          parentEnt.question = parentEnt.items[pvi].question;
          parentEnt.responseHTML = parentEnt.items[pvi].responseHTML;
        }
        break;
      }
    }

    // Execute step by step with delays
    var stepIndex = 0;
    var totalPeelSteps = peelCount;

    function doNextStep() {
      if (stepIndex < totalPeelSteps) {
        // Peel one layer
        peelOne();
        stepIndex++;
        // Only delay if there are more peels to animate;
        // otherwise fall through immediately to open/finish.
        if (stepIndex < totalPeelSteps) {
          setTimeout(doNextStep, STEP_DELAY);
          return;
        }
      }
      if (openSteps.length > 0) {
        // Switch the common ancestor's version if needed (after peeling, before opening children).
        // This rebuilds its response div and restores child highlight spans via restoreChainedHighlights.
        if (ancestorSwitch) {
          if (JR.switchPopupToVersion) JR.switchPopupToVersion(ancestorSwitch.quoteId, ancestorSwitch.version);
          ancestorSwitch = null;
        }

        // Open layers one by one
        var childId = openSteps.shift();
        // First open step: if nothing is open (commonLen === 0),
        // we need to do a full L1 open with scroll
        if (!st.activePopup) {
          var childEntry = st.completedHighlights.get(childId);
          if (childEntry && childEntry.spans && childEntry.spans.length > 0) {
            childEntry.spans[0].scrollIntoView({ block: "center" });
          }
          JR.createPopup({ completedId: childId });
        } else {
          // Wait a tick for chained highlights to restore in the response div
          setTimeout(function () {
            openChildLayer(childId);
            if (openSteps.length > 0) {
              setTimeout(doNextStep, STEP_DELAY);
            } else {
              finishWithVersion();
            }
          }, 120);
          return;
        }

        if (openSteps.length > 0) {
          setTimeout(doNextStep, STEP_DELAY);
        } else {
          finishWithVersion();
        }
      } else {
        finishWithVersion();
      }
    }

    function finishWithVersion() {
      var entry2 = st.completedHighlights.get(targetQuoteId);
      if (!entry2) { done(); return; }
      var currentIdx2 = entry2.activeItemIndex != null ? entry2.activeItemIndex : 0;
      if (currentIdx2 !== target.itemIndex) {
        flipVersions(targetQuoteId, entry2, currentIdx2, target.itemIndex, STEP_DELAY, done);
      } else {
        done();
      }
    }

    doNextStep();
  };

  /**
   * Console shortcut: transition to a target item by its id.
   * Logs available item ids when called with no argument.
   */
  JR.go = function (targetItemId) {
    if (targetItemId === null) {
      JR.transitionTo(null);
      return;
    }
    if (targetItemId === undefined || targetItemId === "") {
      // Print all available items
      console.log("[JR] Available items:");
      st.completedHighlights.forEach(function (entry, quoteId) {
        if (!entry.items || entry.items.length === 0) return;
        var depth = 0;
        var e = entry;
        while (e && e.parentId) { depth++; e = st.completedHighlights.get(e.parentId); }
        var indent = "  ".repeat(depth);
        for (var i = 0; i < entry.items.length; i++) {
          var item = entry.items[i];
          var active = (i === entry.activeItemIndex) ? " ← active" : "";
          var current = (quoteId === st.activeHighlightId && i === entry.activeItemIndex) ? " ★ current" : "";
          console.log(indent + "id: " + item.id + "  q: \"" + (item.question || "").slice(0, 40) + "\"  quote: \"" + (entry.text || "").slice(0, 30) + "\"" + active + current);
        }
      });
      return;
    }
    JR.transitionTo(targetItemId);
  };

  // --- Log item id when popup opens ---
  var _origCreatePopup = JR.createPopup;
  JR.createPopup = function (opts) {
    _origCreatePopup(opts);
    // After popup is created, log the active item
    if (st.activeHighlightId) {
      var entry = st.completedHighlights.get(st.activeHighlightId);
      if (entry && entry.items && entry.items.length > 0) {
        var idx = entry.activeItemIndex != null ? entry.activeItemIndex : 0;
        var item = entry.items[idx];
        if (item) {
          console.log("[JR] popup opened — item: " + item.id + "  quoteId: " + st.activeHighlightId + "  question: \"" + (item.question || "(none)").slice(0, 50) + "\"");
        }
      }
    }
  };

  // --- SPA navigation ---

  /**
   * Update the early-hide <style> tag for the current URL so turns stay hidden
   * during SPA navigation (the document_start script only fires on full loads).
   */
  function refreshEarlyHideStyle() {
    var url = location.href;
    try {
    chrome.storage.local.get(["jumpreturn_highlights", "jumpreturn_deleted_turns"], function (result) {
      var highlights = result.jumpreturn_highlights || [];
      var deletedAll = result.jumpreturn_deleted_turns || {};
      var deletedTurns = deletedAll[url] || [];
      var turnSet = {};
      for (var i = 0; i < highlights.length; i++) {
        var h = highlights[i];
        if (h.url !== url) continue;
        if (h.questionIndex > 0) turnSet[h.questionIndex] = true;
        if (h.responseIndex > 0) turnSet[h.responseIndex] = true;
      }
      for (var d = 0; d < deletedTurns.length; d++) {
        if (deletedTurns[d] > 0) turnSet[deletedTurns[d]] = true;
      }
      var existing = document.getElementById("jr-early-hide");
      var indices = Object.keys(turnSet);
      if (indices.length === 0) {
        if (existing) existing.remove();
        return;
      }
      var rules = [];
      for (var r = 0; r < indices.length; r++) {
        rules.push('article[data-testid="conversation-turn-' + indices[r] + '"]');
      }
      var css = rules.join(",\n") + " { display: none !important; }";
      if (existing) {
        existing.textContent = css;
      } else {
        var style = document.createElement("style");
        style.id = "jr-early-hide";
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
      }
    });
    } catch (e) { /* extension context invalidated after reload */ }
  }

  function onNavigate() {
    var currentUrl = location.href;
    if (currentUrl === st.lastKnownUrl) return;
    st.lastKnownUrl = currentUrl;

    JR.removeAllPopups();
    JR.hideSearchBar();
    JR.hideToolbar();
    st.messageQueue.length = 0;
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
    refreshEarlyHideStyle();
    setTimeout(JR.restoreHighlights, 1000);
    setTimeout(JR.initSearchBar, 1500);
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

  // Init the always-visible search bar (delay for DOM to be ready)
  setTimeout(JR.initSearchBar, 1500);

  // --- Expose console API to page's main world ---
  // Content scripts run in an isolated world; the browser console
  // runs in the main world. Bridge via CustomEvents on document.
  document.addEventListener("jr-go", function (e) {
    var itemId = e.detail || null;
    JR.go(itemId);
  });
  document.addEventListener("jr-open", function (e) {
    if (!e.detail) return;
    JR.openHighlight(e.detail.quoteId, e.detail.itemIndex);
  });
  document.addEventListener("jr-locate", function (e) {
    JR.locate(e.detail || null);
  });

  // Bridge script (src/console-bridge.js) runs in MAIN world via manifest,
  // exposing JR.go() and JR.open() to the browser console.
})();
