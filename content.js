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
  let activeHighlightId = null;    // current popup's highlight id (for chaining)
  let popupStack = [];             // saved parent popup states for nested chains
  let restoreTimer = null;
  let lastKnownUrl = location.href;
  let customPopupWidthL1 = null;      // session-persisted width for level-1 popups
  let customPopupWidthChained = null;  // session-persisted width for chained (level 2+) popups

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
   * Walk a block element's DOM tree and extract its text content,
   * recording the positions of citation pill elements (data-testid="webpage-citation-pill").
   * Returns { text: string, pills: [{start, end}] }.
   * The text is identical to node.textContent.trim(), but pills
   * tracks where inline citation references appear within it.
   */
  function extractBlockText(node) {
    var raw = "";
    var pills = [];
    var bolds = [];

    function walk(n, inBold) {
      if (n.nodeType === Node.TEXT_NODE) {
        if (inBold) {
          var bStart = raw.length;
          raw += n.textContent;
          bolds.push({ start: bStart, end: raw.length });
        } else {
          raw += n.textContent;
        }
        return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      // Citation pill — capture as a unit, record position
      if (n.getAttribute && n.getAttribute("data-testid") === "webpage-citation-pill") {
        var start = raw.length;
        raw += n.textContent;
        pills.push({ start: start, end: raw.length });
        return;
      }
      var nowBold = inBold || n.tagName === "STRONG" || n.tagName === "B";
      for (var child = n.firstChild; child; child = child.nextSibling) {
        walk(child, nowBold);
      }
    }

    walk(node, false);

    // Merge adjacent bold ranges (e.g. "text" split across multiple text nodes)
    if (bolds.length > 1) {
      var merged = [bolds[0]];
      for (var mi = 1; mi < bolds.length; mi++) {
        var prev = merged[merged.length - 1];
        if (bolds[mi].start <= prev.end) {
          prev.end = Math.max(prev.end, bolds[mi].end);
        } else {
          merged.push(bolds[mi]);
        }
      }
      bolds = merged;
    }

    // Adjust positions for leading whitespace that trim() removes
    var leadingWS = raw.length - raw.trimStart().length;
    var trimmed = raw.trim();
    if (leadingWS > 0) {
      var ranges = [pills, bolds];
      for (var r = 0; r < ranges.length; r++) {
        var arr = ranges[r];
        for (var i = arr.length - 1; i >= 0; i--) {
          arr[i].start -= leadingWS;
          arr[i].end -= leadingWS;
          if (arr[i].end <= 0 || arr[i].start >= trimmed.length) {
            arr.splice(i, 1);
          } else {
            arr[i].start = Math.max(0, arr[i].start);
            arr[i].end = Math.min(trimmed.length, arr[i].end);
          }
        }
      }
    }

    return { text: trimmed, pills: pills, bolds: bolds };
  }

  /**
   * Extract the containing sentence(s) for a selection range within a container element.
   * For single-block selections, expands to sentence boundaries.
   * For multi-block selections (e.g. multiple bullet points), collects
   * the full text of each selected block, joined with newlines.
   * Works for both AI response articles and popup response divs.
   * Returns the trimmed string, or null on failure.
   */
  function extractSentenceInContainer(range, blockTypes, container) {
    // Walk all leaf blocks in the container and find which ones the range
    // actually intersects. This is reliable regardless of how the browser
    // positions Range anchors (parent elements, container blocks, etc.).
    var selectedBlocks = [];
    var leafWalker = document.createTreeWalker(container, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (node) {
        if (!BLOCK_TAGS.has(node.tagName)) return NodeFilter.FILTER_SKIP;
        var child = node.firstElementChild;
        while (child) {
          if (BLOCK_TAGS.has(child.tagName)) return NodeFilter.FILTER_SKIP;
          child = child.nextElementSibling;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var leafNode;
    while ((leafNode = leafWalker.nextNode())) {
      if (range.intersectsNode(leafNode)) selectedBlocks.push(leafNode);
    }
    if (selectedBlocks.length === 0) return null;

    var startBlock = selectedBlocks[0];
    var endBlock = selectedBlocks[selectedBlocks.length - 1];

    // Helper: shift an array of {start,end} ranges by a given amount,
    // removing any that fall entirely outside [0, textLen).
    function shiftRanges(arr, shift, textLen) {
      var result = [];
      for (var i = 0; i < arr.length; i++) {
        var s = arr[i].start - shift;
        var e = arr[i].end - shift;
        if (e > 0 && s < textLen) {
          result.push({ start: Math.max(0, s), end: Math.min(textLen, e) });
        }
      }
      return result;
    }

    // Helper: trim leading citation pills from text (never start a quote with a link box).
    function trimLeadingPills(text, pills, bolds) {
      while (pills.length > 0 && pills[0].start === 0) {
        var pEnd = pills[0].end;
        pills.shift();
        var rest = text.slice(pEnd);
        var ws = rest.length - rest.trimStart().length;
        text = rest.trimStart();
        var shift = pEnd + ws;
        pills = shiftRanges(pills, shift, text.length);
        bolds = shiftRanges(bolds, shift, text.length);
      }
      return { text: text, pills: pills, bolds: bolds };
    }

    // Multi-block selection
    if (selectedBlocks.length > 1) {
      var blocks = [];
      var prevLI = null;
      for (var bi = 0; bi < selectedBlocks.length; bi++) {
        var node = selectedBlocks[bi];
        var extracted = extractBlockText(node);
        var blockText = extracted.text;
        var blockPills = extracted.pills;
        var blockBolds = extracted.bolds;
        var isFirstSent = true;

        // For startBlock: trim to the sentence containing the selection start
        if (node === startBlock && node.tagName !== "PRE" && node.contains(range.startContainer)) {
          var rawOffS = getOffsetInBlock(node, range.startContainer, range.startOffset);
          var leadWSS = node.textContent.length - node.textContent.trimStart().length;
          var trimOffS = Math.max(0, rawOffS - leadWSS);
          var bSS = 0;
          for (var si = trimOffS - 1; si >= 0; si--) {
            if (SENTENCE_TERMINATORS.indexOf(blockText[si]) !== -1) { bSS = si + 1; break; }
          }
          if (bSS > 0) {
            isFirstSent = false;
            var slicedS = blockText.slice(bSS);
            var sliceLeadS = slicedS.length - slicedS.trimStart().length;
            blockText = slicedS.trim();
            blockPills = shiftRanges(blockPills, bSS + sliceLeadS, blockText.length);
            blockBolds = shiftRanges(blockBolds, bSS + sliceLeadS, blockText.length);
          }
        }

        // For endBlock: trim to the sentence containing the selection end
        if (node === endBlock && node.tagName !== "PRE" && node.contains(range.endContainer)) {
          var rawOffE = getOffsetInBlock(node, range.endContainer, range.endOffset);
          var leadWSE = node.textContent.length - node.textContent.trimStart().length;
          var trimOffE = Math.min(blockText.length, Math.max(0, rawOffE - leadWSE));
          var bSE = blockText.length;
          for (var si2 = trimOffE; si2 < blockText.length; si2++) {
            if (SENTENCE_TERMINATORS.indexOf(blockText[si2]) !== -1) { bSE = si2 + 1; break; }
          }
          if (bSE < blockText.length) {
            blockText = blockText.slice(0, bSE).trim();
            blockPills = shiftRanges(blockPills, 0, blockText.length);
            blockBolds = shiftRanges(blockBolds, 0, blockText.length);
          }
        }

        // Never start the quote with a citation pill
        if (blocks.length === 0 && blockPills.length > 0 && blockPills[0].start === 0) {
          var trimmed = trimLeadingPills(blockText, blockPills, blockBolds);
          blockText = trimmed.text;
          blockPills = trimmed.pills;
          blockBolds = trimmed.bolds;
        }

        if (!blockText) { continue; }

        blocks.push(blockText);
        if (blockTypes) {
          var closestLI = node.closest("li");
          var depth = 0;
          var listType = "ul";
          var listStart = 1;
          if (closestLI) {
            var ancestor = node.parentElement;
            while (ancestor && ancestor !== container) {
              if (ancestor.tagName === "UL" || ancestor.tagName === "OL") {
                if (depth === 0) {
                  listType = ancestor.tagName === "OL" ? "ol" : "ul";
                  if (ancestor.tagName === "OL") {
                    var liOrd = 1;
                    var prevSib = closestLI.previousElementSibling;
                    while (prevSib) {
                      if (prevSib.tagName === "LI") liOrd++;
                      prevSib = prevSib.previousElementSibling;
                    }
                    listStart = liOrd;
                  }
                }
                depth++;
              }
              ancestor = ancestor.parentElement;
            }
          }
          var tag;
          var isFirstBlk = !closestLI || node === closestLI || closestLI.firstElementChild === node;
          if (!closestLI) {
            tag = node.tagName;
          } else if (closestLI === prevLI) {
            tag = "LI_CONT";
          } else if (!isFirstSent || !isFirstBlk) {
            tag = "LI_CONT";
          } else {
            tag = "LI";
          }
          prevLI = closestLI;
          blockTypes.push({
            tag: tag,
            depth: depth,
            lineCount: blockText.split("\n").length,
            listType: listType,
            listStart: listStart,
            pills: blockPills,
            bolds: blockBolds.length > 0 ? blockBolds : null
          });
        }
      }
      if (blocks.length > 0) return blocks.join("\n");
    }

    // Single-block selection
    var blockText = startBlock.textContent;
    if (!blockText) return null;

    // Code blocks: return entire content (periods aren't sentence boundaries)
    if (startBlock.tagName === "PRE") return blockText.trim();

    var startOffset = getOffsetInBlock(startBlock, range.startContainer, range.startOffset);
    var endOffset = Math.min(
      blockText.length,
      getOffsetInBlock(startBlock, range.endContainer, range.endOffset)
    );

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

    // Detect bullet context, citation pills, and bold ranges for single-block selections
    if (blockTypes && sentence) {
      var singleExtracted = extractBlockText(startBlock);
      var closestLI = startBlock.closest("li");
      var isFirstBlk = !closestLI || startBlock === closestLI || closestLI.firstElementChild === startBlock;
      var isFirstSentence = closestLI && isFirstBlk && sentStart === 0;

      // Adjust pill and bold positions for the sentence substring
      var blockLeadWS = blockText.length - blockText.trimStart().length;
      var rawSlice = blockText.slice(sentStart, sentEnd);
      var sentLeadWS = rawSlice.length - rawSlice.trimStart().length;
      var rangeOffset = blockLeadWS - sentStart - sentLeadWS;

      var sentPills = [];
      var sentBolds = [];
      var singleRangeSets = [
        { src: singleExtracted.pills, dst: sentPills },
        { src: singleExtracted.bolds, dst: sentBolds }
      ];
      for (var rs = 0; rs < singleRangeSets.length; rs++) {
        var srcR = singleRangeSets[rs].src;
        var dstR = singleRangeSets[rs].dst;
        for (var pi = 0; pi < srcR.length; pi++) {
          var adjS = srcR[pi].start + rangeOffset;
          var adjE = srcR[pi].end + rangeOffset;
          if (adjE > 0 && adjS < sentence.length) {
            dstR.push({ start: Math.max(0, adjS), end: Math.min(sentence.length, adjE) });
          }
        }
      }

      // Never start the quote with a citation pill
      if (sentPills.length > 0 && sentPills[0].start === 0) {
        var trimResult = trimLeadingPills(sentence, sentPills, sentBolds);
        sentence = trimResult.text;
        sentPills = trimResult.pills;
        sentBolds = trimResult.bolds;
      }

      var hasMeta = isFirstSentence || sentPills.length > 0 || sentBolds.length > 0;
      if (hasMeta) {
        var singleDepth = 0;
        var singleListType = "ul";
        var singleListStart = 1;
        if (closestLI) {
          var singleAnc = startBlock.parentElement;
          while (singleAnc && singleAnc !== container) {
            if (singleAnc.tagName === "UL" || singleAnc.tagName === "OL") {
              if (singleDepth === 0) {
                singleListType = singleAnc.tagName === "OL" ? "ol" : "ul";
                if (singleAnc.tagName === "OL") {
                  var singleOrd = 1;
                  var sPrev = closestLI.previousElementSibling;
                  while (sPrev) {
                    if (sPrev.tagName === "LI") singleOrd++;
                    sPrev = sPrev.previousElementSibling;
                  }
                  singleListStart = singleOrd;
                }
              }
              singleDepth++;
            }
            singleAnc = singleAnc.parentElement;
          }
        }
        blockTypes.push({
          tag: isFirstSentence ? "LI" : startBlock.tagName,
          depth: singleDepth,
          lineCount: sentence.split("\n").length,
          listType: singleListType,
          listStart: singleListStart,
          pills: sentPills.length > 0 ? sentPills : null,
          bolds: sentBolds.length > 0 ? sentBolds : null
        });
      }
    }

    return sentence || null;
  }

  /**
   * Extract sentence context for a selection in an AI response article.
   * Thin wrapper around extractSentenceInContainer.
   */
  function extractSentence(range, blockTypes) {
    var article = getAIResponseArticle(
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer
    );
    if (!article) return null;
    return extractSentenceInContainer(range, blockTypes, article);
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
    const blockTypes = [];
    var sentence = null;
    try {
      sentence = extractSentence(range, blockTypes);
    } catch (ex) {
      console.warn("[JR] extractSentence threw:", ex);
    }
    const clonedRange = range.cloneRange();
    return { text, sentence, blockTypes: blockTypes.length > 0 ? blockTypes : null, rect, article: anchorArticle, range: clonedRange };
  }

  function getModeLabel(mode) {
    return mode === "regular" ? "Regular" : "Brief";
  }

  /**
   * Find a text substring within an element and return a Range.
   * Walks all text nodes, concatenates their content, finds the substring,
   * then maps the match back to the original text nodes/offsets.
   */
  function findTextRange(root, searchText) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    var fullText = "";
    var node;
    while ((node = walker.nextNode())) {
      nodes.push({ node: node, start: fullText.length });
      fullText += node.textContent;
    }

    if (nodes.length === 0) return null;

    var idx = fullText.indexOf(searchText);
    if (idx === -1) return null;

    var endIdx = idx + searchText.length;
    var startNode = null, startOffset = 0;
    var endNode = null, endOffset = 0;

    for (var i = 0; i < nodes.length; i++) {
      var nodeStart = nodes[i].start;
      var nodeEnd = nodeStart + nodes[i].node.textContent.length;

      if (startNode === null && idx < nodeEnd) {
        startNode = nodes[i].node;
        startOffset = idx - nodeStart;
      }

      if (endIdx <= nodeEnd) {
        endNode = nodes[i].node;
        endOffset = endIdx - nodeStart;
        break;
      }
    }

    if (!startNode || !endNode) return null;

    var range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
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
  function lockScroll(container, anchorEl) {
    var savedTop = container.scrollTop;
    var savedAnchorY = anchorEl ? anchorEl.getBoundingClientRect().top : null;
    var userScrolling = false;
    var wheelTimer = null;
    var rafId = null;

    function markUser() {
      userScrolling = true;
      if (wheelTimer) clearTimeout(wheelTimer);
      wheelTimer = setTimeout(function () { userScrolling = false; }, 800);
    }

    function addListeners(el) {
      el.addEventListener("wheel", markUser, { passive: true });
      el.addEventListener("touchstart", markUser, { passive: true });
      el.addEventListener("touchend", markUser, { passive: true });
    }
    function removeListeners(el) {
      el.removeEventListener("wheel", markUser);
      el.removeEventListener("touchstart", markUser);
      el.removeEventListener("touchend", markUser);
    }

    // rAF enforcement loop — runs before every paint to catch direct scrollTop
    // assignments that scroll events miss (or fire too late for)
    function enforce() {
      // If the scroll container was replaced (ChatGPT rebuilds on first message
      // after reload), re-find it from the anchor element
      if (!container.isConnected && anchorEl && anchorEl.isConnected) {
        removeListeners(container);
        container.scrollTo = origScrollTo;
        container.scrollBy = origScrollBy;
        container = getScrollParent(anchorEl);
        savedTop = container.scrollTop;
        origScrollTo = container.scrollTo;
        origScrollBy = container.scrollBy;
        patchScroll();
        addListeners(container);
      }
      if (!container.isConnected) return;

      if (userScrolling) {
        savedTop = container.scrollTop;
        if (anchorEl && anchorEl.isConnected) {
          savedAnchorY = anchorEl.getBoundingClientRect().top;
        }
      } else {
        // Anchor-based drift correction: measures actual viewport displacement,
        // survives container replacement and layout shifts
        if (anchorEl && anchorEl.isConnected && savedAnchorY !== null) {
          var currentY = anchorEl.getBoundingClientRect().top;
          var drift = currentY - savedAnchorY;
          if (Math.abs(drift) > 1) {
            container.scrollTop += drift;
            savedTop = container.scrollTop;
          }
        } else if (container.scrollTop !== savedTop) {
          container.scrollTop = savedTop;
        }
      }
      rafId = requestAnimationFrame(enforce);
    }
    rafId = requestAnimationFrame(enforce);

    // Patch scrollTo/scrollBy to block programmatic scrolling (incl. smooth)
    var origScrollTo = container.scrollTo;
    var origScrollBy = container.scrollBy;
    function patchScroll() {
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
    }
    patchScroll();
    addListeners(container);

    return function unlock() {
      if (rafId) cancelAnimationFrame(rafId);
      removeListeners(container);
      container.scrollTo = origScrollTo;
      container.scrollBy = origScrollBy;
      if (wheelTimer) clearTimeout(wheelTimer);
    };
  }

  function waitForResponse(popup, turnsBefore, text, sentence, blockTypes, unlockScroll, parentId) {
    var attempts = 0;
    var maxAttempts = 200; // 100 seconds at 500ms intervals
    var timerId = null;
    var questionTurn = null;
    var responseTurn = null;
    var cancelled = false;
    var detached = false;
    var detachedSpans = null;
    var detachedHlId = null;

    function unhideTurns() {
      if (questionTurn) questionTurn.classList.remove("jr-hidden");
      if (responseTurn) responseTurn.classList.remove("jr-hidden");
    }

    function cleanup() {
      if (unlockScroll) unlockScroll();
    }

    cancelResponseWatch = function (detachMode) {
      if (detachMode) {
        // Detach mode: keep poll running, save spans, release scroll lock
        detachedSpans = activeSourceHighlights.slice();
        detached = true;

        // Register highlight early so it's clickable during generation
        detachedHlId = crypto.randomUUID();
        var sourceArticle = detachedSpans[0].closest(SELECTORS.aiTurn);
        var contentContainer = sourceArticle ? sourceArticle.parentElement : document.body;
        for (var k = 0; k < detachedSpans.length; k++) {
          detachedSpans[k].setAttribute("data-jr-highlight-id", detachedHlId);
          detachedSpans[k].classList.add("jr-source-highlight-done");
        }
        completedHighlights.set(detachedHlId, {
          spans: detachedSpans.slice(),
          responseHTML: null,
          text: text,
          sentence: sentence,
          blockTypes: blockTypes,
          contentContainer: contentContainer,
          parentId: parentId || null,
        });

        cleanup();
        cancelResponseWatch = null;
        return;
      }
      // Full cancel: stop everything
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      cleanup();
      unhideTurns();
    };

    function captureResponse() {
      var spans = detached ? detachedSpans : activeSourceHighlights;

      responseTurn.classList.add("jr-hidden");

      // Extract response HTML
      var responseHTML = null;
      if (detached) {
        // No popup to populate — extract directly from the response turn
        var markdown = responseTurn.querySelector(SELECTORS.responseContent);
        if (markdown) responseHTML = markdown.innerHTML;
        cleanup();
      } else {
        repositionPopup();
        showResponseInPopup(popup, responseTurn);
        cleanup();
        repositionPopup();
        var responseDiv = popup.querySelector(".jr-popup-response");
        if (responseDiv) responseHTML = responseDiv.innerHTML;
      }

      var hlId;

      if (detached) {
        // Update the early-registered highlight with the actual response
        hlId = detachedHlId;
        var entry = completedHighlights.get(hlId);
        if (entry) entry.responseHTML = responseHTML;

        // If a popup is currently open for this highlight, show the response
        if (activePopup && activeSourceHighlights.length > 0 &&
            activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === hlId) {
          var loadingEl = activePopup.querySelector(".jr-popup-loading");
          if (loadingEl) loadingEl.remove();
          var respDiv = document.createElement("div");
          respDiv.className = "jr-popup-response";
          if (responseHTML) {
            respDiv.innerHTML = responseHTML;
          } else {
            respDiv.textContent = "No response content found.";
          }
          activePopup.appendChild(respDiv);
          repositionPopup();
          activeHighlightId = hlId;
        }
      } else {
        // Register completed highlight (works for both regular and chained popups)
        hlId = crypto.randomUUID();
        if (spans.length > 0 && responseHTML) {
          var contentContainer = popup.parentElement;
          for (var k = 0; k < spans.length; k++) {
            spans[k].setAttribute("data-jr-highlight-id", hlId);
            spans[k].classList.add("jr-source-highlight-done");
          }
          completedHighlights.set(hlId, {
            spans: spans.slice(),
            responseHTML: responseHTML,
            text: text,
            sentence: sentence,
            blockTypes: blockTypes,
            contentContainer: contentContainer,
            parentId: parentId || null,
          });
        }
        activeHighlightId = hlId;
      }

      // Save to storage with full data for persistence across reload
      var qNum = questionTurn ? getTurnNumber(questionTurn) : -1;
      var rNum = getTurnNumber(responseTurn);
      var sourceArticle = spans.length > 0
        ? spans[0].closest(SELECTORS.aiTurn)
        : null;
      var sourceTurnIdx = sourceArticle ? getTurnNumber(sourceArticle) : -1;
      saveHighlight({
        id: hlId,
        text: text,
        sentence: sentence,
        blockTypes: blockTypes,
        responseHTML: responseHTML,
        url: location.href,
        site: "chatgpt",
        parentId: parentId || null,
        sourceTurnIndex: sourceTurnIdx,
        questionIndex: qNum,
        responseIndex: rNum,
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
        if (!detached) {
          var loading = popup.querySelector(".jr-popup-loading");
          if (loading) loading.textContent = "Response timed out.";
        }
        cleanup();
        unhideTurns();
        // Remove detached highlight since no response arrived
        if (detached && detachedSpans) {
          if (detachedHlId) completedHighlights.delete(detachedHlId);
          for (var ds = 0; ds < detachedSpans.length; ds++) {
            var span = detachedSpans[ds];
            span.removeAttribute("data-jr-highlight-id");
            span.classList.remove("jr-source-highlight-done");
            var parent = span.parentNode;
            if (!parent) continue;
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
            parent.normalize();
          }
          detachedSpans = null;
        }
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
      if (!range || range.collapsed) {
        console.warn("[JR] highlightRange: range is", range ? "collapsed" : "null");
        return wrappers;
      }
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
   * Programmatically select all text across the active source highlight spans.
   * Creates a browser selection from the first to the last span so Ctrl+C works.
   */
  function selectSourceHighlightText() {
    if (activeSourceHighlights.length === 0) return;
    var sel = window.getSelection();
    sel.removeAllRanges();
    var range = document.createRange();
    range.setStartBefore(activeSourceHighlights[0]);
    range.setEndAfter(activeSourceHighlights[activeSourceHighlights.length - 1]);
    sel.addRange(range);
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
   * Walk the highlight chain to find the nearest ancestor with source highlight spans.
   * Chained popups have spans:[], so we need to traverse up to find spans for positioning.
   */
  function getAncestorWithSpans(highlightId) {
    var entry = completedHighlights.get(highlightId);
    while (entry) {
      if (entry.spans && entry.spans.length > 0) return entry;
      if (entry.parentId) {
        entry = completedHighlights.get(entry.parentId);
      } else {
        break;
      }
    }
    return null;
  }

  /**
   * Add mouseup handler to a popup that detects text selection inside .jr-popup-response
   * and spawns a chained popup. Also stops propagation to prevent document-level handlers.
   */
  function addPopupResponseSelectionHandler(popup) {
    popup.addEventListener("mouseup", function (e) {
      e.stopPropagation();
      if (!e.target.closest(".jr-popup-response")) return;
      // Mouseup on active source highlight: select text for copy (same as document-level handler)
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && activeSourceHighlights.indexOf(hlSpan) !== -1) {
        var sel = window.getSelection();
        if (sel.isCollapsed) selectSourceHighlightText();
        return;
      }
      // Mouseup on completed highlight: let the click handler open its popup
      if (e.target.closest(".jr-source-highlight-done")) return;
      setTimeout(function () {
        var selection = window.getSelection();
        if (!selection || selection.isCollapsed) return;
        // Don't create a chained popup if the selection is inside a child's source highlights
        var anchorEl = selection.anchorNode;
        if (anchorEl) {
          var container = anchorEl.nodeType === Node.TEXT_NODE ? anchorEl.parentElement : anchorEl;
          if (container) {
            var srcHL = container.closest(".jr-source-highlight");
            if (srcHL && activeSourceHighlights.indexOf(srcHL) !== -1) return;
          }
        }
        var selectedText = selection.toString().trim();
        if (!selectedText) return;
        if (!activeHighlightId || !completedHighlights.has(activeHighlightId)) return;
        var hlId = activeHighlightId;
        var range = selection.getRangeAt(0).cloneRange();
        selection.removeAllRanges();
        pushPopupState();
        createChainedPopup(selectedText, hlId, range);
      }, 10);
    });

    // Click on a child's source highlight inside this popup → select text for copy
    popup.addEventListener("click", function (e) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && activeSourceHighlights.indexOf(hlSpan) !== -1) {
        e.stopPropagation();
        selectSourceHighlightText();
      }
    });
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

  function getPopupWidth() {
    return customPopupWidthL1 || 360;
  }

  /**
   * Add drag-to-resize handlers to a popup.
   * Detects mousedown near the left/right edges and tracks mousemove to resize.
   */
  function addResizeHandlers(popup) {
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
      }

      function onUp() {
        popup._jrResizing = false;
        if (popup._jrChained) {
          customPopupWidthChained = popup.offsetWidth;
        } else {
          customPopupWidthL1 = popup.offsetWidth;
        }
        popup.style.cursor = "";
        document.removeEventListener("mousemove", onMove, true);
        document.removeEventListener("mouseup", onUp, true);
      }

      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseup", onUp, true);
    });
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
    var popupW = activePopup.offsetWidth;
    var popupH = activePopup.offsetHeight;
    var gap = 8;
    var direction = activePopup._jrDirection || "below";
    var left = rect.left - containerRect.left + rect.width / 2 - popupW / 2;
    var containerW = contentContainer.clientWidth;
    left = Math.max(8, Math.min(left, containerW - popupW - 8));
    var top;
    if (direction === "above") {
      top = rect.top - containerRect.top - popupH - gap;
    } else {
      top = rect.bottom - containerRect.top + gap;
    }
    activePopup.style.left = left + "px";
    activePopup.style.top = top + "px";
  }

  /**
   * Save the current popup state to the stack (parent stays visible in DOM).
   * Clears the active state so a new child popup can be created.
   */
  function pushPopupState() {
    popupStack.push({
      popup: activePopup,
      sourceHighlights: activeSourceHighlights,
      highlightId: activeHighlightId,
      resizeHandler: resizeHandler,
    });
    activePopup = null;
    activeSourceHighlights = [];
    activeHighlightId = null;
    resizeHandler = null;
  }

  /**
   * Close all open popups (active + entire stack).
   */
  function removeAllPopups() {
    while (activePopup || popupStack.length > 0) {
      removePopup();
    }
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
      // Completed highlight: preserve spans, just clean up popup and handlers.
      // If a chained response watch is running, cancel it (unhide its turns).
      if (cancelResponseWatch) {
        cancelResponseWatch(false);
      }
      activeSourceHighlights = [];
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
      }
    } else if (cancelResponseWatch) {
      // Loading state: detach watch, keep spans + hidden turns, let poll continue
      cancelResponseWatch(true);
      activeSourceHighlights = [];
      if (resizeHandler) {
        window.removeEventListener("resize", resizeHandler);
        resizeHandler = null;
      }
    } else {
      // Pre-send or no watch: full cleanup (unwrap spans)
      removeSourceHighlight();
    }

    if (activePopup) {
      // Clean up scroll tracking listener (for chained popups whose highlights are inside a parent popup's response)
      if (activePopup._jrScrollCleanup) {
        activePopup._jrScrollCleanup();
        activePopup._jrScrollCleanup = null;
      }
      activePopup.remove();
      activePopup = null;
    }
    activeHighlightId = null;

    // Restore parent popup state from the stack
    if (popupStack.length > 0) {
      var prev = popupStack.pop();
      activePopup = prev.popup;
      activeSourceHighlights = prev.sourceHighlights;
      activeHighlightId = prev.highlightId;
      resizeHandler = prev.resizeHandler;
    }
  }

  function createLoadingDiv() {
    var div = document.createElement("div");
    div.className = "jr-popup-loading";
    div.textContent = "Waiting for response\u2026";
    return div;
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
  function renderSentenceContext(container, sentence, text, blockTypes) {
    var isMultiBlock = sentence.indexOf("\n") !== -1;

    // Find selected text position in the sentence.
    // Try direct match first, then collapse all whitespace to single spaces.
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

    // Helper: append text, rendering \n as <br>
    function appendTextWithBreaks(parent, str) {
      if (!str) return;
      var parts = str.split("\n");
      for (var p = 0; p < parts.length; p++) {
        if (p > 0) parent.appendChild(document.createElement("br"));
        if (parts[p]) parent.appendChild(document.createTextNode(parts[p]));
      }
    }

    // Helper: fill element with block text, highlight mark, citation pills, and bold ranges.
    // Uses segment-based rendering to handle overlapping regions.
    function fillWithHighlight(el, blockText, blockStart, blockEnd, pills, bolds) {
      // Compute highlight range within this block
      var hlStart = -1, hlEnd = -1;
      if (matchStart !== -1) {
        hlStart = Math.max(matchStart, blockStart) - blockStart;
        hlEnd = Math.min(matchStart + matchLen, blockEnd) - blockStart;
        if (hlStart >= hlEnd || hlStart < 0) { hlStart = -1; hlEnd = -1; }
      }

      // Build boundary points from highlight, pills, and bolds
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
      // Sort and deduplicate
      points.sort(function (a, b) { return a - b; });
      var sorted = [points[0]];
      for (var s = 1; s < points.length; s++) {
        if (points[s] !== points[s - 1]) sorted.push(points[s]);
      }

      // Render each segment with appropriate styling
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

        // Build the text node or innermost wrapper
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
          content = null; // plain text
        }

        // Wrap in <strong> if bold
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
        // Render as a single-item bullet/numbered list
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
        // Use segment-based rendering to handle highlight, pills, and/or bolds
        fillWithHighlight(container, sentence, 0, sentence.length, singlePills, singleBolds);
      } else if (matchStart !== -1) {
        // Simple rendering: text before + highlighted mark + text after
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

    // Multi-block: render with structure matching original block types
    var lines = sentence.split("\n");

    // Build block list: each entry groups the correct number of \n-lines
    // based on lineCount from extractSentence (handles <br> within blocks)
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
    // Append any remaining lines not covered by blockTypes (fallback)
    for (; lineIdx < lines.length; lineIdx++) {
      blockList.push({
        text: lines[lineIdx],
        meta: { tag: "P", depth: 0 }
      });
    }

    // Find min LI depth for relative indentation
    var minDepth = Infinity;
    for (var k = 0; k < blockList.length; k++) {
      var t = blockList[k].meta.tag;
      if ((t === "LI" || t === "LI_CONT") && blockList[k].meta.depth < minDepth) {
        minDepth = blockList[k].meta.depth;
      }
    }
    if (minDepth === Infinity) minDepth = 1;

    // Render blocks, grouping consecutive LI/LI_CONT into <ul> or <ol>
    var pos = 0;
    var openList = null;
    var openListType = null; // "ul" or "ol"

    for (var i = 0; i < blockList.length; i++) {
      var block = blockList[i];
      var meta = block.meta;
      var blockStart = pos;
      var blockEnd = pos + block.text.length;

      if (meta.tag === "LI" || meta.tag === "LI_CONT") {
        var lt = meta.listType || "ul";
        // Close the open list if switching between ol/ul
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
  }

  /**
   * Position the popup inside the content container (parent of articles).
   * Uses position: absolute relative to the container — scrolls naturally
   * with chat content, no scroll listeners needed.
   */
  function positionPopup(popup, rect, contentContainer, forceDirection) {
    var containerRect = contentContainer.getBoundingClientRect();
    var gap = 8;

    // Append offscreen to measure dimensions
    popup.style.left = "-9999px";
    popup.style.top = "-9999px";
    contentContainer.appendChild(popup);
    var popupW = popup.offsetWidth;
    var popupH = popup.offsetHeight;

    // Convert viewport coords to content-container-relative coords
    var left = rect.left - containerRect.left + rect.width / 2 - popupW / 2;
    var top;
    var direction;

    if (forceDirection === "above") {
      top = rect.top - containerRect.top - popupH - gap;
      direction = "above";
    } else if (forceDirection === "below") {
      top = rect.bottom - containerRect.top + gap;
      direction = "below";
    } else {
      // Auto-detect: try below, flip above if overflow
      top = rect.bottom - containerRect.top + gap;
      direction = "below";
      if (rect.bottom + gap + popupH > window.innerHeight) {
        top = rect.top - containerRect.top - popupH - gap;
        direction = "above";
      }
    }

    // Clamp horizontal within container
    var containerW = contentContainer.clientWidth;
    left = Math.max(8, Math.min(left, containerW - popupW - 8));

    popup.style.left = left + "px";
    popup.style.top = top + "px";
    popup._jrDirection = direction;
  }

  function createPopup(text, sentence, blockTypes, rect, range) {
    const popup = document.createElement("div");
    popup.className = "jr-popup";
    if (customPopupWidthL1) popup.style.width = customPopupWidthL1 + "px";

    // Apply source highlight to the selected text in the AI response
    var wrappers = [];
    if (range) {
      wrappers = highlightRange(range);
      activeSourceHighlights = wrappers;
    }

    // Context blockquote with inline highlight of the exact selection
    const highlight = document.createElement("div");
    highlight.className = "jr-popup-highlight";

    if (sentence) {
      renderSentenceContext(highlight, sentence, text, blockTypes);
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

    // Prevent clicks inside popup from dismissing it or re-triggering selection logic.
    // If this popup is a parent (in the stack), close child popups down to this level —
    // but NOT if clicking on the child's source highlights (those need click-to-copy).
    popup.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      if (activePopup && activePopup !== popup && popupStack.length > 0) {
        var hlSpan = e.target.closest(".jr-source-highlight");
        if (!hlSpan || activeSourceHighlights.indexOf(hlSpan) === -1) {
          while (activePopup && activePopup !== popup && popupStack.length > 0) {
            removePopup();
          }
        }
      }
    });
    addPopupResponseSelectionHandler(popup);

    // Send handler — injects follow-up question into ChatGPT's chat input
    function handleSend() {
      const question = input.value.trim();
      if (!question) return;

      var message;
      if (sentence) {
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
        message += "\n\n(For this response only: please keep it brief — 2-3 sentences. This instruction applies to this single response only — do not carry it forward to any later messages.)";
      } else {
        message += "\n\n(Respond at whatever length is natural. If any previous message in this conversation asked for brevity, ignore that — it was a one-time instruction and does not apply here.)";
      }

      // Count existing turns before injection
      var turnsBefore = document.querySelectorAll(SELECTORS.aiTurn).length;

      // Transition popup to loading state
      inputRow.remove();
      var loadingDiv = createLoadingDiv();
      popup.appendChild(loadingDiv);

      // Lock scroll position — ChatGPT auto-scrolls on new turns and streaming
      var scrollAnchorL1 = wrappers.length > 0
        ? wrappers[0]
        : (document.querySelector(SELECTORS.aiTurn) || document.body);
      var chatScrollParent = getScrollParent(scrollAnchorL1);
      var unlockScroll = lockScroll(chatScrollParent, scrollAnchorL1);

      injectAndSend(message);

      // ChatGPT may restructure the layout on the first message after reload,
      // shifting the content container and making the popup's absolute position stale.
      // A delayed reposition catches this async layout shift.
      setTimeout(repositionPopup, 300);

      waitForResponse(popup, turnsBefore, text, sentence, blockTypes, unlockScroll);
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
    addResizeHandlers(popup);
    activePopup = popup;

    // Resize listener — re-clamp horizontal position on viewport width change
    if (wrappers.length > 0) {
      resizeHandler = function () {
        var newRect = getHighlightRect(wrappers);
        var cRect = contentContainer.getBoundingClientRect();
        var popupW = popup.offsetWidth;
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

    // Compute contentContainer early — needed for both span restoration and positioning
    var contentContainer = entry.contentContainer;
    if (!contentContainer || !contentContainer.isConnected) {
      var anchorArticle = entry.spans[0] && entry.spans[0].closest(SELECTORS.aiTurn);
      contentContainer = anchorArticle ? anchorArticle.parentElement : document.body;
    }

    var popup = document.createElement("div");
    popup.className = "jr-popup";
    var isChained = !!entry.parentId;
    popup._jrChained = isChained;
    var w = isChained ? customPopupWidthChained : customPopupWidthL1;
    if (w) popup.style.width = w + "px";

    // Context blockquote (same rendering as createPopup)
    var highlight = document.createElement("div");
    highlight.className = "jr-popup-highlight";
    if (entry.sentence) {
      renderSentenceContext(highlight, entry.sentence, entry.text, entry.blockTypes);
    } else {
      highlight.textContent = truncateText(entry.text, MAX_DISPLAY_CHARS);
    }
    popup.appendChild(highlight);

    if (entry.responseHTML) {
      // Response div (read-only, no input row)
      var responseDiv = document.createElement("div");
      responseDiv.className = "jr-popup-response";
      responseDiv.innerHTML = entry.responseHTML;
      popup.appendChild(responseDiv);

      // Restore chained highlights using text-matching (same as page-reload restore).
      // In-memory children first (current session), then storage (page reload).
      completedHighlights.forEach(function (chEntry, chId) {
        if (chEntry.parentId === id) {
          restoreHighlightInElement(responseDiv, {
            id: chId, text: chEntry.text, responseHTML: chEntry.responseHTML,
            sentence: chEntry.sentence, blockTypes: chEntry.blockTypes, parentId: chEntry.parentId,
          }, contentContainer);
        }
      });
      getChildHighlights(id).then(function (children) {
        for (var ci = 0; ci < children.length; ci++) {
          var child = children[ci];
          if (responseDiv.querySelector('[data-jr-highlight-id="' + child.id + '"]')) continue;
          restoreHighlightInElement(responseDiv, child, contentContainer);
        }
      });
    } else {
      // Still generating — show loading state
      var loadingDiv = createLoadingDiv();
      popup.appendChild(loadingDiv);
    }

    // Prevent clicks inside popup from dismissing it or re-triggering selection logic.
    // If this popup is a parent (in the stack), close child popups down to this level —
    // but NOT if clicking on the child's source highlights (those need click-to-copy).
    popup.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      if (activePopup && activePopup !== popup && popupStack.length > 0) {
        var hlSpan = e.target.closest(".jr-source-highlight");
        if (!hlSpan || activeSourceHighlights.indexOf(hlSpan) === -1) {
          while (activePopup && activePopup !== popup && popupStack.length > 0) {
            removePopup();
          }
        }
      }
    });
    addPopupResponseSelectionHandler(popup);
    if (getComputedStyle(contentContainer).position === "static") {
      contentContainer.style.position = "relative";
    }
    var posRect = getHighlightRect(entry.spans);
    var parentDirection = popupStack.length > 0 ? popupStack[popupStack.length - 1].popup._jrDirection : null;
    positionPopup(popup, posRect, contentContainer, parentDirection);
    addResizeHandlers(popup);

    activePopup = popup;
    activeSourceHighlights = entry.spans;
    activeHighlightId = id;

    // Resize listener
    resizeHandler = function () {
      var newRect = getHighlightRect(entry.spans);
      var cRect = contentContainer.getBoundingClientRect();
      var popupW = popup.offsetWidth;
      var cW = contentContainer.clientWidth;
      var left = newRect.left - cRect.left + newRect.width / 2 - popupW / 2;
      left = Math.max(8, Math.min(left, cW - popupW - 8));
      popup.style.left = left + "px";
    };
    window.addEventListener("resize", resizeHandler);

    // Scroll tracking: if source highlights are inside a parent popup's scrollable response,
    // reposition this popup when that response area scrolls.
    if (entry.spans.length > 0) {
      var parentRespDiv = entry.spans[0].closest(".jr-popup-response");
      if (parentRespDiv) {
        var onParentScroll = function () {
          if (!popup.isConnected || !entry.spans[0].isConnected) return;
          var r = getHighlightRect(entry.spans);
          var cRect = contentContainer.getBoundingClientRect();
          var popupW = popup.offsetWidth;
          var popupH = popup.offsetHeight;
          var gap = 8;
          var cW = contentContainer.clientWidth;
          var left = r.left - cRect.left + r.width / 2 - popupW / 2;
          left = Math.max(8, Math.min(left, cW - popupW - 8));
          var top = r.bottom - cRect.top + gap;
          if (r.bottom + gap + popupH > window.innerHeight) {
            top = r.top - cRect.top - popupH - gap;
          }
          popup.style.left = left + "px";
          popup.style.top = top + "px";
        };
        parentRespDiv.addEventListener("scroll", onParentScroll);
        popup._jrScrollCleanup = function () {
          parentRespDiv.removeEventListener("scroll", onParentScroll);
        };
      }
    }
  }

  // --- Chained popup ---

  function createChainedPopup(selectedText, parentId, range) {
    var popup = document.createElement("div");
    popup.className = "jr-popup";
    popup._jrChained = true;
    if (customPopupWidthChained) popup.style.width = customPopupWidthChained + "px";

    // Extract sentence context BEFORE highlightRange mutates the DOM
    var sentence = null;
    var chainedBlockTypes = [];
    if (range) {
      try {
        var startEl = range.startContainer;
        if (startEl.nodeType === Node.TEXT_NODE) startEl = startEl.parentElement;
        var responseDiv = startEl.closest(".jr-popup-response");
        if (responseDiv) {
          sentence = extractSentenceInContainer(range, chainedBlockTypes, responseDiv);
        }
      } catch (ex) {
        console.warn("[JR] chained sentence extraction failed:", ex);
      }
    }

    // Wrap the selected text in the parent popup's response with source highlight spans
    var wrappers = [];
    if (range) {
      wrappers = highlightRange(range);
      activeSourceHighlights = wrappers;
    }

    // Context blockquote — show sentence context with inline highlight, same as level 1
    var highlightDiv = document.createElement("div");
    highlightDiv.className = "jr-popup-highlight";
    if (sentence) {
      renderSentenceContext(highlightDiv, sentence, selectedText, chainedBlockTypes.length > 0 ? chainedBlockTypes : null);
    } else {
      highlightDiv.textContent = truncateText(selectedText, MAX_DISPLAY_CHARS);
    }
    popup.appendChild(highlightDiv);

    // Input row
    var inputRow = document.createElement("div");
    inputRow.className = "jr-popup-input-row";

    var input = document.createElement("textarea");
    input.className = "jr-popup-input";
    input.placeholder = "Ask a follow-up\u2026";
    input.rows = 2;

    // Split send button group
    var sendGroup = document.createElement("div");
    sendGroup.className = "jr-popup-send-group";

    var sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "jr-popup-send";
    sendBtn.textContent = getModeLabel(responseMode);

    var toggleBtn = document.createElement("button");
    toggleBtn.type = "button";
    toggleBtn.className = "jr-popup-send-toggle";
    toggleBtn.textContent = "\u25BE";

    sendGroup.appendChild(sendBtn);
    sendGroup.appendChild(toggleBtn);
    inputRow.appendChild(input);
    inputRow.appendChild(sendGroup);
    popup.appendChild(inputRow);

    // Dropdown for mode selection
    function openDropdown() {
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

    // Prevent clicks inside popup from dismissing it.
    // If this popup is a parent (in the stack), close child popups down to this level.
    popup.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      while (activePopup && activePopup !== popup && popupStack.length > 0) {
        removePopup();
      }
    });
    addPopupResponseSelectionHandler(popup);

    // Send handler
    function handleSend() {
      var question = input.value.trim();
      if (!question) return;

      var message;
      if (sentence) {
        message =
          'Regarding this part of your response:\n"' +
          sentence +
          '"\n\nSpecifically: "' +
          selectedText +
          '"\n\n' +
          question;
      } else {
        message =
          'Regarding this part of your response:\n"' +
          selectedText +
          '"\n\n' +
          question;
      }

      if (responseMode === "brief") {
        message += "\n\n(For this response only: please keep it brief \u2014 2-3 sentences. This instruction applies to this single response only \u2014 do not carry it forward to any later messages.)";
      } else {
        message += "\n\n(Respond at whatever length is natural. If any previous message in this conversation asked for brevity, ignore that \u2014 it was a one-time instruction and does not apply here.)";
      }

      var turnsBefore = document.querySelectorAll(SELECTORS.aiTurn).length;

      // Transition popup to loading state
      inputRow.remove();
      var loadingDiv = createLoadingDiv();
      popup.appendChild(loadingDiv);

      // Lock scroll position
      var scrollAnchor = wrappers.length > 0
        ? wrappers[0]
        : (document.querySelector(SELECTORS.aiTurn) || document.body);
      var chatScrollParent = getScrollParent(scrollAnchor);
      var unlockScroll = lockScroll(chatScrollParent, scrollAnchor);

      injectAndSend(message);
      setTimeout(repositionPopup, 300);

      waitForResponse(popup, turnsBefore, selectedText, sentence, chainedBlockTypes.length > 0 ? chainedBlockTypes : null, unlockScroll, parentId);
    }

    sendBtn.addEventListener("click", handleSend);

    // Position using the source highlight spans in the parent popup's response
    var posRect = wrappers.length > 0
      ? getHighlightRect(wrappers)
      : getHighlightRect(getAncestorWithSpans(parentId).spans);
    // Use the same content container as the parent popup
    var parentPopupEl = popupStack.length > 0 ? popupStack[popupStack.length - 1].popup : null;
    var contentContainer = parentPopupEl ? parentPopupEl.parentElement : document.body;
    if (getComputedStyle(contentContainer).position === "static") {
      contentContainer.style.position = "relative";
    }
    var parentDirection = parentPopupEl ? parentPopupEl._jrDirection : null;
    positionPopup(popup, posRect, contentContainer, parentDirection);
    addResizeHandlers(popup);
    activePopup = popup;

    // Resize listener
    var anchorSpans = wrappers;
    resizeHandler = function () {
      if (anchorSpans.length === 0 || !anchorSpans[0].isConnected) return;
      var newRect = getHighlightRect(anchorSpans);
      var cRect = contentContainer.getBoundingClientRect();
      var popupW = popup.offsetWidth;
      var cW = contentContainer.clientWidth;
      var left = newRect.left - cRect.left + newRect.width / 2 - popupW / 2;
      left = Math.max(8, Math.min(left, cW - popupW - 8));
      popup.style.left = left + "px";
    };
    window.addEventListener("resize", resizeHandler);

    // Scroll tracking: if source highlights are inside a parent popup's scrollable response,
    // reposition the chained popup when that response area scrolls.
    var parentRespDiv = parentPopupEl ? parentPopupEl.querySelector(".jr-popup-response") : null;
    if (parentRespDiv) {
      var onParentScroll = function () {
        if (!popup.isConnected || anchorSpans.length === 0 || !anchorSpans[0].isConnected) return;
        var r = getHighlightRect(anchorSpans);
        var cRect = contentContainer.getBoundingClientRect();
        var popupW = popup.offsetWidth;
        var popupH = popup.offsetHeight;
        var gap = 8;
        var cW = contentContainer.clientWidth;
        var left = r.left - cRect.left + r.width / 2 - popupW / 2;
        left = Math.max(8, Math.min(left, cW - popupW - 8));
        var top = r.bottom - cRect.top + gap;
        if (r.bottom + gap + popupH > window.innerHeight) {
          top = r.top - cRect.top - popupH - gap;
        }
        popup.style.left = left + "px";
        popup.style.top = top + "px";
      };
      parentRespDiv.addEventListener("scroll", onParentScroll);
      popup._jrScrollCleanup = function () {
        parentRespDiv.removeEventListener("scroll", onParentScroll);
      };
    }

    requestAnimationFrame(function () {
      input.focus();
    });
  }

  // --- Selection listener ---

  function handleSelectionChange() {
    // Remove any existing popup first — removeSourceHighlight() normalizes text
    // nodes, which can invalidate a previously cloned range's container references.
    removeAllPopups();
    const result = getSelectedTextInAIResponse();
    if (!result) return;
    createPopup(result.text, result.sentence, result.blockTypes, result.rect, result.range);
  }

  document.addEventListener("mouseup", function (e) {
    // Ignore mouseup inside our popup (stopPropagation handles this, but belt & suspenders)
    if (activePopup && activePopup.contains(e.target)) return;
    // Popup open + click on active source highlight: select text for copy
    if (activePopup) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && activeSourceHighlights.indexOf(hlSpan) !== -1) {
        var sel = window.getSelection();
        if (sel.isCollapsed) selectSourceHighlightText();
        return;
      }
    }
    // Don't race with the click handler that opens completed highlight popups —
    // handleSelectionChange would fire 10ms later and immediately remove the popup
    if (e.target.closest(".jr-source-highlight-done")) return;
    // Small delay so the selection is finalized
    setTimeout(handleSelectionChange, 10);
  });

  // --- Dismissal ---

  document.addEventListener("mousedown", function (e) {
    if (!activePopup && popupStack.length === 0) return;
    // Clicks inside any popup are caught by that popup's mousedown stopPropagation.
    // If we get here, the click was outside all popups.
    // Don't dismiss if clicking on a source highlight at any level (allows text selection)
    var hlSpan = e.target.closest(".jr-source-highlight");
    if (hlSpan) {
      if (activeSourceHighlights.indexOf(hlSpan) !== -1) return;
      for (var i = 0; i < popupStack.length; i++) {
        if (popupStack[i].sourceHighlights.indexOf(hlSpan) !== -1) return;
      }
      // Also check by highlight ID — the active popup's own source highlight
      if (activeHighlightId && hlSpan.getAttribute("data-jr-highlight-id") === activeHighlightId) return;
    }
    removeAllPopups();
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && activePopup) {
      removePopup();
    }
  });

  // Click on active source highlight (any state) → select text for copy;
  // click on completed highlight → open popup (push stack if inside a popup)
  document.addEventListener("click", function (e) {
    // Popup open + click on any active source highlight: select text for copy.
    if (activePopup) {
      var hlSpan = e.target.closest(".jr-source-highlight");
      if (hlSpan && activeSourceHighlights.indexOf(hlSpan) !== -1) {
        selectSourceHighlightText();
        return;
      }
    }
    // Completed highlight: open popup (or select for copy if it's the active popup's own highlight)
    var span = e.target.closest(".jr-source-highlight-done");
    if (!span) return;
    var hlId = span.getAttribute("data-jr-highlight-id");
    if (!hlId || !completedHighlights.has(hlId)) return;
    // If this highlight belongs to the currently active popup, select text for copy
    // (belt-and-suspenders: the popup-level click handler should have caught this,
    // but the event may not have bubbled through the popup in all cases)
    if (activePopup && activeHighlightId && hlId === activeHighlightId) {
      selectSourceHighlightText();
      return;
    }
    e.stopPropagation();
    // If inside a popup, push state to keep parent visible; otherwise close all
    if (span.closest(".jr-popup")) {
      pushPopupState();
    } else {
      removeAllPopups();
    }
    openCompletedPopup(hlId);
  });

  // --- Restore highlights from storage ---

  /**
   * Restore a single highlight by text-matching within a root element.
   * Shared by restoreHighlights (level 1, page reload) and
   * openCompletedPopup (chained highlights inside popup response).
   */
  function restoreHighlightInElement(root, hl, contentContainer) {
    var range = findTextRange(root, hl.text);
    if (!range) return false;
    var wrappers = highlightRange(range);
    if (wrappers.length === 0) return false;
    for (var k = 0; k < wrappers.length; k++) {
      wrappers[k].setAttribute("data-jr-highlight-id", hl.id);
      wrappers[k].classList.add("jr-source-highlight-done");
    }
    completedHighlights.set(hl.id, {
      spans: wrappers,
      responseHTML: hl.responseHTML,
      text: hl.text,
      sentence: hl.sentence,
      blockTypes: hl.blockTypes,
      contentContainer: contentContainer,
      parentId: hl.parentId || null,
    });
    return true;
  }

  /**
   * Restore saved highlights for the current conversation URL.
   * Polls the DOM for the required turns to appear (ChatGPT renders asynchronously),
   * then wraps the source text, hides Q&A turns, and populates completedHighlights.
   */
  function restoreHighlights() {
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }

    var url = location.href;

    getHighlightsByUrl(url).then(function (highlights) {
      if (highlights.length === 0) return;

      // Only restore highlights that have the full data needed
      var restorable = highlights.filter(function (hl) {
        return hl.sourceTurnIndex > 0 && hl.responseHTML;
      });
      if (restorable.length === 0) return;

      var attempts = 0;
      var maxAttempts = 30; // 15 seconds at 500ms intervals
      var remaining = restorable.slice();

      function tryRestore() {
        var stillRemaining = [];

        for (var i = 0; i < remaining.length; i++) {
          var hl = remaining[i];

          // Skip if already restored
          if (completedHighlights.has(hl.id)) continue;

          // Find the source turn article by turn number
          var sourceArticle = document.querySelector(
            'article[data-testid="conversation-turn-' + hl.sourceTurnIndex + '"]'
          );
          if (!sourceArticle) {
            stillRemaining.push(hl);
            continue;
          }

          // Find the text within the markdown content area
          var markdown = sourceArticle.querySelector(SELECTORS.responseContent);
          if (!markdown) {
            stillRemaining.push(hl);
            continue;
          }

          var contentContainer = sourceArticle.parentElement;
          if (!restoreHighlightInElement(markdown, hl, contentContainer)) continue;

          // Hide the injected Q&A turns
          if (hl.questionIndex > 0) {
            var qTurn = document.querySelector(
              'article[data-testid="conversation-turn-' + hl.questionIndex + '"]'
            );
            if (qTurn) qTurn.classList.add("jr-hidden");
          }
          if (hl.responseIndex > 0) {
            var rTurn = document.querySelector(
              'article[data-testid="conversation-turn-' + hl.responseIndex + '"]'
            );
            if (rTurn) rTurn.classList.add("jr-hidden");
          }
        }

        remaining = stillRemaining;
        attempts++;

        if (remaining.length > 0 && attempts < maxAttempts) {
          restoreTimer = setTimeout(tryRestore, 500);
        }
      }

      // Start immediately
      tryRestore();
    });
  }

  // SPA navigation — dismiss popup, clean up highlights, restore for new conversation
  function onNavigate() {
    // Guard: skip if URL hasn't actually changed (prevents double-processing
    // when both pushState patch and URL poller fire for the same navigation)
    var currentUrl = location.href;
    if (currentUrl === lastKnownUrl) return;
    lastKnownUrl = currentUrl;

    removeAllPopups();
    // Cancel any pending restore from a previous navigation
    if (restoreTimer) {
      clearTimeout(restoreTimer);
      restoreTimer = null;
    }
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
    // Restore highlights for the new conversation after React re-renders
    setTimeout(restoreHighlights, 1000);
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

  // Fallback navigation detection — polls for URL changes that our
  // pushState/replaceState patches may miss (e.g. Next.js saving a reference
  // to the original pushState before our content script patches it)
  setInterval(function () {
    if (location.href !== lastKnownUrl) {
      onNavigate();
    }
  }, 500);

  // Restore saved highlights on initial page load
  restoreHighlights();
})();
