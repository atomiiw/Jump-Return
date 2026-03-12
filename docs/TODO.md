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

## Step 2b: Response Length Toggle — DONE
- Send arrow icon: clicking sends with the last-used mode (defaults to Normal)
- A "switch" button appears below the send icon showing the other mode (e.g. "Brief" if current is Normal)
- Clicking the switch button switches mode and sends immediately
- **Brief** appends a one-time instruction for 2-3 sentences; **Normal** tells ChatGPT to ignore prior brevity instructions
- Last-used mode persists across popups within the session via `st.responseMode`
- Same interface used for both initial question input and edited question re-send

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

### Step 5c: Popup Anchor Arrow — DONE
- Add a small arrow (CSS triangle or caret) on the popup border that points toward the source highlight the popup belongs to
- Arrow sits on the edge of the popup closest to the highlight (top edge if popup is below, bottom edge if above)
- Arrow position tracks the horizontal center of the highlight
- Works for level-1 popups, completed popups, and chained popups

### Step 5d: Show Question in Popup — DONE
- After a response is captured, display the follow-up question the user asked inside the popup, directly below the selected-text blockquote and above the AI response
- The question should be visually distinct from the context and response (e.g. different styling or label)
- Persisted in storage so it appears on popup reopen and after page reload
- Works for both regular and chained popups

### Step 5e: Edit Question & Response Versions — DONE
- Allow the user to edit the follow-up question after a response is captured
- A pencil icon and send icon appear next to the question text in completed popups
- Clicking the pencil toggles edit mode: question text becomes editable in place (contenteditable), pencil appears "pressed"/darkened, send icon becomes visible
- Clicking the pencil again exits edit mode and discards changes (restores original)
- Send icon is greyed out until the text changes; clicking it (or pressing Enter) submits the edited question
- Escape cancels edit mode
- On send: the new question is injected into the chat, the old response is replaced by a loading/streaming view, and the new AI response is captured
- Both old and new responses are kept as **versions** — the popup shows a version nav bar (`◀ 1 / 2 ▶`) when multiple versions exist
- Clicking version nav arrows switches the displayed question text and response HTML
- Storage: each highlight gains optional `versions` array and `activeVersion` index; backward compatible (lazily initialized from top-level fields when absent)
- `addHighlightVersion(id, versionObj)` pushes a new version and syncs top-level fields
- `setHighlightActiveVersion(id, index)` switches the active version and syncs top-level fields
- On page reload, all versions' Q&A turns are hidden (not just the active version's)
- Dismissing the popup during an edit response detaches (keeps polling in background), same as new popups
- Works for both level-1 and chained popups

## Step 6: Streaming Response in Popup — DONE
- Instead of showing a blank/white popup while waiting for the AI response, stream the response word-by-word into the popup in real time — matching how ChatGPT streams its own responses
- While polling for the AI response, continuously read the response turn's current HTML and update `.jr-popup-response` with whatever content has been generated so far
- The popup should show partial content as it arrives, so users can read along during generation instead of staring at a "Waiting for response…" message
- Once streaming is complete (generation finished), finalize the response content as before (save to storage, mark highlight as done, etc.)
- Works for both level-1 popups and chained popups

## Step 7: General Formatting

### Step 7e: Match ChatGPT Font Size in Popup Response — DONE
- The `.jr-popup-response` font size must match ChatGPT's response text (16px), not a reduced size
- Ensures the popup feels like a natural continuation of the chat, not a miniaturized sidebar

### Step 7f: Preserve Selection on Popup Open — DONE
- When a popup opens from a text selection, keep the browser's native selection active (do not clear it or auto-focus the input)
- This lets the user immediately Cmd+C / Ctrl+C to copy the selected text — the native selection overlays the JR source highlight (two visual layers)
- The input field does NOT auto-focus on popup open; the user must click the input to start typing
- Clicking the input field clears the native selection and focuses the input for typing
- Works for both level-1 popups and chained popups

### Step 7a: Highlight Toolbar (Color Picker + Delete) — DONE
- A floating pill-shaped toolbar appears near the highlighted text, on the opposite side from the popup
- 5 color swatches (blue, yellow, green, pink, purple) + trash icon
- Clicking a swatch updates the highlight and popup blockquote color, persists in `chrome.storage.local`
- Clicking trash shows confirmation inside popup: "Delete this highlight and N follow-up(s)?"
  - Confirm: removes highlight spans, keeps Q&A turns hidden, cascade-deletes from storage, closes popup
  - Cancel: returns to the normal popup view
- Deleted turns stay hidden across page reload via `jumpreturn_deleted_turns` storage (per-URL)
- Highlight color persists across page reload via storage
- Cascade: deleting a parent highlight also deletes all its chained children
- The toolbar only appears on completed highlights (not on new/in-progress popups)

### Step 7b: Highlight Hover & Active States — DONE
- Darken the highlight background color when the mouse hovers over a completed highlight span
- Apply a distinct "active/selected" background color when a highlight's popup is currently open
- Hover uses `:hover` pseudo-class; active uses `.jr-source-highlight-active` class toggled by `JR.syncHighlightActive()`
- Works for all 5 highlight colors + default blue, in both light and dark mode
- Works for both level-1 highlights in the chat and chained highlights inside popup responses

### Step 7d: Highlight Navigation Arrows — DONE
- Provide navigation arrows (or a small floating control) to jump between highlights on the page
- Level-1 navigation: arrows cycle through all level-1 highlights in the conversation, scrolling the chat to bring each one into view
- Level-2 navigation: when a level-1 popup is open, arrows cycle through all chained highlights within that popup's response, scrolling the response area as needed
- Current position indicator (e.g. "2 / 5") shows which highlight is focused
- Clicking an arrow scrolls to the highlight and opens its popup

## Step 8: Debugging & Polish

### Step 8a: Remove Multi-Site Scaffolding
- Strip out any multi-site adapter/config code and leave only ChatGPT support
- Clean up selectors, injection logic, and any branching that references Claude, Gemini, or Copilot

### Step 8b: Right-Side Popup Placement
- Support placing the popup on the right side of the highlight (not only left)
- Automatically choose whichever side has more room; allow the user to toggle if needed

### Step 8c: Cmd+F Search Through Hidden Content
- Ensure that popup content (questions and responses) that has been wrapped and hidden from the main chat is still discoverable via the browser's Cmd+F / Ctrl+F search
- Audit all hidden turns and popup HTML to confirm nothing is lost to find-in-page

### Step 8d: Nav Widget Should Not Count Unsent Highlights
- The highlight navigation widget currently increments the count (e.g. shows "1/5") as soon as a new highlight is created for a question that hasn't been sent yet
- The nav widget should only count completed highlights — an unsent/in-progress highlight should not appear in the count or be navigable
- Fix: filter out highlights that don't have a completed response when building the nav list

### Step 8e: Delete Confirmation Bar Refinements
- Move the cancel text slightly rightward
- Make the confirm/cancel icons smaller
- Replace the red-outline cancel indicator with a fog/opaque white overlay that covers everything except the cancel button, making it clear that cancel is the only clickable action

### Step 8f: Export Highlights as Notes
- Add an export function where users can export their highlighted questions and responses as structured notes (e.g. markdown or plain text)
- Accessible from the extension popup or a toolbar button
- Not urgent — lower priority than other polish items

### Step 8g: Disable Extension Toggle
- Add a small ✕ button (floating or in the nav widget) that lets the user disable Jump Return on the current page without uninstalling
- When disabled, all JR event listeners, popups, highlights, and UI are suppressed — ChatGPT behaves as normal
- Clicking again (or reloading) re-enables it
- Persist the enabled/disabled state per tab or globally via `chrome.storage.local`

### Step 8h: Logo & Description for Public Release
- Design/decorate the extension logo for the Chrome Web Store
- Write a polished store description and screenshots for public listing
