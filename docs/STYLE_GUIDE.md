# Style Guide

## General Rules
- All styles live in `styles.css` — no inline styles in JS (only computed `left`/`top`/`width` for positioning)
- Every class is prefixed with `jr-` to avoid collisions with host site styles
- Use CSS custom properties (`--jr-*`) for all colors, radii, shadows, and fonts so theming is centralized
- Single highlight color (brand blue) — no multi-color picker

## Brand
- **Blue:** `#1944f1` — the single brand/accent color
- **White:** `#ffffff` — popup surfaces
- Two-color system: blue for action/highlights, monochrome for everything else

## CSS Variables

Defined on `:root` and overridden for dark mode.

| Variable | Light | Dark | Usage |
|---|---|---|---|
| `--jr-bg` | `#ffffff` | `#1a1c22` | Popup & surface background |
| `--jr-border` | `#e3e1e1` | `#2e3038` | Borders, separators |
| `--jr-text` | `#191414` | `#e4e4e7` | Primary text |
| `--jr-text-muted` | `#6b7280` | `#8b92a8` | Secondary text, idle icons |
| `--jr-action` | `#1944f1` | `#5a7af7` | Brand blue — hover color, links, send button, focus |
| `--jr-action-hover` | `#1539cc` | `#7b95f9` | Hover state for action-colored elements |
| `--jr-highlight-bg` | `#edebeb` | `#232630` | Blockquote background, code bg fallback |
| `--jr-highlight-border` | `#d7d5d5` | `#383b45` | Blockquote borders, question underline |
| `--jr-separator` | `#a3a2a2` | `#656570` | Search bar count separator |
| `--jr-radius` | `8px` | `8px` | Border radius for cards, popups, dropdowns |
| `--jr-radius-pill` | `12px` | `12px` | Border radius for pill shapes (search bar base) |
| `--jr-mark-bg` | `#1944f1` | `#1944f1` | Highlight color on page text (white text on blue) |
| `--jr-mark-bg-hover` | `#1539cc` | `#3d5ef3` | Highlight hover (darker in light, lighter in dark) |
| `--jr-mark-bg-active` | `#112fa8` | `#1539cc` | Highlight active (popup open) |
| `--jr-shadow` | `0 2px 8px rgba(0,0,0,0.12), 0 0.5px 4px rgba(0,0,0,0.06)` | `0 2px 8px rgba(0,0,0,0.4), 0 0.5px 4px rgba(0,0,0,0.2)` | Two-layer elevation shadow |
| `--jr-focus-ring` | `rgba(25,68,241,0.25)` | `rgba(90,122,247,0.35)` | Focus-visible outline glow |
| `--jr-link` | `#1944f1` | `#5a7af7` | Link color in response text |
| `--jr-font` | system stack | system stack | Font family |
| `--jr-icon-btn-size` | `16px` | `16px` | Icon size inside circle buttons |
| `--jr-icon-btn-circle` | `36px` | `36px` | Circle button diameter (trigger, search, trash) |

## Dark Mode
Dark mode activates when the `<html>` element has class `dark` or any class containing `"dark"`:
```css
html.dark,
html[class*="dark"] { ... }
```
Dark mode uses neutral-cool dark backgrounds with a subtle blue undertone (not purple). The brand blue `#1944f1` is used directly for highlights; a lighter `#5a7af7` is used for interactive elements to maintain WCAG AA contrast.

## Hover System

All interactive elements use **scale on hover** with a unified 3-tier system:

| Tier | Scale | Used by |
|---|---|---|
| **Subtle** (large elements, text) | `1.08` | Circle buttons (trigger, search, trash), reply button, dropdown items |
| **Medium** (inline icons) | `1.2` | Send arrow, edit pencil, version arrows, search prev/next |
| **Firm** (small icons, nav) | `1.3` | Nav arrows, confirm icons, disable × |

All hover transitions use `0.15s ease`. Press/active states use `scale(1.35)` for confirm buttons, `scale(0.97)` for the send button.

### Hover Color Rules
- **Action elements** (trigger, search, pencil, send, nav, version, reply, dropdown items, search arrows): idle `--jr-text-muted` → hover `--jr-action` (blue)
- **Destructive** (trash, danger confirm): idle `--jr-text-muted` → hover `#ef4444` (red)
- **Utility** (disable ×): idle `--jr-text-muted` → hover `--jr-action` (blue)
- **Question underline**: idle `--jr-highlight-border` → hover/focus `--jr-action` (blue)

## Components

### Circle Buttons (`.jr-highlight-trigger-btn`, `.jr-search-bar--ready`, `.jr-toolbar-delete`)
- `var(--jr-icon-btn-circle)` diameter (36px), `border-radius: 50%`
- `1px solid var(--jr-border)`, `background: var(--jr-bg)`, `box-shadow: var(--jr-shadow)`
- Icon: `var(--jr-icon-btn-size)` (16px), `color: var(--jr-text-muted)`
- Hover: `color: var(--jr-action)`, `scale: 1.08` (trash: `color: #ef4444`)
- Trigger button: positioned fixed near selection, dismissed on scroll/click-outside/Escape
- Search button: positioned fixed at top-center of chat column
- Trash button: floats at `top: -14px; right: -14px` of popup

### `.jr-popup`
- `position: absolute`, `z-index: 99`, `display: flex; flex-direction: column`
- `min(360px, calc(100vw - 32px))` wide, `max-height: min(520px, 70vh)`
- `border-radius: var(--jr-radius)` (4px), `box-shadow: 0 0 0 1px border + elevation`
- Fade-in animation (`jr-fade-in`, 0.15s ease-out)
- Only `left`, `top`, and `width` are set via JS
- Height caps: quote scrolls at 6 lines, question scrolls at 4 lines, response fills remaining space and scrolls

### `.jr-popup-arrow`
- 18px wide, 9px tall CSS triangle
- Two pseudo-elements: `::before` (border color) and `::after` (fill color, offset 2px)
- `.jr-popup-arrow--up` at `top: -9px`, `.jr-popup-arrow--down` at `bottom: -9px`
- Horizontal `left` set by JS to track highlight center

### `.jr-popup-highlight`
- Blockquote display of selected text context
- `.jr-popup-highlight-inner`: `background: var(--jr-highlight-bg)`, `border-radius: var(--jr-radius)`, `padding: 10px 10px 10px 32px`
- ↩ reply icon as `::before` pseudo at `top: 10px; left: 10px` (14px, `--jr-text-muted`)

### `.jr-popup-mark`
- Inline highlight of the exact selected text within the blockquote
- `background: var(--jr-mark-bg)`, `color: #fff`, no border-radius

### `.jr-source-highlight`
- Inline `<span>` wrapping highlighted text on the page
- `background: var(--jr-mark-bg)`, `color: #fff`, `user-select: text`
- `.jr-source-highlight-done`: persists after popup close, `cursor: pointer`, `transition: background 0.12s ease`
- Hover: `--jr-mark-bg-hover`, Active (popup open): `--jr-mark-bg-active`

### `.jr-highlight-underline`
- 1.5px line under highlighted text, `background: var(--jr-action)` (blue)

### `.jr-popup-question`
- `16px` font, `line-height: 1.6`, flex layout with chevron + text + controls
- `.jr-popup-question-text`: `border-bottom: 1.5px solid var(--jr-highlight-border)`, hover/focus → `var(--jr-action)`
- Placeholder via `::before` with `content: attr(data-placeholder)`

### Inline Icon Buttons (shared base)
Edit pencil, send arrow, version arrows, search prev/next, confirm icons, nav arrows, disable × all share:
- `display: flex; align-items: center; justify-content: center`
- `border: none; background: none; padding: 0; cursor: pointer`
- `color: var(--jr-text-muted); transition: color 0.15s ease, transform 0.15s ease`
- SVG icons at 14px (standard) or 20px (nav arrows)
- Hover: `color: var(--jr-action)` + tier-appropriate scale

### `.jr-popup-edit-btn`
- 24×24px, pencil icon toggle for editing question text
- Active state: `color: var(--jr-text)`

### `.jr-popup-edit-send`
- 24×24px send arrow, `color: var(--jr-text)` idle (darker than muted — primary action)
- Disabled: `color: var(--jr-text-muted)`, `opacity: 1`

### `.jr-send-mode-dropdown`
- Two-item dropdown ("Detailed" / "Concise") shown on hover of send wrapper
- `background: var(--jr-bg)`, `1px solid var(--jr-border)`, `border-radius: var(--jr-radius)`, `box-shadow: var(--jr-shadow)`
- `::after` pseudo creates 8px invisible hit area bridge
- `.jr-send-mode-item`: `padding: 5px 14px`, `font-size: 13px`, `color: var(--jr-text-muted)`
- `.jr-send-mode-item--active`: `color: var(--jr-text)`, `font-weight: 600`

### `.jr-popup-version-nav`
- Version prev/next arrows, 24×24px, `color: var(--jr-text)` idle
- Disabled: `color: var(--jr-border)`, `opacity: 1`
- `.jr-popup-version-indicator`: `font-size: 13px`, `color: var(--jr-text-muted)`

### `.jr-popup-response`
- `padding: 14px`, `border-top: 1px solid var(--jr-border)`
- `max-height: min(350px, 50vh)`, `overflow-y: auto`
- `font-size: 16px`, `line-height: 1.6`, `user-select: text`
- Scroll fade edges via `::before`/`::after` sticky pseudo-elements with `box-shadow`
- Markdown formatting: paragraphs, headings, code blocks, lists, tables, blockquotes, links, images

### `.jr-reply-whole-btn`
- `display: inline-flex`, inside `.jr-popup-response` at the bottom
- `font-size: 14px`, `color: var(--jr-text-muted)`, 14px reply arrow icon
- Hover: `color: var(--jr-action)`, `scale(1.08)`

### `.jr-popup-loading`
- `padding: 14px`, `border-top: 1px solid var(--jr-border)`, `min-height: 48px`
- `font-size: 14px`, `color: var(--jr-text-muted)`, centered

### `.jr-toolbar-delete` (floating circle)
- `position: absolute; top: -14px; right: -14px`
- Same circle button pattern as trigger/search
- Hover: `color: #ef4444` (red), `scale(1.08)`

### Delete Confirmation
- `.jr-popup-delete-confirm`: centered flex row with text + cancel ✕ + confirm ✓
- `.jr-popup-confirm-text`: `font-size: 14px`
- `.jr-popup-confirm-icon-btn`: 14px icons, hover `color: var(--jr-action)`, `scale(1.3)`
- `.jr-popup-confirm-icon-btn--danger`: `color: #ef4444`, hover `#dc2626` (dark: `#f87171`)

### `.jr-nav-widget`
- `position: fixed`, `top: 50%`, `right: 80px`, `z-index: 999999`
- Up/down arrows: 36×36px, 20px icons, `color: var(--jr-text-muted)` idle
- Disabled: `color: var(--jr-border)`, `pointer-events: none`
- `.jr-nav-indicator`: `font-size: 13px`, `color: var(--jr-text-muted)`

### Search Bar
- **Ready state**: Circle button (matches trigger/search), `z-index: 999999`
- **Active state**: 300×40px bar, `border-radius: var(--jr-radius)`, `padding: 0 4px 0 14px`, `font-size: 14px`
- `animation: jr-fade-in 0.15s ease-out` on expand
- `.jr-search-input`: inherits font, transparent bg, no border
- `.jr-search-count`: `font-size: 12px`, `border-left: 1px solid var(--jr-border)` separator
- Prev/next: 24×24px, 14px icons, `color: var(--jr-text)` enabled, `var(--jr-action)` hover

### Search Marks
- `.jr-search-mark`: `background: #fff500`, `color: #000` (yellow, non-active match)
- `.jr-search-mark-active`: `background: #1944f1`, `color: #fff` (brand blue, active match)

## Icon Color Reference

| State | Color | Used by |
|---|---|---|
| **Idle** | `var(--jr-text-muted)` | All icon buttons, circle buttons, reply, dropdown items |
| **Idle (primary)** | `var(--jr-text)` | Send arrow, version arrows, nav arrows (when enabled) |
| **Hovered** | `var(--jr-action)` (blue) | All interactive elements except destructive |
| **Destructive hover** | `#ef4444` | Trash button, danger confirm |
| **Disabled** | `var(--jr-border)` | Version arrows, nav arrows when disabled |
| **Active/pressed** | `var(--jr-text)` | Pencil edit active state |

## Accessibility
- All icon-only buttons have `aria-label` attributes
- `focus-visible` outline: `2px solid var(--jr-action)`, `offset: 2px` on all interactive elements
- `--jr-text-muted` (#6b7280) passes WCAG AA on white (4.63:1)
- White on brand blue passes WCAG AA (6.69:1)
- `@media (prefers-reduced-motion: reduce)` kills all animations/transitions

## Naming Convention
All classes follow the pattern: `.jr-<component>-<element>`
- `.jr-popup` — the container
- `.jr-popup-highlight` — the blockquote inside the popup
- `.jr-popup-question` — the question input / display row
- `.jr-popup-edit-send` — the send arrow icon
- `.jr-highlight-trigger-btn` — the chat bubble circle button
- `.jr-toolbar-delete` — the trash circle button
- `.jr-reply-whole-btn` — the reply to response button
- `.jr-search-bar` — the search bar (with `--ready` and `--active` modifiers)
