# Style Guide

## General Rules
- All styles live in `styles.css` — no inline styles in JS (only computed `left`/`top` for positioning)
- Every class is prefixed with `jr-` to avoid collisions with host site styles
- Use CSS custom properties (`--jr-*`) for all colors, radii, shadows, and fonts so theming is centralized

## CSS Variables

Defined on `:root` and overridden for dark mode.

| Variable | Light | Dark | Usage |
|---|---|---|---|
| `--jr-bg` | `#ffffff` | `#1e1e2e` | Popup & input background |
| `--jr-border` | `#e0e0e0` | `#3a3a4a` | Borders |
| `--jr-text` | `#1a1a1a` | `#e4e4e7` | Primary text |
| `--jr-text-muted` | `#6b7280` | `#9ca3af` | Blockquote / secondary text |
| `--jr-accent` | `#2563eb` | `#3b82f6` | Send button, focus ring |
| `--jr-accent-hover` | `#1d4ed8` | `#2563eb` | Button hover state |
| `--jr-highlight-bg` | `#f3f4f6` | `#2a2a3c` | Blockquote background |
| `--jr-highlight-border` | `#d1d5db` | `#4a4a5a` | Blockquote left border |
| `--jr-mark-bg` | `rgba(37,99,235,0.12)` | `rgba(59,130,246,0.2)` | Inline selection mark |
| `--jr-radius` | `12px` | `12px` | Border radius |
| `--jr-shadow` | light shadow | deeper shadow | Popup box shadow |
| `--jr-font` | system stack | system stack | Font family |

## Dark Mode
Dark mode activates when the `<html>` element has class `dark` or any class containing `"dark"`:
```css
html.dark,
html[class*="dark"] { ... }
```
This covers ChatGPT's dark mode toggle. Other sites may need additional selectors in the future.

## Components

### `.jr-popup`
- `position: absolute`, `z-index: 999999`
- 360px wide, 14px padding, 12px border radius
- Subtle fade-in animation (`jr-fade-in`, 0.15s ease-out)
- Only `left` and `top` are set via JS; everything else is in CSS

### `.jr-popup-highlight`
- Blockquote-style display of the selected text
- 3px solid left border using `--jr-highlight-border`
- Muted text color, 13px font size, `word-break: break-word`

### `.jr-popup-context-list`
- List rendered inside the blockquote for both single-block (first sentence of bullet) and multi-block selections across list items
- Created as `<ul>` for bullet lists or `<ol>` for numbered lists, matching the original content
- `margin: 0`, `padding-left: 1.2em`; explicit `list-style-type` overrides ChatGPT's CSS reset (`list-style: none` on `<ul>`)
- `<ol>` uses `start` attribute to preserve original ordinal numbers (e.g. item 4 shows as "4." not "1.")
- Depth classes (`jr-depth-1`, `jr-depth-2`) provide indentation and alternate marker styles
  - `ul`: disc → circle → square
  - `ol`: decimal → lower-alpha → lower-roman
- `jr-li-cont` class on continuation items (same `<li>`, second `<p>`) suppresses the bullet marker

### `.jr-popup-context-block`
- Block-level `<div>` wrapper for paragraphs and headings in mixed list/non-list content
- `margin-bottom: 6px` (last child 0)
- `.jr-popup-context-heading` variant: `font-weight: 600`, primary text color

### `.jr-popup-input-row`
- Flex row with 8px gap containing the input and send button

### `.jr-popup-input`
- Fills available width (`flex: 1`)
- 8px 12px padding, 8px border radius
- Blue focus ring: `box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2)`

### `.jr-popup-send`
- Fixed-width blue button, white text, 500 weight
- Hover darkens background, active scales to 0.97

### `.jr-popup-send-group`
- Flex container wrapping the send button and dropdown toggle
- `position: relative` to anchor the dropdown
- `border-radius: 8px`, shared rounded corners

### `.jr-popup-send-toggle`
- Small button with `▾` arrow, right side of the split button
- `border-radius: 0 8px 8px 0`, 1px left border separator (`rgba(255,255,255,0.2)`)
- Same blue background as send, hover darkens

### `.jr-popup-dropdown`
- `position: absolute`, anchored above the split button group (`bottom: 100%`)
- Uses `--jr-bg`, `--jr-border`, `--jr-shadow` for theming
- `border-radius: 8px`, `min-width: 120px`, `z-index: 1`

### `.jr-popup-dropdown-item`
- `padding: 6px 12px`, `font-size: 13px`, `cursor: pointer`
- Hover: `background: var(--jr-highlight-bg)`
- `.active` variant: `color: var(--jr-accent)`, `font-weight: 500`

### `.jr-popup-mark`
- Inline `<span>` within the blockquote that highlights the exact selection
- `background: var(--jr-mark-bg)` — subtle accent-colored background
- `border-radius: 2px`, `padding: 1px 0`
- Always rendered when sentence context is available — wraps the entire text when the selection equals the full sentence

### `.jr-popup-pill`
- Inline `<span>` for citation references detected via `data-testid="webpage-citation-pill"`
- Boxed appearance: `border: 1px solid var(--jr-border)`, `border-radius: 4px`, `padding: 1px 5px`
- Slightly smaller font (`0.85em`) with `--jr-highlight-bg` background
- Visually separates citation references from surrounding sentence text
- Can overlap with `.jr-popup-mark` when a citation is inside the highlighted selection

### `.jr-source-highlight`
- Inline `<span>` wrapping text nodes in the AI response to create a persistent "shadow highlight"
- `background: var(--jr-mark-bg)` — same subtle accent tint as `.jr-popup-mark` for visual consistency
- `border-radius: 2px`
- `user-select: text` — ensures text is natively selectable for copy even if the host site disables selection
- Dynamically added when a popup opens from a selection; removed (unwrapped) when the popup is dismissed
- Multiple spans may exist simultaneously when the selection spans multiple text nodes (e.g. across bold/italic boundaries)

### `.jr-source-highlight-done`
- Added to `jr-source-highlight` spans after a response is captured, signaling the highlight is completed and clickable
- `cursor: pointer` — indicates the highlight can be clicked to re-open the popup
- Persists after popup dismiss (unlike plain `jr-source-highlight` which is unwrapped on dismiss for in-progress highlights)
- Used as click target selector: `document.addEventListener("click", ...)` checks for this class
- Each span also gets `data-jr-highlight-id` attribute linking to the in-memory `completedHighlights` Map

### `.jr-hidden`
- Applied to conversation turns to hide injected Q&A from the main chat flow
- `display: none !important` — ensures the turn is fully hidden regardless of host styles
- Added/removed dynamically by the response capture logic

### `.jr-popup-loading`
- Loading indicator shown inside the popup while waiting for the AI response
- `padding: 12px 0 4px 0`, centered text
- `font-size: 13px`, muted text color (`--jr-text-muted`)
- Text content changes: "Waiting for response…" → "Response timed out." on timeout

### `.jr-popup-response`
- Container for the AI response content displayed inside the popup
- `margin-top: 12px`, `padding-top: 12px`, separated by a top border (`--jr-border`)
- `max-height: 300px` with `overflow-y: auto` for scrollable long responses
- `font-size: 14px`, `line-height: 1.6`, `word-break: break-word`
- `user-select: text` — ensures response text is selectable for chained popup highlighting even if the host site disables selection
- **Markdown formatting** (Step 5b): targeted child rules restore spacing and visual structure for elements cloned from ChatGPT's rendered markdown:
  - `p`: `margin: 0 0 1em 0` (last-child 0)
  - `h1`–`h6`: `margin: 1.25em 0 0.5em 0`, `font-weight: 600`, `line-height: 1.3` (first-child margin-top 0)
  - `hr`: `border: none; border-top: 1px solid var(--jr-border); margin: 1em 0`
  - `pre`: background tint, 1px border, `border-radius: 6px`, `padding: 12px`, `overflow-x: auto`
  - `code`: background tint, `border-radius: 3px`, `padding: 2px 4px`; `pre code` resets to inherit
  - `blockquote`: 3px left border, background tint, muted text color
  - `ul`/`ol`: `margin: 1em 0`, `padding-left: 1.5em`; explicit `list-style-type`
  - `table`: `border-collapse: collapse`, `width: 100%`; `th`/`td` borders, padding; `th` background tint
  - `a`: accent color, underline
  - `img`: `max-width: 100%`, `height: auto`

### Resizable Popup (Step 5a)
- Popups are resizable by dragging the left or right edge
- 6px edge detection zone within the popup's 14px padding — does not overlap content areas
- `col-resize` cursor shown on hover near edges; reverts on mouse leave
- During drag: `document`-level `mousemove`/`mouseup` listeners track resize; `preventDefault` on initial mousedown prevents text selection
- Minimum width: 280px; maximum width: `window.innerWidth - 32`
- `customPopupWidth` (module-level variable) persists the last resized width for the page session
- All popup creators (`createPopup`, `openCompletedPopup`, `createChainedPopup`) apply `customPopupWidth` as an inline `style.width` override
- `positionPopup()` measures `popup.offsetWidth` from the DOM (after offscreen append) instead of using a hardcoded value
- `repositionPopup()` and window resize handlers use `popup.offsetWidth` / `activePopup.offsetWidth`

## Naming Convention
All classes follow the pattern: `.jr-<component>-<element>`
- `.jr-popup` — the container
- `.jr-popup-highlight` — the blockquote inside the popup
- `.jr-popup-input` — the text input inside the popup
- `.jr-popup-send` — the send button inside the popup
