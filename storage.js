// storage.js — Persistence for highlight-to-message mappings using chrome.storage.local

const STORAGE_KEY = "jumpreturn_highlights";

/**
 * Check if the extension context is still valid (becomes invalid after extension reload).
 */
function isContextValid() {
  try {
    return !!chrome.runtime.id;
  } catch (e) {
    return false;
  }
}

/**
 * Get all saved highlights.
 */
async function getHighlights() {
  if (!isContextValid()) return [];
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

/**
 * Save a new highlight with full data for persistence across reload.
 * @param {object} opts
 * @param {string} [opts.id] - Optional pre-generated id (defaults to crypto.randomUUID())
 * @param {string} opts.text - The highlighted text (to re-find it on page load)
 * @param {string|null} [opts.sentence] - Sentence context for popup blockquote
 * @param {Array|null} [opts.blockTypes] - Block type metadata for multi-block rendering
 * @param {string|null} [opts.responseHTML] - AI response HTML to show in popup
 * @param {string} opts.url - The page URL
 * @param {string} opts.site - The AI chat site (e.g. "chatgpt", "claude")
 * @param {string|null} [opts.parentId] - If this highlight is inside a popup, the parent highlight's id
 * @param {number|null} [opts.sourceTurnIndex] - Turn number of the article containing the highlighted text
 * @param {number|null} [opts.questionIndex] - Turn number of the injected question
 * @param {number|null} [opts.responseIndex] - Turn number of the AI response
 */
async function saveHighlight({ id, text, sentence, blockTypes, responseHTML, url, site, parentId = null, sourceTurnIndex = null, questionIndex = null, responseIndex = null }) {
  if (!isContextValid()) return null;
  const highlights = await getHighlights();
  const newHighlight = {
    id: id || crypto.randomUUID(),
    text,
    sentence: sentence || null,
    blockTypes: blockTypes || null,
    responseHTML: responseHTML || null,
    url,
    site,
    parentId,
    sourceTurnIndex,
    questionIndex,
    responseIndex,
    createdAt: Date.now(),
  };
  highlights.push(newHighlight);
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
  return newHighlight;
}

/**
 * Link a highlight to its Q&A message indices in the chat flow.
 * @param {string} id - The highlight id
 * @param {number} questionIndex - The index of the question message in the chat
 * @param {number} responseIndex - The index of the response message in the chat
 */
async function linkQA(id, questionIndex, responseIndex) {
  if (!isContextValid()) return null;
  const highlights = await getHighlights();
  const highlight = highlights.find((h) => h.id === id);
  if (!highlight) return null;
  highlight.questionIndex = questionIndex;
  highlight.responseIndex = responseIndex;
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
  return highlight;
}

/**
 * Get all child highlights (chained popups) for a given highlight.
 * @param {string} parentId
 */
async function getChildHighlights(parentId) {
  const highlights = await getHighlights();
  return highlights.filter((h) => h.parentId === parentId);
}

/**
 * Get highlights for a specific URL (top-level only).
 * @param {string} url
 */
async function getHighlightsByUrl(url) {
  const highlights = await getHighlights();
  return highlights.filter((h) => h.url === url && h.parentId === null);
}

/**
 * Delete a highlight and all its descendants.
 * @param {string} id
 */
async function deleteHighlight(id) {
  if (!isContextValid()) return;
  let highlights = await getHighlights();
  const idsToDelete = new Set();

  function collectDescendants(parentId) {
    idsToDelete.add(parentId);
    highlights
      .filter((h) => h.parentId === parentId)
      .forEach((child) => collectDescendants(child.id));
  }

  collectDescendants(id);
  highlights = highlights.filter((h) => !idsToDelete.has(h.id));
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
}

/**
 * Update the responseHTML of an existing highlight in storage.
 * Used to persist chained highlight spans in the parent's response.
 * @param {string} id - The highlight id
 * @param {string} responseHTML - The updated response HTML
 */
async function updateHighlightResponseHTML(id, responseHTML) {
  if (!isContextValid()) return;
  const highlights = await getHighlights();
  const highlight = highlights.find((h) => h.id === id);
  if (!highlight) return;
  highlight.responseHTML = responseHTML;
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
}

/**
 * Clear all highlights.
 */
async function clearAllHighlights() {
  if (!isContextValid()) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}
