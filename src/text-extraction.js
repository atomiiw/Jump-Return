// text-extraction.js — Text extraction & sentence detection for Jump Return
(function () {
  "use strict";

  var S = JR.SELECTORS;
  var BLOCK_TAGS = JR.BLOCK_TAGS;
  var SENTENCE_TERMINATORS = JR.SENTENCE_TERMINATORS;

  /**
   * Walk a block element's DOM tree and extract its text content,
   * recording the positions of citation pill elements (data-testid="webpage-citation-pill").
   * Returns { text: string, pills: [{start, end}], bolds: [{start, end}] }.
   */
  JR.extractBlockText = function (node) {
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

    // Merge adjacent bold ranges
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
  };

  /**
   * Extract the containing sentence(s) for a selection range within a container element.
   * For single-block selections, expands to sentence boundaries.
   * For multi-block selections, collects the full text of each selected block.
   * Works for both AI response articles and popup response divs.
   * Returns the trimmed string, or null on failure.
   */
  JR.extractSentenceInContainer = function (range, blockTypes, container) {
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
        var extracted = JR.extractBlockText(node);
        var blockText = extracted.text;
        var blockPills = extracted.pills;
        var blockBolds = extracted.bolds;
        var isFirstSent = true;

        if (node === startBlock && node.tagName !== "PRE" && node.contains(range.startContainer)) {
          var rawOffS = JR.getOffsetInBlock(node, range.startContainer, range.startOffset);
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

        if (node === endBlock && node.tagName !== "PRE" && node.contains(range.endContainer)) {
          var rawOffE = JR.getOffsetInBlock(node, range.endContainer, range.endOffset);
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

    if (startBlock.tagName === "PRE") return blockText.trim();

    var startOffset = JR.getOffsetInBlock(startBlock, range.startContainer, range.startOffset);
    var endOffset = Math.min(
      blockText.length,
      JR.getOffsetInBlock(startBlock, range.endContainer, range.endOffset)
    );

    var sentStart = 0;
    for (var i = startOffset - 1; i >= 0; i--) {
      if (SENTENCE_TERMINATORS.indexOf(blockText[i]) !== -1) {
        sentStart = i + 1;
        break;
      }
    }

    var sentEnd = blockText.length;
    for (var j = endOffset; j < blockText.length; j++) {
      if (SENTENCE_TERMINATORS.indexOf(blockText[j]) !== -1) {
        sentEnd = j + 1;
        break;
      }
    }

    var sentence = blockText.slice(sentStart, sentEnd).trim();

    if (blockTypes && sentence) {
      var singleExtracted = JR.extractBlockText(startBlock);
      var closestLI = startBlock.closest("li");
      var isFirstBlk = !closestLI || startBlock === closestLI || closestLI.firstElementChild === startBlock;
      var isFirstSentence = closestLI && isFirstBlk && sentStart === 0;

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
  };

  /**
   * Extract sentence context for a selection in an AI response article.
   * Thin wrapper around extractSentenceInContainer.
   */
  JR.extractSentence = function (range, blockTypes) {
    var article = JR.getAIResponseArticle(
      range.startContainer.nodeType === Node.TEXT_NODE
        ? range.startContainer.parentElement
        : range.startContainer
    );
    if (!article) return null;
    return JR.extractSentenceInContainer(range, blockTypes, article);
  };

  /**
   * Get selected text and validate it's inside a single AI response.
   * Returns { text, sentence, blockTypes, rect, article, range } or null.
   */
  JR.getSelectedTextInAIResponse = function () {
    var selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) return null;

    var text = selection.toString().trim();
    if (!text) return null;

    var range = selection.getRangeAt(0);
    var anchorEl =
      selection.anchorNode.nodeType === Node.TEXT_NODE
        ? selection.anchorNode.parentElement
        : selection.anchorNode;
    var focusEl =
      selection.focusNode.nodeType === Node.TEXT_NODE
        ? selection.focusNode.parentElement
        : selection.focusNode;

    if (!anchorEl || !focusEl) return null;

    if (JR.isInsideChatInput(anchorEl) || JR.isInsideChatInput(focusEl)) return null;
    if (JR.isInsidePopup(anchorEl) || JR.isInsidePopup(focusEl)) return null;

    var anchorArticle = JR.getAIResponseArticle(anchorEl);
    var focusArticle = JR.getAIResponseArticle(focusEl);
    if (!anchorArticle || !focusArticle) return null;
    if (anchorArticle !== focusArticle) return null;

    var rect = range.getBoundingClientRect();
    var blockTypes = [];
    var sentence = null;
    try {
      sentence = JR.extractSentence(range, blockTypes);
    } catch (ex) {
      console.warn("[JR] extractSentence threw:", ex);
    }
    var clonedRange = range.cloneRange();
    return { text: text, sentence: sentence, blockTypes: blockTypes.length > 0 ? blockTypes : null, rect: rect, article: anchorArticle, range: clonedRange };
  };

  /**
   * Check if a text node is inside a ChatGPT code block toolbar
   * (the bar with language label, copy, run buttons).
   * These elements are inside .contain-inline-size but outside <pre>/<code>.
   */
  function isToolbarTextNode(textNode) {
    var parent = textNode.parentElement;
    if (!parent) return false;
    // If inside <pre> or <code>, it's actual code — keep it
    if (parent.closest("pre") || parent.closest("code")) return false;
    // If inside .contain-inline-size but NOT inside pre/code, it's toolbar
    if (parent.closest(".contain-inline-size")) return true;
    return false;
  }

  JR.findTextRange = function (root, searchText) {
    // Collect text nodes by simple concatenation (no block-boundary markers).
    function collectTextNodes(walkerRoot, skipFn) {
      var w = document.createTreeWalker(walkerRoot, NodeFilter.SHOW_TEXT, null);
      var nodes = [];
      var fullText = "";
      var n2;
      while ((n2 = w.nextNode())) {
        if (isToolbarTextNode(n2)) continue;
        if (skipFn && skipFn(n2)) continue;
        nodes.push({ node: n2, start: fullText.length });
        fullText += n2.textContent;
      }
      return { nodes: nodes, fullText: fullText };
    }

    var map = collectTextNodes(root, null);
    var nodes = map.nodes;
    var fullText = map.fullText;

    if (nodes.length === 0) return null;

    var idx = fullText.indexOf(searchText);

    // Fallback: selection.toString() inserts \n at block boundaries differently
    // than DOM text nodes. Strip all \n from both strings and search with a
    // position map back to the original fullText offsets.
    var newlineMatched = false;
    if (idx === -1 && searchText.indexOf("\n") !== -1) {
      var strippedFull = "";
      var posMap = []; // posMap[strippedIndex] = originalIndex
      for (var p = 0; p < fullText.length; p++) {
        if (fullText[p] !== "\n") {
          posMap.push(p);
          strippedFull += fullText[p];
        }
      }
      var strippedSearch = searchText.replace(/\n/g, "");
      var sIdx = strippedFull.indexOf(strippedSearch);
      if (sIdx !== -1) {
        idx = posMap[sIdx];
        var origEnd = posMap[sIdx + strippedSearch.length - 1] + 1;
        newlineMatched = true;
        // Use origEnd directly instead of idx + searchText.length
      }
    }

    // Fallback: normalize all whitespace (spaces, tabs, nbsp) to single space
    // and retry. Handles CJK text where selection.toString() may insert spaces
    // at element boundaries that don't exist in DOM text nodes.
    if (idx === -1) {
      var wsNorm = function (s) { return s.replace(/[\s\u00a0]+/g, " ").trim(); };
      var normFull = wsNorm(fullText);
      var normSearch = wsNorm(searchText);
      // Build position map from normalized to original
      var wsMap = [];
      var ni = 0;
      for (var wi = 0; wi < fullText.length; wi++) {
        if (ni < normFull.length && normFull[ni] === fullText[wi]) {
          wsMap.push(wi);
          ni++;
        } else if (/[\s\u00a0]/.test(fullText[wi])) {
          // Whitespace char in original — skip unless it maps to the normalized space
          if (ni < normFull.length && normFull[ni] === " " && /[\s\u00a0]/.test(fullText[wi])) {
            wsMap.push(wi);
            ni++;
          }
        }
      }
      var wsIdx = normFull.indexOf(normSearch);
      if (wsIdx !== -1 && wsIdx < wsMap.length) {
        var wsEndIdx = wsIdx + normSearch.length;
        idx = wsMap[wsIdx];
        var origEnd = wsEndIdx <= wsMap.length ? wsMap[wsEndIdx - 1] + 1 : idx + searchText.length;
        newlineMatched = true; // reuse the origEnd path
      }
    }

    // If not found, toolbar text inside <code> may be inflating the text.
    if (idx === -1) {
      var skipNodes = new Set();
      var codeEls = root.querySelectorAll("code");
      for (var ci = 0; ci < codeEls.length; ci++) {
        var codeFullText = codeEls[ci].textContent;
        var tbMatch = codeFullText.match(/^([A-Z][a-zA-Z+#.]*?)?(Copy code|Copied!|Copy|Run)+/);
        if (!tbMatch) continue;
        var tbLen = tbMatch[0].length;
        var consumed = 0;
        var codeWalker = document.createTreeWalker(codeEls[ci], NodeFilter.SHOW_TEXT, null);
        var tn;
        while ((tn = codeWalker.nextNode()) && consumed < tbLen) {
          var tnLen = tn.textContent.length;
          if (consumed + tnLen <= tbLen) {
            skipNodes.add(tn);
          }
          consumed += tnLen;
        }
      }

      var map2 = collectTextNodes(root, function (n3) { return skipNodes.has(n3); });
      nodes = map2.nodes;
      fullText = map2.fullText;

      idx = fullText.indexOf(searchText);
      if (idx === -1) return null;
    }

    var endIdx = newlineMatched ? origEnd : idx + searchText.length;
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
  };
})();
