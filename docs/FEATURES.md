# Features

## Current

### Highlight-to-Popup (Step 1 — ChatGPT only)
- Select any text inside a ChatGPT AI response to open a floating popup
- Popup displays the highlighted text (truncated to 120 characters) in a blockquote and provides a text input for follow-up questions
- Popup positions itself centered below the selection; flips above if it would overflow the viewport; clamps horizontally to stay on screen
- Dismisses on click outside, Escape key, or SPA navigation (route change)
- Send button and Enter key submit the follow-up question through ChatGPT's real chat input
- Dark mode support — automatically matches ChatGPT's theme

### Sentence Context Extraction (Step 1b)
- When text is highlighted, the extension extracts the full containing sentence(s) from the block-level ancestor (paragraph, list item, heading, etc.)
- If the selection spans multiple sentences, the context expands to cover all touched sentences (from start of first to end of last)
- Popup shows the full sentence context in a blockquote with the exact selection highlighted inline via a colored background mark
- If the selection equals the full sentence, only the plain blockquote is shown (no inline mark needed)
- Code blocks (`<pre>`) use the entire block as the "sentence" since periods aren't sentence boundaries in code
- Injected messages include both the context sentence and the exact quote for better AI context
- Cross-block selections (e.g. multiple bullet points) collect the full text of each selected block, joined with newlines
- Graceful fallback: if sentence extraction fails, the popup and message use the highlighted text alone

### Chat Injection (Step 2 — ChatGPT only)
- Follow-up question is formatted with the highlighted text quoted as context
- Message is injected into ChatGPT's ProseMirror contenteditable input and dispatched via native input event
- ChatGPT's send button is programmatically clicked after a short delay for React to process
- Graceful error handling: logs to console if chat input or send button is not found

### Response Length Toggle (Step 2b)
- Split send button: main area labeled "Regular" or "Brief" acts as the send button; small `▾` toggle opens a dropdown to switch modes
- Default mode: **Regular** — no extra instruction appended (AI responds normally)
- Brief mode appends a one-time instruction: "(For this response only: please keep it brief — 2-3 sentences. Do not carry this instruction forward to later messages.)"
- Mode persists across popups within the same page session; resets on page reload
- Dropdown appears above the split button, themed via CSS variables for light/dark mode

### Response Capture & Hide Q&A (Step 3 — ChatGPT only)
- After sending a follow-up question, the popup transitions to a loading state ("Waiting for response…")
- The extension polls for new conversation turns appearing in the DOM
- When the injected question turn appears, it is hidden from the main chat (`jr-hidden` class)
- When the AI response turn finishes streaming, it is also hidden from the main chat
- The AI response content (rendered markdown) is extracted and displayed inside the popup in a scrollable area (max 300px)
- The highlight and its Q&A turn numbers are saved to `chrome.storage.local`
- If the user dismisses the popup during loading (click outside or Escape), the watch is cancelled and any hidden turns are unhidden — the Q&A stays visible in the normal chat flow
- Timeout after 60 seconds: shows "Response timed out." and unhides turns
- On page reload, hidden turns reappear (persistence is handled in Step 4)

### Source Text Shadow Highlight & Popup Anchoring (Step 3b)
- When the popup opens from a text selection, the original source text in the AI response is wrapped in persistent highlight spans (`jr-source-highlight`) with a subtle blue tint matching the popup's inline mark
- The highlight remains visible even after the browser's native selection is cleared (e.g. when clicking into the popup's textarea)
- The popup is appended inside the chat's scroll container (not `document.body`), so it scrolls naturally with the content — no scroll/resize listeners or requestAnimationFrame jank
- Popup is positioned to the right of the highlight; falls back to the left side if there isn't enough space on the right
- When the highlight scrolls out of view, the popup scrolls away with it naturally (not stuck at the viewport edge)
- On popup dismiss (click outside, Escape, or SPA navigation), all highlight spans are unwrapped and the original DOM is restored cleanly, with text nodes normalized
- Works with selections spanning bold, italic, code, and other inline elements — each text segment gets its own wrapper
- Falls back gracefully if wrapping fails: popup still works, just without the visual source highlight
- Response detection uses the send button state: ChatGPT's send button disappears during generation and reappears when done — this is a definitive, binary signal (replaces the fragile `.result-streaming` class + MutationObserver stability check)
- Chat scroll position is preserved during injection — `lockScroll()` intercepts both scroll events and programmatic `scrollTo()` calls to prevent ChatGPT's auto-scroll

### Persistent Highlights & Re-open Popup (Step 3c)
- After a response is captured, the source text highlight stays visible even after the popup is closed
- Completed highlights get a `jr-source-highlight-done` class with `cursor: pointer` to signal interactivity
- Clicking a completed highlight re-opens a read-only popup showing the original context blockquote and the AI response (no input row or send button)
- Dismissing a re-opened popup preserves the highlight — it can be clicked again any time
- Multiple completed highlights can coexist in the same conversation
- In-progress or pre-send popups still fully clean up on dismiss (highlight unwrapped, no stale state)
- SPA navigation cleans up all completed highlights (unwraps spans, clears in-memory state)
- In-memory only for this step — highlights do not survive page reload

### Storage Layer
- Highlights and their Q&A chain metadata persist via `chrome.storage.local`
- Each highlight stores: id, text, url, site, parentId (for chained popups), questionIndex, responseIndex, createdAt
- Supports linking highlights to chat message indices (`linkQA`)
- Supports child/descendant queries for chained popups
- Cascade delete removes a highlight and all its descendants

## Planned
- **Chained popups** — highlight text inside a popup to spawn a deeper follow-up popup
- **Restore on reload** — re-render saved highlights and their popup chains when revisiting a conversation
- **Multi-site support** — extend selectors and injection logic for Claude, Gemini, and Microsoft Copilot
