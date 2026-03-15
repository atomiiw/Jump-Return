// storage.js — Persistence for highlight-to-message mappings using chrome.storage.local
//
// Storage model (quoteId-based):
// Each record = one version of a highlight: { id, quoteId, text, sentence, blockTypes,
//   question, responseHTML, url, site, parentId, sourceTurnIndex, questionIndex,
//   responseIndex, color, createdAt, active }
// Records sharing the same quoteId are versions of the same highlight (same quote,
// different question+response). Only one per quoteId has active=true.
// parentId references the parent highlight's quoteId for chained popups.

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
 * Migrate old storage format to new quoteId-based format.
 * - Records without quoteId: set quoteId = id, active = true
 * - Records with versions array: expand into separate records
 */
function migrateToQuoteIdFormat(highlights) {
  var migrated = [];
  for (var i = 0; i < highlights.length; i++) {
    var h = highlights[i];
    if (h.quoteId) {
      migrated.push(h);
      continue;
    }

    if (h.versions && h.versions.length > 0) {
      var activeIdx = h.activeVersion != null ? h.activeVersion : h.versions.length - 1;
      for (var vi = 0; vi < h.versions.length; vi++) {
        var v = h.versions[vi];
        migrated.push({
          id: h.id + "-v" + vi,
          quoteId: h.id,
          text: h.text,
          sentence: h.sentence || null,
          blockTypes: h.blockTypes || null,
          question: v.question || null,
          responseHTML: v.responseHTML || null,
          color: h.color || null,
          url: h.url,
          site: h.site,
          parentId: h.parentId || null,
          sourceTurnIndex: h.sourceTurnIndex,
          questionIndex: v.questionIndex != null ? v.questionIndex : h.questionIndex,
          responseIndex: v.responseIndex != null ? v.responseIndex : h.responseIndex,
          createdAt: h.createdAt,
          active: (vi === activeIdx),
        });
      }
    } else {
      h.quoteId = h.id;
      h.active = true;
      delete h.versions;
      delete h.activeVersion;
      migrated.push(h);
    }
  }
  return migrated;
}

/**
 * Get all saved highlights, migrating old format if needed.
 */
async function getHighlights() {
  if (!isContextValid()) return [];
  const result = await chrome.storage.local.get(STORAGE_KEY);
  var highlights = result[STORAGE_KEY] || [];

  var needsMigration = false;
  for (var i = 0; i < highlights.length; i++) {
    if (!highlights[i].quoteId) { needsMigration = true; break; }
  }

  if (needsMigration) {
    highlights = migrateToQuoteIdFormat(highlights);
    await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
  }

  return highlights;
}

/**
 * Save a new highlight item.
 * If another item with the same quoteId exists, it is deactivated.
 * @param {object} opts
 * @param {string} [opts.id] - Unique item id (defaults to crypto.randomUUID())
 * @param {string} [opts.quoteId] - Quote id shared across versions (defaults to crypto.randomUUID())
 * @param {string} opts.text - The highlighted text
 * @param {string|null} [opts.sentence] - Sentence context
 * @param {Array|null} [opts.blockTypes] - Block type metadata
 * @param {string|null} [opts.responseHTML] - AI response HTML
 * @param {string} opts.url - The page URL
 * @param {string} opts.site - The AI chat site
 * @param {string|null} [opts.parentId] - Parent highlight's quoteId (for chained popups)
 * @param {string|null} [opts.parentItemId] - Specific parent item id this child was created in
 * @param {number|null} [opts.sourceTurnIndex] - Turn containing the highlighted text
 * @param {number|null} [opts.questionIndex] - Turn of the injected question
 * @param {number|null} [opts.responseIndex] - Turn of the AI response
 * @param {string|null} [opts.question] - The follow-up question
 * @param {string|null} [opts.color] - Highlight color name
 * @param {boolean} [opts.active] - Whether this is the active version (default true)
 */
async function saveHighlight({ id, quoteId, text, sentence, blockTypes, responseHTML, url, site, parentId = null, parentItemId = null, sourceTurnIndex = null, questionIndex = null, responseIndex = null, question = null, color = null, active = true }) {
  if (!isContextValid()) return null;
  const highlights = await getHighlights();
  const newQuoteId = quoteId || crypto.randomUUID();
  const newHighlight = {
    id: id || crypto.randomUUID(),
    quoteId: newQuoteId,
    text,
    sentence: sentence || null,
    blockTypes: blockTypes || null,
    responseHTML: responseHTML || null,
    question: question || null,
    color: color || null,
    url,
    site,
    parentId,
    parentItemId: parentItemId || null,
    sourceTurnIndex,
    questionIndex,
    responseIndex,
    createdAt: Date.now(),
    active: active !== false,
  };

  // If adding a new active version, deactivate siblings
  if (newHighlight.active) {
    for (var i = 0; i < highlights.length; i++) {
      if (highlights[i].quoteId === newQuoteId) {
        highlights[i].active = false;
      }
    }
  }

  highlights.push(newHighlight);
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
  return newHighlight;
}

/**
 * Link a highlight item to its Q&A message indices in the chat flow.
 * @param {string} id - The item id
 * @param {number} questionIndex
 * @param {number} responseIndex
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
 * Get all items sharing the same quoteId, sorted by createdAt.
 * @param {string} quoteId
 */
async function getItemsByQuoteId(quoteId) {
  var highlights = await getHighlights();
  return highlights
    .filter(function (h) { return h.quoteId === quoteId; })
    .sort(function (a, b) { return (a.createdAt || 0) - (b.createdAt || 0); });
}

/**
 * Get active child highlights (chained popups) for a given parent quoteId.
 * If parentItemId is provided, only returns children created in that specific version.
 * Returns only the active item for each child quoteId.
 * @param {string} parentQuoteId
 * @param {string} [parentItemId] - Optional: filter to children of this specific parent item
 */
async function getChildHighlights(parentQuoteId, parentItemId) {
  const highlights = await getHighlights();
  return highlights.filter(function (h) {
    if (h.parentId !== parentQuoteId || !h.active) return false;
    if (parentItemId && h.parentItemId && h.parentItemId !== parentItemId) return false;
    return true;
  });
}

/**
 * Get highlights for a specific URL.
 * @param {string} url
 */
async function getHighlightsByUrl(url) {
  const highlights = await getHighlights();
  return highlights.filter((h) => h.url === url);
}

/**
 * Delete all items with a given quoteId and all their descendants.
 * @param {string} quoteId
 */
async function deleteHighlight(quoteId) {
  if (!isContextValid()) return;
  let highlights = await getHighlights();
  const quoteIdsToDelete = new Set();

  function collectDescendants(parentQuoteId) {
    quoteIdsToDelete.add(parentQuoteId);
    // Find all unique child quoteIds whose parentId matches
    var childQuoteIds = new Set();
    for (var i = 0; i < highlights.length; i++) {
      if (highlights[i].parentId === parentQuoteId) {
        childQuoteIds.add(highlights[i].quoteId);
      }
    }
    childQuoteIds.forEach(function (cqid) {
      collectDescendants(cqid);
    });
  }

  collectDescendants(quoteId);
  highlights = highlights.filter(function (h) {
    return !quoteIdsToDelete.has(h.quoteId);
  });
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
}

/**
 * Update the responseHTML of an existing item in storage.
 * @param {string} id - The item id
 * @param {string} responseHTML - The updated response HTML
 */
async function updateHighlightResponseHTML(id, responseHTML) {
  if (!isContextValid()) return;
  const highlights = await getHighlights();
  const highlight = highlights.find(function (h) { return h.id === id; });
  if (!highlight) return;
  highlight.responseHTML = responseHTML;
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
}

/**
 * Update the color of all items sharing a quoteId.
 * @param {string} quoteId
 * @param {string} color - The color name
 */
async function updateHighlightColor(quoteId, color) {
  if (!isContextValid()) return;
  var highlights = await getHighlights();
  for (var i = 0; i < highlights.length; i++) {
    if (highlights[i].quoteId === quoteId) {
      highlights[i].color = color;
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
}

/**
 * Count total descendant highlights (unique quoteIds) under a quoteId.
 * @param {string} quoteId
 * @returns {Promise<number>}
 */
async function countDescendants(quoteId) {
  var highlights = await getHighlights();
  var visited = new Set();
  function walk(parentQuoteId) {
    var childQuoteIds = new Set();
    for (var i = 0; i < highlights.length; i++) {
      if (highlights[i].parentId === parentQuoteId) {
        childQuoteIds.add(highlights[i].quoteId);
      }
    }
    childQuoteIds.forEach(function (cqid) {
      if (!visited.has(cqid)) {
        visited.add(cqid);
        walk(cqid);
      }
    });
  }
  walk(quoteId);
  return visited.size;
}

/**
 * Get a single item by its id.
 * @param {string} id
 */
async function getHighlight(id) {
  var highlights = await getHighlights();
  return highlights.find(function (h) { return h.id === id; }) || null;
}

/**
 * Get all items for a quoteId (for collecting turn indices during delete).
 * @param {string} quoteId
 */
async function getHighlightsByQuoteId(quoteId) {
  var highlights = await getHighlights();
  return highlights.filter(function (h) { return h.quoteId === quoteId; });
}

/**
 * Set the active item for a quoteId. Deactivates all others.
 * @param {string} quoteId
 * @param {string} itemId - The item id to make active
 */
async function setActiveItem(quoteId, itemId) {
  if (!isContextValid()) return;
  var highlights = await getHighlights();
  for (var i = 0; i < highlights.length; i++) {
    if (highlights[i].quoteId === quoteId) {
      highlights[i].active = (highlights[i].id === itemId);
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: highlights });
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
