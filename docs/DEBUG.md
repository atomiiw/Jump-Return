# DEBUG — Quality Assurance

1. ~~**Brief mode contaminates normal responses.** When user sends a popup question in Brief mode, subsequent normal ChatGPT responses (outside Popup) also come back brief. The one-time brevity prompt isn't scoped tightly enough — need to prompt engineer it so ChatGPT treats it as truly single-use.~~ **FIXED**

2. ~~**Search bar should use a line, not a box.** Redesign the search bar to be a slim horizontal line showing the user query, not a padded floating box with transparent background.~~ **FIXED**

3. ~~**Search bar should be toggleable.** It should be dismissible rather than always visible.~~ **FIXED**

4. ~~**Search bar should be attached to the top.** It should look fixed to the top edge of the viewport like the black top edge of an iPhone — solid, structural, not floating or transparent.~~ **FIXED**

5. ~~**Search bar button colors are inconsistent.** The buttons don't match the color scheme used by other Popup buttons. Correct them to match the Style Guide icon color reference.~~ **FIXED**

6. ~~**Highlight colors are ugly.** The current highlight color palette needs to be redesigned with more carefully chosen colors.~~ **FIXED**

7. ~~**Popup gets cut off at the bottom of the page.** When a highlight is near the bottom and the popup opens below it, a long popup gets submerged past the page bottom and cut off at the waist. Should auto-detect when the popup would overflow and flip it to open above the highlight instead.~~ **FIXED** — initial placement now checks scroll bounds exactly; during streaming, `checkStreamingOverflow` dynamically flips direction if the popup grows past the container edge.

8. ~~**Cmd+F search order doesn't interleave nested popups.** Search results cycle through DOM matches and L1 popup matches in correct page order, but nested popup matches are grouped after their parent rather than interleaved by position. If a keyword appears in a parent popup's response between two matches in a child popup, the child matches should be visited between the parent matches — not all lumped after.~~ **FIXED**

9. ~~**Popup windows blend into the background.** The popup needs more visual distinction from the page — stronger border, shadow, or contrast so it's clearly a separate floating element.~~ **FIXED**

10. ~~**Hover underline gap is different for popup highlights vs DOM highlights.** The gap between the text and the underline is larger for highlights inside popup responses than for highlights on the main page. They should look identical.~~ **FIXED** — `createUnderlines` used `getBoundingClientRect()` (border-box origin) but absolutely positioned children use the padding-box origin. Missing `borderTopWidth`/`borderLeftWidth` offset caused a 1.5px error when `posParent` was `.jr-popup-response` (which has `border-top: 1.5px`).

11. ~~**Nested popup doesn't follow highlight on reopen.** After generating a chained response, closing just the chained popup, then clicking its highlight to reopen — the popup was fixed on the screen instead of scrolling with the parent. Closing and reopening the parent fully worked fine.~~ **FIXED** — chained highlight spans aren't inside an AI turn article, so `closest(S.aiTurn)` returned null and `contentContainer` defaulted to `document.body`. Fixed in three places: `resolveContentContainer` now checks for parent `.jr-popup` first and rejects `document.body` as cached value; `sendContentContainer` walks up to parent popup's container for chained highlights; entry's `contentContainer` is refreshed after positioning.

12. **Search bar overlaps chat text (floating island).** ChatGPT removed its upper bar, so the search bar now floats directly on top of chat words with no visual separation — just an icon, a line, and a few words. Give `.jr-search-bar` a proper floating island appearance with a solid background (`--jr-bg`), border (`--jr-border`), border-radius, box-shadow, and padding so it looks like a self-contained pill/card.
    - **Files:** `styles.css` (search bar styles, ~line 1287–1370)

13. **Popup should appear on button click, not immediately on highlight.** Currently, highlighting text in an AI response immediately opens the popup. Change to a two-step flow: highlight text → a small floating trigger button appears near the selection → click button to open popup. The trigger button dismisses on click-outside, Escape, or new selection. Completed highlights still open popup on click (no change).
    - **Files:** `content.js` (mouseup handler, ~line 13–36), `styles.css` (new `.jr-highlight-trigger-btn` class)

14. **Default to medium response length.** Default response mode is "regular" which produces full elaborate responses. Change default to "medium" with a moderate-length prompt instruction. Both medium and concise modes append a "return to normal length" reset at the end.
    - **Medium** prompt: `"(For this response only: please respond at a moderate length — a solid paragraph or two, not overly brief or elaborate. After this response, return to your normal response length and disregard this length instruction entirely.)"`
    - **Concise** prompt (unchanged content, renamed from "brief"): `"(For this response only: please keep it brief — 2-3 sentences. After this response, return to your normal response length and disregard the above brevity instruction entirely.)"`
    - Rename `"brief"` → `"concise"` and `"regular"` → `"medium"` throughout.
    - **Files:** `jr-namespace.js` (default mode), `popup.js` (doSend, submitEdit, switch labels), `chat.js` (retry message)

15. **Send button hover should show both Medium and Concise.** Currently the hover dropdown shows only the "other" mode as a switch button. Replace with a two-item dropdown showing both "Medium" and "Concise", with the current mode highlighted/indicated. Clicking either option sends with that mode.
    - **Files:** `popup.js` (buildInputRow, showCompletedResponse — switch button logic), `styles.css` (dropdown item active style)

16. **Reduce highlight colors from 5 to 3.** 5 colors is too many. Change `HIGHLIGHT_COLORS` from `["blue", "yellow", "green", "pink", "purple"]` to `["blue", "yellow", "pink"]`. Remove CSS for green and purple highlight colors, swatches, and variables.
    - **Files:** `jr-namespace.js` (HIGHLIGHT_COLORS), `styles.css` (remove green/purple classes and variables)

17. **"Reply to whole response" feature.** Add a "Reply" button at the bottom of completed popup responses. Clicking it opens a chained popup that references the entire response without requiring the user to highlight anything. The nested popup's quotation area shows only the first few lines of the parent response + "..." instead of the full text.
    - **Files:** `popup.js` (showCompletedResponse — add reply button, createPopup — handle whole-response mode), `styles.css` (`.jr-reply-whole-btn` style), `popup-helpers.js` (truncated quote rendering)

18. **Remove auto-scroll during streaming.** During response generation in a popup, it auto-scrolls to show the latest content. Remove this so the user can scroll freely to read whichever part they want, even while still generating.
    - **Files:** `chat.js` (~line 347, remove `responseDiv.scrollTop = responseDiv.scrollHeight`)

19. **Allow resizing popup while response is generating.** Currently the popup can only be resized after the response is complete. The resize drag handles should work during streaming too.
    - **Files:** `popup-helpers.js` (resize handler logic — ensure it's attached during streaming, not just on completed popups)
