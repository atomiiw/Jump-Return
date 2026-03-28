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

12. ~~**Search bar overlaps chat text (floating island).** ChatGPT removed its upper bar, so the search bar now floats directly on top of chat words with no visual separation — just an icon, a line, and a few words. Give `.jr-search-bar` a proper floating island appearance with a solid background, border, border-radius, box-shadow, and padding so it looks like a self-contained pill/card.~~ **FIXED**

13. ~~**Popup should appear on button click, not immediately on highlight.** Change to a two-step flow: highlight text → a small floating trigger button appears near the selection → click button to open popup.~~ **FIXED**

14. ~~**Default to medium response length.** Change default from "regular" to "medium" with a moderate-length prompt instruction. Both medium and concise modes append a "return to normal length" reset at the end. Rename "brief" → "concise" and "regular" → "medium" throughout.~~ **FIXED**

15. ~~**Send button hover should show both Medium and Concise.** Replace the single switch button with a two-item dropdown showing both options, with the current mode highlighted.~~ **FIXED**

16. ~~**Reduce highlight colors from 5 to 3.** Change from 5 colors to 3 (blue, yellow, pink). Remove green and purple.~~ **FIXED**

17. ~~**"Reply to whole response" feature.** Add a "Reply" button at the bottom of completed popup responses for responding without highlighting.~~ **FIXED**

18. ~~**Remove auto-scroll during streaming.** Remove auto-scroll so the user can scroll freely during generation.~~ **FIXED**

19. ~~**Allow resizing popup while response is generating.** Resize drag handles should work during streaming too.~~ **FIXED**

20. **Reply button stops working after closing the reply popup.** Click Reply, get a response, close that nested popup. Now clicking Reply again does nothing. Also, at this point, highlighting text inside the popup starts showing the chat bubble trigger — it shouldn't while the reply child exists but isn't open.

21. **Edited question should update immediately, not wait for the response.** When I modify my question and send a new version, the old question stays visible while waiting for the new response. It should flip to the new question right away — think of it as: the moment I send version 2, I'm on the version 2 page, which shows the new question + "waiting for response" (or the streaming content). I shouldn't see my old question while the new response is loading.

22. **Reply button should be per-version, not shared across all versions.** Each version page should have its own Reply. Right now if I ask a version 2 question and flip to that page, I see version 1's reply. Flip back to version 1 — no reply button. Flip back and forth a few times and the reply button gets stuck on the wrong version. The whole reply button logic needs to be tied to the specific version (item) it belongs to, not the highlight as a whole.

23. **Trash icon disappears after editing a question.** When I modify the question and send a new version, the delete (trash) icon vanishes. It only comes back if I close and reopen the popup.

24. **Blank space appears at the bottom of popup when hovering a nested highlight.** When I create a highlight inside a popup response and hover over it to show the underline, a new blank space shows up at the bottom of the popup response area along with the underline.

25. **Chat bubble trigger button should be inside the popup edge, not outside.** Right now if I highlight a bullet point list inside a popup, the chat bubble hangs just outside the right edge of the popup, moving with the edge. It should be just inside the edge instead.

26. **Long quote blocks should be capped at 6 lines with a scroller.** If the quoted text in the blockquote area is longer than 6 lines, only show 6 lines and add a scroll bar so the user can scroll to see the rest.

27. **Nav arrows should be behind popups, not above them.** Currently the highlight navigation arrows sit on top of everything. If a popup window overlaps them, the arrows should get covered up — not float above the popup.

28. **Auto-focus the typing bar when Reply is clicked.** As soon as someone clicks Reply, the cursor should be in the input field so they can start typing immediately without having to click on the typing bar first.

29. **Reopening a reply popup mid-generation shows stale state.** If I close a reply popup while it's waiting for a response or streaming, then click Reply again, it shows a fresh input box instead of the current in-progress state. Same if I sent a second version — reopening shows version 1 instead of the in-progress version 2. It should behave exactly like reopening a regular highlight mid-generation: show whatever state the popup is in right now (waiting, streaming, or completed).

30. **Popup clamping and height caps.** Popups should be clamped horizontally — left edge follows the chat column (adjusts when sidebar expands/collapses, 20px padding), right edge stops before the nav widget (12px gap). Max popup width 720px. Quote block caps at 6 lines with a scroller. Response area caps at 400px (or 50vh) with a scroller. When the popup is squeezed super narrow, the content reflows taller but gets capped by these limits instead of making the popup infinitely long.

31. ~~**"Waiting for response" leaks across versions and blocks the queue.**~~ **FIXED**
    1. ~~"Waiting for response" should be exclusive to its own version page.~~ Fixed — each version page now has its own state (waiting, retry, or response).
    2. ~~Auto-timeout and retry button.~~ Fixed — 10-second timeout, retry button, offline detection.

32. **Stopped questions showing up in the chat.** If I send a question through the popup and then stop ChatGPT's generation immediately, the question (and sometimes the empty response) would show up in the regular chat as if I typed it myself. Never fully solved — avoided by disabling the stop button while a Popup response is generating. Users can still stop their own (non-Popup) questions normally.
