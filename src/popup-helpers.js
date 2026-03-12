// popup-helpers.js — Popup positioning, resizing, rendering helpers for Jump Return
(function () {
  "use strict";

  var st = JR.state;

  /** Flash the delete confirmation bar to draw attention back to it. */
  JR.shineDeleteConfirm = function () {
    if (!st.hoverToolbar || !st.hoverToolbar.classList.contains("jr-popup-confirm")) return;
    var el = st.hoverToolbar;
    el.classList.remove("jr-confirm-shine");
    // Force reflow so re-adding the class restarts the animation
    void el.offsetWidth;
    el.classList.add("jr-confirm-shine");
  };

  JR.createLoadingDiv = function () {
    var div = document.createElement("div");
    div.className = "jr-popup-loading";
    div.textContent = "Waiting for response\u2026";
    return div;
  };

  JR.getPopupWidth = function () {
    return st.customPopupWidthL1 || 360;
  };

  /**
   * Render sentence context inside a container element.
   * Single-block: inline text with highlighted mark.
   * Multi-block (contains \n): renders a list preserving bullet structure.
   */
  JR.renderSentenceContext = function (container, sentence, text, blockTypes) {
    var isMultiBlock = sentence.indexOf("\n") !== -1;

    var matchStart = -1;
    var matchLen = 0;
    var directIdx = sentence.indexOf(text);
    if (directIdx !== -1) {
      matchStart = directIdx;
      matchLen = text.length;
    } else {
      var normSentence = sentence.replace(/\s+/g, " ");
      var normText = text.replace(/\s+/g, " ");
      var normIdx = normSentence.indexOf(normText);
      if (normIdx !== -1) {
        matchStart = normIdx;
        matchLen = normText.length;
      }
    }

    function appendTextWithBreaks(parent, str) {
      if (!str) return;
      var parts = str.split("\n");
      for (var p = 0; p < parts.length; p++) {
        if (p > 0) parent.appendChild(document.createElement("br"));
        if (parts[p]) parent.appendChild(document.createTextNode(parts[p]));
      }
    }

    function fillWithHighlight(el, blockText, blockStart, blockEnd, pills, bolds) {
      var hlStart = -1, hlEnd = -1;
      if (matchStart !== -1) {
        hlStart = Math.max(matchStart, blockStart) - blockStart;
        hlEnd = Math.min(matchStart + matchLen, blockEnd) - blockStart;
        if (hlStart >= hlEnd || hlStart < 0) { hlStart = -1; hlEnd = -1; }
      }

      var points = [0, blockText.length];
      if (hlStart >= 0) { points.push(hlStart); points.push(hlEnd); }
      if (pills) {
        for (var p = 0; p < pills.length; p++) {
          points.push(Math.max(0, pills[p].start));
          points.push(Math.min(blockText.length, pills[p].end));
        }
      }
      if (bolds) {
        for (var b = 0; b < bolds.length; b++) {
          points.push(Math.max(0, bolds[b].start));
          points.push(Math.min(blockText.length, bolds[b].end));
        }
      }
      points.sort(function (a, b) { return a - b; });
      var sorted = [points[0]];
      for (var s = 1; s < points.length; s++) {
        if (points[s] !== points[s - 1]) sorted.push(points[s]);
      }

      for (var i = 0; i < sorted.length - 1; i++) {
        var segStart = sorted[i];
        var segEnd = sorted[i + 1];
        if (segStart >= segEnd) continue;

        var segText = blockText.slice(segStart, segEnd);
        var isHL = (hlStart >= 0 && segStart >= hlStart && segEnd <= hlEnd);
        var isPill = false;
        if (pills) {
          for (var j = 0; j < pills.length; j++) {
            if (segStart >= pills[j].start && segEnd <= pills[j].end) { isPill = true; break; }
          }
        }
        var isBold = false;
        if (bolds) {
          for (var k = 0; k < bolds.length; k++) {
            if (segStart >= bolds[k].start && segEnd <= bolds[k].end) { isBold = true; break; }
          }
        }

        var content;
        if (isPill) {
          content = document.createElement("span");
          content.className = isHL ? "jr-popup-pill jr-popup-mark" : "jr-popup-pill";
          appendTextWithBreaks(content, segText);
        } else if (isHL) {
          content = document.createElement("span");
          content.className = "jr-popup-mark";
          appendTextWithBreaks(content, segText);
        } else {
          content = null;
        }

        if (isBold) {
          var strong = document.createElement("strong");
          if (content) {
            strong.appendChild(content);
          } else {
            appendTextWithBreaks(strong, segText);
          }
          el.appendChild(strong);
        } else if (content) {
          el.appendChild(content);
        } else {
          appendTextWithBreaks(el, segText);
        }
      }
    }

    if (!isMultiBlock) {
      var singleMeta = (blockTypes && blockTypes.length === 1) ? blockTypes[0] : null;
      var singlePills = singleMeta ? singleMeta.pills : null;
      var singleBolds = singleMeta ? singleMeta.bolds : null;
      var isBullet = singleMeta && singleMeta.tag === "LI";
      var hasSegments = (singlePills && singlePills.length > 0) || (singleBolds && singleBolds.length > 0);

      if (isBullet) {
        var listEl = document.createElement(singleMeta.listType || "ul");
        listEl.className = "jr-popup-context-list";
        if (singleMeta.listType === "ol" && singleMeta.listStart > 1) {
          listEl.setAttribute("start", singleMeta.listStart);
        }
        var li = document.createElement("li");
        fillWithHighlight(li, sentence, 0, sentence.length, singlePills, singleBolds);
        listEl.appendChild(li);
        container.appendChild(listEl);
      } else if (hasSegments) {
        fillWithHighlight(container, sentence, 0, sentence.length, singlePills, singleBolds);
      } else if (matchStart !== -1) {
        var before = sentence.slice(0, matchStart);
        var after = sentence.slice(matchStart + matchLen);
        if (before) container.appendChild(document.createTextNode(before));
        var mark = document.createElement("span");
        mark.className = "jr-popup-mark";
        mark.textContent = sentence.slice(matchStart, matchStart + matchLen);
        container.appendChild(mark);
        if (after) container.appendChild(document.createTextNode(after));
      } else {
        container.textContent = sentence;
      }
      return;
    }

    // Multi-block rendering
    var lines = sentence.split("\n");

    var blockList = [];
    var lineIdx = 0;
    if (blockTypes && blockTypes.length > 0) {
      for (var b = 0; b < blockTypes.length; b++) {
        var nLines = blockTypes[b].lineCount || 1;
        blockList.push({
          text: lines.slice(lineIdx, lineIdx + nLines).join("\n"),
          meta: blockTypes[b]
        });
        lineIdx += nLines;
      }
    }
    for (; lineIdx < lines.length; lineIdx++) {
      blockList.push({
        text: lines[lineIdx],
        meta: { tag: "P", depth: 0 }
      });
    }

    var minDepth = Infinity;
    for (var k = 0; k < blockList.length; k++) {
      var t = blockList[k].meta.tag;
      if ((t === "LI" || t === "LI_CONT") && blockList[k].meta.depth < minDepth) {
        minDepth = blockList[k].meta.depth;
      }
    }
    if (minDepth === Infinity) minDepth = 1;

    var pos = 0;
    var openList = null;
    var openListType = null;

    for (var i = 0; i < blockList.length; i++) {
      var block = blockList[i];
      var meta = block.meta;
      var blockStart = pos;
      var blockEnd = pos + block.text.length;

      if (meta.tag === "LI" || meta.tag === "LI_CONT") {
        var lt = meta.listType || "ul";
        if (openList && openListType !== lt) {
          container.appendChild(openList);
          openList = null;
        }
        if (!openList) {
          openList = document.createElement(lt);
          openList.className = "jr-popup-context-list";
          if (lt === "ol" && meta.listStart > 1) {
            openList.setAttribute("start", meta.listStart);
          }
          openListType = lt;
        }
        var li = document.createElement("li");
        var relDepth = meta.depth - minDepth;
        if (relDepth > 0) {
          li.classList.add("jr-depth-" + Math.min(relDepth, 2));
        }
        if (meta.tag === "LI_CONT") {
          li.classList.add("jr-li-cont");
        }
        fillWithHighlight(li, block.text, blockStart, blockEnd, meta.pills, meta.bolds);
        openList.appendChild(li);
      } else {
        if (openList) {
          container.appendChild(openList);
          openList = null;
          openListType = null;
        }
        var div = document.createElement("div");
        div.className = "jr-popup-context-block";
        if (/^H[1-6]$/.test(meta.tag)) {
          div.classList.add("jr-popup-context-heading");
        }
        fillWithHighlight(div, block.text, blockStart, blockEnd, meta.pills, meta.bolds);
        container.appendChild(div);
      }

      pos = blockEnd + 1;
    }

    if (openList) {
      container.appendChild(openList);
    }
  };

  /**
   * Determine the best direction (above/below) for a popup given the highlight
   * position and popup height. Prefers the side with more viewport space;
   * falls back to whichever side the popup actually fits.
   */
  JR.bestDirection = function (highlightRect, popupH, gap) {
    var spaceBelow = window.innerHeight - highlightRect.bottom - gap;
    var spaceAbove = highlightRect.top - gap;
    // Prefer the side with more room
    if (spaceBelow >= popupH && spaceAbove >= popupH) {
      return spaceBelow >= spaceAbove ? "below" : "above";
    }
    if (spaceBelow >= popupH) return "below";
    if (spaceAbove >= popupH) return "above";
    // Neither fits fully — pick the side with more space
    return spaceBelow >= spaceAbove ? "below" : "above";
  };

  /**
   * Get the bounding rect of just the first or last line of highlight spans.
   * Spans on the same line share a similar top value (within 4px tolerance).
   */
  JR.getAdjacentLineRect = function (spans, direction) {
    if (!spans || spans.length === 0) return null;
    var rects = [];
    for (var i = 0; i < spans.length; i++) {
      var r = spans[i].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      rects.push(r);
    }
    if (rects.length === 0) return null;
    // Sort by top position
    rects.sort(function (a, b) { return a.top - b.top; });
    var refTop;
    if (direction === "above") {
      // Popup is above → adjacent line is the first (topmost) line
      refTop = rects[0].top;
    } else {
      // Popup is below → adjacent line is the last (bottommost) line
      refTop = rects[rects.length - 1].top;
    }
    // Collect all rects on the same line (within 4px tolerance)
    var top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
    for (var j = 0; j < rects.length; j++) {
      if (Math.abs(rects[j].top - refTop) <= 4) {
        if (rects[j].top < top) top = rects[j].top;
        if (rects[j].left < left) left = rects[j].left;
        if (rects[j].bottom > bottom) bottom = rects[j].bottom;
        if (rects[j].right > right) right = rects[j].right;
      }
    }
    return { top: top, left: left, bottom: bottom, right: right, width: right - left, height: bottom - top };
  };

  /**
   * Update (or create) the arrow element on a popup, pointing toward the highlight.
   * @param {HTMLElement} popup
   * @param {DOMRect} highlightRect — bounding rect of the source highlight (viewport coords)
   * @param {DOMRect} containerRect — bounding rect of the content container (viewport coords)
   * @param {number} popupLeft — popup's CSS left value (px, relative to container)
   */
  JR.updateArrow = function (popup, highlightRect, containerRect, popupLeft) {
    var arrow = popup.querySelector(".jr-popup-arrow");
    if (!arrow) {
      arrow = document.createElement("div");
      arrow.className = "jr-popup-arrow";
      popup.appendChild(arrow);
    }
    arrow.classList.remove("jr-popup-arrow--up", "jr-popup-arrow--down", "jr-popup-arrow--lower");
    if (popup._jrDirection === "above") {
      arrow.classList.add("jr-popup-arrow--down");
      // Down arrow touches whichever card is at the bottom
      var hasLower = popup.querySelector(".jr-popup-response, .jr-popup-loading");
      if (hasLower) arrow.classList.add("jr-popup-arrow--lower");
    } else {
      arrow.classList.add("jr-popup-arrow--up");
    }
    var halfArrow = 9;
    var highlightCenterX = highlightRect.left + highlightRect.width / 2;
    var offset = highlightCenterX - containerRect.left - popupLeft - halfArrow;
    var popupW = popup.offsetWidth;
    offset = Math.max(12, Math.min(offset, popupW - 30));
    arrow.style.left = offset + "px";
  };

  /**
   * Position the popup inside the content container.
   * Uses position: absolute relative to the container.
   */
  JR.positionPopup = function (popup, rect, contentContainer, forceDirection, spans) {
    var containerRect = contentContainer.getBoundingClientRect();
    var gap = 8;

    popup.style.left = "-9999px";
    popup.style.top = "-9999px";
    contentContainer.appendChild(popup);
    var popupW = popup.offsetWidth;
    var popupH = popup.offsetHeight;

    var direction;
    if (forceDirection === "above" || forceDirection === "below") {
      direction = forceDirection;
    } else {
      direction = JR.bestDirection(rect, popupH, gap);
    }
    popup._jrLockedDirection = direction;

    // Use the adjacent line's rect for horizontal centering and arrow
    var adjRect = (spans && spans.length > 0)
      ? JR.getAdjacentLineRect(spans, direction)
      : null;
    var centerRect = adjRect || rect;

    var left = centerRect.left - containerRect.left + centerRect.width / 2 - popupW / 2;
    var top;
    if (direction === "above") {
      top = rect.top - containerRect.top - popupH - gap;
    } else {
      top = rect.bottom - containerRect.top + gap;
    }

    var containerW = contentContainer.clientWidth;
    left = Math.max(8, Math.min(left, containerW - popupW - 8));

    popup.style.left = left + "px";
    popup.style.top = top + "px";
    popup._jrDirection = direction;
    JR.updateArrow(popup, centerRect, containerRect, left);
  };

  /**
   * Recalculate and update the popup's position based on current highlight span positions.
   */
  JR.repositionPopup = function () {
    if (!st.activePopup || st.activeSourceHighlights.length === 0) return;
    var rect = JR.getHighlightRect(st.activeSourceHighlights);
    var contentContainer = st.activePopup.parentElement;
    if (!contentContainer) return;
    var containerRect = contentContainer.getBoundingClientRect();
    var popupW = st.activePopup.offsetWidth;
    var popupH = st.activePopup.offsetHeight;
    var gap = 8;
    var direction = st.activePopup._jrLockedDirection || JR.bestDirection(rect, popupH, gap);

    // Center on the adjacent line's highlight, not the full multi-line rect
    var adjRect = JR.getAdjacentLineRect(st.activeSourceHighlights, direction);
    var centerRect = adjRect || rect;

    var left = centerRect.left - containerRect.left + centerRect.width / 2 - popupW / 2;
    var containerW = contentContainer.clientWidth;
    left = Math.max(8, Math.min(left, containerW - popupW - 8));
    var top;
    if (direction === "above") {
      top = rect.top - containerRect.top - popupH - gap;
    } else {
      top = rect.bottom - containerRect.top + gap;
    }
    st.activePopup.style.left = left + "px";
    st.activePopup.style.top = top + "px";
    st.activePopup._jrDirection = direction;
    JR.updateArrow(st.activePopup, centerRect, containerRect, left);
    // Reposition floating toolbar if present
    if (st.hoverToolbar && st.activeSourceHighlights.length > 0) {
      JR.positionToolbar(st.hoverToolbar, st.activeSourceHighlights);
    }
  };

  /**
   * Add drag-to-resize handlers to a popup.
   */
  JR.addResizeHandlers = function (popup) {
    var EDGE_ZONE = 6;
    var MIN_WIDTH = 280;

    function getEdge(e) {
      var rect = popup.getBoundingClientRect();
      if (e.clientX <= rect.left + EDGE_ZONE) return "left";
      if (e.clientX >= rect.right - EDGE_ZONE) return "right";
      return null;
    }

    popup.addEventListener("mousemove", function (e) {
      if (popup._jrResizing) return;
      popup.style.cursor = getEdge(e) ? "col-resize" : "";
    });

    popup.addEventListener("mouseleave", function () {
      if (!popup._jrResizing) popup.style.cursor = "";
    });

    popup.addEventListener("mousedown", function (e) {
      var edge = getEdge(e);
      if (!edge) return;
      e.preventDefault();

      popup._jrResizing = true;
      var startX = e.clientX;
      var startWidth = popup.offsetWidth;
      var startLeft = parseFloat(popup.style.left) || 0;

      // Compute the arrow's X position (relative to container) as the resize limit.
      // Left edge can't go right of arrow; right edge can't go left of arrow.
      var arrowX = null;
      if (st.activeSourceHighlights.length > 0 && popup.parentElement) {
        var hRect = JR.getHighlightRect(st.activeSourceHighlights);
        var cRect = popup.parentElement.getBoundingClientRect();
        arrowX = hRect.left + hRect.width / 2 - cRect.left;
      }

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var newLeft, newRight;
        if (edge === "right") {
          newLeft = startLeft;
          newRight = startLeft + startWidth + dx;
        } else {
          newLeft = startLeft + dx;
          newRight = startLeft + startWidth;
        }

        // Clamp so the arrow never moves.
        // Arrow offset in popup = arrowX - newLeft - 9.
        // updateArrow clamps to [12, popupW - 30].
        // So: newLeft ≤ arrowX - 21  AND  newRight ≥ arrowX + 21.
        if (arrowX !== null) {
          if (newLeft > arrowX - 21) newLeft = arrowX - 21;
          if (newRight < arrowX + 21) newRight = arrowX + 21;
        }

        var maxWidth = window.innerWidth - 32;
        var newWidth = newRight - newLeft;
        newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));
        // Re-derive left from the clamped width depending on which edge is being dragged
        if (edge === "left") {
          newLeft = newRight - newWidth;
        }

        popup.style.width = newWidth + "px";
        popup.style.left = newLeft + "px";
        if (st.activeSourceHighlights.length > 0 && popup.parentElement) {
          var dir = popup._jrLockedDirection || popup._jrDirection;
          var adjR = JR.getAdjacentLineRect(st.activeSourceHighlights, dir);
          var hRect2 = adjR || JR.getHighlightRect(st.activeSourceHighlights);
          var cRect2 = popup.parentElement.getBoundingClientRect();
          JR.updateArrow(popup, hRect2, cRect2, newLeft);
        }
      }

      function onUp() {
        popup._jrResizing = false;
        if (popup._jrChained) {
          st.customPopupWidthChained = popup.offsetWidth;
        } else {
          st.customPopupWidthL1 = popup.offsetWidth;
        }
        popup.style.cursor = "";
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
      }

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    });
  };

  /**
   * Add mouseup handler to a popup that detects text selection inside .jr-popup-response
   * and spawns a chained popup.
   */
  JR.addPopupResponseSelectionHandler = function (popup) {
    popup.addEventListener("mouseup", function (e) {
      e.stopPropagation();
      if (!e.target.closest(".jr-popup-response")) return;
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        var sel = window.getSelection();
        if (sel.isCollapsed) JR.selectSourceHighlightText();
        return;
      }
      if (e.target.closest(".jr-source-highlight-done")) return;
      setTimeout(function () {
        var selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        var anchorEl = selection.anchorNode;
        if (anchorEl) {
          var container = anchorEl.nodeType === Node.TEXT_NODE ? anchorEl.parentElement : anchorEl;
          if (container) {
            var srcHL = container.closest(".jr-source-highlight");
            if (srcHL && st.activeSourceHighlights.indexOf(srcHL) !== -1) return;
          }
        }
        var selectedText = selection.toString().trim();
        if (!selectedText) return;
        if (!st.activeHighlightId || !st.completedHighlights.has(st.activeHighlightId)) return;
        var hlId = st.activeHighlightId;
        var range = selection.getRangeAt(0).cloneRange();
        selection.removeAllRanges();
        JR.pushPopupState();
        JR.createPopup({ text: selectedText, parentId: hlId, range: range });
      }, 10);
    });

    popup.addEventListener("click", function (e) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && st.activeSourceHighlights.indexOf(hlSpan) !== -1) {
        e.stopPropagation();
        JR.selectSourceHighlightText();
      }
    });
  };

  /**
   * Sync the jr-source-highlight-active class on highlight spans.
   * Adds active class to spans matching the given highlight ID,
   * removes it from all others.
   */
  JR.syncHighlightActive = function (hlId) {
    // Remove active from all
    var allActive = document.querySelectorAll(".jr-source-highlight-active");
    for (var i = 0; i < allActive.length; i++) {
      allActive[i].classList.remove("jr-source-highlight-active");
    }
    // Add to current
    if (hlId) {
      var entry = st.completedHighlights.get(hlId);
      if (entry && entry.spans) {
        for (var j = 0; j < entry.spans.length; j++) {
          entry.spans[j].classList.add("jr-source-highlight-active");
        }
      }
      if (JR.showActiveUnderline) JR.showActiveUnderline(hlId);
    } else {
      if (JR.removeActiveUnderline) JR.removeActiveUnderline();
    }
  };

  /**
   * Save the current popup state to the stack.
   */
  JR.pushPopupState = function () {
    st.popupStack.push({
      popup: st.activePopup,
      sourceHighlights: st.activeSourceHighlights,
      highlightId: st.activeHighlightId,
      resizeHandler: st.resizeHandler,
    });
    st.activePopup = null;
    st.activeSourceHighlights = [];
    st.activeHighlightId = null;
    st.resizeHandler = null;
  };

  // --- Highlight Navigation (Step 7d) ---

  // Up chevron (caret-up)
  var NAV_UP_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,165.66a8,8,0,0,1-11.32,0L128,91.31,53.66,165.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0l80,80A8,8,0,0,1,213.66,165.66Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M216.49,168.49a12,12,0,0,1-17,0L128,97,56.49,168.49a12,12,0,0,1-17-17l80-80a12,12,0,0,1,17,0l80,80A12,12,0,0,1,216.49,168.49Z"/></svg>';
  // Down chevron (caret-down)
  var NAV_DOWN_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80a8,8,0,0,1,11.32-11.32L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159,199.51,87.51a12,12,0,0,1,17,17Z"/></svg>';

  var navNavigating = false; // suppress updateNavWidget during navigation

  /**
   * Get all level-1 (non-chained) highlight IDs, ordered by DOM position.
   */
  JR.getLevel1HighlightIds = function () {
    var items = [];
    st.completedHighlights.forEach(function (entry, id) {
      if (!entry.parentId && entry.spans && entry.spans.length > 0 && entry.spans[0].isConnected) {
        items.push({ id: id, span: entry.spans[0] });
      }
    });
    items.sort(function (a, b) {
      var pos = a.span.compareDocumentPosition(b.span);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    return items.map(function (item) { return item.id; });
  };

  /**
   * Find the L1 ancestor index for the current activeHighlightId.
   */
  function findCurrentL1Index(ids) {
    if (!st.activeHighlightId) return -1;
    var idx = ids.indexOf(st.activeHighlightId);
    if (idx !== -1) return idx;
    // Walk up chained parents to find the root L1
    var entry = st.completedHighlights.get(st.activeHighlightId);
    if (entry && entry.parentId) {
      var parentId = entry.parentId;
      var parentEntry = st.completedHighlights.get(parentId);
      while (parentEntry && parentEntry.parentId) {
        parentId = parentEntry.parentId;
        parentEntry = st.completedHighlights.get(parentId);
      }
      return ids.indexOf(parentId);
    }
    return -1;
  }

  function buildNavWidget() {
    var widget = document.createElement("div");
    widget.className = "jr-nav-widget";

    var upBtn = document.createElement("button");
    upBtn.type = "button";
    upBtn.className = "jr-nav-up";
    upBtn.innerHTML = NAV_UP_SVG;

    var indicator = document.createElement("span");
    indicator.className = "jr-nav-indicator";

    var downBtn = document.createElement("button");
    downBtn.type = "button";
    downBtn.className = "jr-nav-down";
    downBtn.innerHTML = NAV_DOWN_SVG;

    widget.appendChild(upBtn);
    widget.appendChild(indicator);
    widget.appendChild(downBtn);

    upBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      JR.navigateHighlight(-1);
    });

    downBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      JR.navigateHighlight(1);
    });

    widget.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    return widget;
  }

  /**
   * Determine user's scroll position relative to highlights.
   * If any highlight is visible on screen → "between".
   * If none visible and all below viewport → "above".
   * If none visible and all above viewport → "below".
   */
  function getVisibleBounds(el) {
    var top = 0;
    var bottom = window.innerHeight;
    var parent = el.parentElement;
    while (parent) {
      var ov = getComputedStyle(parent).overflowY;
      if (ov === "auto" || ov === "hidden" || ov === "scroll") {
        var pr = parent.getBoundingClientRect();
        if (pr.top > top) top = pr.top;
        if (pr.bottom < bottom) bottom = pr.bottom;
      }
      parent = parent.parentElement;
    }
    return { top: top, bottom: bottom };
  }

  function getScrollPosition(ids) {
    // Find the visible bounds (viewport clipped by scroll containers)
    var firstEntry = st.completedHighlights.get(ids[0]);
    if (!firstEntry || !firstEntry.spans || !firstEntry.spans[0].isConnected) return "between";
    var bounds = getVisibleBounds(firstEntry.spans[0]);

    for (var i = 0; i < ids.length; i++) {
      var entry = st.completedHighlights.get(ids[i]);
      if (!entry || !entry.spans || !entry.spans[0].isConnected) continue;
      var r = entry.spans[0].getBoundingClientRect();
      if (r.height === 0 && r.width === 0) continue;
      if (r.bottom > bounds.top && r.top < bounds.bottom) return "between";
    }
    // No highlight visible — check first highlight position vs visible area
    var firstRect = firstEntry.spans[0].getBoundingClientRect();
    if (firstRect.top >= bounds.bottom) return "above";
    return "below";
  }

  /**
   * Create, update, or hide the floating highlight navigation widget.
   * Only tracks level-1 (non-chained) highlights.
   */
  JR.updateNavWidget = function () {
    if (navNavigating) return;

    var ids = JR.getLevel1HighlightIds();

    if (ids.length < 1) {
      if (st.navWidget) {
        if (st.navWidget._jrScrollCleanup) st.navWidget._jrScrollCleanup();
        st.navWidget.remove();
        st.navWidget = null;
      }
      return;
    }

    if (!st.navWidget) {
      st.navWidget = buildNavWidget();
      document.body.appendChild(st.navWidget);
      // Listen for scroll to update disabled state dynamically
      var scrollEl = document.querySelector('[class*="react-scroll-to-bottom"]') ||
                     document.querySelector('[data-testid="conversation-turn-2"]');
      var scrollParent = scrollEl ? JR.getScrollParent(scrollEl) : window;
      var scrollHandler = function () {
        if (!st.navWidget) return;
        JR.updateNavDisabled();
      };
      (scrollParent === window ? window : scrollParent)
        .addEventListener("scroll", scrollHandler, { passive: true });
      st.navWidget._jrScrollCleanup = function () {
        (scrollParent === window ? window : scrollParent)
          .removeEventListener("scroll", scrollHandler);
      };
    }

    st.navWidget._jrIds = ids;

    var currentIdx = findCurrentL1Index(ids);

    var indicator = st.navWidget.querySelector(".jr-nav-indicator");
    if (currentIdx >= 0) {
      indicator.textContent = (currentIdx + 1) + " / " + ids.length;
    } else {
      indicator.textContent = "" + ids.length;
    }

    JR.updateNavDisabled();
  };

  /**
   * Update just the disabled state of nav arrows (called on scroll + updateNavWidget).
   */
  JR.updateNavDisabled = function () {
    if (!st.navWidget || !st.navWidget._jrIds) return;
    var ids = st.navWidget._jrIds;
    var upBtn = st.navWidget.querySelector(".jr-nav-up");
    var downBtn = st.navWidget.querySelector(".jr-nav-down");
    if (st.confirmingDelete) {
      upBtn.disabled = true;
      downBtn.disabled = true;
      return;
    }
    var currentIdx = findCurrentL1Index(ids);
    if (currentIdx === -1) {
      var pos = getScrollPosition(ids);
      upBtn.disabled = (pos === "above");
      downBtn.disabled = (pos === "below");
    } else {
      upBtn.disabled = (currentIdx === 0);
      downBtn.disabled = (currentIdx === ids.length - 1);
    }
  };

  /**
   * Navigate to the previous or next level-1 highlight.
   * @param {number} direction  -1 for previous (up), +1 for next (down)
   */
  JR.navigateHighlight = function (direction) {
    if (st.confirmingDelete) { JR.shineDeleteConfirm(); return; }
    if (!st.navWidget || !st.navWidget._jrIds) return;
    var ids = st.navWidget._jrIds;
    if (ids.length === 0) return;

    var currentIdx = findCurrentL1Index(ids);

    var nextIdx;
    if (currentIdx === -1) {
      var pos = getScrollPosition(ids);
      if (pos === "below") {
        if (direction > 0) return; // down disabled
        nextIdx = ids.length - 1;
      } else if (pos === "above") {
        if (direction < 0) return; // up disabled
        nextIdx = 0;
      } else {
        // Between — up goes to first, down goes to last
        nextIdx = direction > 0 ? ids.length - 1 : 0;
      }
    } else {
      nextIdx = currentIdx + direction;
    }
    if (nextIdx < 0 || nextIdx >= ids.length) return;

    var targetId = ids[nextIdx];
    var targetEntry = st.completedHighlights.get(targetId);
    if (!targetEntry) return;

    // Suppress intermediate updateNavWidget calls during navigation
    navNavigating = true;
    JR.removeAllPopups();
    navNavigating = false;

    if (targetEntry.spans && targetEntry.spans.length > 0) {
      targetEntry.spans[0].scrollIntoView({ block: "center" });
    }

    JR.createPopup({ completedId: targetId });
  };

  /**
   * Close all open popups (active + entire stack).
   */
  JR.removeAllPopups = function () {
    while (st.activePopup || st.popupStack.length > 0) {
      JR.removePopup();
    }
  };

  JR.removePopup = function () {
    var isCompleted = false;
    var isTemp = false;
    if (st.activeSourceHighlights.length > 0) {
      var hlId = st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id");
      if (hlId && st.completedHighlights.has(hlId)) {
        var hlEntry = st.completedHighlights.get(hlId);
        if (hlEntry && hlEntry._jrTemp) {
          isTemp = true;
          st.completedHighlights.delete(hlId);
        } else {
          isCompleted = true;
        }
      }
    }

    if (isCompleted) {
      if (st.cancelResponseWatch) {
        st.cancelResponseWatch(true); // detach — keep polling for edit responses
      }
      st.activeSourceHighlights = [];
      if (st.resizeHandler) {
        window.removeEventListener("resize", st.resizeHandler);
        st.resizeHandler = null;
      }
    } else if (st.cancelResponseWatch) {
      st.cancelResponseWatch(true);
      st.activeSourceHighlights = [];
      if (st.resizeHandler) {
        window.removeEventListener("resize", st.resizeHandler);
        st.resizeHandler = null;
      }
    } else {
      JR.removeSourceHighlight();
    }

    if (st.activePopup) {
      if (st.activePopup._jrScrollCleanup) {
        st.activePopup._jrScrollCleanup();
        st.activePopup._jrScrollCleanup = null;
      }
      st.activePopup.remove();
      st.activePopup = null;
    }
    st.activeHighlightId = null;

    if (st.popupStack.length > 0) {
      var prev = st.popupStack.pop();
      st.activePopup = prev.popup;
      st.activeSourceHighlights = prev.sourceHighlights;
      st.activeHighlightId = prev.highlightId;
      st.resizeHandler = prev.resizeHandler;
    }
    JR.syncHighlightActive(st.activeHighlightId);
    // Hide toolbar when popup closes; re-show if popping back to a parent popup
    JR.hideToolbar();
    if (st.activeHighlightId) {
      JR.showToolbar(st.activeHighlightId);
    }
    JR.updateNavWidget();
  };
})();
