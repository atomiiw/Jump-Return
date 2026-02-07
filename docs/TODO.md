# TODO — Implementation Steps

Work through these steps **in order**. Do not skip ahead or add features from later steps.

## Step 1: Highlight Detection & Popup UI (ChatGPT only) — DONE
- `content.js` detects text selection in AI responses, shows floating popup
- `styles.css` with CSS variables, dark mode, all popup components
- Send button is a **stub** (logs to console only)
- Dismissal on click outside, Escape, SPA navigation

## Step 1b: Sentence Context Extraction — DONE
- `extractSentence(range)` finds the containing sentence(s) for any selection, expanding to full sentence boundaries
- Block-level ancestor detection (`findBlockAncestor`) bounds sentence search to the paragraph/list item/heading
- Code blocks (`<pre>`) return entire block content (periods aren't sentence boundaries)
- Popup shows full sentence context in blockquote with exact selection highlighted inline (colored background mark)
- Injected message includes both sentence context and exact quote

## Step 2: Chat Injection (ChatGPT only) — DONE
- Wire the send button to inject the follow-up question into ChatGPT's actual chat input
- Quote the highlighted text as context in the message
- Find and click ChatGPT's send button programmatically
- Handle edge cases: input not found, send button not found

## Step 2b: Response Length Toggle (Split Send Button) — DONE
- Replace single "Send" button with a split button: main area shows current mode ("Regular" or "Brief") and sends; small `▾` toggle opens a dropdown to switch modes
- Default mode: Regular (no instruction appended); persists for the page session (module-level variable)
- Append a length instruction to the injected message based on current mode
- Dropdown appears above the button, closes on outside click or item selection

## Step 3: Response Capture & Hide Q&A — DONE
- Popup stays open after send, transitions to loading state ("Waiting for response…")
- Polls for new conversation turns; hides injected question turn and AI response turn from main chat
- When AI response finishes streaming, extracts content and displays it inside the popup (scrollable, max 300px)
- Saves highlight + Q&A turn numbers to `chrome.storage.local` via `saveHighlight()` + `linkQA()`
- Dismissal during loading cancels the watch and unhides any hidden turns
- Timeout after 60 seconds shows "Response timed out." and unhides turns
- Brief mode instruction updated to be explicitly one-time ("For this response only…")

## Step 3b: Source Text Shadow Highlight & Popup Anchoring — DONE
- When a popup opens, the selected source text in the AI response is wrapped in `<span class="jr-source-highlight">` for a persistent visual highlight
- Popup is appended inside the chat scroll container (not `document.body`), so it scrolls naturally with the content — no scroll/resize listeners needed
- Popup is positioned to the right of the highlight (falls back to left if insufficient space)
- On popup dismiss, highlight spans are unwrapped and the DOM is restored cleanly
- Response detection uses send button absence (`isGenerating()`) instead of `.result-streaming` class + MutationObserver content stability
- Scroll position preserved during injection — `lockScroll()` patches both scroll events and `scrollTo()` to prevent ChatGPT's auto-scroll

## Step 3c: Persistent Highlights & Re-open Popup on Click — DONE
- After a response is captured, source highlight spans stay visible with `jr-source-highlight-done` class (pointer cursor)
- Closing the popup preserves the highlight instead of unwrapping the spans
- Clicking a completed highlight re-opens a read-only popup showing the context blockquote and response (no input row)
- In-progress or pre-send popups still clean up fully on dismiss (no regression)
- SPA navigation unwraps all completed highlight spans and clears the in-memory Map
- In-memory only — no persistence across page reload (that's Step 4)

## Step 4: Chained Popups & Persistence
- Allow highlighting text inside a popup to spawn a deeper follow-up popup
- Store parent-child relationships between highlights (`parentId`)
- Restore saved highlights and their popup chains when revisiting a conversation

## Step 5: Multi-Site Support
- Abstract site-specific selectors and injection logic behind a config/adapter pattern
- Add support for Claude (claude.ai)
- Add support for Gemini (gemini.google.com)
- Add support for Microsoft Copilot (copilot.microsoft.com)
- Test each site end-to-end
