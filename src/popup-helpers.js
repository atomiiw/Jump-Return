// popup-helpers.js — Popup positioning, resizing, rendering helpers for Jump Return
(function () {
  "use strict";

  var st = JR.state;

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
    arrow.classList.remove("jr-popup-arrow--up", "jr-popup-arrow--down");
    if (popup._jrDirection === "above") {
      arrow.classList.add("jr-popup-arrow--down");
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

      function onMove(ev) {
        var dx = ev.clientX - startX;
        var newWidth, newLeft;
        if (edge === "right") {
          newWidth = startWidth + dx;
          newLeft = startLeft;
        } else {
          newWidth = startWidth - dx;
          newLeft = startLeft + dx;
        }
        var maxWidth = window.innerWidth - 32;
        newWidth = Math.max(MIN_WIDTH, Math.min(newWidth, maxWidth));
        if (edge === "left") {
          newLeft = startLeft + (startWidth - newWidth);
        }
        popup.style.width = newWidth + "px";
        popup.style.left = newLeft + "px";
        if (st.activeSourceHighlights.length > 0 && popup.parentElement) {
          var dir = popup._jrLockedDirection || popup._jrDirection;
          var adjR = JR.getAdjacentLineRect(st.activeSourceHighlights, dir);
          var hRect = adjR || JR.getHighlightRect(st.activeSourceHighlights);
          var cRect = popup.parentElement.getBoundingClientRect();
          JR.updateArrow(popup, hRect, cRect, newLeft);
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
    if (st.activeSourceHighlights.length > 0) {
      var hlId = st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id");
      if (hlId && st.completedHighlights.has(hlId)) {
        isCompleted = true;
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
    // Hide toolbar if it belongs to a different highlight than what's now active
    if (st.hoverToolbar && st.hoverToolbarHlId !== st.activeHighlightId) {
      JR.hideToolbar();
    }
  };
})();
