// early-hide.js — Runs at document_start to hide Q&A turns before they paint.
// Reads stored highlights + deleted turns for the current URL and injects a
// <style> element with display:none rules so turns are never visible.
(function () {
  "use strict";

  var STORAGE_KEY = "jumpreturn_highlights";
  var DELETED_TURNS_KEY = "jumpreturn_deleted_turns";
  var url = location.href;

  chrome.storage.local.get([STORAGE_KEY, DELETED_TURNS_KEY], function (result) {
    var highlights = result[STORAGE_KEY] || [];
    var deletedAll = result[DELETED_TURNS_KEY] || {};
    var deletedTurns = deletedAll[url] || [];

    var turnSet = {};

    // Collect turn indices from highlights matching this URL
    for (var i = 0; i < highlights.length; i++) {
      var h = highlights[i];
      if (h.url !== url) continue;
      if (h.questionIndex > 0) turnSet[h.questionIndex] = true;
      if (h.responseIndex > 0) turnSet[h.responseIndex] = true;
    }

    // Collect deleted turns for this URL
    for (var d = 0; d < deletedTurns.length; d++) {
      if (deletedTurns[d] > 0) turnSet[deletedTurns[d]] = true;
    }

    var indices = Object.keys(turnSet);
    if (indices.length === 0) return;

    var rules = [];
    for (var r = 0; r < indices.length; r++) {
      rules.push('article[data-testid="conversation-turn-' + indices[r] + '"]');
    }

    var style = document.createElement("style");
    style.id = "jr-early-hide";
    style.textContent = rules.join(",\n") + " { display: none !important; }";
    (document.head || document.documentElement).appendChild(style);
  });
})();
