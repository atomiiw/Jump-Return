// content.js — Event listeners, navigation handling, and initialization for Popup
(function () {
  "use strict";

  var st = JR.state;
  var mouseIsDown = false;
  var triggerBtn = null; // floating "open popup" button after highlight
  var triggerData = null; // saved selection data for the trigger

  document.addEventListener("mousedown", function () { mouseIsDown = true; }, true);
  document.addEventListener("mouseup", function () { mouseIsDown = false; }, true);

  // --- Trigger button helpers ---

  var triggerScrollHandler = null;
  var triggerResizeHandler = null;
  var triggerSelChangeHandler = null;

  function removeTriggerBtn() {
    if (triggerScrollHandler) {
      document.removeEventListener("scroll", triggerScrollHandler, true);
      triggerScrollHandler = null;
    }
    if (triggerResizeHandler) {
      window.removeEventListener("resize", triggerResizeHandler);
      triggerResizeHandler = null;
    }
    if (triggerSelChangeHandler) {
      document.removeEventListener("selectionchange", triggerSelChangeHandler);
      triggerSelChangeHandler = null;
    }
    if (triggerBtn) {
      triggerBtn.remove();
      triggerBtn = null;
      triggerData = null;
    }
    removeDisableBtn();
  }
  JR.removeTriggerBtn = removeTriggerBtn;

  /**
   * Show trigger button for a selection.
   * @param {object} result - { text, sentence, blockTypes, rect, range }
   * @param {object} [opts] - { parentId } for chained (inside popup response)
   */
  function showTriggerBtn(result, opts) {
    removeTriggerBtn();
    triggerData = result;
    var chainParentId = opts && opts.parentId ? opts.parentId : null;

    triggerBtn = document.createElement("button");
    triggerBtn.type = "button";
    triggerBtn.className = "jr-highlight-trigger-btn";
    triggerBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216,36H40A20,20,0,0,0,20,56V184a20,20,0,0,0,20,20H98.11l12.52,21.92a20,20,0,0,0,34.74,0L157.89,204H216a20,20,0,0,0,20-20V56A20,20,0,0,0,216,36Zm-4,144H150.93a12,12,0,0,0-10.42,6.05L128,207.94l-12.51-21.89A12,12,0,0,0,105.07,180H44V60H212Z"/></svg>';
    triggerBtn.title = "Follow up";
    triggerBtn.setAttribute("aria-label", "Follow up on selection");
    triggerBtn.style.position = "fixed";

    function positionBtn() {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        removeTriggerBtn();
        return;
      }
      var range = sel.getRangeAt(0);
      var r = range.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) {
        removeTriggerBtn();
        return;
      }
      var btnSize = triggerBtn.offsetWidth || 32;
      var rects = range.getClientRects();
      var maxRight = r.right;
      for (var ri = 0; ri < rects.length; ri++) {
        if (rects[ri].right > maxRight) maxRight = rects[ri].right;
      }
      // Clamp to the popup edge if selection is inside a popup
      var rightLimit = window.innerWidth - btnSize - 4;
      var parentPopup = range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement && range.startContainer.parentElement.closest(".jr-popup")
        : range.startContainer.closest && range.startContainer.closest(".jr-popup");
      if (parentPopup) {
        var popupRect = parentPopup.getBoundingClientRect();
        rightLimit = popupRect.right - btnSize - 6;
      }
      triggerBtn.style.left = Math.min(maxRight + 6, rightLimit) + "px";
      triggerBtn.style.top = (r.top + r.height / 2 - (triggerBtn.offsetHeight || 32) / 2) + "px";
    }

    triggerBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      e.preventDefault();
      var data = triggerData;
      removeTriggerBtn();
      if (!data) return;

      // Compute sentence context now (deferred from selection time for speed)
      if (!data.sentence && data.range) {
        try {
          var blockTypes = [];
          data.sentence = JR.extractSentence(data.range, blockTypes);
          if (blockTypes.length > 0) data.blockTypes = blockTypes;
        } catch (ex) { /* sentence context is optional */ }
      }

      // Clear native selection
      var sel = window.getSelection();
      if (sel) sel.removeAllRanges();
      if (chainParentId) {
        // Chained popup inside a popup response
        JR.pushPopupState();
        JR.createPopup({ text: data.text, parentId: chainParentId, range: data.range });
      } else {
        // Page-level popup
        JR.removeAllPopups();
        JR.createPopup({ text: data.text, sentence: data.sentence, blockTypes: data.blockTypes, rect: data.rect, range: data.range });
      }
      // Auto-focus the question input
      if (st.activePopup) {
        var input = st.activePopup.querySelector(".jr-popup-question-text[contenteditable]");
        if (input) {
          requestAnimationFrame(function () { input.focus(); });
        }
      }
    });

    triggerBtn.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    document.body.appendChild(triggerBtn);
    positionBtn();

    // Reposition on scroll/resize, remove when selection disappears
    triggerScrollHandler = function () { if (triggerBtn) positionBtn(); };
    triggerResizeHandler = triggerScrollHandler;
    triggerSelChangeHandler = function () {
      var sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        removeTriggerBtn();
      }
    };
    document.addEventListener("scroll", triggerScrollHandler, true);
    window.addEventListener("resize", triggerResizeHandler);
    document.addEventListener("selectionchange", triggerSelChangeHandler);
  }
  JR.showTriggerBtn = showTriggerBtn;

  // --- Selection listener ---

  function handleSelectionChange() {
    if (st.confirmingDelete) return;
    removeTriggerBtn();
    // Quick check: is there a valid selection in an AI response?
    var result = JR.getSelectedTextQuick();
    if (!result) return;
    showTriggerBtn(result);
  }

  document.addEventListener("mouseup", function (e) {
    if (e.target.closest(".jr-popup-disable-btn")) return;
    if (e.target.closest(".jr-search-bar")) return;
    if (e.target.closest(".jr-highlight-trigger-btn")) return;
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
    // Ignore clicks on the "Ask ChatGPT" dismiss button, search bar, or trigger button
    if (e.target.closest(".jr-popup-disable-btn")) return;
    if (e.target.closest(".jr-search-bar")) return;
    if (e.target.closest(".jr-highlight-trigger-btn")) return;
    // Dismiss trigger button on click outside
    if (triggerBtn && !triggerBtn.contains(e.target)) {
      removeTriggerBtn();
    }
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
      if (triggerBtn) { removeTriggerBtn(); return; }
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
   * @param {object} entry
   * @param {object} [opts] - { allowScrollParent: true } to place underlines inside scroll containers
   */
  JR.createUnderlines = function (entry, opts) {
    opts = opts || {};
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

    // Find the nearest positioned ancestor for underline placement.
    // For active (persistent) underlines: skip scroll containers and
    // .jr-popup-response to avoid extending scrollable overflow.
    // For hover (temporary) underlines: allow .jr-popup-response so
    // underlines scroll with the content, matching page-level behavior.
    var posParent = null;
    var el = entry.spans[0].parentElement;
    while (el) {
      if (!opts.allowScrollParent && el.classList.contains("jr-popup-response")) { el = el.parentElement; continue; }
      var cs = getComputedStyle(el);
      if (cs.position === "relative" || cs.position === "absolute" || cs.position === "fixed") {
        if (opts.allowScrollParent || (cs.overflowY !== "auto" && cs.overflowY !== "scroll")) {
          posParent = el;
          break;
        }
      }
      el = el.parentElement;
    }
    if (!posParent) {
      posParent = entry.contentContainer;
      if (!posParent || !posParent.isConnected) {
        var turnEl = entry.spans[0].closest(JR.SELECTORS.aiTurn);
        posParent = turnEl ? turnEl.parentElement : document.body;
      }
    }
    var pRect = posParent.getBoundingClientRect();
    var pStyle = getComputedStyle(posParent);
    var borderLeft = parseFloat(pStyle.borderLeftWidth) || 0;
    var borderTop = parseFloat(pStyle.borderTopWidth) || 0;
    var scrollOffsetX = posParent.scrollLeft || 0;
    var scrollOffsetY = posParent.scrollTop || 0;

    for (var ui = 0; ui < lines.length; ui++) {
      var line = lines[ui];
      var underline = document.createElement("div");
      underline.className = "jr-highlight-underline";
      underline.style.left = (line.left - pRect.left - borderLeft + scrollOffsetX) + "px";
      underline.style.top = (line.bottom - pRect.top - borderTop + scrollOffsetY + 1) + "px";
      underline.style.width = (line.right - line.left) + "px";
      posParent.appendChild(underline);
      elems.push(underline);
    }
    return elems;
  };

  // Hover underline — when no popup is open, or for children of the innermost open popup
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

    // When a popup is open, only allow hover underline for children of the
    // innermost open popup (i.e. highlights whose parentId === activeHighlightId)
    if (st.activePopup) {
      var hovEntry = st.completedHighlights.get(hlId);
      if (!hovEntry || hovEntry.parentId !== st.activeHighlightId) {
        if (hoveredHlId) { removeElems(hoverUnderlines); hoveredHlId = null; }
        return;
      }
    }

    if (hoveredHlId === hlId) return;
    removeElems(hoverUnderlines);
    hoveredHlId = hlId;
    hoverUnderlines = JR.createUnderlines(st.completedHighlights.get(hlId), { allowScrollParent: true });
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
    var elUnder = document.elementFromPoint(lastMouseX, lastMouseY);
    if (!elUnder || !elUnder.closest || !elUnder.closest(".jr-source-highlight-done[data-jr-highlight-id=\"" + hoveredHlId + "\"]")) {
      removeElems(hoverUnderlines);
      hoveredHlId = null;
    }
  }, true);

  // Active underline — shown while popup is open (accepts single ID or array)
  JR.showActiveUnderline = function (hlIds) {
    removeElems(activeUnderlines);
    if (!Array.isArray(hlIds)) hlIds = [hlIds];
    for (var i = 0; i < hlIds.length; i++) {
      var entry = st.completedHighlights.get(hlIds[i]);
      if (entry && !(entry.spans && entry.spans[0] && entry.spans[0]._jrReplyAnchor)) {
        var elems = JR.createUnderlines(entry);
        for (var j = 0; j < elems.length; j++) activeUnderlines.push(elems[j]);
      }
    }
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
    if (!childEntry) return;

    // Reply-to-all: scroll parent response to bottom to reveal the Reply button
    if (childEntry.wholeResponse) {
      if (st.activePopup) {
        var respDiv = st.activePopup.querySelector(".jr-popup-response");
        if (respDiv) respDiv.scrollTop = respDiv.scrollHeight;
      }
      return;
    }

    if (!childEntry.spans || childEntry.spans.length === 0) return;
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
        rules.push('[data-testid="conversation-turn-' + indices[r] + '"]');
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
    JR.clearHiddenTurnIndices();
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

  var activeDisableBtn = null;

  function removeDisableBtn() {
    if (activeDisableBtn) {
      activeDisableBtn.remove();
      activeDisableBtn = null;
    }
  }

  function showDisableBtn(askBtn) {
    removeDisableBtn();

    var btn = document.createElement("span");
    btn.className = "jr-popup-disable-btn";
    btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>';
    activeDisableBtn = btn;

    var r = askBtn.getBoundingClientRect();
    btn.style.top = (r.top - 8) + "px";
    btn.style.left = (r.right - 2) + "px";

    // Tooltip
    var tooltip = document.createElement("div");
    tooltip.className = "jr-disable-tooltip";
    tooltip.textContent = "Hide until reload";

    btn.addEventListener("mouseenter", function () {
      var br = btn.getBoundingClientRect();
      tooltip.style.top = (br.top + br.height / 2) + "px";
      tooltip.style.left = (br.right + 6) + "px";
      document.body.appendChild(tooltip);
    });
    btn.addEventListener("mouseleave", function () {
      if (tooltip.parentNode) tooltip.remove();
    });

    btn.addEventListener("mousedown", function (ev) {
      // Prevent selection from being cleared so the highlight persists
      ev.preventDefault();
      ev.stopPropagation();
    });

    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      ev.preventDefault();
      if (tooltip.parentNode) tooltip.remove();
      removeDisableBtn();
      st.askBtnHidden = true;
      hideAskBtn(askBtn);
    });

    document.body.appendChild(btn);
  }

  // Observer handles both: show × when Ask ChatGPT appears, remove × when
  // it disappears, and auto-hide if user previously dismissed.
  // Deferred to rAF so it never blocks trigger button paint.
  var askBtnObserverPending = false;
  var askBtnObserver = new MutationObserver(function () {
    if (askBtnObserverPending) return;
    askBtnObserverPending = true;
    requestAnimationFrame(function () {
      askBtnObserverPending = false;
      var candidates = document.querySelectorAll('button');
      var found = null;
      for (var i = 0; i < candidates.length; i++) {
        var c = candidates[i];
        if (c.textContent.trim() === "Ask ChatGPT" && !c.closest(".jr-popup")) {
          found = c;
          break;
        }
      }

      if (found) {
        if (st.askBtnHidden) {
          hideAskBtn(found);
        } else if (!activeDisableBtn) {
          showDisableBtn(found);
        }
      } else {
        removeDisableBtn();
      }
    });
  });
  askBtnObserver.observe(document.body, { childList: true, subtree: true });

  // Restore saved highlights on initial page load
  JR.restoreHighlights();
  JR.startHiddenTurnEnforcer();

  // Init the search bar (delay for DOM to be ready)
  setTimeout(JR.initSearchBar, 1500);

  // --- Layout change observer [LAYOUT-LOCKED] — Do not modify ---
  // ChatGPT sidebar open/close doesn't fire window.resize — it only changes
  // the chat column width via CSS. Observe the main content area so highlights,
  // underlines, popups, and arrows stay in sync.
  (function () {
    if (typeof ResizeObserver === "undefined") return;
    function findChatColumn() {
      return document.querySelector('[class*="react-scroll-to-bottom"]')
        || document.querySelector("main")
        || null;
    }
    var lastW = 0;
    var observedEl = null;
    var ro = new ResizeObserver(function (entries) {
      var w = entries[0].contentRect.width;
      if (w === lastW) return;  // height-only change, ignore
      lastW = w;
      // Reposition popups/underlines/arrows and toggle nav widget visibility
      if (st.resizeHandler) st.resizeHandler();
      if (JR.updateNavWidget) JR.updateNavWidget();
    });
    function attach() {
      var el = findChatColumn();
      if (el && el !== observedEl) {
        if (observedEl) ro.unobserve(observedEl);
        observedEl = el;
        lastW = el.clientWidth;
        ro.observe(el);
      }
    }
    attach();
    // Re-attach after SPA navigations (React may recreate the element)
    setInterval(attach, 3000);
  })();

  // --- Expose console API to page's main world ---
  // Content scripts run in an isolated world; the browser console
  // runs in the main world. Bridge via CustomEvents on document.
  document.addEventListener("jr-go", function (e) {
    var itemId = e.detail;
    if (itemId === "__LIST__") itemId = undefined;
    else if (!itemId) itemId = null;
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
