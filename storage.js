// storage.js — Persistence for highlight-to-message mappings using chrome.storage.local

const STORAGE_KEY = "jumpreturn_highlights";

/**
 * Get all saved highlights.
 */
async function getHighlights() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return result[STORAGE_KEY] || [];
}

/**
 * Save a new highlight.
 * @param {string} text - The highlighted text (to re-find it on page load)
 * @param {string} url - The page URL
 * @param {string} site - The AI chat site (e.g. "chatgpt", "claude")
 * @param {string|null} parentId - If this highlight is inside a popup, the parent highlight's id
 */
async function saveHighlight({ text, url, site, parentId = null }) {
  const highlights = await getHighlights();
  const newHighlight = {
    id: crypto.randomUUID(),
    text,
    url,
    site,
    parentId,
    questionIndex: null,
    responseIndex: null,
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
 * Clear all highlights.
 */
async function clearAllHighlights() {
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}
