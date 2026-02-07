# Jump Return — Chrome Extension

## Overview
A Chrome extension that lets users highlight any sentence in AI chat responses, ask follow-up questions in a floating popup, and chain deeper follow-ups — all while keeping the full conversation on the same thread so the AI retains context.

## How It Works
1. User highlights text in an AI response
2. A floating popup appears near the highlight with an input field
3. User types a follow-up question in the popup
4. Extension submits it through the site's actual chat input (uses the user's account, no API key needed)
5. Extension hides that Q&A pair from the main chat flow
6. Displays the AI response inside the popup instead
7. User can highlight text inside the popup → spawns a chained popup for deeper follow-ups

The AI platform's backend has the full conversation (all popup Q&As are real messages in the thread), so it keeps full context, memory, and continuity. The extension only rearranges the presentation layer.

Without the extension installed, the user still sees all Q&A in their normal chat history — just unordered/cluttered, but nothing is lost.

## Architecture
- **Manifest V3** Chrome extension
- `manifest.json` — Extension config, permissions, and content script registration
- `storage.js` — Persistence for highlights and their associated Q&A chains using chrome.storage.local
- `icons/` — Extension icons (16, 48, 128px)
- **Permissions:** `storage` (persist highlights + Q&A), `activeTab`
- **Supported sites:** ChatGPT, Claude, Gemini, Microsoft Copilot

## Docs
- [Features](docs/FEATURES.md)
- [Style Guide](docs/STYLE_GUIDE.md)
- [TODO](docs/TODO.md) — **read this before every task**

## Dev Rules
- **Read `docs/TODO.md`, `docs/FEATURES.md`, and `docs/STYLE_GUIDE.md` before every task.** No exceptions.
- **Follow the TODO steps in order.** Only work on the current step. Do not add features, fix-forward, or jump to later steps — even if the user reports a trivial issue. If a bug report relates to a stub or placeholder from the current step, explain that it's expected behavior for this step.
- Always match the style guide for any UI changes (see docs/STYLE_GUIDE.md)
- Keep all styles in `styles.css` — no inline styles in JS
- Test on all supported sites before considering a feature done
- Use `chrome.storage.local` for highlights, Q&A chains, and user preferences
