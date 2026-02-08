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

## Step 3d: Copyable Highlight Text — DONE
- Problem: when the user selects text, the popup immediately captures focus for typing, so Ctrl+C copies nothing
- Clicking on source highlight spans while a popup is open does not dismiss the popup
- `selectSourceHighlightText()` programmatically selects all highlight text on click — runs on the `click` event (not just `mouseup`) because the browser's default click behavior collapses selections between mouseup and click
- Works in all popup states: typing a question, waiting for response, and viewing the completed response
- The `mouseup` handler skips new popup creation when interacting with active source highlights; also skips for completed highlights to prevent a race with the click handler
- Clicking back into the popup input re-enters edit mode (restores focus for typing a follow-up)
- CSS `user-select: text` on `.jr-source-highlight` ensures text is selectable even if the host site disables it

## Step 4: Persistence Across Reload — DONE
- Storage schema expanded: each highlight now stores `sentence`, `blockTypes`, `responseHTML`, `sourceTurnIndex` alongside existing fields
- `saveHighlight()` accepts all fields in a single call (id, text, sentence, blockTypes, responseHTML, url, site, sourceTurnIndex, questionIndex, responseIndex)
- `restoreHighlights()` on page load queries storage for the current URL, polls DOM for turns to appear, re-wraps source text via `findTextRange()` + `highlightRange()`, hides Q&A turns, populates `completedHighlights` Map
- Clicking a restored highlight re-opens the read-only popup with the saved response (reuses `openCompletedPopup()`)
- SPA navigation: `onNavigate()` cleans up old highlights, then calls `restoreHighlights()` after a delay for React to render the new conversation
- `findTextRange(root, searchText)` walks text nodes in an element, concatenates content, finds the substring, and maps back to a DOM Range

## Step 4b: Chained Popups — DONE
- Highlighting text inside a popup's response area spawns a new child popup **next to the parent** (both visible simultaneously)
- Selected text in the parent popup's response is wrapped in `jr-source-highlight` spans via `highlightRange()` — same as main chat
- Chained popup has its own context blockquote, input field, and send button
- Chained popups inject into the same chat thread, maintaining full AI context
- After response capture, source highlight spans become `jr-source-highlight-done` — clickable to reopen the chained popup
- Parent-child relationships stored via `parentId` in both `completedHighlights` Map and `chrome.storage.local`
- `popupStack` saves parent popup state when a child opens; Escape peels one layer, click outside closes all
- `pushPopupState()` / `removeAllPopups()` manage the stack lifecycle
- Parent's `responseHTML` is updated to include chained highlight spans for persistence
- On reopen, `openCompletedPopup()` restores chained highlight entries from DOM spans and loads children from storage
- Infinite chaining depth supported — each chained response can be highlighted for deeper follow-ups
- `user-select: text` on `.jr-popup-response` ensures text is selectable in all host sites

## Step 5: Popup Window Formatting — DONE

### Step 5a: Resizable Popup — DONE
- Allow the user to drag the popup's edges to make it wider (or narrower)
- Show a resize cursor (`col-resize` / `ew-resize`) when hovering near the left or right edge of the popup
- On mousedown at the edge, track mousemove to adjust the popup width in real time
- Respect a minimum width (e.g. 280px) and maximum width (e.g. viewport width minus padding)
- The resized width persists for subsequent popups within the same page session (module-level variable)
- Works for both regular popups and chained popups

### Step 5b: Preserve Response Markdown Formatting — DONE
- The AI response displayed inside `.jr-popup-response` must faithfully reproduce ChatGPT's rendered markdown formatting
- Horizontal rules (`<hr>`) should render as visible separator lines, not collapse to zero height
- Paragraph spacing / section gaps between headings, paragraphs, and lists must match the original — no content jamming together
- Code blocks, blockquotes, tables, and other markdown elements should retain their visual structure
- Add targeted CSS rules inside `.jr-popup-response` to restore spacing and separators that the popup's scoped styles may strip

### Step 5c: Popup Anchor Arrow
- Add a small arrow (CSS triangle or caret) on the popup border that points toward the source highlight the popup belongs to
- Arrow sits on the edge of the popup closest to the highlight (top edge if popup is below, bottom edge if above)
- Arrow position tracks the horizontal center of the highlight
- Works for level-1 popups, completed popups, and chained popups

### Step 5d: Show Question in Popup
- After a response is captured, display the follow-up question the user asked inside the popup, directly below the selected-text blockquote and above the AI response
- The question should be visually distinct from the context and response (e.g. different styling or label)
- Persisted in storage so it appears on popup reopen and after page reload
- Works for both regular and chained popups

## Step 6: General Formatting

### Step 6a: Delete Highlight
- Add a way to dismiss/delete a completed highlight and its associated Q&A from JR's view
- Deleting removes the highlight spans from the page, unhides the Q&A turns so they return to the normal chat flow, and removes the entry from `chrome.storage.local`
- The messages remain in ChatGPT's conversation history — JR only stops presenting them as a popup
- Cascade: deleting a parent highlight also deletes all its chained children

### Step 6b: Highlight Hover & Active States
- Darken the highlight background color when the mouse hovers over a completed highlight span
- Apply a distinct "active/selected" background color when a highlight's popup is currently open
- Both states use CSS (`:hover` pseudo-class and an active class toggled by JS)
- Works for both level-1 highlights in the chat and chained highlights inside popup responses

### Step 6c: Edit Follow-Up Question
- Allow the user to edit the question text of an existing completed popup
- Editing re-sends the revised question to ChatGPT as a new message in the same thread (the original Q&A pair stays hidden)
- The popup replaces its old response with the new one once it arrives
- The old hidden Q&A turns remain hidden; the new Q&A pair is also hidden — only the latest response is shown in the popup
- Storage is updated with the new question text and new turn indices

### Step 6d: Highlight Navigation Arrows
- Provide navigation arrows (or a small floating control) to jump between highlights on the page
- Level-1 navigation: arrows cycle through all level-1 highlights in the conversation, scrolling the chat to bring each one into view
- Level-2 navigation: when a level-1 popup is open, arrows cycle through all chained highlights within that popup's response, scrolling the response area as needed
- Current position indicator (e.g. "2 / 5") shows which highlight is focused
- Clicking an arrow scrolls to the highlight and opens its popup

## Step 7: Multi-Site Support
- Abstract site-specific selectors and injection logic behind a config/adapter pattern
- Add support for Claude (claude.ai)
- Add support for Gemini (gemini.google.com)
- Add support for Microsoft Copilot (copilot.microsoft.com)
- Test each site end-to-end
