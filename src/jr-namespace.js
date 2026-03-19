// jr-namespace.js — Shared namespace, constants, and mutable state for Jump Return
(function () {
  "use strict";

  window.JR = {
    // --- Constants ---
    SELECTORS: {
      aiTurn: '[data-testid^="conversation-turn-"]',
      aiLabel: "h4.sr-only",
      chatInput: 'div[contenteditable="true"]',
      sendButton: 'button[data-testid="send-button"]',
      stopButton: 'button[data-testid="stop-button"]',
      responseContent: ".markdown",
    },

    AI_LABEL_TEXT: "ChatGPT said:",
    MAX_DISPLAY_CHARS: 120,

    BLOCK_TAGS: new Set([
      "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6",
      "PRE", "BLOCKQUOTE", "TD", "TH",
    ]),

    SENTENCE_TERMINATORS: [".", "?", "!", "\u3002", "\uFF1F", "\uFF01"],

    HIGHLIGHT_COLORS: ["blue", "yellow", "green", "pink", "purple"],

    // --- Shared mutable state ---
    state: {
      activePopup: null,
      responseMode: "regular",          // "regular" or "brief"
      cancelResponseWatch: null,
      responseWatchActive: false,       // true while waitForResponse is polling (including detached)
      activeSourceHighlights: [],       // wrapper <span> elements in the AI response
      resizeHandler: null,              // window resize listener
      completedHighlights: new Map(),   // quoteId → { quoteId, spans, text, sentence, items: [{id, question, responseHTML, ...}], activeItemIndex, ... }
      activeHighlightId: null,          // current popup's highlight id (for chaining)
      popupStack: [],                   // saved parent popup states for nested chains
      restoreTimer: null,
      lastKnownUrl: location.href,
      customPopupWidthL1: null,         // session-persisted width for level-1 popups
      customPopupWidthChained: null,    // session-persisted width for chained (level 2+) popups
      confirmingDelete: false,          // true while delete confirmation is showing
      navWidget: null,                  // floating highlight navigation widget element
      askBtnHidden: false,              // session flag — hides ChatGPT's native "Ask ChatGPT" button
      messageQueue: [],                  // queued messages waiting for generation to finish
    },
  };
})();
