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
- When the selection equals the full sentence, the entire text is wrapped in the mark (consistent blue highlight always visible)
- Code blocks (`<pre>`) use the entire block as the "sentence" since periods aren't sentence boundaries in code
- Injected messages include both the context sentence and the exact quote for better AI context
- Cross-block selections (e.g. multiple bullet points) collect the full text of each selected block, joined with newlines
- Cross-block selections trim start and end blocks to sentence boundaries, so only the relevant sentence from each block is shown
- Bullet points (`<ul>`) render as bulleted lists; numbered lists (`<ol>`) render with decimal numbering — matching the original content
- Single-block selections inside a bullet point show the bullet marker if and only if the selected sentence is the first sentence of that bullet (no period between the bullet marker and the selection)
- Non-first sentences from a bullet point (in cross-block selections) are still indented at list level but rendered without a bullet marker, so they stay visually aligned with neighboring bulleted items
- Numbered list items preserve their original ordinal: selecting item 4 shows "4." not "1."; selecting items 4–8 shows "4. 5. 6. 7. 8."
- Mixed content (e.g. heading + bullet list) groups consecutive list items into their appropriate list type while rendering non-list blocks as plain divs
- Nested list levels are indented with distinct marker styles (ul: disc → circle → square; ol: decimal → lower-alpha → lower-roman)
- Multi-paragraph bullet points (single `<li>` with multiple `<p>` or `<br>` elements) are rendered correctly without extra bullet markers
- Inline citation references (`data-testid="webpage-citation-pill"`) are detected via DOM walking and displayed as boxed pills in the context blockquote, visually separated from surrounding text — works in both single-block and multi-block selections
- Bold text (`<strong>`, `<b>`) is preserved in the context blockquote — bolded words in the original content render as bold in the popup
- Block detection uses `range.intersectsNode()` to find which blocks are actually selected, making it robust against browser Range positioning quirks (casual drags from left edge, selections ending below the last line, container blocks like `<li>` wrapping `<p>`, etc.)
- Sentence context never starts with a citation pill — if a sentence boundary falls right before a pill, the pill is trimmed from the start of the context
- Graceful fallback: if sentence extraction fails, the popup and message use the highlighted text alone

### Chat Injection (Step 2 — ChatGPT only)
- Follow-up question is formatted with the highlighted text quoted as context
- Message is injected into ChatGPT's ProseMirror contenteditable input and dispatched via native input event
- ChatGPT's send button is programmatically clicked after a short delay for React to process
- Graceful error handling: logs to console if chat input or send button is not found

### Response Length Toggle (Step 2b)
- Split send button: main area labeled "Regular" or "Brief" acts as the send button; small `▾` toggle opens a dropdown to switch modes
- Default mode: **Regular** — appends an instruction to respond naturally and ignore any prior brevity requests from earlier messages
- **Brief** mode appends a one-time instruction to keep it to 2-3 sentences, explicitly scoped to this single response only
- Mode persists across popups within the same page session; resets on page reload
- Dropdown appears above the split button, themed via CSS variables for light/dark mode

### Response Capture & Hide Q&A (Step 3 — ChatGPT only)
- After sending a follow-up question, the popup transitions to a loading state ("Waiting for response…")
- The extension polls for new conversation turns appearing in the DOM
- When the injected question turn appears, it is hidden from the main chat (`jr-hidden` class)
- When the AI response turn finishes streaming, it is also hidden from the main chat
- The AI response content (rendered markdown) is extracted and displayed inside the popup in a scrollable area (max 300px)
- The highlight and its Q&A turn numbers are saved to `chrome.storage.local`
- If the user dismisses the popup during loading (click outside or Escape), the response watch detaches: the source highlight becomes immediately clickable (`jr-source-highlight-done`), hidden turns remain hidden, and polling continues in the background
- Clicking a detached highlight during generation opens a popup showing "Generating..." — when the response finishes, the popup updates in-place with the actual response
- If the popup is not open when the response arrives, the highlight stays clickable and clicking it shows the completed response
- If the response times out while detached, turns are unhidden, the highlight is removed from `completedHighlights`, and spans are unwrapped
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

### Copyable Highlight Text (Step 3d)
- Clicking on source highlight spans while a popup is open programmatically selects all the highlight text for Ctrl+C / Cmd+C
- Works in all popup states: while typing a follow-up question, while the response is generating, and when viewing the completed response
- The popup remains visible while the highlight text is selected — it is not dismissed
- Clicking back into the popup input re-enters edit mode (restores focus for typing a follow-up)
- For completed highlights: first click opens the popup, subsequent clicks on the highlight select text for copy
- Works inside chained popups: clicking a child's source highlights in a parent popup's response selects text for copy instead of spawning another chain
- CSS `user-select: text` ensures highlight text is selectable regardless of host site styles

### Storage Layer
- Highlights and their Q&A chain metadata persist via `chrome.storage.local`
- Each highlight stores: id, text, sentence, blockTypes, responseHTML, url, site, parentId, sourceTurnIndex, questionIndex, responseIndex, createdAt
- `saveHighlight()` accepts all fields in a single call — no separate `linkQA()` needed for new highlights
- `updateHighlightResponseHTML()` updates a parent's `responseHTML` in storage after a chained highlight is captured, so chained spans persist across page reload
- Supports child/descendant queries for chained popups
- Cascade delete removes a highlight and all its descendants

### Persistence Across Reload (Step 4)
- On page load, `restoreHighlights()` queries storage for the current conversation URL
- Polls the DOM for conversation turns to appear (ChatGPT renders asynchronously), up to 15 seconds
- For each saved highlight: finds the source turn by `sourceTurnIndex`, locates the text via `findTextRange()`, wraps it in highlight spans using `highlightRange()`, and hides the Q&A turns
- Restored highlights are fully interactive — clicking re-opens the read-only popup with the saved AI response
- SPA navigation cleans up old highlights and restores for the new conversation after React re-renders
- Highlights that can't be matched (e.g., conversation was edited) are silently skipped

### Chained Popups (Step 4b)
- Highlighting text inside a popup's response area spawns a new child popup **next to the parent** — both popups visible simultaneously
- The selected text in the parent popup's response is wrapped in source highlight spans (same `highlightRange()` as the main chat)
- The chained popup shows the selected text as context in a blockquote, with an input field and split send button
- Chained questions are injected into the same ChatGPT thread, so the AI retains full context from the entire conversation
- After response capture, highlight spans in the parent response become clickable (`jr-source-highlight-done`) — clicking reopens the chained popup
- Popup stack: Escape peels off the topmost popup (returning to parent), click outside closes the entire chain
- Infinite chaining depth: a chained popup's response can itself be highlighted to create deeper follow-ups
- When a parent popup is reopened, chained highlights are restored via the same `findTextRange()` + `highlightRange()` text-matching used for page-reload restore — no baked spans in `responseHTML`
- Parent-child relationships are stored via `parentId` in both the in-memory Map and `chrome.storage.local`
- Response mode toggle (Regular/Brief) works in chained popups identically to regular popups

### Resizable Popup (Step 5a)
- Drag the left or right edge of any popup to resize its width
- A `col-resize` cursor appears when hovering within 6px of the popup's left or right edge
- On mousedown at the edge, mousemove tracks in real time to adjust the popup width
- Minimum width: 280px; maximum width: viewport width minus 32px padding
- Level-1 and chained (level 2+) popups have independent widths — resizing a chained popup only affects other chained popups, not level-1
- Each width persists for its level within the same page session
- Works for regular popups, completed popups, and chained popups
- All positioning logic (initial placement, reposition, window resize) uses the popup's actual `offsetWidth` instead of a hardcoded 360px

### Response Markdown Formatting (Step 5b)
- The AI response inside `.jr-popup-response` faithfully reproduces ChatGPT's rendered markdown formatting
- Paragraphs (`<p>`) have proper bottom margins with spacing between sections
- Headings (`<h1>`–`<h6>`) have top/bottom margins, bold weight, and tighter line height
- Horizontal rules (`<hr>`) render as visible 1px separator lines using `--jr-border`
- Code blocks (`<pre>`) have a background tint, border, rounded corners, padding, and horizontal scroll
- Inline code (`<code>`) has a subtle background tint, rounded corners, and padding; nested inside `<pre>` it inherits the block's styles
- Blockquotes have a left border, background tint, and muted text color — matching the popup's context blockquote style
- Lists (`<ul>`, `<ol>`) have proper margins, padding, and explicit `list-style-type` to override host site resets
- Tables have collapsed borders, themed header backgrounds, and consistent cell padding
- Links use the accent color with underline; images are constrained to `max-width: 100%`

## Planned
- **Popup anchor arrow** (Step 5c) — CSS triangle on the popup border pointing at the source highlight
- **Show question in popup** (Step 5d) — display the user's follow-up question between the context blockquote and the AI response
- **Delete highlight** (Step 6a) — remove a highlight and its Q&A from JR's view (messages stay in ChatGPT's history)
- **Highlight hover & active states** (Step 6b) — darken highlight on hover; distinct color when popup is open
- **Edit follow-up question** (Step 6c) — revise a question and re-send it, replacing the old response
- **Highlight navigation arrows** (Step 6d) — jump between highlights in the chat (level-1) or within a popup (level-2)
- **Multi-site support** (Step 7) — extend selectors and injection logic for Claude, Gemini, and Microsoft Copilot
