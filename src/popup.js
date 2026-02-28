// popup.js — Unified popup creation for Jump Return (any depth, any mode)
(function () {
  "use strict";

  var S = JR.SELECTORS;
  var st = JR.state;

  // --- Private helpers (not on JR.*) ---

  function resolveContentContainer(wrappers, isChained, entry) {
    if (entry) {
      var cc = entry.contentContainer;
      if (cc && cc.isConnected) return cc;
      var aa = entry.spans[0] && entry.spans[0].closest(S.aiTurn);
      return aa ? aa.parentElement : document.body;
    }
    if (isChained) {
      var parentPopupEl = st.popupStack.length > 0 ? st.popupStack[st.popupStack.length - 1].popup : null;
      return parentPopupEl ? parentPopupEl.parentElement : document.body;
    }
    var anchorArticle = (wrappers.length > 0)
      ? wrappers[0].closest(S.aiTurn)
      : document.querySelector(S.aiTurn);
    return (anchorArticle ? anchorArticle.parentElement : null) || document.body;
  }

  function attachResizeListener(popup, spans, contentContainer) {
    if (spans.length === 0) return;
    st.resizeHandler = function () {
      if (!spans[0].isConnected) return;
      var r = JR.getHighlightRect(spans);
      var cRect = contentContainer.getBoundingClientRect();
      var popupW = popup.offsetWidth;
      var cW = contentContainer.clientWidth;
      var left = r.left - cRect.left + r.width / 2 - popupW / 2;
      left = Math.max(8, Math.min(left, cW - popupW - 8));
      popup.style.left = left + "px";
      JR.updateArrow(popup, r, cRect, left);
      if (st.hoverToolbar) {
        JR.positionToolbar(st.hoverToolbar, spans);
      }
    };
    window.addEventListener("resize", st.resizeHandler);
  }

  function attachScrollTracking(popup, spans, contentContainer) {
    if (spans.length === 0) return;
    var parentRespDiv = spans[0].closest(".jr-popup-response");
    if (!parentRespDiv) return;
    // Lock parent popup's scroll while chained popup is open
    var savedOverflow = parentRespDiv.style.overflow;
    parentRespDiv.style.overflow = "hidden";
    popup._jrScrollCleanup = function () {
      parentRespDiv.style.overflow = savedOverflow;
    };
  }

  function buildInputRow(popup, text, sentence, blockTypes, wrappers, parentId) {
    var questionDiv = document.createElement("div");
    questionDiv.className = "jr-popup-question";

    var questionText = document.createElement("span");
    questionText.className = "jr-popup-question-text";
    questionText.contentEditable = "true";
    questionText.setAttribute("data-placeholder", "Ask a follow-up\u2026");
    questionDiv.appendChild(questionText);

    // Send wrapper with Brief/Elaborate dropdown — same as edit send
    var sendWrapper = document.createElement("div");
    sendWrapper.className = "jr-edit-send-wrapper";

    var sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "jr-popup-edit-send";
    sendBtn.innerHTML = SEND_SVG;
    sendBtn.disabled = true;
    sendWrapper.appendChild(sendBtn);

    var sendDropdown = document.createElement("div");
    sendDropdown.className = "jr-edit-send-dropdown jr-disabled";
    var dropdownMenu = document.createElement("div");
    dropdownMenu.className = "jr-edit-send-dropdown-menu";
    var modes = [
      { label: "Brief", mode: "brief" },
      { label: "Elaborate", mode: "regular" }
    ];

    function doSend(mode) {
      var question = questionText.textContent.trim();
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

      if (mode === "brief") {
        message += "\n\n(For this response only: please keep it brief \u2014 2-3 sentences. This instruction applies to this single response only \u2014 do not carry it forward to any later messages.)";
      } else {
        message += "\n\n(Respond at whatever length is natural. If any previous message in this conversation asked for brevity, ignore that \u2014 it was a one-time instruction and does not apply here.)";
      }

      var turnsBefore = document.querySelectorAll(S.aiTurn).length;

      questionDiv.remove();
      // Re-add as non-editable question display
      var displayDiv = document.createElement("div");
      displayDiv.className = "jr-popup-question";
      displayDiv.textContent = question;
      var loadingDiv = JR.createLoadingDiv();
      popup.appendChild(displayDiv);
      popup.appendChild(loadingDiv);

      var scrollAnchor = wrappers.length > 0
        ? wrappers[0]
        : (document.querySelector(S.aiTurn) || document.body);
      var chatScrollParent = JR.getScrollParent(scrollAnchor);
      var unlockScroll = JR.lockScroll(chatScrollParent, scrollAnchor);

      JR.injectAndSend(message);
      setTimeout(JR.repositionPopup, 300);

      JR.waitForResponse(popup, turnsBefore, text, sentence, blockTypes, unlockScroll, parentId, question);
    }

    modes.forEach(function (m) {
      var item = document.createElement("div");
      item.className = "jr-edit-send-dropdown-item";
      item.textContent = m.label;
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        var current = questionText.textContent.trim();
        if (!current) return;
        doSend(m.mode);
      });
      dropdownMenu.appendChild(item);
    });
    sendDropdown.appendChild(dropdownMenu);
    sendWrapper.appendChild(sendDropdown);
    questionDiv.appendChild(sendWrapper);
    popup.appendChild(questionDiv);

    // Track input to enable/disable send
    questionText.addEventListener("input", function () {
      var current = questionText.textContent.trim();
      var empty = !current;
      sendBtn.disabled = empty;
      if (empty) {
        sendDropdown.classList.add("jr-disabled");
      } else {
        sendDropdown.classList.remove("jr-disabled");
      }
    });

    // Prevent send button from stealing focus
    sendBtn.addEventListener("click", function (e) {
      e.stopPropagation();
    });

    // Enter prevented (must pick mode from dropdown)
    questionText.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
      }
    });

    // Do NOT auto-focus — let the user Cmd+C the native selection first.
    // Clicking the input clears the native selection and focuses for typing.
    questionText.addEventListener("mousedown", function () {
      var sel = window.getSelection();
      if (sel && !sel.isCollapsed) sel.removeAllRanges();
    });
  }

  var PENCIL_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 2l3 3-9 9H2v-3l9-9z"/></svg>';

  var TRASH_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h12M5.333 4V2.667a1.333 1.333 0 011.334-1.334h2.666a1.333 1.333 0 011.334 1.334V4M13 4l-.667 9.333A1.333 1.333 0 0111 14.667H5a1.333 1.333 0 01-1.333-1.334L3 4"/></svg>';

  /**
   * Build the toolbar DOM for a given highlight. Re-creates each time
   * because the hlId / entry may change on each hover.
   */
  function buildToolbarEl(hlId, entry) {
    var toolbar = document.createElement("div");
    toolbar.className = "jr-popup-toolbar";

    var colors = JR.HIGHLIGHT_COLORS;
    var currentColor = entry.color || "blue";

    for (var i = 0; i < colors.length; i++) {
      (function (color) {
        var swatch = document.createElement("div");
        swatch.className = "jr-toolbar-swatch jr-toolbar-swatch--" + color;
        if (color === currentColor) swatch.classList.add("jr-toolbar-swatch--active");
        swatch.addEventListener("click", function (e) {
          e.stopPropagation();
          var spans = entry.spans;
          for (var s = 0; s < spans.length; s++) {
            for (var c = 0; c < colors.length; c++) {
              spans[s].classList.remove("jr-highlight-color-" + colors[c]);
            }
            spans[s].classList.add("jr-highlight-color-" + color);
          }
          entry.color = color;
          // Update popup blockquote marks if popup is open
          if (st.activePopup && st.activeHighlightId === hlId) {
            var marks = st.activePopup.querySelectorAll(".jr-popup-mark");
            for (var m = 0; m < marks.length; m++) {
              for (var c2 = 0; c2 < colors.length; c2++) {
                marks[m].classList.remove("jr-highlight-color-" + colors[c2]);
              }
              marks[m].classList.add("jr-highlight-color-" + color);
            }
          }
          var swatches = toolbar.querySelectorAll(".jr-toolbar-swatch");
          for (var sw = 0; sw < swatches.length; sw++) {
            swatches[sw].classList.remove("jr-toolbar-swatch--active");
          }
          swatch.classList.add("jr-toolbar-swatch--active");
          updateHighlightColor(hlId, color);
        });
        toolbar.appendChild(swatch);
      })(colors[i]);
    }

    var trashBtn = document.createElement("button");
    trashBtn.type = "button";
    trashBtn.className = "jr-toolbar-delete";
    trashBtn.innerHTML = TRASH_SVG;
    trashBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      JR.hideToolbar();
      st.confirmingDelete = true;
      // If popup is already open for this highlight, show confirmation there
      if (st.activePopup && st.activeHighlightId === hlId) {
        showDeleteConfirmation(st.activePopup, hlId, entry, true);
      } else {
        // Open popup for this highlight, then show confirmation
        // Check if this is a chained highlight inside a parent popup
        var isInsidePopup = entry.spans.length > 0 && entry.spans[0].closest(".jr-popup");
        if (isInsidePopup) {
          JR.pushPopupState();
        } else {
          JR.removeAllPopups();
        }
        JR.createPopup({ completedId: hlId });
        if (st.activePopup) {
          showDeleteConfirmation(st.activePopup, hlId, entry, false);
        }
      }
    });
    toolbar.appendChild(trashBtn);

    // Stop mousedown from propagating so click-outside doesn't dismiss popup
    toolbar.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    // Keep toolbar alive when mouse enters it
    toolbar.addEventListener("mouseenter", function () {
      if (st.hoverToolbarTimer) {
        clearTimeout(st.hoverToolbarTimer);
        st.hoverToolbarTimer = null;
      }
    });

    // Start hide when mouse leaves toolbar
    toolbar.addEventListener("mouseleave", function () {
      st.hoverToolbarTimer = setTimeout(function () {
        JR.hideToolbar();
      }, 80);
    });

    return toolbar;
  }

  /**
   * Show the floating toolbar for a completed highlight.
   */
  JR.showToolbar = function (hlId) {
    if (st.confirmingDelete) return;
    var entry = st.completedHighlights.get(hlId);
    if (!entry || !entry.spans || entry.spans.length === 0) return;

    // Cancel any pending hide
    if (st.hoverToolbarTimer) {
      clearTimeout(st.hoverToolbarTimer);
      st.hoverToolbarTimer = null;
    }

    // If already showing for this highlight, just reposition
    if (st.hoverToolbar && st.hoverToolbarHlId === hlId) {
      JR.positionToolbar(st.hoverToolbar, entry.spans);
      return;
    }

    // Remove old toolbar (including any mid-fade)
    if (st.hoverToolbar) {
      st.hoverToolbar.remove();
      st.hoverToolbar = null;
    }
    var fading = document.querySelectorAll(".jr-toolbar-hiding");
    for (var i = 0; i < fading.length; i++) fading[i].remove();

    var toolbar = buildToolbarEl(hlId, entry);
    st.hoverToolbar = toolbar;
    st.hoverToolbarHlId = hlId;

    // Find content container from the spans
    var contentContainer = entry.contentContainer;
    if (!contentContainer || !contentContainer.isConnected) {
      var article = entry.spans[0].closest(S.aiTurn);
      contentContainer = article ? article.parentElement : document.body;
    }
    if (getComputedStyle(contentContainer).position === "static") {
      contentContainer.style.position = "relative";
    }

    toolbar.style.left = "-9999px";
    toolbar.style.top = "-9999px";
    contentContainer.appendChild(toolbar);
    JR.positionToolbar(toolbar, entry.spans);
  };

  /**
   * Hide the floating toolbar.
   */
  JR.hideToolbar = function () {
    if (st.hoverToolbarTimer) {
      clearTimeout(st.hoverToolbarTimer);
      st.hoverToolbarTimer = null;
    }
    if (st.hoverToolbar) {
      var tb = st.hoverToolbar;
      tb.classList.add("jr-toolbar-hiding");
      st.hoverToolbar = null;
      st.hoverToolbarHlId = null;
      setTimeout(function () { tb.remove(); }, 120);
    }
  };

  /**
   * Position the floating toolbar near the highlight.
   * If a popup is open for this highlight, goes on the opposite side.
   * Otherwise defaults to above the highlight.
   */
  JR.positionToolbar = function (toolbar, spans) {
    if (!toolbar || !toolbar.parentElement) return;
    var hlRect = JR.getHighlightRect(spans);
    var contentContainer = toolbar.parentElement;
    var cRect = contentContainer.getBoundingClientRect();
    var toolbarW = toolbar.offsetWidth;
    var toolbarH = toolbar.offsetHeight;
    var gap = 4;

    // Determine which side: opposite of popup if open for THIS highlight, else above
    var popupDirection = null;
    if (st.activeHighlightId === st.hoverToolbarHlId && st.activePopup && st.activePopup._jrDirection) {
      popupDirection = st.activePopup._jrDirection;
    }

    // Toolbar side determines which line is adjacent
    // toolbar goes opposite the popup, so it's adjacent to the same line as the popup
    var toolbarSide; // side where toolbar goes
    if (popupDirection === "below") {
      toolbarSide = "above";
    } else if (popupDirection === "above") {
      toolbarSide = "below";
    } else {
      toolbarSide = "above";
    }

    // Get the rect of the line adjacent to the popup (same line toolbar is near)
    // When popup is above → adjacent is first line → toolbar below first line
    // When popup is below → adjacent is last line → toolbar above last line
    var adjLineRect = JR.getAdjacentLineRect(spans, popupDirection || "above");
    var lineRect = adjLineRect || hlRect;

    // Center horizontally over the adjacent line's highlight
    var left = lineRect.left - cRect.left + lineRect.width / 2 - toolbarW / 2;
    var cW = contentContainer.clientWidth;
    left = Math.max(4, Math.min(left, cW - toolbarW - 4));

    var top;
    if (toolbarSide === "below") {
      top = lineRect.bottom - cRect.top + gap;
    } else {
      top = lineRect.top - cRect.top - toolbarH - gap;
    }

    toolbar.style.left = left + "px";
    toolbar.style.top = top + "px";
  };

  function showDeleteConfirmation(popup, hlId, entry, hadPopupOpen) {
    JR.hideToolbar();

    var originalChildren = [];
    while (popup.firstChild) {
      originalChildren.push(popup.removeChild(popup.firstChild));
    }

    countDescendants(hlId).then(function (count) {
      var confirm = document.createElement("div");
      confirm.className = "jr-popup-confirm";

      var text = document.createElement("div");
      text.className = "jr-popup-confirm-text";
      if (count > 0) {
        text.textContent = "Delete this highlight and " + count + " follow-up" + (count === 1 ? "" : "s") + "?";
      } else {
        text.textContent = "Delete this highlight?";
      }
      confirm.appendChild(text);

      var buttons = document.createElement("div");
      buttons.className = "jr-popup-confirm-buttons";

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "jr-popup-confirm-btn";
      cancelBtn.textContent = "Cancel";
      cancelBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        st.confirmingDelete = false;
        if (hadPopupOpen) {
          // Restore the popup content
          while (popup.firstChild) popup.removeChild(popup.firstChild);
          for (var i = 0; i < originalChildren.length; i++) {
            popup.appendChild(originalChildren[i]);
          }
          JR.repositionPopup();
        } else {
          // No popup was open before — just close everything
          JR.removeAllPopups();
        }
      });

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "jr-popup-confirm-btn jr-popup-confirm-btn--danger";
      deleteBtn.textContent = "Delete";
      deleteBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        executeDelete(hlId);
      });

      buttons.appendChild(cancelBtn);
      buttons.appendChild(deleteBtn);
      confirm.appendChild(buttons);
      popup.appendChild(confirm);
      JR.repositionPopup();
    });
  }

  function executeDelete(hlId) {
    st.confirmingDelete = false;
    var idsToDelete = [];
    function walkDescendants(parentId) {
      idsToDelete.push(parentId);
      st.completedHighlights.forEach(function (entry, id) {
        if (entry.parentId === parentId) {
          walkDescendants(id);
        }
      });
    }
    walkDescendants(hlId);

    // Collect all turn indices to persist as hidden, then unwrap spans
    var turnsToHide = [];

    for (var i = 0; i < idsToDelete.length; i++) {
      var id = idsToDelete[i];
      var entry = st.completedHighlights.get(id);
      if (!entry) continue;

      // Collect turn indices from in-memory versions
      if (entry.versions && entry.versions.length > 0) {
        for (var vi = 0; vi < entry.versions.length; vi++) {
          if (entry.versions[vi].questionIndex > 0) turnsToHide.push(entry.versions[vi].questionIndex);
          if (entry.versions[vi].responseIndex > 0) turnsToHide.push(entry.versions[vi].responseIndex);
        }
      }

      // Unwrap highlight spans
      if (entry.spans) {
        for (var s = 0; s < entry.spans.length; s++) {
          var span = entry.spans[s];
          var parent = span.parentNode;
          if (!parent) continue;
          while (span.firstChild) parent.insertBefore(span.firstChild, span);
          parent.removeChild(span);
          parent.normalize();
        }
      }

      st.completedHighlights.delete(id);
    }

    // Also collect turn indices from storage (covers indices not in memory)
    var storagePromises = idsToDelete.map(function (delId) {
      return getHighlight(delId).then(function (hl) {
        if (!hl) return;
        if (hl.questionIndex > 0) turnsToHide.push(hl.questionIndex);
        if (hl.responseIndex > 0) turnsToHide.push(hl.responseIndex);
        if (hl.versions) {
          for (var vi2 = 0; vi2 < hl.versions.length; vi2++) {
            if (hl.versions[vi2].questionIndex > 0) turnsToHide.push(hl.versions[vi2].questionIndex);
            if (hl.versions[vi2].responseIndex > 0) turnsToHide.push(hl.versions[vi2].responseIndex);
          }
        }
      });
    });

    Promise.all(storagePromises).then(function () {
      // Persist hidden turns so they stay hidden after reload
      if (turnsToHide.length > 0) {
        addDeletedTurns(location.href, turnsToHide);
      }
      deleteHighlight(hlId);
    });

    // If there's a parent popup on the stack, just peel back to it;
    // otherwise close everything
    if (st.popupStack.length > 0) {
      JR.removePopup();
    } else {
      JR.removeAllPopups();
    }
  }

  function buildVersionNav(popup, hlId) {
    var entry = st.completedHighlights.get(hlId);
    if (!entry || !entry.versions || entry.versions.length <= 1) return;

    var nav = document.createElement("div");
    nav.className = "jr-popup-version-nav";

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "jr-popup-version-prev";
    prevBtn.textContent = "\u25C0";

    var indicator = document.createElement("span");
    indicator.className = "jr-popup-version-indicator";

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "jr-popup-version-next";
    nextBtn.textContent = "\u25B6";

    nav.appendChild(prevBtn);
    nav.appendChild(indicator);
    nav.appendChild(nextBtn);

    function updateNav() {
      var idx = entry.activeVersion != null ? entry.activeVersion : entry.versions.length - 1;
      indicator.textContent = (idx + 1) + " / " + entry.versions.length;
      prevBtn.disabled = (idx === 0);
      nextBtn.disabled = (idx === entry.versions.length - 1);
    }

    function switchVersion(newIdx) {
      entry.activeVersion = newIdx;
      var v = entry.versions[newIdx];
      entry.question = v.question;
      entry.responseHTML = v.responseHTML;
      setHighlightActiveVersion(hlId, newIdx);

      // Update question text
      var qText = popup.querySelector(".jr-popup-question-text");
      if (qText) qText.textContent = v.question || "";

      // Replace response
      var oldResp = popup.querySelector(".jr-popup-response");
      if (oldResp) oldResp.remove();

      if (v.responseHTML) {
        var responseDiv = document.createElement("div");
        responseDiv.className = "jr-popup-response";
        responseDiv.innerHTML = v.responseHTML;
        popup.appendChild(responseDiv);

        // Restore chained highlights for this version
        restoreChainedHighlights(responseDiv, hlId, entry.contentContainer);
      }

      updateNav();
      JR.repositionPopup();
    }

    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var idx = entry.activeVersion != null ? entry.activeVersion : entry.versions.length - 1;
      if (idx > 0) switchVersion(idx - 1);
    });

    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var idx = entry.activeVersion != null ? entry.activeVersion : entry.versions.length - 1;
      if (idx < entry.versions.length - 1) switchVersion(idx + 1);
    });

    updateNav();

    // Insert after question div, before response
    var responseDiv = popup.querySelector(".jr-popup-response");
    var loadingDiv = popup.querySelector(".jr-popup-loading");
    var before = responseDiv || loadingDiv;
    if (before) {
      popup.insertBefore(nav, before);
    } else {
      popup.appendChild(nav);
    }
  }

  function restoreChainedHighlights(responseDiv, parentId, contentContainer) {
    st.completedHighlights.forEach(function (chEntry, chId) {
      if (chEntry.parentId === parentId) {
        JR.restoreHighlightInElement(responseDiv, {
          id: chId, text: chEntry.text, responseHTML: chEntry.responseHTML,
          sentence: chEntry.sentence, blockTypes: chEntry.blockTypes, question: chEntry.question, parentId: chEntry.parentId,
        }, contentContainer);
      }
    });
    getChildHighlights(parentId).then(function (children) {
      for (var ci = 0; ci < children.length; ci++) {
        var child = children[ci];
        if (responseDiv.querySelector('[data-jr-highlight-id="' + child.id + '"]')) continue;
        JR.restoreHighlightInElement(responseDiv, child, contentContainer);
      }
    });
  }

  var SEND_SVG = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8h12M10 4l4 4-4 4"/></svg>';

  function submitEdit(popup, hlId, entry, contentContainer, newQuestion, mode) {
    // Exit edit mode visually
    var questionText = popup.querySelector(".jr-popup-question-text");
    if (questionText) {
      questionText.contentEditable = "false";
      questionText.textContent = newQuestion;
    }
    var editBtn = popup.querySelector(".jr-popup-edit-btn");
    if (editBtn) editBtn.classList.remove("jr-popup-edit-btn--active");
    var sendWrap = popup.querySelector(".jr-edit-send-wrapper");
    if (sendWrap) sendWrap.style.display = "none";

    // Remove response and version nav, show loading
    var responseDiv = popup.querySelector(".jr-popup-response");
    if (responseDiv) responseDiv.remove();
    var versionNav = popup.querySelector(".jr-popup-version-nav");
    if (versionNav) versionNav.remove();

    popup.appendChild(JR.createLoadingDiv());
    JR.repositionPopup();

    // Build injection message
    var text = entry.text;
    var sentence = entry.sentence;
    var message;
    if (sentence) {
      message = 'Regarding this part of your response:\n"' + sentence + '"\n\nSpecifically: "' + text + '"\n\n' + newQuestion;
    } else {
      message = 'Regarding this part of your response:\n"' + text + '"\n\n' + newQuestion;
    }

    var editMode = mode || "regular";
    if (editMode === "brief") {
      message += "\n\n(For this response only: please keep it brief \u2014 2-3 sentences. This instruction applies to this single response only \u2014 do not carry it forward to any later messages.)";
    } else {
      message += "\n\n(Respond at whatever length is natural. If any previous message in this conversation asked for brevity, ignore that \u2014 it was a one-time instruction and does not apply here.)";
    }

    var turnsBefore = document.querySelectorAll(S.aiTurn).length;

    var scrollAnchor = entry.spans.length > 0 ? entry.spans[0] : document.body;
    var chatScrollParent = JR.getScrollParent(scrollAnchor);
    var unlockScroll = JR.lockScroll(chatScrollParent, scrollAnchor);

    JR.injectAndSend(message);
    setTimeout(JR.repositionPopup, 300);

    JR.waitForResponse(popup, turnsBefore, text, sentence, entry.blockTypes, unlockScroll, entry.parentId, newQuestion, { hlId: hlId });
  }

  function showCompletedResponse(popup, id, entry, contentContainer) {
    // Show the question with inline edit toggle
    if (entry.question) {
      var questionDiv = document.createElement("div");
      questionDiv.className = "jr-popup-question";

      var questionText = document.createElement("span");
      questionText.className = "jr-popup-question-text";
      questionText.textContent = entry.question;
      questionDiv.appendChild(questionText);

      // Send icon with hover dropdown — hidden until edit mode
      var sendWrapper = document.createElement("div");
      sendWrapper.className = "jr-edit-send-wrapper";
      sendWrapper.style.display = "none";

      var sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.className = "jr-popup-edit-send";
      sendBtn.innerHTML = SEND_SVG;
      sendBtn.disabled = true;
      sendWrapper.appendChild(sendBtn);

      var sendDropdown = document.createElement("div");
      sendDropdown.className = "jr-edit-send-dropdown jr-disabled";
      var dropdownMenu = document.createElement("div");
      dropdownMenu.className = "jr-edit-send-dropdown-menu";
      var modes = [
        { label: "Brief", mode: "brief" },
        { label: "Elaborate", mode: "regular" }
      ];
      modes.forEach(function (m) {
        var item = document.createElement("div");
        item.className = "jr-edit-send-dropdown-item";
        item.textContent = m.label;
        item.addEventListener("click", function (e) {
          e.stopPropagation();
          var current = questionText.textContent.trim();
          if (!current || current === originalText) return;
          submitEdit(popup, id, entry, contentContainer, current, m.mode);
        });
        dropdownMenu.appendChild(item);
      });
      sendDropdown.appendChild(dropdownMenu);
      sendWrapper.appendChild(sendDropdown);
      questionDiv.appendChild(sendWrapper);

      // Pencil toggle — click to enter/exit edit mode
      var editBtn = document.createElement("button");
      editBtn.type = "button";
      editBtn.className = "jr-popup-edit-btn";
      editBtn.innerHTML = PENCIL_SVG;
      questionDiv.appendChild(editBtn);

      var editing = false;
      var originalText = entry.question;

      editBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        editing = !editing;

        if (editing) {
          // Activate edit mode
          editBtn.classList.add("jr-popup-edit-btn--active");
          questionText.contentEditable = "true";
          questionText.focus();
          // Place cursor at end
          var sel = window.getSelection();
          var range = document.createRange();
          range.selectNodeContents(questionText);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
          sendWrapper.style.display = "";
          sendBtn.disabled = true;
          sendDropdown.classList.add("jr-disabled");
        } else {
          // Deactivate — cancel and restore original text
          editBtn.classList.remove("jr-popup-edit-btn--active");
          questionText.contentEditable = "false";
          questionText.textContent = originalText;
          sendWrapper.style.display = "none";
          sendBtn.disabled = true;
          sendDropdown.classList.add("jr-disabled");
        }
      });

      // Track text changes to enable/disable send
      questionText.addEventListener("input", function () {
        var current = questionText.textContent.trim();
        var unchanged = (current === originalText || current === "");
        sendBtn.disabled = unchanged;
        if (unchanged) {
          sendDropdown.classList.add("jr-disabled");
        } else {
          sendDropdown.classList.remove("jr-disabled");
        }
      });

      // Escape cancels, Enter prevented (must use dropdown to pick mode)
      questionText.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          editing = false;
          editBtn.classList.remove("jr-popup-edit-btn--active");
          questionText.contentEditable = "false";
          questionText.textContent = originalText;
          sendWrapper.style.display = "none";
          sendBtn.disabled = true;
          sendDropdown.classList.add("jr-disabled");
        }
      });

      // Send button itself is not directly clickable — dropdown items handle it
      sendBtn.addEventListener("click", function (e) {
        e.stopPropagation();
      });

      popup.appendChild(questionDiv);
    }

    // Version nav (if multiple versions)
    if (entry.versions && entry.versions.length > 1) {
      buildVersionNav(popup, id);
    }

    if (entry.responseHTML) {
      var responseDiv = document.createElement("div");
      responseDiv.className = "jr-popup-response";
      responseDiv.innerHTML = entry.responseHTML;
      popup.appendChild(responseDiv);

      // Restore chained highlights
      restoreChainedHighlights(responseDiv, id, contentContainer);
    } else {
      popup.appendChild(JR.createLoadingDiv());
    }
  }

  // --- Unified popup creation ---

  /**
   * Create a popup at any depth. Works for:
   *  - Level 1: text selected in AI response     { text, sentence, blockTypes, rect, range }
   *  - Chained: text selected in popup response   { text, range, parentId }
   *  - Completed: reopening a saved highlight      { completedId }
   */
  JR.createPopup = function (opts) {
    var completedId = opts.completedId || null;
    var parentId = opts.parentId || null;
    var range = opts.range || null;
    var rect = opts.rect || null;

    // --- Resolve completed entry ---
    var entry = null;
    if (completedId) {
      entry = st.completedHighlights.get(completedId);
      if (!entry) return;
    }

    var isCompleted = !!entry;
    var isChained = isCompleted ? !!entry.parentId : !!parentId;

    var text = isCompleted ? entry.text : opts.text;
    var sentence = isCompleted ? entry.sentence : (opts.sentence || null);
    var blockTypes = isCompleted ? entry.blockTypes : (opts.blockTypes || null);

    // --- Chained sentence extraction (before highlightRange mutates DOM) ---
    if (!isCompleted && isChained && range) {
      var chainedBlockTypes = [];
      try {
        var startEl = range.startContainer;
        if (startEl.nodeType === Node.TEXT_NODE) startEl = startEl.parentElement;
        var respDiv = startEl.closest(".jr-popup-response");
        if (respDiv) {
          sentence = JR.extractSentenceInContainer(range, chainedBlockTypes, respDiv);
          if (chainedBlockTypes.length > 0) blockTypes = chainedBlockTypes;
        }
      } catch (ex) {
        console.warn("[JR] chained sentence extraction failed:", ex);
      }
    }

    // --- Highlight range (new popups only) ---
    var wrappers = [];
    if (!isCompleted && range) {
      wrappers = JR.highlightRange(range);
      st.activeSourceHighlights = wrappers;
    }

    // --- Create popup element ---
    var popup = document.createElement("div");
    popup.className = "jr-popup";
    popup._jrChained = isChained;
    var w = isChained ? st.customPopupWidthChained : st.customPopupWidthL1;
    if (w) popup.style.width = w + "px";

    // --- Context blockquote (same for all) ---
    var highlight = document.createElement("div");
    highlight.className = "jr-popup-highlight";
    if (sentence) {
      JR.renderSentenceContext(highlight, sentence, text, blockTypes);
    } else {
      highlight.textContent = JR.truncateText(text, JR.MAX_DISPLAY_CHARS);
    }
    popup.appendChild(highlight);

    // --- Apply saved color to blockquote marks (completed popups) ---
    if (isCompleted && entry.color) {
      var marks = highlight.querySelectorAll(".jr-popup-mark");
      for (var mi = 0; mi < marks.length; mi++) {
        marks[mi].classList.add("jr-highlight-color-" + entry.color);
      }
    }

    // --- Body: input row (new) or response HTML (completed) ---
    if (isCompleted) {
      showCompletedResponse(popup, completedId, entry, resolveContentContainer(wrappers, isChained, entry));
    } else {
      buildInputRow(popup, text, sentence, blockTypes, wrappers, parentId);
    }

    // --- Mousedown: stop propagation + close children to this level ---
    popup.addEventListener("mousedown", function (e) {
      e.stopPropagation();
      if (st.activePopup && st.activePopup !== popup && st.popupStack.length > 0) {
        var hlSpan = e.target.closest(".jr-source-highlight");
        if (!hlSpan || st.activeSourceHighlights.indexOf(hlSpan) === -1) {
          while (st.activePopup && st.activePopup !== popup && st.popupStack.length > 0) {
            JR.removePopup();
          }
        }
      }
    });
    JR.addPopupResponseSelectionHandler(popup);

    // --- Resolve content container ---
    var contentContainer = resolveContentContainer(wrappers, isChained, entry);
    if (getComputedStyle(contentContainer).position === "static") {
      contentContainer.style.position = "relative";
    }

    // --- Position ---
    var spans = isCompleted ? entry.spans : wrappers;
    var posRect;
    if (spans.length > 0) {
      posRect = JR.getHighlightRect(spans);
    } else if (rect) {
      posRect = rect;
    } else if (isChained && parentId) {
      posRect = JR.getHighlightRect(JR.getAncestorWithSpans(parentId).spans);
    }

    var parentDirection = (st.popupStack.length > 0)
      ? st.popupStack[st.popupStack.length - 1].popup._jrDirection
      : null;
    JR.positionPopup(popup, posRect, contentContainer, isChained ? parentDirection : null, spans);
    JR.addResizeHandlers(popup);

    // --- Register active state ---
    st.activePopup = popup;
    st.activeSourceHighlights = isCompleted ? entry.spans : wrappers;
    st.activeHighlightId = isCompleted ? completedId : null;
    JR.syncHighlightActive(st.activeHighlightId);

    // --- Reposition toolbar if already showing for this highlight ---
    if (isCompleted && st.hoverToolbar && st.hoverToolbarHlId === completedId) {
      JR.positionToolbar(st.hoverToolbar, spans);
    }

    // --- Resize + scroll tracking ---
    attachResizeListener(popup, spans, contentContainer);
    attachScrollTracking(popup, spans, contentContainer);

    // --- Preserve native selection over the source highlight for Cmd+C ---
    if (!isCompleted && wrappers.length > 0) {
      requestAnimationFrame(function () {
        JR.selectSourceHighlightText();
      });
    }
  };

  /**
   * Rebuild a completed popup after an edit response is captured.
   * Called from chat.js captureResponse when editOpts is present.
   */
  JR.rebuildPopupAfterEdit = function (popup, hlId) {
    var entry = st.completedHighlights.get(hlId);
    if (!entry) return;

    // Remove everything except blockquote and arrow
    var children = Array.from(popup.children);
    for (var i = 0; i < children.length; i++) {
      var cl = children[i].classList;
      if (!cl.contains("jr-popup-highlight") && !cl.contains("jr-popup-arrow")) {
        children[i].remove();
      }
    }

    showCompletedResponse(popup, hlId, entry, entry.contentContainer);
    JR.repositionPopup();
  };
})();
