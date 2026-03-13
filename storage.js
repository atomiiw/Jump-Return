// storage.js — Persistence for highlight-to-message mappings using chrome.storage.local

const STORAGE_KEY = "jumpreturn_highlights";
const DELETED_TURNS_KEY = "jumpreturn_deleted_turns";

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
 * @param {string} opts.site - The AI chat site (e.g. "chatgpt")
 * @param {string|null} [opts.parentId] - If this highlight is inside a popup, the parent highlight's id
 * @param {number|null} [opts.sourceTurnIndex] - Turn number of the article containing the highlighted text
 * @param {number|null} [opts.questionIndex] - Turn number of the injected question
 * @param {number|null} [opts.responseIndex] - Turn number of the AI response
 * @param {string|null} [opts.question] - The follow-up question the user asked
 * @param {string|null} [opts.color] - Highlight color name (e.g. "blue", "yellow")
 */
async function saveHighlight({ id, text, sentence, blockTypes, responseHTML, url, site, parentId = null, sourceTurnIndex = null, questionIndex = null, responseIndex = null, question = null, color = null }) {
  if (!isContextValid()) return null;
  const highlights = await getHighlights();
  const newHighlight = {
    id: id || crypto.randomUUID(),
    text,
    sentence: sentence || null,
    blockTypes: blockTypes || null,
    responseHTML: responseHTML || null,
    question: question || null,
    color: color || null,
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
  return highlights.filter((h) => h.url === url);
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
 * Update the color of an existing highlight in storage.
 * @param {string} id - The highlight id
 * @param {string} color - The color name (e.g. "blue", "yellow")
 */
async function updateHighlightColor(id, color) {
  if (!isContextValid()) return;
  var highlights = await getHighlights();
  var hl = highlights.find(function (h) { return h.id === id; });
  if (!hl) return;
  hl.color = color;
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
}

/**
 * Count total descendants (chained Q&As) under a highlight.
 * @param {string} id
 * @returns {Promise<number>}
 */
async function countDescendants(id) {
  var highlights = await getHighlights();
  var count = 0;
  function walk(parentId) {
    highlights.filter(function (h) { return h.parentId === parentId; }).forEach(function (child) {
      count++;
      walk(child.id);
    });
  }
  walk(id);
  return count;
}

/**
 * Get a single highlight by id.
 * @param {string} id
 */
async function getHighlight(id) {
  var highlights = await getHighlights();
  return highlights.find(function (h) { return h.id === id; }) || null;
}

/**
 * Add a new version to an existing highlight (edit question flow).
 * Lazily initializes the versions array from top-level fields if absent.
 * @param {string} id
 * @param {object} versionObj - { question, responseHTML, questionIndex, responseIndex }
 */
async function addHighlightVersion(id, versionObj) {
  if (!isContextValid()) return null;
  var highlights = await getHighlights();
  var hl = highlights.find(function (h) { return h.id === id; });
  if (!hl) return null;

  if (!hl.versions) {
    hl.versions = [{
      question: hl.question,
      responseHTML: hl.responseHTML,
      questionIndex: hl.questionIndex,
      responseIndex: hl.responseIndex,
    }];
  }

  hl.versions.push(versionObj);
  hl.activeVersion = hl.versions.length - 1;
  hl.question = versionObj.question;
  hl.responseHTML = versionObj.responseHTML;
  hl.questionIndex = versionObj.questionIndex;
  hl.responseIndex = versionObj.responseIndex;

  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
  return hl;
}

/**
 * Switch the active version of a highlight.
 * @param {string} id
 * @param {number} index - 0-based index into versions array
 */
async function setHighlightActiveVersion(id, index) {
  if (!isContextValid()) return null;
  var highlights = await getHighlights();
  var hl = highlights.find(function (h) { return h.id === id; });
  if (!hl) return null;

  if (!hl.versions) {
    hl.versions = [{
      question: hl.question,
      responseHTML: hl.responseHTML,
      questionIndex: hl.questionIndex,
      responseIndex: hl.responseIndex,
    }];
  }

  if (index < 0 || index >= hl.versions.length) return null;

  hl.activeVersion = index;
  var v = hl.versions[index];
  hl.question = v.question;
  hl.responseHTML = v.responseHTML;
  hl.questionIndex = v.questionIndex;
  hl.responseIndex = v.responseIndex;

  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
  return hl;
}

/**
 * Save turn indices that should stay hidden after a highlight is deleted.
 * Stored per-URL so they only apply to the correct conversation.
 * @param {string} url - The conversation URL
 * @param {number[]} turnIndices - Turn indices to keep hidden
 */
async function addDeletedTurns(url, turnIndices) {
  if (!isContextValid()) return;
  var result = await chrome.storage.local.get(DELETED_TURNS_KEY);
  var all = result[DELETED_TURNS_KEY] || {};
  if (!all[url]) all[url] = [];
  for (var i = 0; i < turnIndices.length; i++) {
    if (turnIndices[i] > 0 && all[url].indexOf(turnIndices[i]) === -1) {
      all[url].push(turnIndices[i]);
    }
  }
  await chrome.storage.local.set({ [DELETED_TURNS_KEY]: all });
}

/**
 * Get turn indices that should stay hidden for a given URL.
 * @param {string} url
 * @returns {Promise<number[]>}
 */
async function getDeletedTurns(url) {
  if (!isContextValid()) return [];
  var result = await chrome.storage.local.get(DELETED_TURNS_KEY);
  var all = result[DELETED_TURNS_KEY] || {};
  return all[url] || [];
}

/**
 * Clear all highlights.
 */
async function clearAllHighlights() {
  if (!isContextValid()) return;
  await chrome.storage.local.set({ [STORAGE_KEY]: [] });
}
