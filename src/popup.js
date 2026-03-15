// popup.js — Unified popup creation for Jump Return (any depth, any mode)
(function () {
  "use strict";

  var S = JR.SELECTORS;
  var st = JR.state;

  var CHEVRON_RIGHT_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80A8,8,0,0,1,88,208V48a8,8,0,0,1,13.66-5.66l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>';

  var SWITCH_SVG = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M228,48V96a12,12,0,0,1-12,12H168a12,12,0,0,1,0-24h19l-7.8-7.8a75.55,75.55,0,0,0-53.32-22.26h-.43A75.49,75.49,0,0,0,72.39,75.57,12,12,0,1,1,55.61,58.41a99.38,99.38,0,0,1,69.87-28.47H126A99.42,99.42,0,0,1,196.2,59.23L204,67V48a12,12,0,0,1,24,0ZM183.61,180.43a75.49,75.49,0,0,1-53.09,21.63h-.43A75.55,75.55,0,0,1,76.77,179.8L69,172H88a12,12,0,0,0,0-24H40a12,12,0,0,0-12,12v48a12,12,0,0,0,24,0V189l7.8,7.8A99.42,99.42,0,0,0,130,226.06h.56a99.38,99.38,0,0,0,69.87-28.47,12,12,0,0,0-16.78-17.16Z"/></svg>';

  // --- Private helpers (not on JR.*) ---

  /**
   * Wire up Copy buttons inside a popup response div.
   */
  var CODE_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"></polyline><polyline points="8 6 2 12 8 18"></polyline></svg>';
  var COPY_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  var CHECK_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
  /** Create a Copy button with a live click handler. */
  function wireCopyButton(container) {
    var btn = document.createElement("button");
    btn.innerHTML = COPY_ICON + " Copy";
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      var codeBlock = btn.closest(".jr-code-block");
      var codeEl = codeBlock ? codeBlock.querySelector("pre code") : null;
      var text = codeEl ? codeEl.textContent : "";
      navigator.clipboard.writeText(text);
      btn.innerHTML = CHECK_ICON + " Copied!";
      setTimeout(function () { btn.innerHTML = COPY_ICON + " Copy"; }, 2000);
    });
    container.appendChild(btn);
  }

  /**
   * Rebuild ChatGPT code blocks inside a popup response div into clean,
   * self-contained blocks with working Copy buttons.
   */
  function rebuildCodeBlocks(responseDiv) {
    // First, handle any previously-rebuilt .jr-code-block elements (from stored HTML).
    // These have dead buttons (event listeners lost on serialize/deserialize).
    // Rewire their Copy buttons with fresh handlers.
    var existingBlocks = responseDiv.querySelectorAll(".jr-code-block");
    for (var eb = 0; eb < existingBlocks.length; eb++) {
      var block = existingBlocks[eb];
      var oldBtns = block.querySelector(".jr-code-header-btns");
      if (oldBtns) oldBtns.remove();
      var btnsDiv = document.createElement("div");
      btnsDiv.className = "jr-code-header-btns";
      wireCopyButton(btnsDiv);
      var header = block.querySelector(".jr-code-header");
      if (header) header.appendChild(btnsDiv);
    }

    // Now handle fresh ChatGPT <pre> elements (not yet inside .jr-code-block)
    var pres = responseDiv.querySelectorAll("pre");
    for (var p = 0; p < pres.length; p++) {
      if (pres[p].closest(".jr-code-block")) continue;

      var pre = pres[p];
      var wrapper = pre.closest(".contain-inline-size") || pre;
      if (!responseDiv.contains(wrapper)) wrapper = pre;

      // Detect language from wrapper text outside pre/code
      var lang2 = "";
      if (wrapper !== pre) {
        var spans = wrapper.querySelectorAll("span");
        for (var s = 0; s < spans.length; s++) {
          if (spans[s].closest("pre") || spans[s].closest("code")) continue;
          var t = (spans[s].textContent || "").trim();
          if (t && t.length < 30 && t.indexOf("Copy") === -1 && t.indexOf("Run") === -1) {
            lang2 = t;
            break;
          }
        }
      }

      var codeEl = pre.querySelector("code");
      buildCleanCodeBlock(codeEl, pre, lang2, wrapper);
    }
  }

  function buildCleanCodeBlock(codeEl, pre, lang, replaceTarget) {
    // Extract pure code text. ChatGPT embeds toolbar (language label, Copy/Run buttons)
    // inside the <code> element's DOM tree. Strategy: get full textContent, then strip
    // the known toolbar prefix pattern from the start.
    var source = codeEl || pre;
    var fullText = source.textContent;

    // Detect language from <code> class (ChatGPT sets "language-java", "language-python", etc.)
    if (!lang && codeEl) {
      var classLang = (codeEl.className || "").match(/language-(\w+)/);
      if (classLang) {
        // Capitalize first letter to match toolbar text: "java" → "Java"
        lang = classLang[1].charAt(0).toUpperCase() + classLang[1].slice(1);
      }
    }

    // Build list of toolbar labels to strip from the start of the text.
    var toolbarLabels = ["Copy code", "Copied!", "Copy", "Run"];
    if (lang) toolbarLabels.unshift(lang);

    // If lang still not detected, try regex: capitalized word before "Copy"/"Run"
    if (!lang) {
      var langMatch = fullText.match(/^([A-Z][a-zA-Z+#.]*?)(?:Copy|Run|Copied)/);
      if (langMatch) {
        lang = langMatch[1];
        toolbarLabels.unshift(lang);
      }
    }

    // Last resort: if text starts with a capitalized word that isn't valid code,
    // check against known language names
    if (!lang) {
      var knownLangs = ["Python", "Java", "JavaScript", "TypeScript", "Ruby", "Go",
        "Rust", "PHP", "HTML", "CSS", "SQL", "Bash", "Shell", "Kotlin", "Swift",
        "Scala", "Perl", "Lua", "Dart", "Matlab", "Haskell", "Elixir", "Clojure"];
      for (var kl = 0; kl < knownLangs.length; kl++) {
        if (fullText.indexOf(knownLangs[kl]) === 0) {
          lang = knownLangs[kl];
          toolbarLabels.unshift(lang);
          break;
        }
      }
    }

    // Strip toolbar labels from the start, repeatedly (order varies)
    var stripped = fullText;
    var changed = true;
    while (changed) {
      changed = false;
      stripped = stripped.replace(/^\s+/, "");
      for (var tl = 0; tl < toolbarLabels.length; tl++) {
        if (stripped.indexOf(toolbarLabels[tl]) === 0) {
          stripped = stripped.substring(toolbarLabels[tl].length);
          changed = true;
        }
      }
    }
    var codeText = stripped.trim();
    var codeClass = codeEl ? codeEl.className : "";

    // Build clean block
    var block = document.createElement("div");
    block.className = "jr-code-block";

    // Header: language label + buttons
    var header = document.createElement("div");
    header.className = "jr-code-header";

    var langSpan = document.createElement("span");
    langSpan.className = "jr-code-lang";
    langSpan.textContent = lang || "";
    header.appendChild(langSpan);

    var btnsDiv = document.createElement("div");
    btnsDiv.className = "jr-code-header-btns";
    wireCopyButton(btnsDiv);

    header.appendChild(btnsDiv);
    block.appendChild(header);

    // Code area
    var newPre = document.createElement("pre");
    var newCode = document.createElement("code");
    if (codeClass) newCode.className = codeClass;
    newCode.textContent = codeText;
    newPre.appendChild(newCode);
    block.appendChild(newPre);

    // Replace the entire ChatGPT wrapper
    if (replaceTarget && replaceTarget.parentElement) {
      replaceTarget.parentElement.insertBefore(block, replaceTarget);
      replaceTarget.remove();
    }
  }

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

  function buildInputRow(container, text, sentence, blockTypes, wrappers, parentId) {
    var popup = container.closest(".jr-popup");
    var questionDiv = document.createElement("div");
    questionDiv.className = "jr-popup-question";

    var inputInner = document.createElement("div");
    inputInner.className = "jr-popup-question-inner";

    var inputChevron = document.createElement("span");
    inputChevron.className = "jr-popup-question-chevron";
    inputChevron.innerHTML = CHEVRON_RIGHT_SVG;
    inputInner.appendChild(inputChevron);

    var questionText = document.createElement("span");
    questionText.className = "jr-popup-question-text";
    questionText.contentEditable = "true";
    questionText.setAttribute("data-placeholder", "Ask a follow-up\u2026");
    questionText.addEventListener("paste", function (e) {
      e.preventDefault();
      var text = (e.clipboardData || window.clipboardData).getData("text/plain");
      document.execCommand("insertText", false, text);
    });
    inputInner.appendChild(questionText);
    questionDiv.appendChild(inputInner);

    // Send wrapper with click-to-send + switch mode button
    var sendWrapper = document.createElement("div");
    sendWrapper.className = "jr-edit-send-wrapper";

    var sendBtn = document.createElement("button");
    sendBtn.type = "button";
    sendBtn.className = "jr-popup-edit-send";
    sendBtn.innerHTML = SEND_SVG;
    sendBtn.disabled = true;
    sendWrapper.appendChild(sendBtn);

    var switchBtn = document.createElement("div");
    switchBtn.className = "jr-send-switch-btn jr-disabled";
    function updateSwitchLabel() {
      var other = st.responseMode === "brief" ? "Elaborate" : "Brief";
      switchBtn.innerHTML = '<span class="jr-switch-inner">' + SWITCH_SVG + other + '</span>';
    }
    updateSwitchLabel();
    sendWrapper.appendChild(switchBtn);
    questionDiv.appendChild(sendWrapper);
    container.appendChild(questionDiv);

    function doSend(mode) {
      var question = questionText.textContent.trim();
      if (!question) return;

      st.responseMode = mode;

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
        message += "\n\n(Ignore any previous instructions about brevity \u2014 respond normally.)";
      }

      var turnsBefore = document.querySelectorAll(S.aiTurn).length;

      questionDiv.remove();
      // Re-add as non-editable question display
      var displayDiv = document.createElement("div");
      displayDiv.className = "jr-popup-question";
      var displayInner = document.createElement("div");
      displayInner.className = "jr-popup-question-inner";
      var displayChevron = document.createElement("span");
      displayChevron.className = "jr-popup-question-chevron";
      displayChevron.innerHTML = CHEVRON_RIGHT_SVG;
      displayInner.appendChild(displayChevron);
      var displayText = document.createElement("span");
      displayText.className = "jr-popup-question-text";
      displayText.textContent = question;
      displayInner.appendChild(displayText);
      displayDiv.appendChild(displayInner);
      var loadingDiv = JR.createLoadingDiv();
      container.appendChild(displayDiv);
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

    // Click send arrow → send with current default mode
    sendBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var current = questionText.textContent.trim();
      if (!current) return;
      doSend(st.responseMode);
    });

    // Click switch button → switch mode and send
    switchBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var current = questionText.textContent.trim();
      if (!current) return;
      var newMode = st.responseMode === "brief" ? "regular" : "brief";
      doSend(newMode);
    });

    // Track input to enable/disable send + switch
    questionText.addEventListener("input", function () {
      var current = questionText.textContent.trim();
      if (!current && questionText.innerHTML !== "") {
        questionText.innerHTML = "";
      }
      var empty = !current;
      sendBtn.disabled = empty;
      if (empty) {
        switchBtn.classList.add("jr-disabled");
      } else {
        switchBtn.classList.remove("jr-disabled");
      }
    });

    // Block Enter in question input (send via button only)
    questionText.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
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

  var PENCIL_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M230.14,70.54,185.46,25.85a20,20,0,0,0-28.29,0L33.86,149.17A19.85,19.85,0,0,0,28,163.31V208a20,20,0,0,0,20,20H92.69a19.86,19.86,0,0,0,14.14-5.86L230.14,98.82a20,20,0,0,0,0-28.28ZM91,204H52V165l84-84,39,39ZM192,103,153,64l18.34-18.34,39,39Z"/></svg>';

  var TRASH_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM192,208H64V64H192ZM80,24a8,8,0,0,1,8-8h80a8,8,0,0,1,0,16H88A8,8,0,0,1,80,24Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H40a12,12,0,0,0,0,24h4V208a20,20,0,0,0,20,20H192a20,20,0,0,0,20-20V72h4a12,12,0,0,0,0-24ZM188,204H68V72H188ZM76,20A12,12,0,0,1,88,8h80a12,12,0,0,1,0,24H88A12,12,0,0,1,76,20Z"/></svg>';

  /**
   * Build the toolbar DOM for a given highlight. Re-creates each time
   * because the hlId / entry may change on each hover.
   */
  function applyColorToHighlight(color, entry, hlId) {
    var colors = JR.HIGHLIGHT_COLORS;
    var spans = entry.spans;
    for (var s = 0; s < spans.length; s++) {
      for (var c = 0; c < colors.length; c++) {
        spans[s].classList.remove("jr-highlight-color-" + colors[c]);
      }
      spans[s].classList.add("jr-highlight-color-" + color);
    }
    if (st.activePopup && st.activeHighlightId === hlId) {
      var marks = st.activePopup.querySelectorAll(".jr-popup-mark");
      for (var m = 0; m < marks.length; m++) {
        for (var c2 = 0; c2 < colors.length; c2++) {
          marks[m].classList.remove("jr-highlight-color-" + colors[c2]);
        }
        marks[m].classList.add("jr-highlight-color-" + color);
      }
    }
  }

  function buildToolbarEl(hlId, entry, opts) {
    opts = opts || {};
    var toolbar = document.createElement("div");
    toolbar.className = "jr-popup-toolbar";

    var colors = JR.HIGHLIGHT_COLORS;

    for (var i = 0; i < colors.length; i++) {
      (function (color) {
        var swatch = document.createElement("div");
        swatch.className = "jr-toolbar-swatch jr-toolbar-swatch--" + color;
        if (color === (entry.color || "blue")) swatch.classList.add("jr-toolbar-swatch--active");
        swatch.addEventListener("click", function (e) {
          e.stopPropagation();
          entry.color = color;
          // Sync to _jrAutoColor so captureResponse picks up color for new highlights
          if (entry.spans && entry.spans.length > 0) {
            entry.spans[0]._jrAutoColor = color;
          }
          var swatches = toolbar.querySelectorAll(".jr-toolbar-swatch");
          for (var sw = 0; sw < swatches.length; sw++) {
            swatches[sw].classList.remove("jr-toolbar-swatch--active");
          }
          swatch.classList.add("jr-toolbar-swatch--active");
          applyColorToHighlight(color, entry, hlId);
          if (!entry._jrTemp) updateHighlightColor(hlId, color);
        });
        toolbar.appendChild(swatch);
      })(colors[i]);
    }

    if (!opts.hideTrash) {
      var trashBtn = document.createElement("button");
      trashBtn.type = "button";
      trashBtn.className = "jr-toolbar-delete";
      trashBtn.innerHTML = TRASH_SVG;
      trashBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        showDeleteConfirmation(hlId, entry);
      });
      toolbar.appendChild(trashBtn);
    }

    // Stop mousedown from propagating so click-outside doesn't dismiss popup
    toolbar.addEventListener("mousedown", function (e) {
      e.stopPropagation();
    });

    return toolbar;
  }

  /**
   * Show toolbar — now embedded inline in the popup, so this is a no-op.
   * Kept for backward compatibility with callers.
   */
  JR.showToolbar = function () {};

  /**
   * Hide the floating toolbar.
   */
  /**
   * Hide toolbar — now embedded inline in the popup, so this is a no-op.
   */
  JR.hideToolbar = function () {};

  /**
   * Position the floating toolbar near the highlight.
   * If a popup is open for this highlight, goes on the opposite side.
   * Otherwise defaults to above the highlight.
   */
  /**
   * Position toolbar — now inline, so this is a no-op.
   */
  JR.positionToolbar = function () {};


  function showDeleteConfirmation(hlId, entry) {
    if (!st.activePopup) return;
    var popup = st.activePopup;

    st.confirmingDelete = true;
    JR.updateNavDisabled();

    // Build confirm card inside the popup (after counting descendants)
    countDescendants(hlId).then(function (count) {
      // Save popup children so we can restore on cancel (done inside .then to avoid empty-frame flicker)
      // Clone the arrow so the confirm view has one too
      var arrowEl = popup.querySelector(".jr-popup-arrow");
      var arrowClone = arrowEl ? arrowEl.cloneNode(true) : null;
      var savedChildren = [];
      while (popup.firstChild) {
        savedChildren.push(popup.removeChild(popup.firstChild));
      }
      if (arrowClone) popup.appendChild(arrowClone);
      var confirmCard = document.createElement("div");
      confirmCard.className = "jr-popup-upper jr-popup-delete-confirm";

      var text = document.createElement("div");
      text.className = "jr-popup-confirm-text";
      if (count === 0) {
        text.textContent = "Delete this highlight?";
      } else {
        text.textContent = "Delete this and " + count + " nested follow-up" + (count === 1 ? "" : "s") + "?";
      }

      var cancelBtn = document.createElement("button");
      cancelBtn.type = "button";
      cancelBtn.className = "jr-popup-confirm-icon-btn";
      cancelBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M208.49,191.51a12,12,0,0,1-17,17L128,145,64.49,208.49a12,12,0,0,1-17-17L111,128,47.51,64.49a12,12,0,0,1,17-17L128,111l63.51-63.52a12,12,0,0,1,17,17L145,128Z"/></svg>';
      cancelBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        st.confirmingDelete = false;
        JR.updateNavDisabled();
        // Restore popup content — keep current left, only adjust top for "above" popups
        var savedLeft = popup.style.left;
        while (popup.firstChild) popup.removeChild(popup.firstChild);
        for (var ri = 0; ri < savedChildren.length; ri++) {
          popup.appendChild(savedChildren[ri]);
        }
        popup.style.left = savedLeft;
        var dir = popup._jrLockedDirection || popup._jrDirection;
        if (dir === "above" && st.activeSourceHighlights.length > 0 && popup.parentElement) {
          var hRect = JR.getHighlightRect(st.activeSourceHighlights);
          var cRect = popup.parentElement.getBoundingClientRect();
          popup.style.top = (hRect.top - cRect.top - popup.offsetHeight - 8) + "px";
        }
      });

      var deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "jr-popup-confirm-icon-btn jr-popup-confirm-icon-btn--danger";
      deleteBtn.innerHTML = '<svg viewBox="0 0 256 256" fill="currentColor"><path d="M232.49,80.49l-128,128a12,12,0,0,1-17,0l-56-56a12,12,0,1,1,17-17L96,183,215.51,63.51a12,12,0,0,1,17,17Z"/></svg>';
      deleteBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        st.confirmingDelete = false;
        executeDelete(hlId);
      });

      confirmCard.appendChild(text);
      confirmCard.appendChild(cancelBtn);
      confirmCard.appendChild(deleteBtn);

      popup.appendChild(confirmCard);
      // Keep horizontal position — only adjust top for "above" popups
      var dir = popup._jrLockedDirection || popup._jrDirection;
      if (dir === "above" && st.activeSourceHighlights.length > 0 && popup.parentElement) {
        var hRect = JR.getHighlightRect(st.activeSourceHighlights);
        var cRect = popup.parentElement.getBoundingClientRect();
        var gap = 8;
        popup.style.top = (hRect.top - cRect.top - popup.offsetHeight - gap) + "px";
      }
    });
  }

  function executeDelete(hlId) {
    st.confirmingDelete = false;
    var quoteIdsToDelete = [];
    function walkDescendants(parentQuoteId) {
      quoteIdsToDelete.push(parentQuoteId);
      st.completedHighlights.forEach(function (entry, qid) {
        if (entry.parentId === parentQuoteId) {
          walkDescendants(qid);
        }
      });
    }
    walkDescendants(hlId);

    // Collect all turn indices to persist as hidden, then unwrap spans
    var turnsToHide = [];

    for (var i = 0; i < quoteIdsToDelete.length; i++) {
      var qid = quoteIdsToDelete[i];
      var entry = st.completedHighlights.get(qid);
      if (!entry) continue;

      // Collect turn indices from in-memory items
      if (entry.items && entry.items.length > 0) {
        for (var vi = 0; vi < entry.items.length; vi++) {
          if (entry.items[vi].questionIndex > 0) turnsToHide.push(entry.items[vi].questionIndex);
          if (entry.items[vi].responseIndex > 0) turnsToHide.push(entry.items[vi].responseIndex);
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

      st.completedHighlights.delete(qid);
    }

    // Also collect turn indices from storage (covers items not in memory)
    var storagePromises = quoteIdsToDelete.map(function (delQuoteId) {
      return getHighlightsByQuoteId(delQuoteId).then(function (items) {
        for (var si = 0; si < items.length; si++) {
          if (items[si].questionIndex > 0) turnsToHide.push(items[si].questionIndex);
          if (items[si].responseIndex > 0) turnsToHide.push(items[si].responseIndex);
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
    JR.updateNavWidget();
  }

  function buildVersionNavInline(container, hlId) {
    var popup = container.closest(".jr-popup");
    var entry = st.completedHighlights.get(hlId);
    if (!entry || !entry.items || entry.items.length <= 1) return null;

    var nav = document.createElement("div");
    nav.className = "jr-popup-version-nav";

    var prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.className = "jr-popup-version-prev";
    prevBtn.innerHTML = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M168.49,199.51a12,12,0,0,1-17,17l-80-80a12,12,0,0,1,0-17l80-80a12,12,0,0,1,17,17L97,128Z"/></svg>';

    var nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.className = "jr-popup-version-next";
    nextBtn.innerHTML = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M184.49,136.49l-80,80a12,12,0,0,1-17-17L159,128,87.51,56.49a12,12,0,1,1,17-17l80,80A12,12,0,0,1,184.49,136.49Z"/></svg>';

    nav.appendChild(prevBtn);
    nav.appendChild(nextBtn);

    function updateNav() {
      var idx = entry.activeItemIndex != null ? entry.activeItemIndex : entry.items.length - 1;
      prevBtn.disabled = (idx === 0);
      nextBtn.disabled = (idx === entry.items.length - 1);
    }

    function switchVersion(newIdx) {
      entry.activeItemIndex = newIdx;
      var v = entry.items[newIdx];
      entry.question = v.question;
      entry.responseHTML = v.responseHTML;
      setActiveItem(hlId, v.id);

      // Update question text
      var qText = container.querySelector(".jr-popup-question-text");
      if (qText) qText.textContent = v.question || "";

      // Replace response
      var oldResp = popup.querySelector(".jr-popup-response");
      if (oldResp) oldResp.remove();

      if (v.responseHTML) {
        var responseDiv = document.createElement("div");
        responseDiv.className = "jr-popup-response";
        responseDiv.innerHTML = v.responseHTML;
        popup.appendChild(responseDiv);
        rebuildCodeBlocks(responseDiv, v.responseIndex || entry.responseIndex);

        restoreChainedHighlights(responseDiv, hlId, entry.contentContainer, v.id);
      }

      updateNav();

      // Only update arrow — don't recalculate left/top which would
      // reset any user resize/position adjustments.
      if (st.activeSourceHighlights.length > 0 && popup.parentElement) {
        var rect = JR.getHighlightRect(st.activeSourceHighlights);
        var cRect = popup.parentElement.getBoundingClientRect();
        var left = parseFloat(popup.style.left) || 0;
        JR.updateArrow(popup, rect, cRect, left);
      }
    }

    prevBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var idx = entry.activeItemIndex != null ? entry.activeItemIndex : entry.items.length - 1;
      if (idx > 0) switchVersion(idx - 1);
    });

    nextBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      var idx = entry.activeItemIndex != null ? entry.activeItemIndex : entry.items.length - 1;
      if (idx < entry.items.length - 1) switchVersion(idx + 1);
    });

    updateNav();

    // Expose a direct-jump function so external code (Cmd+F search)
    // can switch to any version in one shot without clicking arrows.
    nav._jrSwitchTo = switchVersion;

    return nav;
  }

  /**
   * Public: jump the currently-open popup to a specific version index.
   * Uses the version nav's internal switchVersion — single DOM update,
   * no flickering from repeated button clicks.
   */
  JR.switchPopupToVersion = function (hlId, targetVersion) {
    if (!st.activePopup) return;
    var entry = st.completedHighlights.get(hlId);
    if (!entry || !entry.items || entry.items.length <= 1) return;
    var current = entry.activeItemIndex != null ? entry.activeItemIndex : entry.items.length - 1;
    if (current === targetVersion) return;

    var nav = st.activePopup.querySelector(".jr-popup-version-nav");
    if (nav && nav._jrSwitchTo) {
      nav._jrSwitchTo(targetVersion);
    }
  };

  function restoreChainedHighlights(responseDiv, parentQuoteId, contentContainer, activeParentItemId) {
    // Restore from in-memory entries — only children belonging to this version
    st.completedHighlights.forEach(function (chEntry, chQuoteId) {
      if (chEntry.parentId !== parentQuoteId) return;
      if (activeParentItemId && chEntry.parentItemId && chEntry.parentItemId !== activeParentItemId) return;
      JR.restoreHighlightInElement(responseDiv, {
        quoteId: chQuoteId, text: chEntry.text, responseHTML: chEntry.responseHTML,
        sentence: chEntry.sentence, blockTypes: chEntry.blockTypes, question: chEntry.question,
        parentId: chEntry.parentId, parentItemId: chEntry.parentItemId,
        responseIndex: chEntry.responseIndex,
        items: chEntry.items, activeItemIndex: chEntry.activeItemIndex,
      }, contentContainer);
    });
    // Also check storage for children not yet in memory
    getChildHighlights(parentQuoteId, activeParentItemId).then(function (children) {
      for (var ci = 0; ci < children.length; ci++) {
        var child = children[ci];
        var childKey = child.quoteId || child.id;
        if (responseDiv.querySelector('[data-jr-highlight-id="' + childKey + '"]')) continue;
        JR.restoreHighlightInElement(responseDiv, child, contentContainer);
      }
    });
  }

  var SEND_SVG = '<svg class="jr-icon-reg" viewBox="0 0 256 256" fill="currentColor"><path d="M221.66,133.66l-72,72a8,8,0,0,1-11.32-11.32L196.69,136H40a8,8,0,0,1,0-16H196.69L138.34,61.66a8,8,0,0,1,11.32-11.32l72,72A8,8,0,0,1,221.66,133.66Z"/></svg><svg class="jr-icon-bold" viewBox="0 0 256 256" fill="currentColor"><path d="M224.49,136.49l-72,72a12,12,0,0,1-17-17L187,140H40a12,12,0,0,1,0-24H187L135.51,64.48a12,12,0,0,1,17-17l72,72A12,12,0,0,1,224.49,136.49Z"/></svg>';

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
      message += "\n\n(Ignore any previous instructions about brevity \u2014 respond normally.)";
    }

    var turnsBefore = document.querySelectorAll(S.aiTurn).length;

    var scrollAnchor = entry.spans.length > 0 ? entry.spans[0] : document.body;
    var chatScrollParent = JR.getScrollParent(scrollAnchor);
    var unlockScroll = JR.lockScroll(chatScrollParent, scrollAnchor);

    JR.injectAndSend(message);
    setTimeout(JR.repositionPopup, 300);

    JR.waitForResponse(popup, turnsBefore, text, sentence, entry.blockTypes, unlockScroll, entry.parentId, newQuestion, { hlId: hlId });
  }

  function showCompletedResponse(popup, upper, id, entry, contentContainer) {
    // Show the question with inline edit toggle
    if (entry.question) {
      var questionDiv = document.createElement("div");
      questionDiv.className = "jr-popup-question jr-popup-question--editable";

      var questionInner = document.createElement("div");
      questionInner.className = "jr-popup-question-inner";

      var chevronSpan = document.createElement("span");
      chevronSpan.className = "jr-popup-question-chevron";
      chevronSpan.innerHTML = CHEVRON_RIGHT_SVG;
      questionInner.appendChild(chevronSpan);

      var questionText = document.createElement("span");
      questionText.className = "jr-popup-question-text";
      questionText.textContent = entry.question;
      questionText.addEventListener("paste", function (e) {
        e.preventDefault();
        var t = (e.clipboardData || window.clipboardData).getData("text/plain");
        document.execCommand("insertText", false, t);
      });
      questionInner.appendChild(questionText);
      questionDiv.appendChild(questionInner);

      // Right-side controls container
      var controlsDiv = document.createElement("div");
      controlsDiv.className = "jr-popup-question-controls";

      // Version nav (inline, shown by default if multiple items exist)
      var hasVersions = entry.items && entry.items.length > 1;
      var versionNav = null;
      if (hasVersions) {
        versionNav = buildVersionNavInline(upper, id);
        controlsDiv.appendChild(versionNav);
      }

      // Send wrapper (hidden until edit mode)
      var sendWrapper = document.createElement("div");
      sendWrapper.className = "jr-edit-send-wrapper";
      sendWrapper.style.display = "none";

      var sendBtn = document.createElement("button");
      sendBtn.type = "button";
      sendBtn.className = "jr-popup-edit-send";
      sendBtn.innerHTML = SEND_SVG;
      sendBtn.disabled = true;
      sendWrapper.appendChild(sendBtn);

      var switchBtn = document.createElement("div");
      switchBtn.className = "jr-send-switch-btn jr-disabled";
      function updateEditSwitchLabel() {
        var other = st.responseMode === "brief" ? "Elaborate" : "Brief";
        switchBtn.innerHTML = '<span class="jr-switch-inner">' + SWITCH_SVG + other + '</span>';
      }
      updateEditSwitchLabel();
      sendWrapper.appendChild(switchBtn);
      controlsDiv.appendChild(sendWrapper);

      questionDiv.appendChild(controlsDiv);

      var editing = false;
      var originalText = entry.question;
      var lastCaretRange = null;

      // Track caret position on mousemove for click-to-edit placement
      questionText.addEventListener("mousemove", function (e) {
        if (editing || st.cancelResponseWatch) { lastCaretRange = null; return; }
        var caretRange = document.caretRangeFromPoint(e.clientX, e.clientY);
        if (!caretRange || !questionText.contains(caretRange.startContainer)) {
          lastCaretRange = null;
          return;
        }
        lastCaretRange = caretRange;
      });

      questionText.addEventListener("mouseleave", function () {
        lastCaretRange = null;
      });

      function enterEditMode(clickEvent) {
        if (editing) return;
        // Block editing while a response is still generating
        if (st.cancelResponseWatch) return;
        editing = true;
        originalText = questionText.textContent.trim();
        questionDiv.classList.add("jr-popup-question--editing");
        questionText.contentEditable = "true";
        questionText.focus();
        // Place caret at click position if available
        var sel = window.getSelection();
        if (clickEvent && lastCaretRange) {
          var range = document.createRange();
          try {
            range.setStart(lastCaretRange.startContainer, lastCaretRange.startOffset);
            range.collapse(true);
            sel.removeAllRanges();
            sel.addRange(range);
          } catch (ex) {
            range.selectNodeContents(questionText);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } else {
          var range = document.createRange();
          range.selectNodeContents(questionText);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        lastCaretRange = null;
        if (versionNav) versionNav.style.display = "none";
        sendWrapper.style.display = "";
        sendBtn.disabled = true;
        switchBtn.classList.add("jr-disabled");
        updateEditSwitchLabel();
      }

      function exitEditMode() {
        if (!editing) return;
        editing = false;
        questionDiv.classList.remove("jr-popup-question--editing");
        questionText.contentEditable = "false";
        questionText.textContent = originalText;
        if (versionNav) versionNav.style.display = "";
        sendWrapper.style.display = "none";
        sendBtn.disabled = true;
        switchBtn.classList.add("jr-disabled");
      }

      // Click on question text → enter edit mode at click position
      questionText.addEventListener("click", function (e) {
        if (!editing) {
          e.stopPropagation();
          enterEditMode(e);
        }
      });

      // Track text changes to enable/disable send
      questionText.addEventListener("input", function () {
        var current = questionText.textContent.trim();
        var unchanged = (current === originalText || current === "");
        sendBtn.disabled = unchanged;
        if (unchanged) {
          switchBtn.classList.add("jr-disabled");
        } else {
          switchBtn.classList.remove("jr-disabled");
        }
      });

      // Blur exits edit mode
      questionText.addEventListener("blur", function (e) {
        // Don't exit if clicking send or switch
        if (e.relatedTarget && (e.relatedTarget === sendBtn || e.relatedTarget.closest(".jr-send-switch-btn"))) return;
        setTimeout(function () { exitEditMode(); }, 150);
      });

      // Block Enter, Escape cancels
      questionText.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          exitEditMode();
        }
      });

      sendBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var current = questionText.textContent.trim();
        if (!current || current === originalText) return;
        submitEdit(popup, id, entry, contentContainer, current, st.responseMode);
      });

      switchBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        var current = questionText.textContent.trim();
        if (!current || current === originalText) return;
        var newMode = st.responseMode === "brief" ? "regular" : "brief";
        st.responseMode = newMode;
        submitEdit(popup, id, entry, contentContainer, current, newMode);
      });

      upper.appendChild(questionDiv);
    }

    // Remove any stale loading div before adding response
    var staleLoading = popup.querySelector(".jr-popup-loading");
    if (staleLoading) staleLoading.remove();

    if (entry.responseHTML) {
      var responseDiv = document.createElement("div");
      responseDiv.className = "jr-popup-response";
      responseDiv.innerHTML = entry.responseHTML;
      popup.appendChild(responseDiv);
      rebuildCodeBlocks(responseDiv, entry.responseIndex);

      // Restore chained highlights — only those belonging to the active version
      var activeItem = (entry.items && entry.items.length > 0)
        ? entry.items[entry.activeItemIndex != null ? entry.activeItemIndex : 0]
        : null;
      restoreChainedHighlights(responseDiv, id, contentContainer, activeItem ? activeItem.id : null);
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
  JR.wireCopyButtons = rebuildCodeBlocks;

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
    var autoColor = null;
    if (!isCompleted && range) {
      wrappers = JR.highlightRange(range);
      st.activeSourceHighlights = wrappers;

      // Detect overlapping highlights and pick a distinct color immediately
      autoColor = JR.pickNonConflictingColor(wrappers);
      if (autoColor) {
        for (var ac = 0; ac < wrappers.length; ac++) {
          wrappers[ac].classList.add("jr-highlight-color-" + autoColor);
        }
        // Stash for captureResponse to read later
        if (wrappers.length > 0) wrappers[0]._jrAutoColor = autoColor;
      }
    }

    // --- Create popup element ---
    var popup = document.createElement("div");
    popup.className = "jr-popup";
    popup._jrChained = isChained;
    var w = isChained ? st.customPopupWidthChained : st.customPopupWidthL1;
    if (w) popup.style.width = w + "px";

    // --- Upper card (toolbar + highlight + question) ---
    var upper = document.createElement("div");
    upper.className = "jr-popup-upper";
    popup.appendChild(upper);

    // --- Inline color toolbar (above blockquote, left-aligned) ---
    if (st.activeHighlightId || (isCompleted && completedId) || (wrappers && wrappers.length > 0)) {
      var toolbarHlId = isCompleted ? completedId : null;
      var toolbarEntry = isCompleted ? entry : null;
      // Defer building for new highlights — they get a temp ID after this block
      if (toolbarHlId && toolbarEntry) {
        var inlineToolbar = buildToolbarEl(toolbarHlId, toolbarEntry);
        inlineToolbar.classList.add("jr-toolbar-inline");
        upper.appendChild(inlineToolbar);
        popup._jrInlineToolbar = inlineToolbar;
      } else {
        popup._jrDeferToolbar = true;
      }
    }

    // --- Context blockquote ---
    var highlight = document.createElement("div");
    highlight.className = "jr-popup-highlight";
    var highlightInner = document.createElement("div");
    highlightInner.className = "jr-popup-highlight-inner";
    if (sentence) {
      JR.renderSentenceContext(highlightInner, sentence, text, blockTypes);
    } else {
      highlightInner.textContent = JR.truncateText(text, JR.MAX_DISPLAY_CHARS);
    }
    highlight.appendChild(highlightInner);
    upper.appendChild(highlight);

    // --- Apply color to blockquote marks ---
    var markColor = isCompleted ? (entry.color || null) : autoColor;
    if (markColor) {
      var marks = highlight.querySelectorAll(".jr-popup-mark");
      for (var mi = 0; mi < marks.length; mi++) {
        marks[mi].classList.add("jr-highlight-color-" + markColor);
      }
    }

    // --- Body: input row (new) or response HTML (completed) ---
    if (isCompleted) {
      showCompletedResponse(popup, upper, completedId, entry, resolveContentContainer(wrappers, isChained, entry));
    } else {
      buildInputRow(upper, text, sentence, blockTypes, wrappers, parentId);
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

    JR.positionPopup(popup, posRect, contentContainer, null, spans);
    JR.attachAboveAnchorObserver(popup);
    JR.addResizeHandlers(popup);

    // --- Register active state ---
    st.activePopup = popup;
    st.activeSourceHighlights = isCompleted ? entry.spans : wrappers;
    if (isCompleted) {
      st.activeHighlightId = completedId;
    } else if (wrappers.length > 0) {
      // Create a temporary entry so the color toolbar works on new highlights
      var tempId = "temp-" + Date.now();
      for (var ti = 0; ti < wrappers.length; ti++) {
        wrappers[ti].setAttribute("data-jr-highlight-id", tempId);
      }
      st.completedHighlights.set(tempId, {
        quoteId: tempId,
        spans: wrappers,
        color: autoColor || null,
        text: text,
        sentence: sentence,
        blockTypes: blockTypes,
        contentContainer: contentContainer,
        parentId: parentId || null,
        items: [],
        activeItemIndex: 0,
        _jrTemp: true,
      });
      st.activeHighlightId = tempId;
    } else {
      st.activeHighlightId = null;
    }
    JR.syncHighlightActive(st.activeHighlightId);

    // --- Build inline toolbar for new (temp) highlights ---
    if (popup._jrDeferToolbar && st.activeHighlightId) {
      var deferEntry = st.completedHighlights.get(st.activeHighlightId);
      if (deferEntry) {
        var deferToolbar = buildToolbarEl(st.activeHighlightId, deferEntry, { hideTrash: true });
        deferToolbar.classList.add("jr-toolbar-inline");
        var upperCard = popup.querySelector(".jr-popup-upper");
        if (upperCard) upperCard.insertBefore(deferToolbar, upperCard.firstChild);
        popup._jrInlineToolbar = deferToolbar;
      }
      delete popup._jrDeferToolbar;
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

    JR.updateNavWidget();
  };

  /**
   * Rebuild a completed popup after an edit response is captured.
   * Called from chat.js captureResponse when editOpts is present.
   */
  JR.rebuildPopupAfterEdit = function (popup, hlId) {
    var entry = st.completedHighlights.get(hlId);
    if (!entry) return;

    // Find the upper card and strip question/version nav from it
    var upper = popup.querySelector(".jr-popup-upper");
    if (upper) {
      var questionDiv = upper.querySelector(".jr-popup-question");
      if (questionDiv) questionDiv.remove();
      var versionNav = upper.querySelector(".jr-popup-version-nav");
      if (versionNav) versionNav.remove();
    }

    // Remove response and loading divs from popup (outside upper)
    var children = Array.from(popup.children);
    for (var i = 0; i < children.length; i++) {
      var cl = children[i].classList;
      if (!cl.contains("jr-popup-upper") && !cl.contains("jr-popup-arrow")) {
        children[i].remove();
      }
    }

    showCompletedResponse(popup, upper, hlId, entry, entry.contentContainer);
    JR.repositionPopup();
  };
})();
