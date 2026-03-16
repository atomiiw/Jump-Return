// chat.js — Chat injection, response capture, and scroll locking for Jump Return
(function () {
  "use strict";

  var S = JR.SELECTORS;
  var st = JR.state;

  /**
   * Read the auto-assigned color stashed on spans by createPopup.
   * Color is final from cursor time — no re-detection at capture time.
   */
  function getAutoColor(spans) {
    if (spans.length === 0) return null;
    return spans[0]._jrAutoColor || null;
  }

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
      console.error("[Jump Return] Chat input not found");
      return;
    }

    // Freeze the conversation scroll container before touching the input —
    // prevents any ChatGPT-triggered scroll-to-bottom from causing a visible flicker.
    var scrollAnchor = document.querySelector(S.aiTurn) || chatInput;
    var scrollParent = JR.getScrollParent(scrollAnchor);
    var savedScrollTop = scrollParent ? scrollParent.scrollTop : 0;

    chatInput.focus({ preventScroll: true });

    var dt = new DataTransfer();
    dt.setData("text/plain", message);
    chatInput.dispatchEvent(new ClipboardEvent("paste", {
      clipboardData: dt,
      bubbles: true,
      cancelable: true,
    }));

    // Restore scroll position immediately after paste
    if (scrollParent) scrollParent.scrollTop = savedScrollTop;

    var attempts = 0;
    function trySend() {
      var sendBtn = JR.findSendButton();
      if (sendBtn && !sendBtn.disabled) {
        // Restore scroll once more right before click in case React shifted it
        if (scrollParent) scrollParent.scrollTop = savedScrollTop;
        sendBtn.click();
        chatInput.blur();
        // One final restore after click
        if (scrollParent) scrollParent.scrollTop = savedScrollTop;
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
    if (JR.isGenerating() || st.responseWatchActive) {
      st.messageQueue.push(opts);
      return;
    }
    sendQueued(opts);
  };

  function sendQueued(opts) {
    if (opts.beforeSend) opts.beforeSend(opts.waitOpts);
    JR.injectAndSend(opts.message);
    var w = opts.waitOpts;
    JR.waitForResponse(w.popup, w.turnsBefore, w.text, w.sentence, w.blockTypes, w.unlockScroll, w.parentId, w.question, w.editOpts, w.preRegisteredHlId, w.preRegisteredItemId);
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

    function cleanup() {
      st.responseWatchActive = false;
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

      // Auto-scroll to bottom during streaming
      responseDiv.scrollTop = responseDiv.scrollHeight;

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
          var detachColor = getAutoColor(detachedSpans);
          for (var k = 0; k < detachedSpans.length; k++) {
            detachedSpans[k].setAttribute("data-jr-highlight-id", detachedHlId);
            detachedSpans[k].classList.add("jr-source-highlight-done");
            if (detachColor) detachedSpans[k].classList.add("jr-highlight-color-" + detachColor);
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
          if (detachColor) detachEntry.color = detachColor;
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
          parentItemId: (memEntry && memEntry.parentItemId) || parentItemId || null,
          sourceTurnIndex: memEntry ? (memEntry.spans && memEntry.spans[0] ? JR.getTurnNumber(memEntry.spans[0].closest(S.aiTurn)) : -1) : -1,
          questionIndex: qNum,
          responseIndex: rNum,
          color: memEntry ? memEntry.color : null,
          active: true,
        });

        // Rebuild popup UI if it's open for this highlight
        if (!detached && popup && popup.isConnected) {
          JR.rebuildPopupAfterEdit(popup, hlId);
        } else if (detached && st.activePopup && st.activeSourceHighlights.length > 0 &&
                   st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === hlId) {
          JR.rebuildPopupAfterEdit(st.activePopup, hlId);
        }

        st.activeHighlightId = hlId;
        JR.syncHighlightActive(hlId);
        JR.updateNavWidget();
        st.cancelResponseWatch = null;
        JR.drainQueue();
        return;
      }

      // --- Normal (non-edit) capture ---
      // Always capture responseHTML from the ORIGINAL turn, not from the popup div.
      // The popup div may have been modified by rebuildCodeBlocks (replaces <pre> with
      // custom .jr-code-block that has dead event listeners when deserialized from storage).
      var responseHTML = null;
      var markdown2 = responseTurn.querySelector(S.responseContent);
      if (markdown2) responseHTML = markdown2.innerHTML;
      if (detached) {
        cleanup();
      } else {
        JR.repositionPopup();
        JR.showResponseInPopup(popup, responseTurn);
        cleanup();
        JR.repositionPopup();
      }

      var hlId2;
      var qNum2 = questionTurn ? JR.getTurnNumber(questionTurn) : -1;
      var rNum2 = JR.getTurnNumber(responseTurn);

      if (detached) {
        hlId2 = detachedHlId;
        var entry = st.completedHighlights.get(hlId2);
        if (entry) {
          entry.responseHTML = responseHTML;
          entry.responseIndex = rNum2;
          // Update pending items with real data
          if (entry.items && entry.items.length > 0 && entry.items[0].responseHTML === "__PENDING__") {
            entry.items[0].responseHTML = responseHTML;
            entry.items[0].questionIndex = qNum2;
            entry.items[0].responseIndex = rNum2;
          } else if (!entry.items || entry.items.length === 0) {
            var detItemId = crypto.randomUUID();
            entry.items = [{ id: detItemId, question: question || null, responseHTML: responseHTML, questionIndex: qNum2, responseIndex: rNum2 }];
            entry.activeItemIndex = 0;
          }
        }

        if (st.activePopup && st.activeSourceHighlights.length > 0 &&
            st.activeSourceHighlights[0].getAttribute("data-jr-highlight-id") === hlId2) {
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
          if (preEntry.items && preEntry.items.length > 0) {
            preEntry.items[0].responseHTML = responseHTML;
            preEntry.items[0].questionIndex = qNum2;
            preEntry.items[0].responseIndex = rNum2;
          }
        }
        st.activeHighlightId = hlId2;
        JR.syncHighlightActive(hlId2);

        // Rebuild popup into completed view (editable question, version nav)
        if (popup && popup.isConnected) {
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
          var autoColor = getAutoColor(spans);
          var entryObj = {
            quoteId: hlId2,
            spans: spans.slice(),
            responseHTML: responseHTML,
            text: text,
            sentence: sentence,
            blockTypes: blockTypes,
            question: question || null,
            color: autoColor || null,
            contentContainer: contentContainer2,
            parentId: parentId || null,
            parentItemId: parentItemId || null,
            responseIndex: rNum2,
            items: [{ id: itemId2, question: question || null, responseHTML: responseHTML, questionIndex: qNum2, responseIndex: rNum2 }],
            activeItemIndex: 0,
          };
          if (autoColor) {
            for (var ac = 0; ac < spans.length; ac++) {
              spans[ac].classList.add("jr-highlight-color-" + autoColor);
            }
          }
          st.completedHighlights.set(hlId2, entryObj);
        }
        st.activeHighlightId = hlId2;
        JR.syncHighlightActive(hlId2);

        // Rebuild popup into completed view (editable question, version nav)
        if (popup && popup.isConnected) {
          JR.rebuildPopupAfterEdit(popup, hlId2);
        }
      }

      var autoColor2 = null;
      if (!detached && spans.length > 0) {
        var e2 = st.completedHighlights.get(hlId2);
        if (e2) autoColor2 = e2.color || null;
      } else if (detached && detachedHlId) {
        var de = st.completedHighlights.get(detachedHlId);
        if (de && !de.color) {
          autoColor2 = getAutoColor(spans);
          if (autoColor2) {
            de.color = autoColor2;
            for (var dac = 0; dac < spans.length; dac++) {
              spans[dac].classList.add("jr-highlight-color-" + autoColor2);
            }
          }
        } else if (de) {
          autoColor2 = de.color;
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
          color: autoColor2,
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
          color: autoColor2,
        });
      }

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
          responseTurn.classList.add("jr-hidden");
        }
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
          JR.repositionPopup();
        }
      }

      if (!responseTurn && allTurns.length > turnsBefore + 1) {
        var candidate2 = allTurns[turnsBefore + 1];
        var label2 = candidate2.querySelector(S.aiLabel);
        if (label2 && label2.textContent.includes(JR.AI_LABEL_TEXT)) {
          responseTurn = candidate2;
          startStreaming();
        }
      }

      // React can remount DOM elements — re-apply hiding every cycle
      enforceHidden();

      if (responseTurn && !JR.isGenerating()) {
        // Delay capture slightly — ChatGPT's markdown renderer may still be
        // processing the final tokens after the stop button disappears.
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

      if (Date.now() - startTime >= timeoutMs) {
        cleanup();
        unhideTurns();

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
          retryBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="currentColor"><path d="M244,56v48a12,12,0,0,1-12,12H184a12,12,0,1,1,0-24H201.1l-19-17.38c-.13-.12-.26-.24-.38-.37A76,76,0,1,0,127,204h1a75.53,75.53,0,0,0,52.15-20.72,12,12,0,0,1,16.49,17.45A99.45,99.45,0,0,1,128,228h-1.37A100,100,0,1,1,198.51,57.06L220,76.72V56a12,12,0,0,1,24,0Z"/></svg>';
          retryBtn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            timeoutDiv.remove();
            // Rebuild message
            var retryMessage;
            if (sentence) {
              retryMessage = 'Regarding this part of your response:\n"' + sentence + '"\n\nSpecifically: "' + text + '"\n\n' + question;
            } else {
              retryMessage = 'Regarding this part of your response:\n"' + text + '"\n\n' + question;
            }
            if (st.responseMode === "brief") {
              retryMessage += "\n\n(For this response only: please keep it brief \u2014 2-3 sentences. This instruction applies to this single response only \u2014 do not carry it forward to any later messages.)";
            } else {
              retryMessage += "\n\n(Ignore any previous instructions about brevity \u2014 respond normally.)";
            }

            var retryLoading = JR.createLoadingDiv();
            targetPopup.appendChild(retryLoading);

            var retryWaitOpts = {
              popup: targetPopup, turnsBefore: 0, text: text, sentence: sentence,
              blockTypes: blockTypes, unlockScroll: null, parentId: parentId,
              question: question, editOpts: editOpts
            };

            JR.enqueueMessage({
              message: retryMessage,
              waitOpts: retryWaitOpts,
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

        if (editOpts) {
          if (!detached && popup && popup.isConnected) {
            showTimeoutUI(popup);
          }
          st.cancelResponseWatch = null;
          JR.drainQueue();
          return;
        }
        if (!detached) {
          showTimeoutUI(popup);
        }
        if (detached && detachedSpans) {
          if (preRegisteredHlId) {
            // Pre-registered highlight persists with __PENDING__ — don't remove
            detachedSpans = null;
          } else {
            if (detachedHlId) st.completedHighlights.delete(detachedHlId);
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
        }
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
