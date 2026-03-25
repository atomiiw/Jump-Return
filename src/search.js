// search.js — Custom search bar for finding text inside popup content
(function () {
  "use strict";

  var st = JR.state;

  /** Get the horizontal center of the chat column, or null. */
  function getChatColCenter() {
    var el = document.querySelector('[class*="react-scroll-to-bottom"]') || document.querySelector('main');
    if (!el) return null;
    var r = el.getBoundingClientRect();
    return r.left + r.width / 2;
  }

  // --- SVGs ---
  var SEARCH_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,215.51,185,168a92.12,92.12,0,1,0-17,17l47.53,47.54a12,12,0,0,0,17-17ZM44,112a68,68,0,1,1,68,68A68.07,68.07,0,0,1,44,112Z"/></svg>';
  var DOWN_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216.49,104.49l-80,80a12,12,0,0,1-17,0l-80-80a12,12,0,0,1,17-17L128,159l71.51-71.52a12,12,0,0,1,17,17Z"/></svg>';
  var UP_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M216.49,168.49a12,12,0,0,1-17,0L128,97,56.49,168.49a12,12,0,0,1-17-17l80-80a12,12,0,0,1,17,0l80,80A12,12,0,0,1,216.49,168.49Z"/></svg>';
  var CLEAR_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M203.63,62.65l13.25-14.58a12,12,0,0,0-17.76-16.14L185.88,46.49A100,100,0,0,0,52.37,193.35L39.12,207.93a12,12,0,1,0,17.76,16.14l13.24-14.56A100,100,0,0,0,203.63,62.65ZM52,128A75.94,75.94,0,0,1,169.58,64.43l-100.91,111A75.6,75.6,0,0,1,52,128Zm76,76a75.52,75.52,0,0,1-41.58-12.43l100.91-111A75.94,75.94,0,0,1,128,204Z"/></svg>';

  // --- State ---
  var searchBar = null;
  var searchInput = null;
  var searchCount = null;
  var matches = [];       // flat ordered list of match objects
  var matchIndex = -1;    // current active match
  var debounceTimer = null;
  var textCache = {};     // itemId → stripped plain text of responseHTML
  var savedVersions = {}; // quoteId → original activeItemIndex (before search switched it)
  var lastSearchMap = null; // cached searchable map from last performSearch

  // --- Helpers ---

  /**
   * Strip HTML to plain text (cached per item id).
   * Runs rebuildCodeBlocks on the temp div so the extracted text matches
   * what the popup DOM actually contains (toolbar text stripped, etc.).
   */
  function stripHTML(html, cacheKey) {
    if (cacheKey && textCache[cacheKey]) return textCache[cacheKey];
    var div = document.createElement("div");
    div.innerHTML = html;
    if (JR.wireCopyButtons) JR.wireCopyButtons(div);
    var text = div.textContent || "";
    if (cacheKey) textCache[cacheKey] = text;
    return text;
  }

  /** Build parent chain for a quoteId (L1 root first). Checks both in-memory and search map. */
  function buildChain(hlId) {
    var chain = [hlId];
    var entry = st.completedHighlights.get(hlId)
      || (lastSearchMap && lastSearchMap.entries.get(hlId))
      || null;
    while (entry && entry.parentId) {
      chain.unshift(entry.parentId);
      entry = st.completedHighlights.get(entry.parentId)
        || (lastSearchMap && lastSearchMap.entries.get(entry.parentId))
        || null;
    }
    return chain;
  }

  /**
   * Collect all matches for the given query across the main page and
   * all highlight popups. Returns a flat sorted array of match objects.
   *
   * Order follows reading position: walk through turns top-to-bottom.
   * For each turn, add page text matches, then add popup matches for
   * any L1 highlights anchored in that turn (depth-first into children).
   * This way a popup's matches appear right after the page text that
   * surrounds its source highlight.
   */
  /**
   * Compute the character offset of a DOM node within a container's textContent.
   */
  function charOffsetOf(node, container) {
    var range = document.createRange();
    range.setStart(container, 0);
    range.setEnd(node, 0);
    return range.toString().length;
  }

  /**
   * Build a searchable entries map from both in-memory completedHighlights
   * and storage. Storage entries fill in children that haven't been opened yet.
   * Returns { entries: Map<quoteId, entry-like>, childrenOf: { parentId: [quoteId,...] } }
   */
  function buildSearchableMap(storageHighlights) {
    var entries = new Map();
    // Start with in-memory entries
    st.completedHighlights.forEach(function (entry, id) {
      entries.set(id, entry);
    });
    // Add storage-only entries (grouped by quoteId)
    if (storageHighlights) {
      var byQuote = {};
      for (var i = 0; i < storageHighlights.length; i++) {
        var h = storageHighlights[i];
        if (h.url !== location.href) continue;
        var qid = h.quoteId;
        if (!byQuote[qid]) byQuote[qid] = [];
        byQuote[qid].push(h);
      }
      var quoteIds = Object.keys(byQuote);
      for (var qi = 0; qi < quoteIds.length; qi++) {
        var qid2 = quoteIds[qi];
        if (entries.has(qid2)) continue; // already in memory
        var items = byQuote[qid2];
        items.sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
        var activeIdx = 0;
        for (var ai = 0; ai < items.length; ai++) {
          if (items[ai].active) activeIdx = ai;
        }
        entries.set(qid2, {
          quoteId: qid2,
          text: items[0].text,
          sentence: items[0].sentence,
          blockTypes: items[0].blockTypes,
          parentId: items[0].parentId || null,
          parentItemId: items[0].parentItemId || null,
          color: items[0].color || null,
          responseHTML: items[activeIdx].responseHTML,
          question: items[activeIdx].question,
          spans: [],
          items: items.map(function (it) {
            return { id: it.id, question: it.question, responseHTML: it.responseHTML, questionIndex: it.questionIndex, responseIndex: it.responseIndex };
          }),
          activeItemIndex: activeIdx,
          wholeResponse: !!items[0].wholeResponse,
        });
      }
    }
    var childrenOf = {};
    entries.forEach(function (entry, id) {
      if (entry.parentId) {
        if (!childrenOf[entry.parentId]) childrenOf[entry.parentId] = [];
        childrenOf[entry.parentId].push(id);
      }
    });
    return { entries: entries, childrenOf: childrenOf };
  }

  function collectMatches(query, searchMap) {
    if (!query) return [];
    var q = query.toLowerCase();
    var result = [];
    var S = JR.SELECTORS;

    var allEntries = searchMap.entries;
    var childrenOf = searchMap.childrenOf;

    /**
     * Collect popup matches for a highlight and its children (depth-first).
     * Returns an array of match objects.
     */
    function popupMatchesForEntry(quoteId, entry) {
      if (!entry || !entry.items) return [];
      var out = [];
      var chain = buildChain(quoteId);

      // Group children by parentItemId (every child has one after migration)
      var kids = childrenOf[quoteId] || [];
      var kidsByParentItem = {}; // parentItemId → [childQuoteId, ...]
      for (var ki = 0; ki < kids.length; ki++) {
        var kidEntry = allEntries.get(kids[ki]);
        if (!kidEntry) continue;
        var pid = kidEntry.parentItemId;
        if (pid) {
          if (!kidsByParentItem[pid]) kidsByParentItem[pid] = [];
          kidsByParentItem[pid].push(kids[ki]);
        }
      }

      // Search each version: question first, then response interleaved with children
      for (var vi = 0; vi < entry.items.length; vi++) {
        var item = entry.items[vi];

        // Question matches always come first for this version
        if (item.question) {
          var qLower = item.question.toLowerCase();
          var qp = 0;
          while ((qp = qLower.indexOf(q, qp)) !== -1) {
            out.push({ quoteId: quoteId, itemIndex: vi, field: "question", offset: qp, length: q.length, chain: chain });
            qp += q.length;
          }
        }

        // Response matches interleaved with child highlights by position
        var versionKids = kidsByParentItem[item.id] || [];
        if (item.responseHTML && item.responseHTML !== "__PENDING__") {
          var rText = stripHTML(item.responseHTML, item.id);
          var rLower = rText.toLowerCase();

          // Collect response text matches with offsets
          var respMatches = [];
          var rp = 0;
          while ((rp = rLower.indexOf(q, rp)) !== -1) {
            respMatches.push({ offset: rp, match: { quoteId: quoteId, itemIndex: vi, field: "response", offset: rp, length: q.length, chain: chain } });
            rp += q.length;
          }

          // Collect child highlights with their offset in the response text
          var childGroups = [];
          for (var vki = 0; vki < versionKids.length; vki++) {
            var childQid = versionKids[vki];
            var childEnt = allEntries.get(childQid);
            if (!childEnt) continue;
            var childText = childEnt.text ? childEnt.text.toLowerCase() : "";
            var childOff = childText ? rLower.indexOf(childText) : -1;
            if (childOff === -1) childOff = Infinity;
            childGroups.push({ offset: childOff, childQid: childQid, childEnt: childEnt });
          }
          childGroups.sort(function (a, b) { return a.offset - b.offset; });

          // Interleave by position — same pattern as page-level interleaving
          var ri = 0, ci = 0;
          while (ri < respMatches.length || ci < childGroups.length) {
            var rOff = ri < respMatches.length ? respMatches[ri].offset : Infinity;
            var cOff = ci < childGroups.length ? childGroups[ci].offset : Infinity;
            if (rOff === Infinity && cOff === Infinity) break;
            if (rOff <= cOff) {
              out.push(respMatches[ri].match);
              ri++;
            } else {
              var childOut = popupMatchesForEntry(childGroups[ci].childQid, childGroups[ci].childEnt);
              for (var co = 0; co < childOut.length; co++) out.push(childOut[co]);
              ci++;
            }
          }
          // Process any remaining children not reached by interleave (e.g. reply-to-all
          // whose text isn't a substring of the parent response → Infinity offset)
          for (; ci < childGroups.length; ci++) {
            var tailOut = popupMatchesForEntry(childGroups[ci].childQid, childGroups[ci].childEnt);
            for (var to2 = 0; to2 < tailOut.length; to2++) out.push(tailOut[to2]);
          }
        } else {
          // No response yet — just recurse into children
          for (var vki2 = 0; vki2 < versionKids.length; vki2++) {
            var childOut2 = popupMatchesForEntry(versionKids[vki2], allEntries.get(versionKids[vki2]));
            for (var co2 = 0; co2 < childOut2.length; co2++) out.push(childOut2[co2]);
          }
        }
      }

      return out;
    }

    // Walk turns in DOM order
    var turns = document.querySelectorAll(S.aiTurn);

    for (var ti = 0; ti < turns.length; ti++) {
      var turn = turns[ti];
      if (turn.classList.contains("jr-hidden")) continue;

      var markdown = turn.querySelector(S.responseContent);
      if (!markdown) continue;

      // Collect page matches with their character offsets
      var turnText = markdown.textContent || "";
      var ttLower = turnText.toLowerCase();
      var pageMatches = [];
      var tp = 0;
      while ((tp = ttLower.indexOf(q, tp)) !== -1) {
        pageMatches.push({ offset: tp, match: { quoteId: null, itemIndex: null, field: "page", offset: tp, length: q.length, chain: null, turnElement: markdown, turnIndex: ti } });
        tp += q.length;
      }

      // Collect L1 highlights in this turn with their character offsets
      var hlsInTurn = [];
      st.completedHighlights.forEach(function (entry, id) {
        if (entry.parentId || entry._jrTemp) return;
        if (!entry.spans || entry.spans.length === 0 || !entry.spans[0].isConnected) return;
        var hlTurn = entry.spans[0].closest(S.aiTurn);
        if (hlTurn !== turn) return;
        var charOff = charOffsetOf(entry.spans[0], markdown);
        hlsInTurn.push({ charOffset: charOff, quoteId: id, entry: entry });
      });
      // Sort highlights by DOM position within the turn
      hlsInTurn.sort(function (a, b) { return a.charOffset - b.charOffset; });

      // Interleave: walk page matches and insert popup groups at highlight positions
      var pi = 0; // page match index
      var hi2 = 0; // highlight index

      while (pi < pageMatches.length || hi2 < hlsInTurn.length) {
        // Pick whichever comes first by character offset
        var pageOff = pi < pageMatches.length ? pageMatches[pi].offset : Infinity;
        var hlOff = hi2 < hlsInTurn.length ? hlsInTurn[hi2].charOffset : Infinity;

        if (pageOff <= hlOff) {
          result.push(pageMatches[pi].match);
          pi++;
        } else {
          // Insert all popup matches for this highlight
          var popupMs = popupMatchesForEntry(hlsInTurn[hi2].quoteId, hlsInTurn[hi2].entry);
          for (var pm = 0; pm < popupMs.length; pm++) result.push(popupMs[pm]);
          hi2++;
        }
      }
    }

    return result;
  }

  // --- DOM Mark Highlighting ---

  /** Remove all search marks from the document. */
  function clearMarks() {
    var marks = document.querySelectorAll(".jr-search-mark");
    for (var i = 0; i < marks.length; i++) {
      var mark = marks[i];
      var parent = mark.parentNode;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();
    }
  }

  /**
   * Walk text nodes in a container to find the text at a given character
   * offset and wrap it in a <mark> element. Uses Range carefully to handle
   * matches that cross element boundaries (bold, italic, code, etc.).
   * Returns the mark element, or null if not found.
   */
  function insertMark(container, offset, length, isActive) {
    var walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    var charCount = 0;
    var node;
    var markClass = "jr-search-mark" + (isActive ? " jr-search-mark-active" : "");

    // First pass: find which text nodes the match spans
    var segments = []; // { node, startInNode, take }
    var remaining = length;
    var found = false;

    while ((node = walker.nextNode())) {
      var nodeLen = node.textContent.length;
      if (!found) {
        if (charCount + nodeLen <= offset) {
          charCount += nodeLen;
          continue;
        }
        // Match starts in this node
        found = true;
        var startInNode = offset - charCount;
        var available = nodeLen - startInNode;
        var take = Math.min(remaining, available);
        segments.push({ node: node, start: startInNode, take: take });
        remaining -= take;
        charCount += nodeLen;
      } else if (remaining > 0) {
        var take2 = Math.min(remaining, nodeLen);
        segments.push({ node: node, start: 0, take: take2 });
        remaining -= take2;
        charCount += nodeLen;
      }
      if (remaining <= 0) break;
    }

    if (segments.length === 0) return null;

    // Second pass: wrap each segment in its own mark (handles cross-element matches)
    var firstMark = null;
    for (var si = segments.length - 1; si >= 0; si--) {
      var seg = segments[si];
      try {
        var range = document.createRange();
        range.setStart(seg.node, seg.start);
        range.setEnd(seg.node, seg.start + seg.take);
        var mark = document.createElement("mark");
        mark.className = markClass;
        range.surroundContents(mark);
        firstMark = mark;
      } catch (ex) {
        // surroundContents can fail if range crosses element boundaries
        // within a single text node (shouldn't happen, but be safe)
      }
    }
    return firstMark;
  }

  /**
   * Apply search marks for ALL visible matches (like Chrome's native Cmd+F).
   * Non-active matches get jr-search-mark, active gets jr-search-mark-active.
   * Inserts marks from last offset to first within each container to avoid
   * offset-shift issues.
   */
  function applyMarks() {
    clearMarks();
    if (matches.length === 0 || matchIndex < 0) return;

    // Group matches by their DOM container
    var groups = [];
    var containerMap = new Map();

    for (var i = 0; i < matches.length; i++) {
      var m = matches[i];
      var container = getContainerForMatch(m);
      if (!container || !container.isConnected) continue;

      if (!containerMap.has(container)) {
        var group = { container: container, items: [] };
        containerMap.set(container, group);
        groups.push(group);
      }
      containerMap.get(container).items.push({ idx: i, offset: m.offset, length: m.length });
    }

    // Insert marks in each container, offset descending (last first)
    for (var g = 0; g < groups.length; g++) {
      var group = groups[g];
      group.items.sort(function (a, b) { return b.offset - a.offset; });
      for (var gi = 0; gi < group.items.length; gi++) {
        var item = group.items[gi];
        insertMark(group.container, item.offset, item.length, item.idx === matchIndex);
      }
    }

    // Scroll to the active mark
    var activeMark = document.querySelector(".jr-search-mark-active");
    if (activeMark) {
      var markRect = activeMark.getBoundingClientRect();
      var scrollParent = activeMark.closest(".jr-popup-response");
      if (scrollParent) {
        var parentRect = scrollParent.getBoundingClientRect();
        if (markRect.top < parentRect.top || markRect.bottom > parentRect.bottom) {
          activeMark.scrollIntoView({ block: "center" });
        }
      } else {
        var margin = window.innerHeight * 0.15;
        if (markRect.top < margin || markRect.bottom > window.innerHeight - margin) {
          activeMark.scrollIntoView({ block: "center" });
        }
      }
    }
  }

  /** Resolve the DOM container element for a match. */
  function getContainerForMatch(m) {
    if (m.field === "page") {
      return (m.turnElement && m.turnElement.isConnected) ? m.turnElement : null;
    }
    var entry = st.completedHighlights.get(m.quoteId);
    if (!entry) return null;

    // Only apply marks for the version currently displayed in the popup.
    // Other versions' offsets don't match the visible response text.
    var activeIdx = entry.activeItemIndex != null ? entry.activeItemIndex : 0;
    if (m.itemIndex != null && m.itemIndex !== activeIdx) return null;

    var popup = findPopupForQuoteId(m.quoteId);
    if (!popup) return null;

    if (m.field === "question") {
      return popup.querySelector(".jr-popup-question-text");
    } else if (m.field === "response") {
      return popup.querySelector(".jr-popup-response");
    }
    return null;
  }

  /** Find the popup element currently showing a given quoteId. */
  function findPopupForQuoteId(quoteId) {
    // Check active popup
    if (st.activeHighlightId === quoteId && st.activePopup) {
      return st.activePopup;
    }
    // Check popup stack
    for (var i = 0; i < st.popupStack.length; i++) {
      if (st.popupStack[i].highlightId === quoteId && st.popupStack[i].popup) {
        return st.popupStack[i].popup;
      }
    }
    return null;
  }

  // --- Navigation ---

  /**
   * Navigate to the match at the given index.
   * Opens the right popup chain if needed.
   */
  /**
   * Restore the original active version for a quoteId if we changed it during search.
   */
  function restoreVersion(quoteId) {
    if (!(quoteId in savedVersions)) return;
    var entry = st.completedHighlights.get(quoteId);
    if (!entry) { delete savedVersions[quoteId]; return; }
    var origIdx = savedVersions[quoteId];
    if (entry.activeItemIndex !== origIdx) {
      if (JR.switchPopupToVersion) JR.switchPopupToVersion(quoteId, origIdx);
    }
    delete savedVersions[quoteId];
  }

  /**
   * Restore all saved versions and close popups — called when leaving search.
   */
  function restoreAllVersions() {
    var ids = Object.keys(savedVersions);
    for (var i = 0; i < ids.length; i++) {
      var entry = st.completedHighlights.get(ids[i]);
      if (entry && entry.activeItemIndex !== savedVersions[ids[i]]) {
        entry.activeItemIndex = savedVersions[ids[i]];
        var v = entry.items[savedVersions[ids[i]]];
        if (v) {
          entry.question = v.question;
          entry.responseHTML = v.responseHTML;
          setActiveItem(ids[i], v.id);
        }
      }
    }
    savedVersions = {};
  }

  function navigateToMatch(idx) {
    if (idx < 0 || idx >= matches.length) return;
    matchIndex = idx;
    updateCounter();

    var m = matches[idx];

    if (m.field === "page") {
      // Page match — restore version of previous popup, close it, then mark
      if (st.activeHighlightId) restoreVersion(st.activeHighlightId);
      if (st.activePopup) JR.removeAllPopups();
      if (searchInput) searchInput.focus();
      applyMarks();
      return;
    }

    // Popup match — check in-memory first, then search map
    var entry = st.completedHighlights.get(m.quoteId)
      || (lastSearchMap && lastSearchMap.entries.get(m.quoteId))
      || null;
    if (!entry) return;

    var targetItemIdx = m.itemIndex != null ? m.itemIndex : (entry.activeItemIndex || 0);
    var targetItem = entry.items && entry.items[targetItemIdx];
    if (!targetItem) return;
    var targetItemId = targetItem.id;

    // Save original version before switching
    if (!(m.quoteId in savedVersions)) {
      savedVersions[m.quoteId] = entry.activeItemIndex != null ? entry.activeItemIndex : 0;
    }

    // Ensure the entire chain from L1 to this quoteId is in completedHighlights
    if (lastSearchMap) {
      var chain = buildChain(m.quoteId);
      for (var ci = 0; ci < chain.length; ci++) {
        if (!st.completedHighlights.has(chain[ci])) {
          var chainEntry = lastSearchMap.entries.get(chain[ci]);
          if (chainEntry) st.completedHighlights.set(chain[ci], chainEntry);
        }
      }

      // Save original ancestor versions so we can restore them when search closes
      for (var ai = 0; ai < chain.length - 1; ai++) {
        var ancestorId = chain[ai];
        if (!(ancestorId in savedVersions)) {
          var ancestorEntry = st.completedHighlights.get(ancestorId);
          if (ancestorEntry) {
            savedVersions[ancestorId] = ancestorEntry.activeItemIndex != null ? ancestorEntry.activeItemIndex : 0;
          }
        }
      }
    }

    // Use transitionTo — it handles peeling, opening children, version flipping.
    // Marks are applied in the onDone callback so they never land on stale content.
    JR.transitionTo(targetItemId, function () {
      applyMarks();
    });
    if (searchInput) searchInput.focus();
  }

  function updateCounter() {
    if (!searchCount) return;
    if (matches.length === 0) {
      searchCount.textContent = "";
    } else {
      searchCount.textContent = (matchIndex + 1) + " / " + matches.length;
    }
    updateNavButtons();
  }

  // --- Search execution ---

  function performSearch() {
    var query = searchInput ? searchInput.value.trim() : "";
    clearMarks();

    if (!query || query.length < 2) {
      matches = [];
      matchIndex = -1;
      updateCounter();
      return;
    }

    // Load storage to include children not yet in memory
    getHighlightsByUrl(location.href).then(function (storageHls) {
      lastSearchMap = buildSearchableMap(storageHls);
      matches = collectMatches(query, lastSearchMap);
      doAfterCollect(query);
    });
  }

  function doAfterCollect(query) {
    if (matches.length > 0) {
      matchIndex = 0;
      navigateToMatch(0);
    } else {
      matchIndex = -1;
      updateCounter();
    }
  }

  function searchNext() {
    if (matches.length === 0) return;
    var next = (matchIndex + 1) % matches.length;
    navigateToMatch(next);
  }

  function searchPrev() {
    if (matches.length === 0) return;
    var prev = (matchIndex - 1 + matches.length) % matches.length;
    navigateToMatch(prev);
  }

  // --- Search bar DOM ---

  var prevBtn = null;
  var nextBtn = null;
  var outsideClickHandler = null;

  /** Update prev/next button enabled state based on matches. */
  function updateNavButtons() {
    if (!prevBtn || !nextBtn) return;
    var hasMatches = matches.length > 0;
    if (hasMatches) {
      prevBtn.classList.add("jr-search-prev--enabled");
      nextBtn.classList.add("jr-search-next--enabled");
    } else {
      prevBtn.classList.remove("jr-search-prev--enabled");
      nextBtn.classList.remove("jr-search-next--enabled");
    }
  }

  /** Switch search bar to ready state. */
  function enterReadyState() {
    if (!searchBar) return;
    searchBar.className = "jr-search-bar jr-search-bar--ready";
    var cc = getChatColCenter();
    if (cc != null) searchBar.style.left = (cc - 18) + "px";
    searchBar.style.top = "8px";
    // Clear search state
    if (searchInput) searchInput.value = "";
    clearMarks();
    restoreAllVersions();
    matches = [];
    matchIndex = -1;
    if (searchCount) searchCount.textContent = "";
    // Remove outside click listener
    if (outsideClickHandler) {
      document.removeEventListener("mousedown", outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }

  /** Switch search bar to active/search state. */
  function enterSearchState() {
    if (!searchBar) return;
    searchBar.className = "jr-search-bar jr-search-bar--active";
    var cc = getChatColCenter();
    if (cc != null) searchBar.style.left = (cc - 150) + "px";
    searchBar.style.top = "6px";
    updateNavButtons();
    // Focus input after class swap so it's visible
    setTimeout(function () {
      if (searchInput) searchInput.focus();
    }, 0);
    // Listen for clicks outside to return to ready state
    if (outsideClickHandler) {
      document.removeEventListener("mousedown", outsideClickHandler, true);
    }
    outsideClickHandler = function (e) {
      if (searchBar && !searchBar.contains(e.target)) {
        enterReadyState();
      }
    };
    // Delay attaching so the current click doesn't trigger it
    setTimeout(function () {
      document.addEventListener("mousedown", outsideClickHandler, true);
    }, 0);
  }

  /**
   * Inject the search bar into the page.
   * Called once on init / SPA navigate. Idempotent.
   */
  JR.initSearchBar = function () {
    if (searchBar && searchBar.isConnected) return;

    searchBar = document.createElement("div");
    searchBar.className = "jr-search-bar jr-search-bar--ready";

    // --- Search icon (visible in all states) ---
    var activeIcon = document.createElement("span");
    activeIcon.className = "jr-search-active-icon";
    activeIcon.innerHTML = SEARCH_SVG;
    searchBar.appendChild(activeIcon);

    // Input
    searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.className = "jr-search-input";
    searchInput.placeholder = "Search this page\u2026";
    searchInput.setAttribute("aria-label", "Search highlights");
    searchBar.appendChild(searchInput);

    // Match counter
    searchCount = document.createElement("span");
    searchCount.className = "jr-search-count";
    searchCount.textContent = "";
    searchBar.appendChild(searchCount);

    // Prev button (up caret)
    prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "jr-search-prev";
    prevBtn.setAttribute("aria-label", "Previous match");
    prevBtn.innerHTML = UP_SVG;
    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (matches.length > 0) searchPrev();
    });
    searchBar.appendChild(prevBtn);

    // Next button (down caret)
    nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "jr-search-next";
    nextBtn.setAttribute("aria-label", "Next match");
    nextBtn.innerHTML = DOWN_SVG;
    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (matches.length > 0) searchNext();
    });
    searchBar.appendChild(nextBtn);

    // --- Events ---

    // Click on ready state → enter search state
    searchBar.addEventListener("click", function (e) {
      if (searchBar.classList.contains("jr-search-bar--ready")) {
        e.stopPropagation();
        enterSearchState();
      }
    });

    searchInput.addEventListener("input", function () {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(function () {
        performSearch();
        updateNavButtons();
      }, 300);
    });

    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          searchPrev();
        } else {
          searchNext();
        }
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        searchNext();
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        searchPrev();
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        enterReadyState();
      }
    });

    // Prevent popup dismissal when clicking inside search bar
    searchBar.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    // Append to document.body (immune to React re-renders).
    // Horizontally center over the chat column (right section).
    document.body.appendChild(searchBar);

    var cc = getChatColCenter();
    if (cc != null) {
      var barSize = searchBar.offsetWidth || 36;
      searchBar.style.left = (cc - barSize / 2) + "px";
    }

    searchBar.style.top = "8px";
  };

  /** Reset search state (called on SPA navigate). */
  JR.hideSearchBar = function () {
    clearMarks();
    restoreAllVersions();
    if (outsideClickHandler) {
      document.removeEventListener("mousedown", outsideClickHandler, true);
      outsideClickHandler = null;
    }
    if (searchBar) {
      searchBar.remove();
      searchBar = null;
    }
    searchInput = null;
    searchCount = null;
    prevBtn = null;
    nextBtn = null;
    matches = [];
    matchIndex = -1;
    textCache = {};
    lastSearchMap = null;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
  };

  JR.isSearchBarOpen = function () {
    return !!searchBar;
  };
})();
