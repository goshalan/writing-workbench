(function () {
  "use strict";

  var CHAT_STORAGE_KEY = "writing-workbench.chat.v1";
  var HISTORY_STORAGE_KEY = "writing-workbench.history.v1";
  var CHAT_LIMIT = 30;
  var HISTORY_LIMIT = 60;
  var STORED_TEXT_LIMIT = 4000;
  var REWRITE_TEXT_LIMIT = 24000;
  var CONTEXT_LIMIT = 60000;
  var i18n = window.WritingWorkbenchI18n;
  var API_BASE = document.documentElement.dataset.basePath || "";

  if (!i18n) {
    throw new Error("Writing Workbench i18n failed to load");
  }
  i18n.apply();

  function t(key, values) {
    return i18n.t(key, values);
  }

  var state = {
    chapters: [],
    activeFilename: "",
    activeSha256: "",
    activeMeta: null,
    loadedContent: "",
    documentPrefix: "",
    bookTitle: "Writing Workbench",
    sortKey: "name",
    sortOrder: "asc",
    provider: "unknown",
    providerReady: false,
    selection: null,
    rewrite: null,
    replacementUndo: [],
    chat: readLocalArray(CHAT_STORAGE_KEY),
    history: readLocalArray(HISTORY_STORAGE_KEY),
    loadingChapter: false,
    saving: false,
    asking: false,
    rewriting: false,
    analyzing: false,
    analysis: null,
    conflict: false
  };

  var el = {
    saveState: byId("saveState"),
    saveStateText: byId("saveStateText"),
    undoButton: byId("undoButton"),
    redoButton: byId("redoButton"),
    deleteButton: byId("deleteButton"),
    shortcutButton: byId("shortcutButton"),
    newChapterButton: byId("newChapterButton"),
    emptyCreateButton: byId("emptyCreateButton"),
    chapterSearch: byId("chapterSearch"),
    sortSelect: byId("sortSelect"),
    sortOrderButton: byId("sortOrderButton"),
    chapterLoading: byId("chapterLoading"),
    chapterList: byId("chapterList"),
    chapterEmpty: byId("chapterEmpty"),
    chapterError: byId("chapterError"),
    chapterErrorText: byId("chapterErrorText"),
    retryChaptersButton: byId("retryChaptersButton"),
    chapterCount: byId("chapterCount"),
    bookLabel: byId("bookLabel"),
    editorTitle: byId("editorTitle"),
    chapterMetadata: byId("chapterMetadata"),
    editorPlaceholder: byId("editorPlaceholder"),
    editorLoading: byId("editorLoading"),
    editor: byId("chapterEditor"),
    selectionStat: byId("selectionStat"),
    chapterStat: byId("chapterStat"),
    savedAt: byId("savedAt"),
    saveButton: byId("saveButton"),
    conflictBanner: byId("conflictBanner"),
    conflictText: byId("conflictText"),
    copyConflictButton: byId("copyConflictButton"),
    reloadConflictButton: byId("reloadConflictButton"),
    providerBadge: byId("providerBadge"),
    privacyNote: byId("privacyNote"),
    privacyText: byId("privacyText"),
    selectionStatus: byId("selectionStatus"),
    instruction: byId("rewriteInstruction"),
    instructionCount: byId("instructionCount"),
    rewriteButton: byId("rewriteButton"),
    rewriteStatus: byId("rewriteStatus"),
    rewriteResult: byId("rewriteResult"),
    replaceButton: byId("replaceButton"),
    undoReplaceButton: byId("undoReplaceButton"),
    copyRewriteButton: byId("copyRewriteButton"),
    chatTab: byId("chatTab"),
    analysisTab: byId("analysisTab"),
    historyTab: byId("historyTab"),
    chatView: byId("chatView"),
    analysisView: byId("analysisView"),
    historyView: byId("historyView"),
    chatLog: byId("chatLog"),
    chatInput: byId("chatInput"),
    sendChatButton: byId("sendChatButton"),
    analyzeButton: byId("analyzeButton"),
    analysisSafety: byId("analysisSafety"),
    analysisStatus: byId("analysisStatus"),
    analysisResult: byId("analysisResult"),
    historyList: byId("historyList"),
    clearHistoryButton: byId("clearHistoryButton"),
    newChapterDialog: byId("newChapterDialog"),
    newChapterForm: byId("newChapterForm"),
    newChapterTitleInput: byId("newChapterTitleInput"),
    newChapterFormat: byId("newChapterFormat"),
    closeNewChapterButton: byId("closeNewChapterButton"),
    cancelNewChapterButton: byId("cancelNewChapterButton"),
    createChapterButton: byId("createChapterButton"),
    deleteDialog: byId("deleteDialog"),
    deleteForm: byId("deleteForm"),
    deleteChapterName: byId("deleteChapterName"),
    closeDeleteButton: byId("closeDeleteButton"),
    cancelDeleteButton: byId("cancelDeleteButton"),
    confirmDeleteButton: byId("confirmDeleteButton"),
    shortcutDialog: byId("shortcutDialog"),
    closeShortcutButton: byId("closeShortcutButton"),
    toastStack: byId("toastStack")
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function unwrapPayload(payload) {
    if (!isPlainObject(payload)) {
      return {};
    }
    if (isPlainObject(payload.data)) {
      return Object.assign({}, payload, payload.data);
    }
    return payload;
  }

  function RequestError(message, status, code, details) {
    this.name = "RequestError";
    this.message = message || t("status.requestFailed");
    this.status = status || 0;
    this.code = code || "request_failed";
    this.details = isPlainObject(details) ? details : {};
  }

  RequestError.prototype = Object.create(Error.prototype);
  RequestError.prototype.constructor = RequestError;

  async function api(url, options) {
    var requestOptions = Object.assign({}, options || {});
    requestOptions.headers = Object.assign({ Accept: "application/json" }, requestOptions.headers || {});
    if (requestOptions.body && !requestOptions.headers["Content-Type"]) {
      requestOptions.headers["Content-Type"] = "application/json";
    }

    var response;
    try {
      var requestUrl = API_BASE && url.charAt(0) === "/" ? API_BASE + url : url;
      response = await fetch(requestUrl, requestOptions);
    } catch (_error) {
      throw new RequestError(t("status.network"), 0, "network_error");
    }

    var raw = {};
    try {
      raw = await response.json();
    } catch (_error) {
      raw = {};
    }
    var payload = unwrapPayload(raw);

    if (!response.ok || raw.ok === false || payload.ok === false) {
      var errorValue = raw.error || payload.error || {};
      var fallbackMessage = typeof errorValue === "string"
        ? errorValue
        : errorValue.message || payload.message || t("status.requestFailedCode", { status: response.status });
      var code = isPlainObject(errorValue) && errorValue.code
        ? errorValue.code
        : payload.code || "request_failed";
      var details = isPlainObject(errorValue) && isPlainObject(errorValue.details)
        ? errorValue.details
        : payload.details;
      throw new RequestError(
        i18n.errorMessage(code, fallbackMessage, response.status),
        response.status,
        code,
        details
      );
    }
    return payload;
  }

  function readLocalArray(key) {
    try {
      var value = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_error) {
      return [];
    }
  }

  function writeLocal(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_error) {
      toast(t("status.historyStorage"), "warning");
    }
  }

  function clampText(value, limit) {
    var text = String(value == null ? "" : value);
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  }

  function nowTime() {
    return new Date().toLocaleTimeString(i18n.locale, { hour: "2-digit", minute: "2-digit" });
  }

  function nowDateTime() {
    return new Date().toLocaleString(i18n.locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDate(value) {
    if (!value) {
      return t("time.unknown");
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString(i18n.locale, {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatBytes(value) {
    var bytes = Number(value || 0);
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return (bytes / 1024).toFixed(bytes < 10240 ? 1 : 0) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function countWords(value) {
    var matches = String(value || "").match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|[\u3400-\u9fff]/g);
    return matches ? matches.length : 0;
  }

  function chapterFilename(chapter) {
    return String(chapter && (chapter.filename || chapter.name || chapter.id) || "");
  }

  function chapterTitle(chapter) {
    var title = String(chapter && chapter.title || "").trim();
    if (title) {
      return title;
    }
    return chapterFilename(chapter)
      .replace(/\.(?:md|txt)$/i, "")
      .replace(/_+/g, " ")
      .trim() || t("chapters.unnamed");
  }

  function chapterListTitle(chapter) {
    return chapterTitle(chapter).replace(
      /^第\s*(?:\d+|[零〇一二三四五六七八九十百千两]+)\s*章[\s:_\-—]*/,
      ""
    ) || chapterTitle(chapter);
  }

  function normalizeChapter(value) {
    var item = typeof value === "string" ? { filename: value } : value || {};
    return {
      filename: chapterFilename(item),
      name: chapterFilename(item),
      title: chapterTitle(item),
      extension: String(item.extension || (chapterFilename(item).match(/\.[^.]+$/) || [""])[0]).toLowerCase(),
      size_bytes: Number(item.size_bytes != null ? item.size_bytes : item.size || 0),
      character_count: Number(item.character_count != null ? item.character_count : item.chars || 0),
      word_count: Number(item.word_count != null ? item.word_count : item.words || item.character_count || item.chars || 0),
      sha256: String(item.sha256 || item.hash || ""),
      modified_at: item.modified_at || item.updated_at || item.mtime || "",
      chapter_number: Number.isFinite(Number(item.chapter_number)) && item.chapter_number !== null
        ? Number(item.chapter_number)
        : null
    };
  }

  function mergeChapter(metadata) {
    var chapter = normalizeChapter(metadata);
    if (!chapter.filename) {
      return;
    }
    var index = state.chapters.findIndex(function (item) {
      return item.filename === chapter.filename;
    });
    if (index === -1) {
      state.chapters.push(chapter);
    } else {
      state.chapters[index] = chapter;
    }
  }

  function naturalCompare(left, right) {
    return String(left).localeCompare(String(right), i18n.locale, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function compareChapters(left, right) {
    var result = 0;
    if (state.sortKey === "modified") {
      result = String(left.modified_at).localeCompare(String(right.modified_at));
    } else if (state.sortKey === "words") {
      result = left.word_count - right.word_count;
    } else if (state.sortKey === "size") {
      result = left.size_bytes - right.size_bytes;
    } else if (left.chapter_number !== null && right.chapter_number !== null) {
      result = left.chapter_number - right.chapter_number;
    } else if (left.chapter_number !== null) {
      result = -1;
    } else if (right.chapter_number !== null) {
      result = 1;
    } else {
      result = naturalCompare(left.filename, right.filename);
    }
    if (result === 0) {
      result = naturalCompare(left.filename, right.filename);
    }
    return state.sortOrder === "desc" ? -result : result;
  }

  function visibleChapters() {
    var query = el.chapterSearch.value.trim().toLocaleLowerCase(i18n.locale);
    return state.chapters.filter(function (chapter) {
      if (!query) {
        return true;
      }
      return (chapter.title + " " + chapter.filename).toLocaleLowerCase(i18n.locale).indexOf(query) !== -1;
    }).sort(compareChapters);
  }

  function showListState(name) {
    el.chapterLoading.hidden = name !== "loading";
    el.chapterList.hidden = name !== "list";
    el.chapterEmpty.hidden = name !== "empty";
    el.chapterError.hidden = name !== "error";
  }

  function renderChapters() {
    var chapters = visibleChapters();
    el.chapterList.replaceChildren();
    el.chapterCount.textContent = t("chapters.count", { count: state.chapters.length });

    if (!chapters.length) {
      var searching = Boolean(el.chapterSearch.value.trim());
      el.chapterEmpty.querySelector("p").textContent = searching
        ? t("chapters.noMatches")
        : t("chapters.empty");
      el.emptyCreateButton.hidden = searching;
      showListState("empty");
      return;
    }

    var fragment = document.createDocumentFragment();
    chapters.forEach(function (chapter, index) {
      var row = document.createElement("button");
      row.type = "button";
      row.className = "chapter-row" + (chapter.filename === state.activeFilename ? " is-active" : "");
      row.dataset.filename = chapter.filename;
      row.setAttribute("aria-current", chapter.filename === state.activeFilename ? "true" : "false");

      var badge = document.createElement("span");
      badge.className = "chapter-index";
      var number = chapter.chapter_number !== null ? chapter.chapter_number : index + 1;
      badge.textContent = String(number).padStart(2, "0");

      var copy = document.createElement("span");
      copy.className = "chapter-row-copy";
      var title = document.createElement("strong");
      title.textContent = chapterListTitle(chapter);
      var meta = document.createElement("small");
      meta.textContent = t("chapters.rowMeta", {
        format: (chapter.extension || ".txt").slice(1).toUpperCase(),
        count: chapter.word_count,
        date: formatDate(chapter.modified_at)
      });
      copy.append(title, meta);

      var dot = document.createElement("span");
      dot.className = "row-dot";
      dot.setAttribute("aria-hidden", "true");
      row.append(badge, copy, dot);
      fragment.appendChild(row);
    });
    el.chapterList.appendChild(fragment);
    showListState("list");
  }

  async function loadChapters(preferredFilename, options) {
    var settings = options || {};
    if (!settings.silent) {
      showListState("loading");
    }
    try {
      var payload = await api("/api/chapters");
      var chapters = payload.chapters || payload.items || payload.files || [];
      if (!Array.isArray(chapters) && isPlainObject(chapters)) {
        chapters = Object.values(chapters);
      }
      state.chapters = Array.isArray(chapters) ? chapters.map(normalizeChapter).filter(function (item) {
        return Boolean(item.filename);
      }) : [];
      renderChapters();

      var target = preferredFilename || state.activeFilename;
      var exists = state.chapters.some(function (item) { return item.filename === target; });
      if (target && exists && settings.open !== false) {
        await loadChapter(target, { force: true, record: settings.record !== false });
      } else if (!state.activeFilename && state.chapters.length && settings.open !== false) {
        var ordered = visibleChapters();
        var current = ordered[ordered.length - 1] || state.chapters[state.chapters.length - 1];
        await loadChapter(current.filename, { force: true, record: settings.record !== false });
      } else if (!state.chapters.length) {
        clearEditor();
      }
    } catch (error) {
      el.chapterErrorText.textContent = error.message || t("chapters.loadFailed");
      showListState("error");
      toast(error.message || t("status.loadFailed"), "error");
    }
  }

  function clearEditor() {
    state.activeFilename = "";
    state.activeSha256 = "";
    state.activeMeta = null;
    state.loadedContent = "";
    state.documentPrefix = "";
    state.selection = null;
    state.rewrite = null;
    state.replacementUndo = [];
    state.conflict = false;
    el.editor.value = "";
    el.editor.disabled = true;
    el.editorTitle.textContent = t("editor.choose");
    el.chapterMetadata.textContent = t("editor.waiting");
    el.editorPlaceholder.hidden = false;
    el.editorLoading.hidden = true;
    el.conflictBanner.hidden = true;
    resetRewriteResult();
    updateEditorState();
    renderChapters();
  }

  function extractContent(payload) {
    if (typeof payload.content === "string") {
      return payload.content;
    }
    if (isPlainObject(payload.chapter) && typeof payload.chapter.content === "string") {
      return payload.chapter.content;
    }
    return "";
  }

  function splitDocumentContent(content) {
    var source = String(content || "");
    var cursor = 0;
    var frontMatter = source.match(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/);
    if (frontMatter) {
      cursor = frontMatter[0].length;
    }
    var blankLine;
    while ((blankLine = source.slice(cursor).match(/^\r?\n/))) {
      cursor += blankLine[0].length;
    }
    var title = source.slice(cursor).match(/^[ \t]*#[ \t]+[^\r\n]+[ \t]*(?:\r?\n|$)/);
    if (title) {
      cursor += title[0].length;
    }
    while ((blankLine = source.slice(cursor).match(/^\r?\n/))) {
      cursor += blankLine[0].length;
    }
    return { prefix: source.slice(0, cursor), body: source.slice(cursor) };
  }

  function documentContent() {
    return state.documentPrefix + (el.editor.value || "");
  }

  function extractChapter(payload, fallbackFilename) {
    var metadata = isPlainObject(payload.chapter) ? payload.chapter : payload;
    if (!chapterFilename(metadata) && fallbackFilename) {
      metadata = Object.assign({}, metadata, { filename: fallbackFilename, name: fallbackFilename });
    }
    return normalizeChapter(metadata);
  }

  function confirmDiscard(message) {
    if (!isDirty()) {
      return true;
    }
    return window.confirm(message || t("status.discard"));
  }

  async function loadChapter(filename, options) {
    var settings = options || {};
    if (!filename || state.loadingChapter) {
      return;
    }
    if (filename === state.activeFilename && !settings.force) {
      el.editor.focus();
      return;
    }
    if (!settings.force && !confirmDiscard()) {
      return;
    }

    state.loadingChapter = true;
    el.editorLoading.hidden = false;
    el.editorPlaceholder.hidden = true;
    updateControls();
    try {
      var payload = await api(chapterUrl(filename));
      var chapter = extractChapter(payload, filename);
      var content = extractContent(payload);
      var documentParts = splitDocumentContent(content);
      state.activeFilename = chapter.filename || filename;
      state.activeSha256 = chapter.sha256 || String(payload.sha256 || "");
      state.activeMeta = chapter;
      state.loadedContent = documentParts.body;
      state.documentPrefix = documentParts.prefix;
      state.selection = null;
      state.rewrite = null;
      state.replacementUndo = [];
      state.conflict = false;
      el.editor.value = documentParts.body;
      el.editor.disabled = false;
      el.editorTitle.textContent = chapter.title;
      el.chapterMetadata.textContent = (chapter.extension || ".txt").slice(1).toUpperCase() + " · " + formatBytes(chapter.size_bytes);
      el.savedAt.textContent = chapter.modified_at
        ? t("save.last", { date: formatDate(chapter.modified_at) })
        : t("save.loaded");
      el.conflictBanner.hidden = true;
      resetRewriteResult();
      mergeChapter(chapter);
      renderChapters();
      if (settings.record !== false) {
        addHistory("open", t("action.open"), chapter.title);
      }
      requestAnimationFrame(function () {
        el.editor.focus();
        el.editor.setSelectionRange(0, 0);
        el.editor.scrollTop = 0;
      });
    } catch (error) {
      toast(error.message || t("status.loadFailed"), "error");
      if (error.status === 404) {
        await loadChapters("", { open: false, silent: true });
        clearEditor();
      }
    } finally {
      state.loadingChapter = false;
      el.editorLoading.hidden = true;
      if (!state.activeFilename) {
        el.editorPlaceholder.hidden = false;
      }
      updateEditorState();
    }
  }

  function chapterUrl(filename) {
    return "/api/chapters/" + encodeURIComponent(filename);
  }

  function isDirty() {
    return Boolean(state.activeFilename) && el.editor.value !== state.loadedContent;
  }

  function setSaveState(kind, message) {
    el.saveState.className = "save-state is-" + kind;
    el.saveStateText.textContent = message;
  }

  function updateEditorStats() {
    var content = el.editor.value || "";
    var start = el.editor.selectionStart || 0;
    var end = el.editor.selectionEnd || 0;
    var selected = start < end ? content.slice(start, end) : "";
    var selectedWords = countWords(selected);
    var totalWords = countWords(content);
    el.selectionStat.textContent = t("editor.selectionCount", { count: selectedWords });
    el.chapterStat.textContent = t("editor.totalCount", { count: totalWords });
    if (selected && selected.trim()) {
      state.selection = { start: start, end: end, text: selected };
      el.selectionStatus.textContent = t("editor.selectedCount", { count: selectedWords });
      el.selectionStatus.classList.add("is-ready");
    } else {
      state.selection = null;
      el.selectionStatus.textContent = t("editor.noSelection");
      el.selectionStatus.classList.remove("is-ready");
    }
    updateControls();
  }

  function updateEditorState() {
    updateEditorStats();
    if (state.saving) {
      setSaveState("saving", t("save.saving"));
    } else if (state.conflict) {
      setSaveState("conflict", t("save.conflict"));
    } else if (isDirty()) {
      setSaveState("dirty", t("save.dirty"));
      el.savedAt.textContent = t("save.notWritten");
    } else if (state.activeFilename) {
      setSaveState("saved", t("save.savedManual"));
    } else {
      setSaveState("saved", t("save.localManual"));
    }
    updateControls();
  }

  function updateControls() {
    var hasChapter = Boolean(state.activeFilename) && !state.loadingChapter;
    el.saveButton.disabled = !hasChapter || !isDirty() || state.saving;
    el.deleteButton.disabled = !hasChapter || state.saving;
    el.undoButton.disabled = !hasChapter;
    el.redoButton.disabled = !hasChapter;
    var aiEnabled = state.providerReady && state.provider !== "off";
    el.rewriteButton.disabled = !aiEnabled || !hasChapter || !state.selection || state.rewriting;
    el.chatInput.disabled = !aiEnabled;
    el.sendChatButton.disabled = !aiEnabled || !hasChapter || !el.chatInput.value.trim() || state.asking;
    el.analyzeButton.disabled = !aiEnabled || !state.chapters.length || state.analyzing;
    el.analysisSafety.textContent = isDirty() ? t("analysis.unsaved") : t("analysis.savedOnly");
    el.replaceButton.disabled = !state.rewrite || !state.rewrite.text;
    el.copyRewriteButton.disabled = !state.rewrite || !state.rewrite.text;
    el.undoReplaceButton.disabled = state.replacementUndo.length === 0;
  }

  function handleEditorInput() {
    updateEditorState();
  }

  function showConflict(error, action) {
    state.conflict = true;
    var currentSha = error && error.details && error.details.current_sha256;
    el.conflictText.textContent = action === "delete"
      ? t("conflict.delete")
      : t("conflict.edit", {
        suffix: currentSha
          ? (i18n.language === "en" ? "; copy it before reloading." : "，可复制后再重新读取。")
          : (i18n.language === "en" ? "." : "。")
      });
    el.conflictBanner.hidden = false;
    updateEditorState();
    toast(t("status.conflictToast"), "warning");
  }

  async function saveChapter() {
    if (!state.activeFilename || state.saving || !isDirty()) {
      return;
    }
    state.saving = true;
    state.conflict = false;
    el.conflictBanner.hidden = true;
    setButtonBusy(el.saveButton, true, t("status.saving"));
    updateEditorState();
    var editorBodyToSave = el.editor.value;
    var contentToSave = documentContent();
    try {
      var payload = await api(chapterUrl(state.activeFilename), {
        method: "PUT",
        body: JSON.stringify({
          content: contentToSave,
          expected_sha256: state.activeSha256
        })
      });
      var chapter = extractChapter(payload, state.activeFilename);
      state.loadedContent = editorBodyToSave;
      state.activeSha256 = chapter.sha256 || String(payload.sha256 || state.activeSha256);
      state.activeMeta = chapter;
      state.conflict = false;
      el.conflictBanner.hidden = true;
      el.savedAt.textContent = t("save.justSaved");
      mergeChapter(chapter);
      renderChapters();
      addHistory("save", t("action.save"), chapter.title);
      toast(t("status.saved"));
    } catch (error) {
      if (error.status === 409 || error.code === "chapter_conflict") {
        showConflict(error, "save");
      } else {
        setSaveState("error", t("status.saveFailedState"));
        toast(error.message || t("status.saveFailed"), "error");
      }
    } finally {
      state.saving = false;
      setButtonBusy(el.saveButton, false);
      updateEditorState();
    }
  }

  async function reloadAfterConflict() {
    if (!state.activeFilename) {
      return;
    }
    if (isDirty() && !window.confirm(t("status.reloadConfirm"))) {
      return;
    }
    await loadChapter(state.activeFilename, { force: true });
    toast(t("status.reloaded"));
  }

  function setButtonBusy(button, busy, label) {
    if (!button) {
      return;
    }
    if (busy) {
      if (!button.dataset.idleHtml) {
        button.dataset.idleHtml = button.innerHTML;
      }
      button.classList.add("is-busy");
      button.disabled = true;
      if (label) {
        button.textContent = label;
      }
    } else {
      button.classList.remove("is-busy");
      if (button.dataset.idleHtml) {
        button.innerHTML = button.dataset.idleHtml;
      }
    }
  }

  function resetRewriteResult() {
    state.rewrite = null;
    el.rewriteResult.className = "rewrite-result";
    el.rewriteResult.replaceChildren();
    var copy = document.createElement("p");
    copy.className = "muted-copy";
    copy.textContent = t("rewrite.empty");
    el.rewriteResult.appendChild(copy);
    el.rewriteStatus.textContent = t("rewrite.notGenerated");
    updateControls();
  }

  function nearbyContext(selection) {
    var content = el.editor.value || "";
    var allowance = 9000;
    var before = content.slice(Math.max(0, selection.start - allowance), selection.start);
    var after = content.slice(selection.end, selection.end + allowance);
    return before + "\n\n[选中段落]\n" + selection.text + "\n[/选中段落]\n\n" + after;
  }

  function limitedContext(content) {
    var text = String(content || "");
    if (text.length <= CONTEXT_LIMIT) {
      return text;
    }
    var half = Math.floor((CONTEXT_LIMIT - 30) / 2);
    return text.slice(0, half) + "\n\n[中间内容已省略]\n\n" + text.slice(-half);
  }

  async function requestRewrite() {
    if (state.rewriting) {
      return;
    }
    updateEditorStats();
    if (!state.activeFilename) {
      toast(t("status.openFirst"), "warning");
      return;
    }
    if (!state.selection || !state.selection.text.trim()) {
      toast(t("status.selectText"), "warning");
      el.editor.focus();
      return;
    }
    if (state.selection.text.length > REWRITE_TEXT_LIMIT) {
      toast(t("status.selectionTooLarge"), "error");
      return;
    }
    if (!state.providerReady || state.provider === "off") {
      toast(t("status.aiUnavailable"), "warning");
      return;
    }

    var snapshot = {
      start: state.selection.start,
      end: state.selection.end,
      text: state.selection.text
    };
    state.rewriting = true;
    state.rewrite = null;
    el.rewriteResult.className = "rewrite-result";
    el.rewriteResult.textContent = t("status.generatingPreview");
    el.rewriteStatus.textContent = t("status.inProgress");
    setButtonBusy(el.rewriteButton, true, t("status.generating"));
    updateControls();
    try {
      var payload = await api("/api/ai/rewrite", {
        method: "POST",
        body: JSON.stringify({
          text: snapshot.text,
          instruction: el.instruction.value.trim(),
          context: nearbyContext(snapshot),
          language: i18n.language
        })
      });
      var rewritten = String(payload.result || payload.rewritten_text || payload.rewrite || payload.text || "").trim();
      if (!rewritten) {
        throw new RequestError(t("status.emptyRewrite"), 502, "empty_ai_response");
      }
      state.rewrite = {
        text: rewritten,
        selection: snapshot,
        provider: String(payload.provider || state.provider)
      };
      el.rewriteResult.className = "rewrite-result is-ready";
      el.rewriteResult.textContent = rewritten;
      el.rewriteStatus.textContent = t("status.previewComplete");
      addHistory("rewrite", t("action.rewrite"), clampText(snapshot.text, 180));
      toast(t("status.previewToast"));
    } catch (error) {
      el.rewriteResult.className = "rewrite-result is-error";
      el.rewriteResult.textContent = error.message || t("status.previewFailed");
      el.rewriteStatus.textContent = t("status.generationFailed");
      toast(error.message || t("status.previewFailed"), "error");
    } finally {
      state.rewriting = false;
      setButtonBusy(el.rewriteButton, false);
      updateControls();
    }
  }

  function locateRewriteTarget(target, content) {
    if (content.slice(target.start, target.end) === target.text) {
      return { start: target.start, end: target.end };
    }
    var first = content.indexOf(target.text);
    if (first === -1 || content.indexOf(target.text, first + target.text.length) !== -1) {
      return null;
    }
    return { start: first, end: first + target.text.length };
  }

  function replaceWithRewrite() {
    if (!state.rewrite || !state.activeFilename) {
      return;
    }
    var current = el.editor.value;
    var range = locateRewriteTarget(state.rewrite.selection, current);
    if (!range) {
      toast(t("status.changedSelection"), "error");
      return;
    }
    state.replacementUndo.push({
      content: current,
      start: range.start,
      end: range.end
    });
    state.replacementUndo = state.replacementUndo.slice(-20);
    var replacement = state.rewrite.text;
    el.editor.value = current.slice(0, range.start) + replacement + current.slice(range.end);
    el.editor.focus();
    el.editor.setSelectionRange(range.start, range.start + replacement.length);
    updateEditorState();
    addHistory("replace", t("action.replace"), clampText(replacement, 180));
    toast(t("status.replaced"));
  }

  function undoReplacement() {
    var snapshot = state.replacementUndo.pop();
    if (!snapshot) {
      toast(t("status.noUndo"), "warning");
      return;
    }
    el.editor.value = snapshot.content;
    el.editor.focus();
    el.editor.setSelectionRange(snapshot.start, snapshot.end);
    updateEditorState();
    addHistory("undo", t("action.undo"), state.activeMeta ? state.activeMeta.title : state.activeFilename);
    toast(t("status.undone"));
  }

  async function copyText(value) {
    var text = String(value || "");
    if (!text) {
      return;
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        var area = document.createElement("textarea");
        area.value = text;
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      toast(t("status.copied"));
    } catch (_error) {
      toast(t("status.copyFailed"), "error");
    }
  }

  function addHistory(type, title, detail) {
    state.history.unshift({
      type: type,
      title: clampText(title, 80),
      detail: clampText(detail, 500),
      at: nowDateTime()
    });
    state.history = state.history.slice(0, HISTORY_LIMIT);
    writeLocal(HISTORY_STORAGE_KEY, state.history);
    if (!el.historyView.hidden) {
      renderHistory();
    }
  }

  function sanitizedChat() {
    return state.chat.slice(-CHAT_LIMIT).map(function (item) {
      return {
        role: item.role === "assistant" ? "assistant" : "user",
        content: clampText(item.content, STORED_TEXT_LIMIT),
        provider: clampText(item.provider || "", 40),
        time: clampText(item.time || "", 40),
        error: Boolean(item.error)
      };
    });
  }

  function persistChat() {
    state.chat = sanitizedChat();
    writeLocal(CHAT_STORAGE_KEY, state.chat);
  }

  function renderChat() {
    el.chatLog.replaceChildren();
    if (!state.chat.length) {
      var empty = document.createElement("div");
      empty.className = "chat-empty";
      var title = document.createElement("p");
      title.textContent = t("chat.empty");
      var note = document.createElement("span");
      note.textContent = t("chat.hint");
      empty.append(title, note);
      el.chatLog.appendChild(empty);
      return;
    }

    state.chat.forEach(function (message) {
      var article = document.createElement("article");
      article.className = "chat-message " + (message.role === "user" ? "is-user" : "is-assistant") + (message.error ? " is-error" : "");
      var meta = document.createElement("div");
      meta.className = "message-meta";
      var who = document.createElement("span");
      who.textContent = message.role === "user" ? t("chat.you") : t("chat.assistant");
      var time = document.createElement("time");
      time.textContent = message.time || "";
      meta.append(who, time);
      var content = document.createElement("p");
      content.textContent = message.content || "";
      article.append(meta, content);
      el.chatLog.appendChild(article);
    });
    requestAnimationFrame(function () {
      el.chatLog.scrollTop = el.chatLog.scrollHeight;
    });
  }

  function renderHistory() {
    el.historyList.replaceChildren();
    if (!state.history.length) {
      var empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t("history.empty");
      el.historyList.appendChild(empty);
      return;
    }
    var fragment = document.createDocumentFragment();
    state.history.forEach(function (item) {
      var article = document.createElement("article");
      article.className = "history-row";
      var header = document.createElement("header");
      var title = document.createElement("strong");
      title.textContent = item.title || t("history.operation");
      var time = document.createElement("time");
      time.textContent = item.at || "";
      header.append(title, time);
      var detail = document.createElement("p");
      detail.textContent = item.detail || "";
      article.append(header, detail);
      fragment.appendChild(article);
    });
    el.historyList.appendChild(fragment);
  }

  function switchAssistantView(view) {
    var showChat = view === "chat";
    var showAnalysis = view === "analysis";
    var showHistory = view === "history";
    el.chatView.hidden = !showChat;
    el.analysisView.hidden = !showAnalysis;
    el.historyView.hidden = !showHistory;
    el.chatTab.classList.toggle("is-active", showChat);
    el.analysisTab.classList.toggle("is-active", showAnalysis);
    el.historyTab.classList.toggle("is-active", showHistory);
    el.chatTab.setAttribute("aria-selected", showChat ? "true" : "false");
    el.analysisTab.setAttribute("aria-selected", showAnalysis ? "true" : "false");
    el.historyTab.setAttribute("aria-selected", showHistory ? "true" : "false");
    if (showHistory) {
      renderHistory();
    }
  }

  function pendingChatNode() {
    var article = document.createElement("article");
    article.className = "chat-message is-assistant";
    article.id = "pendingChatMessage";
    var meta = document.createElement("div");
    meta.className = "message-meta";
    var who = document.createElement("span");
    who.textContent = t("chat.assistant");
    var time = document.createElement("time");
    time.textContent = t("chat.answering");
    meta.append(who, time);
    var dots = document.createElement("div");
    dots.className = "typing-dots";
    dots.append(document.createElement("i"), document.createElement("i"), document.createElement("i"));
    article.append(meta, dots);
    return article;
  }

  async function sendQuestion() {
    var question = el.chatInput.value.trim();
    if (!question || state.asking) {
      return;
    }
    if (!state.activeFilename) {
      toast(t("status.openFirst"), "warning");
      return;
    }
    if (!state.providerReady || state.provider === "off") {
      toast(t("status.aiUnavailable"), "warning");
      return;
    }

    var previous = state.chat.slice(-20).map(function (item) {
      return { role: item.role, content: clampText(item.content, STORED_TEXT_LIMIT) };
    });
    state.chat.push({ role: "user", content: question, provider: state.provider, time: nowTime() });
    persistChat();
    el.chatInput.value = "";
    renderChat();
    var pending = pendingChatNode();
    el.chatLog.appendChild(pending);
    el.chatLog.scrollTop = el.chatLog.scrollHeight;
    state.asking = true;
    setButtonBusy(el.sendChatButton, true);
    updateControls();
    try {
      var payload = await api("/api/ai/ask", {
        method: "POST",
        body: JSON.stringify({
          question: question,
          context: limitedContext(el.editor.value),
          history: previous,
          language: i18n.language
        })
      });
      var answer = String(payload.answer || payload.reply || payload.result || payload.content || "").trim();
      if (!answer) {
        throw new RequestError(t("status.emptyAnswer"), 502, "empty_ai_response");
      }
      state.chat.push({
        role: "assistant",
        content: answer,
        provider: String(payload.provider || state.provider),
        time: nowTime()
      });
      addHistory("ask", t("action.ask"), clampText(question + " | " + answer, 380));
    } catch (error) {
      state.chat.push({
        role: "assistant",
        content: t("status.callFailed", { message: error.message || t("status.unknownError") }),
        provider: state.provider,
        time: nowTime(),
        error: true
      });
      toast(error.message || t("status.askFailed"), "error");
    } finally {
      state.asking = false;
      pending.remove();
      persistChat();
      renderChat();
      setButtonBusy(el.sendChatButton, false);
      updateControls();
    }
  }

  async function analyzeManuscript() {
    if (state.analyzing) {
      return;
    }
    if (!state.chapters.length) {
      toast(t("analysis.noChapters"), "warning");
      return;
    }
    if (!state.providerReady || state.provider === "off") {
      toast(t("status.aiUnavailable"), "warning");
      return;
    }
    state.analyzing = true;
    el.analysisResult.className = "analysis-result is-loading";
    el.analysisResult.textContent = t("analysis.running");
    el.analysisStatus.textContent = t("analysis.running");
    setButtonBusy(el.analyzeButton, true, t("status.analyzing"));
    updateControls();
    try {
      var payload = await api("/api/ai/analyze", {
        method: "POST",
        body: JSON.stringify({ language: i18n.language })
      });
      var report = String(payload.report || payload.analysis || payload.result || "").trim();
      if (!report) {
        throw new RequestError(t("status.emptyAnswer"), 502, "empty_ai_response");
      }
      var count = Number(payload.analyzed_chapters || state.chapters.length);
      state.analysis = { report: report, count: count, provider: payload.provider || state.provider };
      el.analysisResult.className = "analysis-result is-ready";
      el.analysisResult.textContent = report;
      el.analysisStatus.textContent = t("analysis.complete", { count: count });
      addHistory("analyze", t("action.analyze"), t("analysis.complete", { count: count }));
      toast(t("status.analysisComplete"));
    } catch (error) {
      el.analysisResult.className = "analysis-result is-error";
      el.analysisResult.textContent = error.message || t("status.analysisFailed");
      el.analysisStatus.textContent = t("analysis.failed");
      toast(error.message || t("status.analysisFailed"), "error");
    } finally {
      state.analyzing = false;
      setButtonBusy(el.analyzeButton, false);
      if (state.analysis) {
        el.analyzeButton.querySelector("span").textContent = t("analysis.rerun");
      }
      updateControls();
    }
  }

  function openDialog(dialog) {
    if (!dialog) {
      return;
    }
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
  }

  function closeDialog(dialog) {
    if (!dialog) {
      return;
    }
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
  }

  function openNewChapterDialog() {
    openDialog(el.newChapterDialog);
    requestAnimationFrame(function () {
      el.newChapterTitleInput.focus();
      el.newChapterTitleInput.select();
    });
  }

  async function createChapter(event) {
    event.preventDefault();
    var title = el.newChapterTitleInput.value.trim();
    var extension = el.newChapterFormat.value;
    if (!title) {
      el.newChapterTitleInput.focus();
      return;
    }
    var initialContent = extension === ".md" ? "# " + title + "\n\n" : title + "\n\n";
    setButtonBusy(el.createChapterButton, true, t("status.creating"));
    try {
      var payload = await api("/api/chapters", {
        method: "POST",
        body: JSON.stringify({
          title: title,
          extension: extension,
          content: initialContent
        })
      });
      var chapter = extractChapter(payload, "");
      closeDialog(el.newChapterDialog);
      el.newChapterForm.reset();
      addHistory("create", t("action.create"), chapter.title || title);
      toast(t("status.created"));
      await loadChapters(chapter.filename, { record: false });
    } catch (error) {
      toast(error.message || t("status.createFailed"), "error");
    } finally {
      setButtonBusy(el.createChapterButton, false);
      updateControls();
    }
  }

  function openDeleteDialog() {
    if (!state.activeFilename) {
      return;
    }
    if (isDirty() && !window.confirm(t("status.deleteDirty"))) {
      return;
    }
    el.deleteChapterName.textContent = state.activeFilename;
    openDialog(el.deleteDialog);
  }

  async function deleteChapter(event) {
    event.preventDefault();
    if (!state.activeFilename) {
      closeDialog(el.deleteDialog);
      return;
    }
    var deleting = state.activeFilename;
    setButtonBusy(el.confirmDeleteButton, true, t("status.deleting"));
    try {
      await api(chapterUrl(deleting), {
        method: "DELETE",
        body: JSON.stringify({ expected_sha256: state.activeSha256 })
      });
      closeDialog(el.deleteDialog);
      addHistory("delete", t("action.delete"), deleting);
      toast(t("status.deleted"));
      clearEditor();
      await loadChapters("", { record: false });
    } catch (error) {
      closeDialog(el.deleteDialog);
      if (error.status === 409 || error.code === "chapter_conflict") {
        showConflict(error, "delete");
      } else {
        toast(error.message || t("status.deleteFailed"), "error");
      }
    } finally {
      setButtonBusy(el.confirmDeleteButton, false);
      updateControls();
    }
  }

  function clearLocalHistory() {
    if ((state.history.length || state.chat.length) && !window.confirm(t("status.clearConfirm"))) {
      return;
    }
    state.history = [];
    state.chat = [];
    writeLocal(HISTORY_STORAGE_KEY, []);
    writeLocal(CHAT_STORAGE_KEY, []);
    renderHistory();
    renderChat();
    toast(t("status.cleared"));
  }

  function updateProvider(provider) {
    var normalized = String(provider || "unknown").trim().toLowerCase();
    if (normalized === "offline") {
      normalized = "mock";
    }
    if (normalized === "disabled" || normalized === "none") {
      normalized = "off";
    }
    state.provider = normalized;
    state.providerReady = normalized !== "unknown";
    el.providerBadge.className = "provider-badge";
    el.privacyNote.className = "privacy-note";
    var dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    el.providerBadge.replaceChildren(dot);
    var label = document.createTextNode(t("provider.unknown"));

    if (normalized === "hermes" || normalized === "local" || normalized === "local-agent") {
      el.providerBadge.classList.add("is-local");
      label = document.createTextNode("Hermes · local");
      el.privacyNote.classList.add("is-local");
      el.privacyText.textContent = t("provider.hermesNote");
    } else if (normalized === "mock") {
      el.providerBadge.classList.add("is-local");
      label = document.createTextNode(t("provider.mock"));
      el.privacyNote.classList.add("is-local");
      el.privacyText.textContent = t("provider.mockNote");
    } else if (normalized === "off") {
      el.providerBadge.classList.add("is-off");
      label = document.createTextNode(t("provider.off"));
      el.privacyText.textContent = t("provider.offNote");
    } else {
      el.providerBadge.classList.add("is-checking");
      state.providerReady = false;
      el.privacyText.textContent = t("provider.unknownNote");
    }
    el.providerBadge.appendChild(label);
    updateControls();
  }

  async function loadProviderStatus() {
    try {
      var payload = await api("/api/health");
      state.bookTitle = String(payload.book_title || "Writing Workbench");
      if (el.bookLabel) {
        el.bookLabel.textContent = state.bookTitle;
        el.bookLabel.title = state.bookTitle;
      }
      document.title = state.bookTitle + " · " + t("app.title");
      updateProvider(payload.provider || (payload.ai && payload.ai.provider) || "unknown");
    } catch (error) {
      updateProvider("unknown");
      toast(error.message || t("status.healthFailed"), "error");
    }
  }

  function nativeEdit(command) {
    if (!state.activeFilename || el.editor.disabled) {
      return;
    }
    el.editor.focus();
    try {
      document.execCommand(command);
    } catch (_error) {
      toast(t("status.unsupportedEdit"), "warning");
    }
    window.setTimeout(updateEditorState, 0);
  }

  function toast(message, type) {
    if (!el.toastStack || !message) {
      return;
    }
    var item = document.createElement("div");
    item.className = "toast" + (type ? " is-" + type : "");
    item.textContent = String(message);
    el.toastStack.appendChild(item);
    window.setTimeout(function () {
      item.remove();
    }, type === "error" ? 5200 : 3300);
  }

  function bindDialogBackdrop(dialog) {
    dialog.addEventListener("click", function (event) {
      if (event.target === dialog) {
        closeDialog(dialog);
      }
    });
  }

  function bindEvents() {
    el.newChapterButton.addEventListener("click", openNewChapterDialog);
    el.emptyCreateButton.addEventListener("click", openNewChapterDialog);
    el.newChapterForm.addEventListener("submit", createChapter);
    el.closeNewChapterButton.addEventListener("click", function () { closeDialog(el.newChapterDialog); });
    el.cancelNewChapterButton.addEventListener("click", function () { closeDialog(el.newChapterDialog); });

    el.deleteButton.addEventListener("click", openDeleteDialog);
    el.deleteForm.addEventListener("submit", deleteChapter);
    el.closeDeleteButton.addEventListener("click", function () { closeDialog(el.deleteDialog); });
    el.cancelDeleteButton.addEventListener("click", function () { closeDialog(el.deleteDialog); });

    el.shortcutButton.addEventListener("click", function () { openDialog(el.shortcutDialog); });
    el.closeShortcutButton.addEventListener("click", function () { closeDialog(el.shortcutDialog); });

    [el.newChapterDialog, el.deleteDialog, el.shortcutDialog].forEach(bindDialogBackdrop);

    el.retryChaptersButton.addEventListener("click", function () { loadChapters(); });
    el.chapterSearch.addEventListener("input", renderChapters);
    el.sortSelect.addEventListener("change", function () {
      state.sortKey = el.sortSelect.value;
      renderChapters();
    });
    el.sortOrderButton.addEventListener("click", function () {
      state.sortOrder = state.sortOrder === "asc" ? "desc" : "asc";
      var asc = state.sortOrder === "asc";
      el.sortOrderButton.setAttribute("aria-label", asc ? t("chapters.sortAscLabel") : t("chapters.sortDescLabel"));
      el.sortOrderButton.classList.toggle("is-desc", !asc);
      renderChapters();
      toast(asc ? t("status.sortedAsc") : t("status.sortedDesc"));
    });
    el.chapterList.addEventListener("click", function (event) {
      var row = event.target.closest(".chapter-row");
      if (row) {
        loadChapter(row.dataset.filename);
      }
    });

    el.editor.addEventListener("input", handleEditorInput);
    ["select", "keyup", "mouseup", "touchend"].forEach(function (eventName) {
      el.editor.addEventListener(eventName, updateEditorStats);
    });
    el.saveButton.addEventListener("click", saveChapter);
    el.undoButton.addEventListener("click", function () { nativeEdit("undo"); });
    el.redoButton.addEventListener("click", function () { nativeEdit("redo"); });
    el.copyConflictButton.addEventListener("click", function () { copyText(documentContent()); });
    el.reloadConflictButton.addEventListener("click", reloadAfterConflict);

    el.instruction.addEventListener("input", function () {
      el.instructionCount.textContent = String(el.instruction.value.length);
    });
    el.rewriteButton.addEventListener("click", requestRewrite);
    el.replaceButton.addEventListener("click", replaceWithRewrite);
    el.undoReplaceButton.addEventListener("click", undoReplacement);
    el.copyRewriteButton.addEventListener("click", function () {
      copyText(state.rewrite && state.rewrite.text);
    });

    el.chatTab.addEventListener("click", function () { switchAssistantView("chat"); });
    el.analysisTab.addEventListener("click", function () { switchAssistantView("analysis"); });
    el.historyTab.addEventListener("click", function () { switchAssistantView("history"); });
    el.chatInput.addEventListener("input", updateControls);
    el.chatInput.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        sendQuestion();
      }
    });
    el.sendChatButton.addEventListener("click", sendQuestion);
    el.analyzeButton.addEventListener("click", analyzeManuscript);
    el.clearHistoryButton.addEventListener("click", clearLocalHistory);

    window.addEventListener("beforeunload", function (event) {
      if (isDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    });

    document.addEventListener("keydown", function (event) {
      var modifier = event.metaKey || event.ctrlKey;
      var key = String(event.key || "").toLowerCase();
      if (modifier && key === "s") {
        event.preventDefault();
        saveChapter();
      } else if (modifier && key === "k") {
        event.preventDefault();
        el.chapterSearch.focus();
        el.chapterSearch.select();
      } else if (modifier && event.shiftKey && key === "r") {
        event.preventDefault();
        requestRewrite();
      } else if (modifier && event.key === "Enter") {
        event.preventDefault();
        sendQuestion();
      }
    });
  }

  function initialize() {
    bindEvents();
    renderChat();
    renderHistory();
    updateProvider("unknown");
    updateEditorState();
    Promise.allSettled([
      loadProviderStatus(),
      loadChapters("", { record: false })
    ]);
  }

  initialize();
})();
