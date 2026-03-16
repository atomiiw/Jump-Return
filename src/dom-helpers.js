// dom-helpers.js — DOM query and utility functions for Jump Return
(function () {
  "use strict";

  var S = JR.SELECTORS;

  /**
   * Check if a node is inside an AI response turn (not a user turn).
   * Returns the article element if yes, null otherwise.
   */
  JR.getAIResponseArticle = function (node) {
    var article = node.closest(S.aiTurn);
    if (!article) return null;
    var label = article.querySelector(S.aiLabel);
    if (!label || !label.textContent.includes(JR.AI_LABEL_TEXT)) return null;
    return article;
  };

  /**
   * Check if a node is inside the chat input area.
   */
  JR.isInsideChatInput = function (node) {
    return !!node.closest(S.chatInput);
  };

  /**
   * Check if ChatGPT is currently generating a response.
   * The stop button is present ONLY during active generation.
   */
  JR.isGenerating = function () {
    return !!document.querySelector(S.stopButton);
  };

  /**
   * Check if a node is inside our popup.
   */
  JR.isInsidePopup = function (node) {
    return !!node.closest(".jr-popup");
  };

  /**
   * Walk up from a node to find the nearest block-level ancestor,
   * stopping before the ceiling element.
   */
  JR.findBlockAncestor = function (node, ceiling) {
    var el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el !== ceiling) {
      if (JR.BLOCK_TAGS.has(el.tagName)) return el;
      el = el.parentElement;
    }
    return null;
  };

  /**
   * Get the character offset of a (container, offset) position within a block's textContent.
   */
  JR.getOffsetInBlock = function (block, container, offset) {
    var r = document.createRange();
    r.setStart(block, 0);
    r.setEnd(container, offset);
    return r.toString().length;
  };

  /**
   * Find the nearest scrollable ancestor of an element.
   * Requires actual scrollable content (scrollHeight > clientHeight)
   * to avoid picking up ancestors like <main> that have overflow:auto
   * but cover the full page (including header/input areas).
   */
  JR.getScrollParent = function (el) {
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
  };

  /**
   * Extract the turn number from an article's data-testid attribute.
   * e.g. "conversation-turn-5" → 5
   */
  JR.getTurnNumber = function (article) {
    var testId = article.getAttribute("data-testid") || "";
    var match = testId.match(/conversation-turn-(\d+)/);
    return match ? parseInt(match[1], 10) : -1;
  };

  JR.truncateText = function (text, max) {
    if (text.length <= max) return text;
    return text.slice(0, max) + "\u2026";
  };

  /**
   * Locate a highlight by quoteId and return its DOM position info.
   * Logs to console and returns the info object.
   * @param {string} hlId — quoteId of the highlight
   * @returns {object|null}
   */
  JR.locate = function (hlId) {
    if (!hlId) {
      // List all highlights
      var all = [];
      JR.state.completedHighlights.forEach(function (entry, id) {
        var span = entry.spans && entry.spans[0];
        var turn = span ? span.closest(S.aiTurn) : null;
        var turnNum = turn ? JR.getTurnNumber(turn) : -1;
        all.push({
          quoteId: id,
          turnIndex: turnNum,
          domOrder: -1,
          text: (entry.text || "").slice(0, 60),
          question: (entry.question || "").slice(0, 60),
          parentId: entry.parentId || null,
          color: entry.color || null,
          pending: entry.responseHTML === "__PENDING__",
          spanCount: entry.spans ? entry.spans.length : 0,
          connected: span ? span.isConnected : false,
        });
      });
      // Sort by turn index (cheap), then by DOM position within same turn
      all.sort(function (a, b) {
        if (a.turnIndex !== b.turnIndex) return a.turnIndex - b.turnIndex;
        if (!a.connected || !b.connected) return 0;
        var spanA = JR.state.completedHighlights.get(a.quoteId).spans[0];
        var spanB = JR.state.completedHighlights.get(b.quoteId).spans[0];
        var pos = spanA.compareDocumentPosition(spanB);
        return (pos & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
      });
      for (var oi = 0; oi < all.length; oi++) {
        all[oi].domOrder = oi;
      }
      // Light log — no console.table (it chokes DevTools with DOM refs)
      console.log("[JR.locate] " + all.length + " highlights:", all.map(function (h) {
        return h.domOrder + ": " + h.quoteId.slice(0, 8) + "… t" + h.turnIndex + " \"" + h.text.slice(0, 30) + "\"";
      }).join("\n"));
      return all;
    }

    var entry = JR.state.completedHighlights.get(hlId);
    if (!entry) {
      console.warn("[JR.locate] No highlight found with id:", hlId);
      return null;
    }

    var spans = entry.spans || [];
    var firstSpan = spans[0] || null;
    var turn = firstSpan ? firstSpan.closest(S.aiTurn) : null;
    var turnNum = turn ? JR.getTurnNumber(turn) : -1;
    var rect = firstSpan && firstSpan.isConnected ? firstSpan.getBoundingClientRect() : null;

    // Build ancestor path
    var path = [];
    if (firstSpan && firstSpan.isConnected) {
      var el = firstSpan;
      while (el && el !== document.body) {
        var tag = el.tagName.toLowerCase();
        var id = el.id ? "#" + el.id : "";
        var cls = el.className && typeof el.className === "string"
          ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".")
          : "";
        var testId = el.getAttribute && el.getAttribute("data-testid");
        var tidStr = testId ? "[data-testid=\"" + testId + "\"]" : "";
        path.push(tag + id + cls + tidStr);
        el = el.parentElement;
      }
    }

    // Build chain (parent → grandparent → … → root)
    var chain = [];
    var cur = entry;
    var curId = hlId;
    while (cur) {
      chain.unshift({ quoteId: curId, text: (cur.text || "").slice(0, 40) });
      if (!cur.parentId) break;
      curId = cur.parentId;
      cur = JR.state.completedHighlights.get(curId);
    }

    var info = {
      quoteId: hlId,
      text: entry.text,
      question: entry.question,
      color: entry.color || null,
      parentId: entry.parentId || null,
      chain: chain,
      turnIndex: turnNum,
      spanCount: spans.length,
      connected: firstSpan ? firstSpan.isConnected : false,
      pending: entry.responseHTML === "__PENDING__",
      versions: entry.items ? entry.items.length : 0,
      activeVersion: entry.activeItemIndex,
      rect: rect ? { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) } : null,
      domPath: path.slice(0, 8),
    };

    console.log("[JR.locate]", hlId, "| Turn:", turnNum, "| Connected:", info.connected, "| Pending:", info.pending, "| Text:", (entry.text || "").slice(0, 60));

    return info;
  };
})();
