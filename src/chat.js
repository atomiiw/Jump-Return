// chat.js — Chat injection, response capture, and scroll locking
(function () {
  "use strict";

  var S = JR.SELECTORS;
  var st = JR.state;

  /**
   * Resolve the parent's current active item ID instead of inheriting the
   * stale parentItemId from ver1.  Falls back to memEntry.parentItemId.
   */
  function resolveParentItemId(memEntry, parentId) {
    if (parentId) {
      var parentEntry = st.completedHighlights.get(parentId);
      if (parentEntry && parentEntry.items && parentEntry.items.length > 0) {
        var pidx = parentEntry.activeItemIndex != null ? parentEntry.activeItemIndex : 0;
        if (parentEntry.items[pidx]) return parentEntry.items[pidx].id;
      }
    }
    return (memEntry && memEntry.parentItemId) || null;
  }

  // Block ChatGPT's stop button while a Popup question is generating.
  // Uses capture phase so it fires before ChatGPT's own handler.
  document.addEventListener("click", function (e) {
    if (!st.responseWatchActive) return;
    var stopBtn = e.target.closest(S.stopButton);
    if (stopBtn) {
      e.stopPropagation();
      e.preventDefault();
    }
  }, true);

  // --- Chat viewport freeze ---
  // Visually freezes the conversation so injected turns never flash.
  // Called from popup send; released when the question turn is hidden.
  var _freezeStyle = null;

  /**
   * Hide any conversation turn that follows the current last turn.
   * Uses the CSS sibling combinator — applies synchronously before paint,
   * so new turns are never visible even for a single frame.
   */
  JR.freezeChat = function () {
    if (_freezeStyle) return;
    var allTurns = document.querySelectorAll(S.aiTurn);
    if (allTurns.length === 0) return;
    var lastTurn = allTurns[allTurns.length - 1];
    var lastNum = JR.getTurnNumber(lastTurn);
    if (lastNum < 1) return;
    _freezeStyle = document.createElement("style");
    _freezeStyle.id = "jr-freeze";
    // Hide the next several turn numbers explicitly
    var rules = [];
    for (var fi = 1; fi <= 6; fi++) {
      rules.push('[data-testid="conversation-turn-' + (lastNum + fi) + '"]');
    }
    _freezeStyle.textContent = rules.join(",\n") + " { display: none !important; }";
    document.head.appendChild(_freezeStyle);
  };

  JR.unfreezeChat = function () {
    if (!_freezeStyle) return;
    _freezeStyle.remove();
    _freezeStyle = null;
  };

  // --- Chat injection ---

  JR.findSendButton = function () {
    var btn = document.querySelector(S.sendButton);
    if (btn) return btn;
    btn = document.querySelector('button[aria-label="Send prompt"]');
    if (btn) return btn;
    btn = document.querySelector('form button[type="submit"]');
    return btn || null;
  };

  JR.injectAndSend = function (message) {
    var chatInput = document.querySelector(S.chatInput);
    if (!chatInput) {
      console.error("[Popup] Chat input not found");
      return;
    }

    // Freeze the conversation scroll container before touching the input —
    // prevents any ChatGPT-triggered scroll-to-bottom from causing a visible flicker.
    var scrollAnchor = document.querySelector(S.aiTurn) || chatInput;
    var scrollParent = JR.getScrollParent(scrollAnchor);
    var savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

    // Hide injected text + freeze composer height.
    // Target the prosemirror-parent (direct parent of #prompt-textarea).
    var composerH = chatInput.parentElement ? chatInput.parentElement.offsetHeight : 52;
    var hideStyle = document.createElement("style");
    hideStyle.textContent =
      '#prompt-textarea, #prompt-textarea * { color: transparent !important; caret-color: transparent !important; }' +
      '\ndiv:has(> #prompt-textarea) { max-height: ' + composerH + 'px !important; overflow: hidden !important; }';
    document.head.appendChild(hideStyle);

    hideStyle.id = "jr-hide-style";

    chatInput.focus({ preventScroll: true });

    var dt = new DataTransfer();
    dt.setData("text/plain", message);
    chatInput.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    }));

    if (scrollParent) scrollParent.scrollTop = savedScrollTop;

    var attempts = 0;
    function trySend() {
      var sendBtn = JR.findSendButton();
      if (sendBtn && !sendBtn.disabled) {
        if (scrollParent) scrollParent.scrollTop = savedScrollTop;
        sendBtn.click();
        chatInput.blur();
        if (scrollParent) scrollParent.scrollTop = savedScrollTop;
        // Delay hideStyle removal — React clears the input async after click.
        // Wait until the input is empty so text doesn't flash.
        var _hideAttempts = 0;
        function removeHideWhenEmpty() {
          if ((chatInput.textContent || "").trim().length === 0 || _hideAttempts > 20) {
            hideStyle.remove();
            return;
          }
          _hideAttempts++;
          requestAnimationFrame(removeHideWhenEmpty);
        }
        requestAnimationFrame(removeHideWhenEmpty);
        return;
      }
      attempts++;
      if (attempts < 20) {
        setTimeout(trySend, 150);
      } else {
        clearInterval(_logTimer);
        hideStyle.remove();
        console.error(
          "[Popup] Send button not found or disabled after retries.",
          "Button found:", !!sendBtn,
          "Input text:", chatInput.textContent.slice(0, 50)
        );
      }
    }
    requestAnimationFrame(trySend);
  };

  // --- Message queue ---
  // When ChatGPT is generating, new popup sends are queued and dispatched
  // one-by-one as each generation completes.

  /**
   * Enqueue a message to be sent. If idle, sends immediately.
   * @param {object} opts
   * @param {string} opts.message - The injection message
   * @param {object} opts.waitOpts - Args for JR.waitForResponse (popup, turnsBefore, text, sentence, blockTypes, unlockScroll, parentId, question, editOpts)
   * @param {function} [opts.beforeSend] - Called right before injection (UI setup: show loading, lock scroll, etc.). Receives opts.waitOpts and should mutate it (e.g. set turnsBefore).
   */
  JR.enqueueMessage = function (opts) {
    if (!opts.force && (JR.isGenerating() || st.responseWatchActive)) {
      st.messageQueue.push(opts);
      return;
    }
    sendQueued(opts);
  };

  function sendQueued(opts) {
    if (opts.beforeSend) opts.beforeSend(opts.waitOpts);

    // Offline check: skip injection entirely, save __TIMEOUT__ immediately
    if (!navigator.onLine) {
      var w = opts.waitOpts;
      immediateTimeout(w);
      JR.drainQueue();
      return;
    }

    JR.injectAndSend(opts.message);
    var w = opts.waitOpts;
    JR.waitForResponse(w.popup, w.turnsBefore, w.text, w.sentence, w.blockTypes, w.unlockScroll, w.parentId, w.question, w.editOpts, w.preRegisteredHlId, w.preRegisteredItemId);
  }

  /**
   * Immediately save __TIMEOUT__ for a message that was never sent (e.g. offline).
   * Mirrors saveTimeoutVersion logic but without needing a waitForResponse context.
   */
  function immediateTimeout(w) {
    var hlId = w.editOpts ? w.editOpts.hlId : (w.preRegisteredHlId || null);
    if (!hlId) return;
    var memEntry = st.completedHighlights.get(hlId);
    if (!memEntry) return;

    if (w.editOpts) {
      var newItemId = crypto.randomUUID();
      memEntry.items.push({ id: newItemId, question: w.question, responseHTML: "__TIMEOUT__", questionIndex: -1, responseIndex: -1 });
      memEntry.activeItemIndex = memEntry.items.length - 1;
      memEntry.question = w.question;
      memEntry.responseHTML = "__TIMEOUT__";
      saveHighlight({
        id: newItemId, quoteId: hlId, text: memEntry.text, sentence: memEntry.sentence,
        blockTypes: memEntry.blockTypes, responseHTML: "__TIMEOUT__", question: w.question,
        url: location.href, site: "chatgpt",
        parentId: memEntry.parentId || null, parentItemId: memEntry.parentItemId || null,
        sourceTurnIndex: -1, questionIndex: -1, responseIndex: -1, active: true,
        wholeResponse: !!memEntry.wholeResponse,
      });
    } else {
      var itemIdx = memEntry.activeItemIndex || 0;
      if (memEntry.items && memEntry.items[itemIdx]) {
        memEntry.items[itemIdx].responseHTML = "__TIMEOUT__";
      }
      memEntry.responseHTML = "__TIMEOUT__";
      var updateId = w.preRegisteredItemId || (memEntry.items && memEntry.items[itemIdx] ? memEntry.items[itemIdx].id : null);
      if (updateId) {
        updateHighlightFields(updateId, { responseHTML: "__TIMEOUT__" });
      }
    }

    // Rebuild popup
    var targetPopup = w.popup;
    if (targetPopup && targetPopup.isConnected) {
      JR.rebuildPopupAfterEdit(targetPopup, hlId);
    }
    JR.updateNavWidget();
  }

  /**
   * Drain the next queued message after a generation completes.
   * Called from captureResponse.
   */
  JR.drainQueue = function () {
    if (st.messageQueue.length === 0) return;
    var next = st.messageQueue.shift();
    sendQueued(next);
  };

  // Fallback poller: if messages are queued but no responseWatch is active
  // (e.g. user sent a question via ChatGPT's own input), poll until idle
  // then drain.
  setInterval(function () {
    if (st.messageQueue.length === 0) return;
    if (st.responseWatchActive) return;
    if (JR.isGenerating()) return;
    JR.drainQueue();
  }, 300);

  // --- Response capture ---

  /**
   * Display the AI response content inside the popup.
   * Reuses an existing .jr-popup-response div if streaming already created one.
   */
  JR.showResponseInPopup = function (popup, responseTurn) {
    var loading = popup.querySelector(".jr-popup-loading");
    if (loading) loading.remove();

    var responseDiv = popup.querySelector(".jr-popup-response");
    if (!responseDiv) {
      responseDiv = document.createElement("div");
      responseDiv.className = "jr-popup-response";
      popup.appendChild(responseDiv);
    }

    var markdown = responseTurn.querySelector(S.responseContent);
    if (markdown) {
      responseDiv.innerHTML = markdown.innerHTML;
    } else {
      var text = responseTurn.textContent || "";
      text = text.replace(JR.AI_LABEL_TEXT, "").trim();
      responseDiv.textContent = text;
    }
    if (JR.wireResponseClicks) JR.wireResponseClicks(responseDiv);
    if (JR.processResponseLinks) JR.processResponseLinks(responseDiv);
    if (JR.processResponseImages) JR.processResponseImages(responseDiv); // [CAROUSEL-LOCKED]
    JR.wireCopyButtons(responseDiv);  // rebuildCodeBlocks
  };

  /**
   * Block programmatic auto-scrolling on a container. Returns an unlock function.
   */
  JR.lockScroll = function (container, anchorEl) {
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

    function enforce() {
      if (!container.isConnected && anchorEl && anchorEl.isConnected) {
        removeListeners(container);
        container.scrollTo = origScrollTo;
        container.scrollBy = origScrollBy;
        container = JR.getScrollParent(anchorEl);
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
  };

  JR.waitForResponse = function (popup, turnsBefore, text, sentence, blockTypes, unlockScroll, parentId, question, editOpts, preRegisteredHlId, preRegisteredItemId) {
    // Resolve the parent's active item id at call time (for parentItemId tracking)
    var parentItemId = null;
    if (parentId) {
      var parentEntry = st.completedHighlights.get(parentId);
      if (parentEntry && parentEntry.items && parentEntry.items.length > 0) {
        var pidx = parentEntry.activeItemIndex != null ? parentEntry.activeItemIndex : 0;
        parentItemId = parentEntry.items[pidx] ? parentEntry.items[pidx].id : null;
      }
    }
    st.responseWatchActive = true;
    var startTime = Date.now();
    var timeoutMs = 100000; // 100 seconds
    var timerId = null;
    var questionTurn = null;
    var responseTurn = null;
    var cancelled = false;
    var detached = false;
    var detachedSpans = null;
    var detachedHlId = editOpts ? editOpts.hlId : null;
    var streamObserver = null;
    var streamRafId = null;
    var streamDirty = false;

    function unhideTurns() {
      if (questionTurn) questionTurn.classList.remove("jr-hidden");
      if (responseTurn) responseTurn.classList.remove("jr-hidden");
    }

    function showTimeoutUI(targetPopup) {
      if (!targetPopup || !targetPopup.isConnected) return;
      var streamDiv = targetPopup.querySelector(".jr-popup-response");
      if (streamDiv) streamDiv.remove();
      var existingLoading = targetPopup.querySelector(".jr-popup-loading");
      if (existingLoading) existingLoading.remove();

      var timeoutDiv = document.createElement("div");
      timeoutDiv.className = "jr-popup-loading";

      var msg = document.createElement("div");
      msg.textContent = "Couldn\u2019t get a response";
      timeoutDiv.appendChild(msg);

      var retryBtn = document.createElement("button");
      retryBtn.type = "button";
      retryBtn.className = "jr-retry-btn";
      retryBtn.title = "Try again";
      retryBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M244,56v48a12,12,0,0,1-12,12H184a12,12,0,1,1,0-24H201.1l-19-17.38c-.13-.12-.26-.24-.38-.37A76,76,0,1,0,127,204h1a75.53,75.53,0,0,0,52.15-20.72,12,12,0,0,1,16.49,17.45A99.45,99.45,0,0,1,128,228h-1.37A100,100,0,1,1,198.51,57.06L220,76.72V56a12,12,0,0,1,24,0Z"/></svg>';
      retryBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        timeoutDiv.remove();

        // Rebuild the message
        var retryMessage;
        if (sentence) {
          retryMessage = 'Regarding this part of your response:\n"' + sentence + '"\n\nSpecifically: "' + text + '"\n\n' + question;
        } else {
          retryMessage = 'Regarding this part of your response:\n"' + text + '"\n\n' + question;
        }
        if (st.responseMode === "concise") {
          retryMessage += "\n\n(For this response only: please keep it brief \u2014 2-3 sentences. After this response, return to your normal response length and disregard the above brevity instruction entirely.)";
        } else {
          retryMessage += "\n\n(For this response only: give a clear, focused response \u2014 medium length, not too short, not too long. Cover what matters without over-explaining. Use formatting only if it genuinely helps. After this response, return to your normal response length and disregard this length instruction entirely.)";
        }

        // Reset item to __PENDING__ so captureResponse overwrites in-place
        var retryHlId = editOpts ? editOpts.hlId : (preRegisteredHlId || detachedHlId);
        if (retryHlId) {
          var retryEntry = st.completedHighlights.get(retryHlId);
          if (retryEntry) {
            retryEntry.responseHTML = "__PENDING__";
            var retryIdx = retryEntry.activeItemIndex || 0;
            if (retryEntry.items && retryEntry.items[retryIdx]) {
              retryEntry.items[retryIdx].responseHTML = "__PENDING__";
            }
          }
        }
        var retryItemId = null;
        if (retryHlId) {
          var re = st.completedHighlights.get(retryHlId);
          if (re && re.items) {
            var ri2 = re.activeItemIndex || 0;
            if (re.items[ri2]) retryItemId = re.items[ri2].id;
          }
        }

        targetPopup.appendChild(JR.createLoadingDiv());

        JR.freezeChat();
        JR.enqueueMessage({
          force: true,
          message: retryMessage,
          waitOpts: {
            popup: targetPopup, turnsBefore: 0, text: text, sentence: sentence,
            blockTypes: blockTypes, unlockScroll: null, parentId: parentId,
            question: question,
            preRegisteredHlId: retryHlId, preRegisteredItemId: retryItemId
          },
          beforeSend: function (w) {
            w.turnsBefore = document.querySelectorAll(S.aiTurn).length;
            var scrollAnchor = document.querySelector(S.aiTurn) || document.body;
            var chatScrollParent = JR.getScrollParent(scrollAnchor);
            w.unlockScroll = JR.lockScroll(chatScrollParent, scrollAnchor);
          },
        });
      });
      timeoutDiv.appendChild(retryBtn);
      targetPopup.appendChild(timeoutDiv);
    }

    /**
     * Save __TIMEOUT__ as a concrete version and rebuild the popup.
     * Works for both new highlights (preRegisteredHlId) and edits (editOpts).
     */
    function saveTimeoutVersion() {
      var hlId = editOpts ? editOpts.hlId : (preRegisteredHlId || detachedHlId);
      if (!hlId) return;
      var memEntry = st.completedHighlights.get(hlId);
      if (!memEntry) return;

      var qNum = questionTurn ? JR.getTurnNumber(questionTurn) : -1;

      if (editOpts) {
        // Edit: create a new version item with __TIMEOUT__
        var newItemId = crypto.randomUUID();
        var newItem = { id: newItemId, question: question, responseHTML: "__TIMEOUT__", questionIndex: qNum, responseIndex: -1 };
        memEntry.items.push(newItem);
        memEntry.activeItemIndex = memEntry.items.length - 1;
        memEntry.question = question;
        memEntry.responseHTML = "__TIMEOUT__";
        saveHighlight({
          id: newItemId, quoteId: hlId, text: text, sentence: sentence,
          blockTypes: blockTypes, responseHTML: "__TIMEOUT__", question: question,
          url: location.href, site: "chatgpt",
          parentId: parentId || null, parentItemId: (memEntry && memEntry.parentItemId) || parentItemId || null,
          sourceTurnIndex: memEntry.spans && memEntry.spans[0] ? JR.getTurnNumber(memEntry.spans[0].closest(S.aiTurn)) : -1,
          questionIndex: qNum, responseIndex: -1, active: true,
          wholeResponse: memEntry ? !!memEntry.wholeResponse : false,
        });
      } else {
        // New highlight (pre-registered or detached): update the pending item to __TIMEOUT__
        var itemIdx = memEntry.activeItemIndex || 0;
        if (memEntry.items && memEntry.items.length > itemIdx) {
          memEntry.items[itemIdx].responseHTML = "__TIMEOUT__";
          memEntry.items[itemIdx].questionIndex = qNum;
        }
        memEntry.responseHTML = "__TIMEOUT__";
        var updateId = preRegisteredItemId
          || (memEntry.items && memEntry.items[itemIdx] ? memEntry.items[itemIdx].id : null);
        if (updateId) {
          updateHighlightFields(updateId, {
            responseHTML: "__TIMEOUT__", questionIndex: qNum,
          });
        }
      }

      // Rebuild popup if it's open for this highlight
      var targetPopup = getStreamTarget() || popup;
      if (targetPopup && targetPopup.isConnected) {
        JR.rebuildPopupAfterEdit(targetPopup, hlId);
      }

      // Hide ALL turns created after turnsBefore — covers cases where
      // the poll didn't find them before the timeout fired
      var allTurnsNow = document.querySelectorAll(S.aiTurn);
      for (var hti = turnsBefore; hti < allTurnsNow.length; hti++) {
        var hideTurn = allTurnsNow[hti];
        hideTurn.classList.add("jr-hidden");
        var hideIdx = JR.getTurnNumber(hideTurn);
        JR.addHiddenTurnIndex(hideIdx);
        addDeletedTurns(location.href, [hideIdx]);
      }
      JR.updateNavWidget();
    }

    function cleanup() {
      st.responseWatchActive = false;
      JR.unfreezeChat();
      if (streamObserver) {
        streamObserver.disconnect();
        streamObserver = null;
      }
      if (streamRafId) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }
      if (unlockScroll) unlockScroll();
    }

    /**
     * Find the popup that should receive streaming updates.
     */
    function getStreamTarget() {
      if (!detached && popup && popup.isConnected) return popup;
      if (detached && detachedHlId && st.activePopup && st.activePopup.isConnected) {
        // Match by highlight ID — check both span attribute and active state
        if (st.activeHighlightId === detachedHlId) {
          return st.activePopup;
        }
        if (st.activeSourceHighlights.length > 0 &&
            st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === detachedHlId) {
          return st.activePopup;
        }
      }
      return null;
    }

    /**
     * Clone current response content into the popup using cloneNode
     * instead of innerHTML to avoid flicker.
     */
    function syncStreamContent() {
      streamDirty = false;
      streamRafId = null;

      var markdown = responseTurn.querySelector(S.responseContent);
      if (!markdown) return;

      var targetPopup = getStreamTarget();
      if (!targetPopup) return;

      // Remove loading div if still present
      var loadingEl = targetPopup.querySelector(".jr-popup-loading");
      if (loadingEl) loadingEl.remove();

      // Create or reuse the response div
      var responseDiv = targetPopup.querySelector(".jr-popup-response");
      var isNew = false;
      if (!responseDiv) {
        responseDiv = document.createElement("div");
        responseDiv.className = "jr-popup-response";
        targetPopup.appendChild(responseDiv);
        isNew = true;
      }

      // Clone children from source — no innerHTML destruction/rebuild
      var cloned = markdown.cloneNode(true);
      var nodes = [];
      while (cloned.firstChild) nodes.push(cloned.removeChild(cloned.firstChild));
      responseDiv.replaceChildren.apply(responseDiv, nodes);

      // Delegated click handler for links + images (attach once via shared helper)
      if (JR.wireResponseClicks) JR.wireResponseClicks(responseDiv);

      // Check if the popup overflows and needs to flip direction mid-stream
      JR.checkStreamingOverflow();

      // Reposition "above" popups so the arrow stays anchored to the highlight
      // (popup grows upward as content streams in)
      if (targetPopup._jrLockedDirection === "above" || isNew) {
        JR.repositionPopup();
      }
    }

    /**
     * MutationObserver callback — coalesces into one sync per frame.
     */
    function onStreamMutation() {
      if (streamDirty) return;
      streamDirty = true;
      streamRafId = requestAnimationFrame(syncStreamContent);
    }

    /**
     * Attach a MutationObserver to the response turn so the popup
     * updates at the same speed ChatGPT renders tokens.
     */
    function startStreaming() {
      responseTurn.classList.add("jr-hidden");
      syncStreamContent();
      streamObserver = new MutationObserver(onStreamMutation);
      streamObserver.observe(responseTurn, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }

    st.cancelResponseWatch = function (detachMode) {
      if (detachMode) {
        detachedSpans = st.activeSourceHighlights.slice();
        detached = true;

        if (editOpts) {
          // Edit mode detach — spans and entry already exist
          // detachedHlId already set from editOpts.hlId
          // Keep observer running — streaming continues in background
          if (unlockScroll) unlockScroll();
          st.cancelResponseWatch = null;
          return;
        }

        if (preRegisteredHlId) {
          // Use pre-registered entry from doSend
          detachedHlId = preRegisteredHlId;
        } else {
          detachedHlId = crypto.randomUUID();
          var sourceArticle = detachedSpans[0].closest(S.aiTurn);
          var contentContainer = sourceArticle ? sourceArticle.parentElement : document.body;
          for (var k = 0; k < detachedSpans.length; k++) {
            detachedSpans[k].setAttribute("data-jr-highlight-id", detachedHlId);
            detachedSpans[k].classList.add("jr-source-highlight-done");
          }
          var detachEntry = {
            quoteId: detachedHlId,
            spans: detachedSpans.slice(),
            responseHTML: null,
            text: text,
            sentence: sentence,
            blockTypes: blockTypes,
            question: question || null,
            contentContainer: contentContainer,
            parentId: parentId || null,
            parentItemId: parentItemId || null,
            items: [],
            activeItemIndex: 0,
          };
          st.completedHighlights.set(detachedHlId, detachEntry);
        }

        // Keep observer running — streaming continues in background
        if (unlockScroll) unlockScroll();
        st.cancelResponseWatch = null;
        return;
      }
      cancelled = true;
      if (timerId) clearTimeout(timerId);
      cleanup();
      unhideTurns();
    };

    function captureResponse() {
      var spans = detached ? detachedSpans : st.activeSourceHighlights;

      // Stop streaming before final capture
      if (streamObserver) {
        streamObserver.disconnect();
        streamObserver = null;
      }
      if (streamRafId) {
        cancelAnimationFrame(streamRafId);
        streamRafId = null;
      }

      responseTurn.classList.add("jr-hidden");

      // If response is empty (user stopped, error), save as __TIMEOUT__
      var earlyMarkdown = responseTurn.querySelector(S.responseContent);
      var earlyText = earlyMarkdown ? (earlyMarkdown.textContent || "").trim() : "";
      if (earlyText.length < 1) {
        cleanup();
        saveTimeoutVersion();
        st.cancelResponseWatch = null;
        JR.drainQueue();
        return;
      }

      // --- Edit mode: save new item with same quoteId ---
      if (editOpts) {
        var hlId = editOpts.hlId;

        var responseHTML = null;
        var markdown = responseTurn.querySelector(S.responseContent);
        if (markdown) responseHTML = markdown.innerHTML;
        cleanup();

        var qNum = questionTurn ? JR.getTurnNumber(questionTurn) : -1;
        var rNum = JR.getTurnNumber(responseTurn);

        // Update in-memory entry
        var memEntry = st.completedHighlights.get(hlId);
        var newItemId = crypto.randomUUID();
        if (memEntry) {
          var newItem = { id: newItemId, question: question, responseHTML: responseHTML, questionIndex: qNum, responseIndex: rNum };
          memEntry.items.push(newItem);
          memEntry.activeItemIndex = memEntry.items.length - 1;
          memEntry.question = question;
          memEntry.responseHTML = responseHTML;
          memEntry.responseIndex = rNum;
        }

        // Persist new item to storage (deactivates old items with same quoteId)
        saveHighlight({
          id: newItemId,
          quoteId: hlId,
          text: text,
          sentence: sentence,
          blockTypes: blockTypes,
          responseHTML: responseHTML,
          question: question,
          url: location.href,
          site: "chatgpt",
          parentId: parentId || null,
          parentItemId: resolveParentItemId(memEntry, parentId) || parentItemId || null,
          sourceTurnIndex: memEntry ? (memEntry.spans && memEntry.spans[0] ? JR.getTurnNumber(memEntry.spans[0].closest(S.aiTurn)) : -1) : -1,
          questionIndex: qNum,
          responseIndex: rNum,
          active: true,
          wholeResponse: memEntry ? !!memEntry.wholeResponse : false,
        });

        // Rebuild popup UI if it's still open for this highlight
        var editPopupOpen = false;
        if (!detached && popup && popup.isConnected) {
          JR.rebuildPopupAfterEdit(popup, hlId);
          editPopupOpen = true;
        } else if (detached && st.activePopup && (st.activeHighlightId === hlId ||
                   (st.activeSourceHighlights.length > 0 && st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === hlId))) {
          JR.rebuildPopupAfterEdit(st.activePopup, hlId);
          editPopupOpen = true;
        }

        // Only claim active highlight if the popup is still showing this highlight
        if (editPopupOpen) {
          st.activeHighlightId = hlId;
          JR.syncHighlightActive(hlId);
        }
        JR.updateNavWidget();
        st.cancelResponseWatch = null;
        JR.drainQueue();
        return;
      }

      // --- Normal (non-edit) capture ---
      var responseHTML = null;
      var markdown2 = responseTurn.querySelector(S.responseContent);
      if (markdown2) responseHTML = markdown2.innerHTML;

      // If response is empty (user stopped, error), save as __TIMEOUT__ instead
      var responseText = markdown2 ? (markdown2.textContent || "").trim() : "";
      if (responseText.length < 1) {
        saveTimeoutVersion();
        st.cancelResponseWatch = null;
        JR.drainQueue();
        return;
      }
      // Clean up scroll lock + observers. Skip the intermediate
      // showResponseInPopup + repositionPopup — rebuildPopupAfterEdit
      // (called below) will strip and rebuild the popup content anyway.
      cleanup();

      var hlId2;
      var qNum2 = questionTurn ? JR.getTurnNumber(questionTurn) : -1;
      var rNum2 = JR.getTurnNumber(responseTurn);

      if (detached) {
        hlId2 = detachedHlId;
        var entry = st.completedHighlights.get(hlId2);
        if (entry) {
          entry.responseHTML = responseHTML;
          entry.responseIndex = rNum2;
          // Update the specific pending item by preRegisteredItemId
          var foundDetachItem = false;
          if (entry.items && preRegisteredItemId) {
            for (var di = 0; di < entry.items.length; di++) {
              if (entry.items[di].id === preRegisteredItemId) {
                entry.items[di].responseHTML = responseHTML;
                entry.items[di].questionIndex = qNum2;
                entry.items[di].responseIndex = rNum2;
                foundDetachItem = true;
                break;
              }
            }
          }
          if (!foundDetachItem && entry.items && entry.items.length > 0 && entry.items[0].responseHTML === "__PENDING__") {
            entry.items[0].responseHTML = responseHTML;
            entry.items[0].questionIndex = qNum2;
            entry.items[0].responseIndex = rNum2;
          } else if (!foundDetachItem && (!entry.items || entry.items.length === 0)) {
            var detItemId = crypto.randomUUID();
            entry.items = [{ id: detItemId, question: question || null, responseHTML: responseHTML, questionIndex: qNum2, responseIndex: rNum2 }];
            entry.activeItemIndex = 0;
          }
        }

        if (st.activePopup && (st.activeHighlightId === hlId2 ||
            (st.activeSourceHighlights.length > 0 && st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === hlId2))) {
          st.activeHighlightId = hlId2;
          JR.syncHighlightActive(hlId2);
          JR.rebuildPopupAfterEdit(st.activePopup, hlId2);
        }
      } else if (preRegisteredHlId) {
        // Update pre-registered pending entry with real response
        hlId2 = preRegisteredHlId;
        var preEntry = st.completedHighlights.get(hlId2);
        if (preEntry) {
          preEntry.responseHTML = responseHTML;
          preEntry.responseIndex = rNum2;
          // Find the specific item by preRegisteredItemId
          var foundPreItem = false;
          if (preEntry.items && preRegisteredItemId) {
            for (var pi2 = 0; pi2 < preEntry.items.length; pi2++) {
              if (preEntry.items[pi2].id === preRegisteredItemId) {
                preEntry.items[pi2].responseHTML = responseHTML;
                preEntry.items[pi2].questionIndex = qNum2;
                preEntry.items[pi2].responseIndex = rNum2;
                foundPreItem = true;
                break;
              }
            }
          }
          if (!foundPreItem && preEntry.items && preEntry.items.length > 0) {
            preEntry.items[0].responseHTML = responseHTML;
            preEntry.items[0].questionIndex = qNum2;
            preEntry.items[0].responseIndex = rNum2;
          }
        }
        // Rebuild popup into completed view (editable question, version nav)
        if (popup && popup.isConnected) {
          st.activeHighlightId = hlId2;
          JR.syncHighlightActive(hlId2);
          JR.rebuildPopupAfterEdit(popup, hlId2);
        }
      } else {
        hlId2 = crypto.randomUUID();
        var itemId2 = crypto.randomUUID();
        if (spans.length > 0 && responseHTML) {
          var contentContainer2 = popup.parentElement;
          for (var k = 0; k < spans.length; k++) {
            spans[k].setAttribute("data-jr-highlight-id", hlId2);
            spans[k].classList.add("jr-source-highlight-done");
          }
          var entryObj = {
            quoteId: hlId2,
            spans: spans.slice(),
            responseHTML: responseHTML,
            text: text,
            sentence: sentence,
            blockTypes: blockTypes,
            question: question || null,
            contentContainer: contentContainer2,
            parentId: parentId || null,
            parentItemId: parentItemId || null,
            responseIndex: rNum2,
            items: [{ id: itemId2, question: question || null, responseHTML: responseHTML, questionIndex: qNum2, responseIndex: rNum2 }],
            activeItemIndex: 0,
          };
          st.completedHighlights.set(hlId2, entryObj);
        }

        // Rebuild popup into completed view (editable question, version nav)
        if (popup && popup.isConnected) {
          st.activeHighlightId = hlId2;
          JR.syncHighlightActive(hlId2);
          JR.rebuildPopupAfterEdit(popup, hlId2);
        }
      }

      var sourceArticle = spans.length > 0
        ? spans[0].closest(S.aiTurn)
        : null;
      var sourceTurnIdx = sourceArticle ? JR.getTurnNumber(sourceArticle) : -1;

      // Determine the item id to persist
      var persistItemId;
      if (preRegisteredItemId) {
        persistItemId = preRegisteredItemId;
      } else if (detached && entry && entry.items && entry.items[0]) {
        persistItemId = entry.items[0].id;
      } else {
        persistItemId = itemId2;
      }

      if (preRegisteredItemId || (detached && preRegisteredHlId)) {
        // Update the existing pending storage record
        updateHighlightFields(persistItemId, {
          responseHTML: responseHTML,
          questionIndex: qNum2,
          responseIndex: rNum2,
          sourceTurnIndex: sourceTurnIdx,
        });
      } else {
        saveHighlight({
          id: persistItemId,
          quoteId: hlId2,
          text: text,
          sentence: sentence,
          blockTypes: blockTypes,
          responseHTML: responseHTML,
          question: question || null,
          url: location.href,
          site: "chatgpt",
          parentId: parentId || null,
          parentItemId: parentItemId || null,
          sourceTurnIndex: sourceTurnIdx,
          questionIndex: qNum2,
          responseIndex: rNum2,
        });
      }

      // Register with persistent enforcer so React remounts can't unhide
      JR.addHiddenTurnIndex(qNum2);
      JR.addHiddenTurnIndex(rNum2);

      JR.updateNavWidget();
      st.cancelResponseWatch = null;
      JR.drainQueue();
    }

    /**
     * Re-verify that hidden turns are still hidden. React may unmount
     * and remount article elements, losing our jr-hidden class.
     */
    function enforceHidden() {
      var allTurns = document.querySelectorAll(S.aiTurn);
      if (questionTurn) {
        var qCurrent = allTurns[turnsBefore];
        if (qCurrent && qCurrent !== questionTurn) {
          // React swapped the element — update reference
          questionTurn = qCurrent;
        }
        questionTurn.classList.add("jr-hidden");
      }
      if (responseTurn) {
        var rCurrent = allTurns[turnsBefore + 1];
        if (rCurrent && rCurrent !== responseTurn) {
          responseTurn = rCurrent;
        }
        responseTurn.classList.add("jr-hidden");
      }
    }

    var lastContentSnapshot = "";
    var lastContentChangeTime = Date.now();
    var STALE_THRESHOLD = 10000; // 10 seconds of no content change → force capture

    function poll() {
      if (cancelled) return;

      var allTurns = document.querySelectorAll(S.aiTurn);

      if (!questionTurn && allTurns.length > turnsBefore) {
        var candidate = allTurns[turnsBefore];
        var label = candidate.querySelector(S.aiLabel);
        if (!label || !label.textContent.includes(JR.AI_LABEL_TEXT)) {
          questionTurn = candidate;
          questionTurn.classList.add("jr-hidden");
          var qIdx = JR.getTurnNumber(questionTurn);
          JR.addHiddenTurnIndex(qIdx);
          // Write to BOTH storage keys so it survives reload even if one write fails
          addDeletedTurns(location.href, [qIdx]);
          var qHlKey = preRegisteredHlId || (editOpts && editOpts.hlId);
          var qHlRec = qHlKey ? st.completedHighlights.get(qHlKey) : null;
          // Resolve the actual item ID — for edits, find it from the in-memory entry
          var qSaveId = preRegisteredItemId
            || (qHlRec && qHlRec.items && qHlRec.items[qHlRec.activeItemIndex || 0]
                ? qHlRec.items[qHlRec.activeItemIndex || 0].id : null);
          if (qSaveId && qHlRec && qHlRec.items) {
            var oldItem = qHlRec.items[qHlRec.activeItemIndex || 0];
            if (oldItem && oldItem.questionIndex > 0 && oldItem.questionIndex !== qIdx) {
              addDeletedTurns(location.href, [oldItem.questionIndex]);
              JR.addHiddenTurnIndex(oldItem.questionIndex);
            }
            updateHighlightFields(qSaveId, { questionIndex: qIdx });
          }
          JR.repositionPopup();
        }
      }

      if (!responseTurn && allTurns.length > turnsBefore + 1) {
        var candidate2 = allTurns[turnsBefore + 1];
        var label2 = candidate2.querySelector(S.aiLabel);
        if (label2 && label2.textContent.includes(JR.AI_LABEL_TEXT)) {
          responseTurn = candidate2;
          responseTurn.classList.add("jr-hidden");
          var rIdx = JR.getTurnNumber(responseTurn);
          JR.addHiddenTurnIndex(rIdx);
          addDeletedTurns(location.href, [rIdx]);
          var rHlKey = preRegisteredHlId || (editOpts && editOpts.hlId);
          var rHlRec = rHlKey ? st.completedHighlights.get(rHlKey) : null;
          var rSaveId = preRegisteredItemId
            || (rHlRec && rHlRec.items && rHlRec.items[rHlRec.activeItemIndex || 0]
                ? rHlRec.items[rHlRec.activeItemIndex || 0].id : null);
          if (rSaveId && rHlRec && rHlRec.items) {
            var oldItem2 = rHlRec.items[rHlRec.activeItemIndex || 0];
            if (oldItem2 && oldItem2.responseIndex > 0 && oldItem2.responseIndex !== rIdx) {
              addDeletedTurns(location.href, [oldItem2.responseIndex]);
              JR.addHiddenTurnIndex(oldItem2.responseIndex);
            }
            updateHighlightFields(rSaveId, { responseIndex: rIdx });
          }
          startStreaming();
        }
      }

      // Once both turns are found and have jr-hidden, the pre-hide CSS is redundant
      // freezeChat CSS stays until cleanup() calls unfreezeChat()

      // React can remount DOM elements — re-apply hiding every cycle
      enforceHidden();

      if (responseTurn && !JR.isGenerating()) {
        // Capture after a brief delay for React to finish rendering.
        // Force-hide the response turn now and sync content to popup immediately.
        responseTurn.classList.add("jr-hidden");
        if (streamObserver) syncStreamContent();
        setTimeout(captureResponse, 300);
        return;
      }

      // Stale-content safeguard: if response exists but isGenerating() stays
      // true while content hasn't changed for STALE_THRESHOLD, force capture.
      if (responseTurn && JR.isGenerating()) {
        var currentContent = responseTurn.textContent || "";
        if (currentContent !== lastContentSnapshot) {
          lastContentSnapshot = currentContent;
          lastContentChangeTime = Date.now();
        } else if (Date.now() - lastContentChangeTime >= STALE_THRESHOLD) {
          console.warn("[JR] Response stale for " + STALE_THRESHOLD + "ms — force capturing");
          setTimeout(captureResponse, 300);
          return;
        }
      }

      // Quick timeout: if generation already stopped and no turns appeared at all, don't wait long.
      // Only fires when NEITHER question nor response turn has appeared — if questionTurn exists,
      // the message was injected successfully and we should wait for the response.
      if (!questionTurn && !responseTurn && !JR.isGenerating() && Date.now() - startTime >= 1500) {
        cleanup();
        saveTimeoutVersion();
        st.cancelResponseWatch = null;
        JR.drainQueue();
        return;
      }

      // Hard 10-second timeout: if no meaningful response content exists
      // AND ChatGPT is NOT actively generating, force-stop and save __TIMEOUT__.
      // If isGenerating() is true, ChatGPT is working — let it continue.
      if (Date.now() - startTime >= 10000) {
        var md5 = responseTurn ? responseTurn.querySelector(S.responseContent) : null;
        var hasRealContent = md5 && (md5.textContent || "").trim().length >= 1;
        if (!hasRealContent) {
          var stopBtn = document.querySelector(S.stopButton);
          if (stopBtn) stopBtn.click();
          cleanup();
          saveTimeoutVersion();
          st.cancelResponseWatch = null;
          JR.drainQueue();
          return;
        }
      }

      if (Date.now() - startTime >= timeoutMs) {
        cleanup();
        saveTimeoutVersion();
        st.cancelResponseWatch = null;
        JR.drainQueue();
        return;
      }

      // Poll fast initially to catch new turns quickly, then slow down
      var interval = (questionTurn && responseTurn) ? 500 : 80;
      timerId = setTimeout(poll, interval);
    }

    timerId = setTimeout(poll, 80);
  };
})();
