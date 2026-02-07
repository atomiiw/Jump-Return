// content.js — Highlight detection & popup UI for Jump Return
(function () {
  "use strict";

  // --- Selectors (ChatGPT-specific, stable data-testid based) ---
  const SELECTORS = {
    aiTurn: 'article[data-testid^="conversation-turn-"]',
    aiLabel: "h6.sr-only",
    chatInput: 'div[contenteditable="true"]',
    sendButton: 'button[data-testid="send-button"]',
    stopButton: 'button[data-testid="stop-button"]',
    responseContent: ".markdown",
  };

  const AI_LABEL_TEXT = "ChatGPT said:";
  const MAX_DISPLAY_CHARS = 120;

  const BLOCK_TAGS = new Set([
    "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
    "PRE", "BLOCKQUOTE", "TD", "TH",
  ]);
  const SENTENCE_TERMINATORS = [".", "?", "!", "\u3002", "\uFF1F", "\uFF01"];

  let activePopup = null;
  let responseMode = "regular"; // "regular" or "brief"
  let cancelResponseWatch = null;
  let activeSourceHighlights = []; // wrapper <span> elements in the AI response
  let resizeHandler = null;        // window resize listener
  let completedHighlights = new Map(); // id → { spans, responseHTML, text, sentence, contentContainer }

  // --- Helpers ---

  /**
   * Check if a node is inside an AI response turn (not a user turn).
   * Returns the article element if yes, null otherwise.
   */
  function getAIResponseArticle(node) {
    const article = node.closest(SELECTORS.aiTurn);
    if (!article) return null;
    const label = article.querySelector(SELECTORS.aiLabel);
    if (!label || !label.textContent.includes(AI_LABEL_TEXT)) return null;
    return article;
  }

  /**
   * Check if a node is inside the chat input area.
   */
  function isInsideChatInput(node) {
    return !!node.closest(SELECTORS.chatInput);
  }

  /**
   * Check if ChatGPT is currently generating a response.
   * The stop button is present ONLY during active generation.
   */
  function isGenerating() {
    return !!document.querySelector(SELECTORS.stopButton);
  }

  /**
   * Check if a node is inside our popup.
   */
  function isInsidePopup(node) {
    return !!node.closest(".jr-popup");
  }

  /**
   * Walk up from a node to find the nearest block-level ancestor,
   * stopping before the ceiling element.
   */
  function findBlockAncestor(node, ceiling) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== ceiling) {
      if (BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return null;
  }

  /**
   * Get the character offset of a (container, offset) position within a block's textContent.
   */
  function getOffsetInBlock(block, container, offset) {
    var r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(container, offset);
    return r.toString().length;
  }

  /**
   * Extract the containing sentence(s) for the given selection range.
   * For single-block selections, expands to sentence boundaries.
   * For multi-block selections (e.g. multiple bullet points), collects
   * the full text of each selected block, joined with newlines.
   * Returns the trimmed string, or null on failure.
   */
  function extractSentence(range) {
    var article = getAIResponseArticle(
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer
    );
    if (!article) return null;

    var startBlock = findBlockAncestor(range.startContainer, article);
    if (!startBlock) return null;

    var endBlock = findBlockAncestor(range.endContainer, article);

    // Multi-block selection: collect all selected blocks' text
    if (endBlock && endBlock !== startBlock) {
      var blocks = [];
      var walker = document.createTreeWalker(article, NodeFilter.SHOW_ELEMENT, {
        acceptNode: function (node) {
          if (!BLOCK_TAGS.has(node.tagName)) return NodeFilter.FILTER_SKIP;
          // Skip blocks that directly contain other blocks (e.g. <li> wrapping <p>)
          // to avoid collecting the same text twice — the inner block will be visited instead
          var child = node.firstElementChild;
          while (child) {
            if (BLOCK_TAGS.has(child.tagName)) return NodeFilter.FILTER_SKIP;
            child = child.nextElementSibling;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      });
      var inRange = false;
      var node;
      while ((node = walker.nextNode())) {
        if (node === startBlock) inRange = true;
        if (inRange) blocks.push(node.textContent.trim());
        if (node === endBlock) break;
      }
      if (blocks.length > 0) return blocks.join("\n");
    }

    // Single-block selection
    var blockText = startBlock.textContent;
    if (!blockText) return null;

    // Code blocks: return entire content (periods aren't sentence boundaries)
    if (startBlock.tagName === "PRE") return blockText.trim();

    var startOffset = getOffsetInBlock(startBlock, range.startContainer, range.startOffset);
    var endOffset = getOffsetInBlock(startBlock, range.endContainer, range.endOffset);

    // Search backwards for sentence start
    var sentStart = 0;
    for (var i = startOffset - 1; i >= 0; i--) {
      if (SENTENCE_TERMINATORS.indexOf(blockText[i]) !== -1) {
        sentStart = i + 1;
        break;
      }
    }

    // Search forwards for sentence end
    var sentEnd = blockText.length;
    for (var j = endOffset; j < blockText.length; j++) {
      if (SENTENCE_TERMINATORS.indexOf(blockText[j]) !== -1) {
        sentEnd = j + 1;
        break;
      }
    }

    var sentence = blockText.slice(sentStart, sentEnd).trim();
    return sentence || null;
  }

  /**
   * Get selected text and validate it's inside a single AI response.
   * Returns { text, sentence, rect, article, range } or null.
   */
  function getSelectedTextInAIResponse() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

    const text = selection.toString().trim();
    if (!text) return null;

    const range = selection.getRangeAt(0);
    const anchorEl =
      selection.anchorNode.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : selection.anchorNode;
    const focusEl =
      selection.focusNode.nodeType === Node.TEXT_NODE
        ? selection.focusNode.parentElement
        : selection.focusNode;

    if (!anchorEl || !focusEl) return null;

    // Exclude chat input
    if (isInsideChatInput(anchorEl) || isInsideChatInput(focusEl)) return null;

    // Exclude selections inside our popup
    if (isInsidePopup(anchorEl) || isInsidePopup(focusEl)) return null;

    // Both ends must be in the same AI response article
    const anchorArticle = getAIResponseArticle(anchorEl);
    const focusArticle = getAIResponseArticle(focusEl);
    if (!anchorArticle || !focusArticle) return null;
    if (anchorArticle !== focusArticle) return null;

    const rect = range.getBoundingClientRect();
    const sentence = extractSentence(range);
    const clonedRange = range.cloneRange();
    return { text, sentence, rect, article: anchorArticle, range: clonedRange };
  }

  function getModeLabel(mode) {
    return mode === "regular" ? "Regular" : "Brief";
  }

  // --- Chat injection ---

  function findSendButton() {
    // Primary selector
    var btn = document.querySelector(SELECTORS.sendButton);
    if (btn) return btn;
    // Fallback: aria-label based
    btn = document.querySelector('button[aria-label="Send prompt"]');
    if (btn) return btn;
    // Fallback: the submit button inside the chat form
    btn = document.querySelector('form button[type="submit"]');
    return btn || null;
  }

  function injectAndSend(message) {
    var chatInput = document.querySelector(SELECTORS.chatInput);
    if (!chatInput) {
      console.error("[Jump Return] Chat input not found");
      return;
    }

    chatInput.focus({ preventScroll: true });

    // Use clipboard paste — ProseMirror handles paste natively,
    // which reliably syncs its internal state and enables the send button
    var dt = new DataTransfer();
    dt.setData("text/plain", message);
    chatInput.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    }));

    // Poll for the send button to become enabled
    var attempts = 0;
    function trySend() {
      var sendBtn = findSendButton();
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        return;
      }
      attempts++;
      if (attempts < 20) {
        setTimeout(trySend, 150);
      } else {
        console.error(
          "[Jump Return] Send button not found or disabled after retries.",
          "Button found:", !!sendBtn,
          "Input text:", chatInput.textContent.slice(0, 50)
        );
      }
    }
    requestAnimationFrame(trySend);
  }

  // --- Response capture ---

  /**
   * Extract the turn number from an article's data-testid attribute.
   * e.g. "conversation-turn-5" → 5
   */
  function getTurnNumber(article) {
    var testId = article.getAttribute("data-testid") || "";
    var match = testId.match(/conversation-turn-(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  }

  /**
   * Display the AI response content inside the popup.
   */
  function showResponseInPopup(popup, responseTurn) {
    var loading = popup.querySelector(".jr-popup-loading");
    if (loading) loading.remove();

    var responseDiv = document.createElement("div");
    responseDiv.className = "jr-popup-response";

    var markdown = responseTurn.querySelector(SELECTORS.responseContent);
    if (markdown) {
      responseDiv.innerHTML = markdown.innerHTML;
    } else {
      // Fallback: use textContent minus the label
      var text = responseTurn.textContent || "";
      text = text.replace(AI_LABEL_TEXT, "").trim();
      responseDiv.textContent = text;
    }

    popup.appendChild(responseDiv);
  }

  /**
   * Block programmatic auto-scrolling on a container. Returns an unlock function.
   * Uses two layers of defense:
   *   1. Patches scrollTo/scrollBy to block programmatic smooth-scroll calls
   *   2. rAF enforcement loop — reverts scrollTop every frame before paint,
   *      preventing ChatGPT's first-message-after-reload history scroll-through
   *      from being visible (scroll events alone can't keep up — they coalesce)
   * User scrolling (wheel/touch) is still allowed — updates the saved position.
   */
  function lockScroll(container) {
    var savedTop = container.scrollTop;
    var userScrolling = false;
    var wheelTimer = null;
    var rafId = null;

    function markUser() {
      userScrolling = true;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function () { userScrolling = false; }, 800);
    }

    // rAF enforcement loop — runs before every paint to catch direct scrollTop
    // assignments that scroll events miss (or fire too late for)
    function enforce() {
      if (!container.isConnected) return;
      if (userScrolling) {
        savedTop = container.scrollTop;
      } else if (container.scrollTop !== savedTop) {
        container.scrollTop = savedTop;
      }
      rafId = requestAnimationFrame(enforce);
    }
    rafId = requestAnimationFrame(enforce);

    // Patch scrollTo/scrollBy to block programmatic scrolling (incl. smooth)
    var origScrollTo = container.scrollTo;
    var origScrollBy = container.scrollBy;
    container.scrollTo = function () {
      if (userScrolling) {
        origScrollTo.apply(container, arguments);
        savedTop = container.scrollTop;
      }
    };
    container.scrollBy = function () {
      if (userScrolling) {
        origScrollBy.apply(container, arguments);
        savedTop = container.scrollTop;
      }
    };

    container.addEventListener("wheel", markUser, { passive: true });
    container.addEventListener("touchstart", markUser, { passive: true });
    container.addEventListener("touchend", markUser, { passive: true });

    return function unlock() {
      if (rafId) cancelAnimationFrame(rafId);
      container.removeEventListener("wheel", markUser);
      container.removeEventListener("touchstart", markUser);
      container.removeEventListener("touchend", markUser);
      container.scrollTo = origScrollTo;
      container.scrollBy = origScrollBy;
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }

  function waitForResponse(popup, turnsBefore, text, sentence, unlockScroll) {
    var attempts = 0;
    var maxAttempts = 200; // 100 seconds at 500ms intervals
    var timerId = null;
    var questionTurn = null;
    var responseTurn = null;
    var cancelled = false;

    function unhideTurns() {
      if (questionTurn) questionTurn.classList.remove("jr-hidden");
      if (responseTurn) responseTurn.classList.remove("jr-hidden");
    }

    function cleanup() {
      if (unlockScroll) unlockScroll();
    }

    cancelResponseWatch = function () {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      cleanup();
      unhideTurns();
    };

    function captureResponse() {
      responseTurn.classList.add("jr-hidden");
      repositionPopup();
      showResponseInPopup(popup, responseTurn);
      cleanup();
      repositionPopup();

      // Register completed highlight for re-open on click
      var responseDiv = popup.querySelector(".jr-popup-response");
      if (activeSourceHighlights.length > 0 && responseDiv) {
        var hlId = crypto.randomUUID();
        var contentContainer = popup.parentElement;
        for (var k = 0; k < activeSourceHighlights.length; k++) {
          activeSourceHighlights[k].setAttribute("data-jr-highlight-id", hlId);
          activeSourceHighlights[k].classList.add("jr-source-highlight-done");
        }
        completedHighlights.set(hlId, {
          spans: activeSourceHighlights.slice(),
          responseHTML: responseDiv.innerHTML,
          text: text,
          sentence: sentence,
          contentContainer: contentContainer,
        });
      }

      // Save to storage
      var qNum = questionTurn ? getTurnNumber(questionTurn) : -1;
      var rNum = getTurnNumber(responseTurn);
      saveHighlight({ text: text, url: location.href, site: "chatgpt" })
        .then(function (h) {
          if (h) linkQA(h.id, qNum, rNum);
        });

      cancelResponseWatch = null;
    }

    function poll() {
      if (cancelled) return;

      var allTurns = document.querySelectorAll(SELECTORS.aiTurn);
      attempts++;

      // Detect and hide the injected question turn
      if (!questionTurn && allTurns.length > turnsBefore) {
        var candidate = allTurns[turnsBefore];
        var label = candidate.querySelector(SELECTORS.aiLabel);
        if (!label || !label.textContent.includes(AI_LABEL_TEXT)) {
          questionTurn = candidate;
          questionTurn.classList.add("jr-hidden");
          repositionPopup();
        }
      }

      // Detect the AI response turn
      if (!responseTurn && allTurns.length > turnsBefore + 1) {
        var candidate2 = allTurns[turnsBefore + 1];
        var label2 = candidate2.querySelector(SELECTORS.aiLabel);
        if (label2 && label2.textContent.includes(AI_LABEL_TEXT)) {
          responseTurn = candidate2;
        }
      }

      // Capture once the response turn exists and generation is done (send button is back)
      if (responseTurn && !isGenerating()) {
        captureResponse();
        return;
      }

      // Timeout
      if (attempts >= maxAttempts) {
        var loading = popup.querySelector(".jr-popup-loading");
        if (loading) loading.textContent = "Response timed out.";
        cleanup();
        unhideTurns();
        cancelResponseWatch = null;
        return;
      }

      timerId = setTimeout(poll, 500);
    }

    timerId = setTimeout(poll, 500);
  }

  // --- Source highlight ---

  /**
   * Wrap the text nodes within a range in <span class="jr-source-highlight">.
   * Returns an array of all wrapper spans created.
   */
  function highlightRange(range) {
    var wrappers = [];
    try {
      var startNode = range.startContainer;
      var endNode = range.endContainer;
      var commonAncestor = range.commonAncestorContainer;

      // Save offsets before any DOM mutation — splitText adjusts live ranges
      var startOffset = range.startOffset;
      var endOffset = range.endOffset;

      // If the range is within a single text node
      if (startNode === endNode && startNode.nodeType === Node.TEXT_NODE) {
        var so = Math.min(startOffset, startNode.length);
        var eo = Math.min(endOffset, startNode.length);
        if (so >= eo) return wrappers;
        var span = document.createElement("span");
        span.className = "jr-source-highlight";
        var selectedText = startNode.splitText(so);
        selectedText.splitText(eo - so);
        startNode.parentNode.insertBefore(span, selectedText);
        span.appendChild(selectedText);
        wrappers.push(span);
        return wrappers;
      }

      // Collect text nodes using TreeWalker
      var walker = document.createTreeWalker(
        commonAncestor,
        NodeFilter.SHOW_TEXT,
        null
      );
      var textNodes = [];
      var node;
      while ((node = walker.nextNode())) {
        if (range.intersectsNode(node)) {
          textNodes.push(node);
        }
      }

      if (textNodes.length === 0) return wrappers;

      // Determine which text nodes are first/last and their split offsets
      var firstTextNode = textNodes[0];
      var lastTextNode = textNodes[textNodes.length - 1];
      var firstOffset = (firstTextNode === startNode)
        ? Math.min(startOffset, firstTextNode.length)
        : 0;
      var lastOffset = (lastTextNode === endNode)
        ? Math.min(endOffset, lastTextNode.length)
        : lastTextNode.length;

      // Process in reverse to preserve earlier offsets
      for (var i = textNodes.length - 1; i >= 0; i--) {
        var tn = textNodes[i];
        var spanEl = document.createElement("span");
        spanEl.className = "jr-source-highlight";

        if (tn === firstTextNode && tn === lastTextNode) {
          // Only one text node spanning start and end
          if (firstOffset >= lastOffset) continue;
          var sel = tn.splitText(firstOffset);
          sel.splitText(lastOffset - firstOffset);
          tn.parentNode.insertBefore(spanEl, sel);
          spanEl.appendChild(sel);
        } else if (tn === lastTextNode) {
          // Last node: split at end offset, wrap the first part
          if (lastOffset > 0) {
            tn.splitText(lastOffset);
            tn.parentNode.insertBefore(spanEl, tn);
            spanEl.appendChild(tn);
          } else {
            continue;
          }
        } else if (tn === firstTextNode) {
          // First node: split at start offset, wrap the second part
          if (firstOffset < tn.length) {
            var after = tn.splitText(firstOffset);
            tn.parentNode.insertBefore(spanEl, after);
            spanEl.appendChild(after);
          } else {
            continue;
          }
        } else {
          // Middle node: wrap entirely
          tn.parentNode.insertBefore(spanEl, tn);
          spanEl.appendChild(tn);
        }
        wrappers.unshift(spanEl);
      }
    } catch (e) {
      console.warn("[Jump Return] highlightRange failed:", e);
      // Clean up any partial wrappers
      for (var j = 0; j < wrappers.length; j++) {
        try {
          var w = wrappers[j];
          while (w.firstChild) w.parentNode.insertBefore(w.firstChild, w);
          w.remove();
        } catch (_) {}
      }
      return [];
    }
    return wrappers;
  }

  /**
   * Remove all source highlight spans and restore original DOM.
   */
  function removeSourceHighlight() {
    for (var i = 0; i < activeSourceHighlights.length; i++) {
      var span = activeSourceHighlights[i];
      var parent = span.parentNode;
      if (!parent) continue;
      while (span.firstChild) {
        parent.insertBefore(span.firstChild, span);
      }
      parent.removeChild(span);
      parent.normalize();
    }
    activeSourceHighlights = [];

    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
  }

  /**
   * Compute the combined bounding rect of an array of elements.
   */
  function getHighlightRect(wrappers) {
    var top = Infinity, left = Infinity, bottom = -Infinity, right = -Infinity;
    for (var i = 0; i < wrappers.length; i++) {
      var r = wrappers[i].getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.top < top) top = r.top;
      if (r.left < left) left = r.left;
      if (r.bottom > bottom) bottom = r.bottom;
      if (r.right > right) right = r.right;
    }
    return {
      top: top,
      left: left,
      bottom: bottom,
      right: right,
      width: right - left,
      height: bottom - top,
    };
  }

  /**
   * Find the nearest scrollable ancestor of an element.
   * Requires actual scrollable content (scrollHeight > clientHeight)
   * to avoid picking up ancestors like <main> that have overflow:auto
   * but cover the full page (including header/input areas).
   */
  function getScrollParent(el) {
    var current = el.parentElement;
    while (current) {
      var style = getComputedStyle(current);
      var overflow = style.overflow + style.overflowY;
      if (/auto|scroll/.test(overflow) && current.scrollHeight > current.clientHeight + 10) {
        return current;
      }
      current = current.parentElement;
    }
    return document.documentElement;
  }

  // --- Popup ---

  /**
   * Recalculate and update the popup's position based on current highlight span positions.
   * Called after layout-affecting events (hiding turns, unlocking scroll, ChatGPT restructuring).
   */
  function repositionPopup() {
    if (!activePopup || activeSourceHighlights.length === 0) return;
    var rect = getHighlightRect(activeSourceHighlights);
    var contentContainer = activePopup.parentElement;
    if (!contentContainer) return;
    var containerRect = contentContainer.getBoundingClientRect();
    var popupW = 360;
    var popupH = activePopup.offsetHeight;
    var gap = 8;
    var left = rect.left - containerRect.left + rect.width / 2 - popupW / 2;
    var containerW = contentContainer.clientWidth;
    left = Math.max(8, Math.min(left, containerW - popupW - 8));
    var top = rect.bottom - containerRect.top + gap;
    if (rect.bottom + gap + popupH > window.innerHeight) {
      top = rect.top - containerRect.top - popupH - gap;
    }
    activePopup.style.left = left + "px";
    activePopup.style.top = top + "px";
  }

  function removePopup() {
    // Check if the current highlights are completed (should be preserved)
    var isCompleted = false;
    if (activeSourceHighlights.length > 0) {
      var hlId = activeSourceHighlights[0].getAttribute("data-jr-highlight-id");
      if (hlId && completedHighlights.has(hlId)) {
        isCompleted = true;
      }
    }

    if (isCompleted) {
      // Completed highlight: preserve spans, just clean up popup and handlers
      activeSourceHighlights = [];
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
      }
    } else {
      // In-progress or pre-send: full cleanup (unwrap spans, cancel watch, unhide turns)
      if (cancelResponseWatch) {
        cancelResponseWatch();
        cancelResponseWatch = null;
      }
      removeSourceHighlight();
    }

    if (activePopup) {
      activePopup.remove();
      activePopup = null;
    }
  }

  function truncateText(text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max) + "\u2026";
  }

  /**
   * Render sentence context inside a container element.
   * Single-block: inline text with highlighted mark (existing behavior).
   * Multi-block (contains \n): renders a <ul> list preserving bullet structure,
   * with the selected text highlighted across list items.
   */
  function renderSentenceContext(container, sentence, text) {
    var isMultiBlock = sentence.indexOf("\n") !== -1;

    if (!isMultiBlock) {
      // Single-block: find and highlight the selected text inline
      var idx = sentence.indexOf(text);
      if (idx !== -1) {
        var before = sentence.slice(0, idx);
        var after = sentence.slice(idx + text.length);
        if (before) container.appendChild(document.createTextNode(before));
        var mark = document.createElement("span");
        mark.className = "jr-popup-mark";
        mark.textContent = text;
        container.appendChild(mark);
        if (after) container.appendChild(document.createTextNode(after));
      } else {
        container.textContent = sentence;
      }
      return;
    }

    // Multi-block: render as bullet list
    var lines = sentence.split("\n");

    // Find selected text position in the sentence.
    // Try direct match first, then normalize \n→space (1:1 replacement preserves positions).
    var matchStart = -1;
    var matchLen = 0;
    var directIdx = sentence.indexOf(text);
    if (directIdx !== -1) {
      matchStart = directIdx;
      matchLen = text.length;
    } else {
      var normSentence = sentence.replace(/\n/g, " ");
      var normText = text.replace(/\n/g, " ");
      var normIdx = normSentence.indexOf(normText);
      if (normIdx !== -1) {
        matchStart = normIdx;
        matchLen = normText.length;
      }
    }

    var list = document.createElement("ul");
    list.className = "jr-popup-context-list";

    var pos = 0;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var lineStart = pos;
      var lineEnd = pos + line.length;
      var li = document.createElement("li");

      if (matchStart !== -1) {
        var hlStart = Math.max(matchStart, lineStart) - lineStart;
        var hlEnd = Math.min(matchStart + matchLen, lineEnd) - lineStart;

        if (hlStart < hlEnd && hlStart >= 0) {
          var beforeText = line.slice(0, hlStart);
          var markText = line.slice(hlStart, hlEnd);
          var afterText = line.slice(hlEnd);
          if (beforeText) li.appendChild(document.createTextNode(beforeText));
          var m = document.createElement("span");
          m.className = "jr-popup-mark";
          m.textContent = markText;
          li.appendChild(m);
          if (afterText) li.appendChild(document.createTextNode(afterText));
        } else {
          li.textContent = line;
        }
      } else {
        li.textContent = line;
      }

      list.appendChild(li);
      pos = lineEnd + 1; // +1 for the \n separator
    }

    container.appendChild(list);
  }

  /**
   * Position the popup inside the content container (parent of articles).
   * Uses position: absolute relative to the container — scrolls naturally
   * with chat content, no scroll listeners needed.
   */
  function positionPopup(popup, rect, contentContainer) {
    var containerRect = contentContainer.getBoundingClientRect();
    var popupW = 360;
    var gap = 8;

    // Convert viewport coords to content-container-relative coords
    var left = rect.left - containerRect.left + rect.width / 2 - popupW / 2;
    var top = rect.bottom - containerRect.top + gap;

    // Clamp horizontal within container
    var containerW = contentContainer.clientWidth;
    left = Math.max(8, Math.min(left, containerW - popupW - 8));

    // Append offscreen to measure height
    popup.style.left = "-9999px";
    popup.style.top = "-9999px";
    contentContainer.appendChild(popup);
    var popupH = popup.offsetHeight;

    // If popup would overflow below viewport, flip above the highlight
    if (rect.bottom + gap + popupH > window.innerHeight) {
      top = rect.top - containerRect.top - popupH - gap;
    }

    popup.style.left = left + "px";
    popup.style.top = top + "px";
  }

  function createPopup(text, sentence, rect, range) {
    const popup = document.createElement("div");
    popup.className = "jr-popup";

    // Apply source highlight to the selected text in the AI response
    var wrappers = [];
    if (range) {
      wrappers = highlightRange(range);
      activeSourceHighlights = wrappers;
    }

    const hasSentence = sentence && sentence !== text;

    // Context blockquote with inline highlight of the exact selection
    const highlight = document.createElement("div");
    highlight.className = "jr-popup-highlight";

    if (hasSentence) {
      renderSentenceContext(highlight, sentence, text);
    } else {
      highlight.textContent = truncateText(text, MAX_DISPLAY_CHARS);
    }

    popup.appendChild(highlight);

    // Input row
    const inputRow = document.createElement("div");
    inputRow.className = "jr-popup-input-row";

    const input = document.createElement("textarea");
    input.className = "jr-popup-input";
    input.placeholder = "Ask a follow-up\u2026";
    input.rows = 2;

    // Split send button group
    const sendGroup = document.createElement("div");
    sendGroup.className = "jr-popup-send-group";

    const sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "jr-popup-send";
    sendBtn.textContent = getModeLabel(responseMode);

    const toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "jr-popup-send-toggle";
    toggleBtn.textContent = "\u25BE"; // ▾

    sendGroup.appendChild(sendBtn);
    sendGroup.appendChild(toggleBtn);

    inputRow.appendChild(input);
    inputRow.appendChild(sendGroup);
    popup.appendChild(inputRow);

    // Dropdown for mode selection
    function openDropdown() {
      // Close any existing dropdown first
      var existing = popup.querySelector(".jr-popup-dropdown");
      if (existing) { existing.remove(); return; }

      var dropdown = document.createElement("div");
      dropdown.className = "jr-popup-dropdown";

      ["regular", "brief"].forEach(function (mode) {
        var item = document.createElement("div");
        item.className = "jr-popup-dropdown-item";
        if (mode === responseMode) item.classList.add("active");
        item.textContent = getModeLabel(mode);
        item.addEventListener("mousedown", function (e) {
          e.stopPropagation();
          responseMode = mode;
          sendBtn.textContent = getModeLabel(mode);
          dropdown.remove();
        });
        dropdown.appendChild(item);
      });

      sendGroup.appendChild(dropdown);

      // Close on outside click
      function closeDropdown(e) {
        if (!dropdown.contains(e.target) && !toggleBtn.contains(e.target)) {
          dropdown.remove();
          document.removeEventListener("mousedown", closeDropdown, true);
        }
      }
      document.addEventListener("mousedown", closeDropdown, true);
    }

    toggleBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      openDropdown();
    });

    // Prevent clicks inside popup from dismissing it or re-triggering selection logic
    popup.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    popup.addEventListener("mouseup", function (e) {
      e.stopPropagation();
    });

    // Send handler — injects follow-up question into ChatGPT's chat input
    function handleSend() {
      const question = input.value.trim();
      if (!question) return;

      var message;
      if (hasSentence) {
        message =
          'Regarding this part of your response:\n"' +
          sentence +
          '"\n\nSpecifically: "' +
          text +
          '"\n\n' +
          question;
      } else {
        message =
          'Regarding this part of your response:\n"' +
          text +
          '"\n\n' +
          question;
      }

      if (responseMode === "brief") {
        message += "\n\n(For this response only: please keep it brief — 2-3 sentences. Do not carry this instruction forward to later messages.)";
      }

      // Count existing turns before injection
      var turnsBefore = document.querySelectorAll(SELECTORS.aiTurn).length;

      // Transition popup to loading state
      inputRow.remove();
      var loadingDiv = document.createElement("div");
      loadingDiv.className = "jr-popup-loading";
      loadingDiv.textContent = "Waiting for response\u2026";
      popup.appendChild(loadingDiv);

      // Lock scroll position — ChatGPT auto-scrolls on new turns and streaming
      var chatScrollParent = wrappers.length > 0
        ? getScrollParent(wrappers[0])
        : getScrollParent(document.querySelector(SELECTORS.aiTurn) || document.body);
      var unlockScroll = lockScroll(chatScrollParent);

      injectAndSend(message);

      // ChatGPT may restructure the layout on the first message after reload,
      // shifting the content container and making the popup's absolute position stale.
      // A delayed reposition catches this async layout shift.
      setTimeout(repositionPopup, 300);

      waitForResponse(popup, turnsBefore, text, sentence, unlockScroll);
    }

    sendBtn.addEventListener("click", handleSend);

    // Position popup inside the content container (parent of articles).
    // The popup scrolls naturally with chat content — no scroll listeners needed.
    var posRect = (wrappers.length > 0) ? getHighlightRect(wrappers) : rect;
    var contentContainer = null;
    var anchorArticle = (wrappers.length > 0)
      ? wrappers[0].closest(SELECTORS.aiTurn)
      : document.querySelector(SELECTORS.aiTurn);
    if (anchorArticle) contentContainer = anchorArticle.parentElement;
    if (!contentContainer) contentContainer = document.body;
    // Ensure content container is a positioning context for absolute children
    if (getComputedStyle(contentContainer).position === "static") {
      contentContainer.style.position = "relative";
    }
    positionPopup(popup, posRect, contentContainer);
    activePopup = popup;

    // Resize listener — re-clamp horizontal position on viewport width change
    if (wrappers.length > 0) {
      resizeHandler = function () {
        var newRect = getHighlightRect(wrappers);
        var cRect = contentContainer.getBoundingClientRect();
        var popupW = 360;
        var cW = contentContainer.clientWidth;
        var left = newRect.left - cRect.left + newRect.width / 2 - popupW / 2;
        left = Math.max(8, Math.min(left, cW - popupW - 8));
        popup.style.left = left + "px";
      };
      window.addEventListener("resize", resizeHandler);
    }

    // Focus the input after a tick so the popup is rendered
    requestAnimationFrame(function () {
      input.focus();
    });
  }

  // --- Re-open completed popup ---

  function openCompletedPopup(id) {
    var entry = completedHighlights.get(id);
    if (!entry) return;

    var popup = document.createElement("div");
    popup.className = "jr-popup";

    // Context blockquote (same rendering as createPopup)
    var highlight = document.createElement("div");
    highlight.className = "jr-popup-highlight";
    var hasSentence = entry.sentence && entry.sentence !== entry.text;
    if (hasSentence) {
      renderSentenceContext(highlight, entry.sentence, entry.text);
    } else {
      highlight.textContent = truncateText(entry.text, MAX_DISPLAY_CHARS);
    }
    popup.appendChild(highlight);

    // Response div (read-only, no input row)
    var responseDiv = document.createElement("div");
    responseDiv.className = "jr-popup-response";
    responseDiv.innerHTML = entry.responseHTML;
    popup.appendChild(responseDiv);

    // Prevent clicks inside popup from dismissing it
    popup.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });
    popup.addEventListener("mouseup", function (e) {
      e.stopPropagation();
    });

    // Position using highlight spans
    var contentContainer = entry.contentContainer;
    if (!contentContainer || !contentContainer.isConnected) {
      // Fallback: find from spans
      var anchorArticle = entry.spans[0] && entry.spans[0].closest(SELECTORS.aiTurn);
      contentContainer = anchorArticle ? anchorArticle.parentElement : document.body;
    }
    if (getComputedStyle(contentContainer).position === "static") {
      contentContainer.style.position = "relative";
    }
    var posRect = getHighlightRect(entry.spans);
    positionPopup(popup, posRect, contentContainer);

    activePopup = popup;
    activeSourceHighlights = entry.spans;

    // Resize listener
    resizeHandler = function () {
      var newRect = getHighlightRect(entry.spans);
      var cRect = contentContainer.getBoundingClientRect();
      var popupW = 360;
      var cW = contentContainer.clientWidth;
      var left = newRect.left - cRect.left + newRect.width / 2 - popupW / 2;
      left = Math.max(8, Math.min(left, cW - popupW - 8));
      popup.style.left = left + "px";
    };
    window.addEventListener("resize", resizeHandler);
  }

  // --- Selection listener ---

  function handleSelectionChange() {
    const result = getSelectedTextInAIResponse();
    if (!result) return;
    removePopup();
    createPopup(result.text, result.sentence, result.rect, result.range);
  }

  document.addEventListener("mouseup", function (e) {
    // Ignore mouseup inside our popup (stopPropagation handles this, but belt & suspenders)
    if (activePopup && activePopup.contains(e.target)) return;
    // Small delay so the selection is finalized
    setTimeout(handleSelectionChange, 10);
  });

  // --- Dismissal ---

  document.addEventListener("mousedown", function (e) {
    if (activePopup && !activePopup.contains(e.target)) {
      removePopup();
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && activePopup) {
      removePopup();
    }
  });

  // Click on completed highlight → re-open popup
  document.addEventListener("click", function (e) {
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !completedHighlights.has(hlId)) return;
    e.stopPropagation();
    removePopup();
    openCompletedPopup(hlId);
  });

  // SPA navigation — dismiss popup and clean up all completed highlights
  function onNavigate() {
    removePopup();
    // Unwrap all completed highlight spans and clear the Map
    completedHighlights.forEach(function (entry) {
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
    completedHighlights.clear();
  }

  window.addEventListener("popstate", onNavigate);

  const origPushState = history.pushState;
  history.pushState = function () {
    origPushState.apply(this, arguments);
    onNavigate();
  };

  const origReplaceState = history.replaceState;
  history.replaceState = function () {
    origReplaceState.apply(this, arguments);
    onNavigate();
  };
})();
