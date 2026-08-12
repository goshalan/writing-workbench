(function () {
  "use strict";

  var CHAT_STORAGE_KEY = "writing-workbench.chat.v1";
  var HISTORY_STORAGE_KEY = "writing-workbench.history.v1";
  var CHAT_LIMIT = 30;
  var HISTORY_LIMIT = 60;
  var STORED_TEXT_LIMIT = 4000;
  var REWRITE_TEXT_LIMIT = 24000;
  var CONTEXT_LIMIT = 60000;

  var state = {
    chapters: [],
    activeFilename: "",
    activeSha256: "",
    activeMeta: null,
    loadedContent: "",
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
    historyTab: byId("historyTab"),
    chatView: byId("chatView"),
    historyView: byId("historyView"),
    chatLog: byId("chatLog"),
    chatInput: byId("chatInput"),
    sendChatButton: byId("sendChatButton"),
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
    this.message = message || "请求失败";
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
      response = await fetch(url, requestOptions);
    } catch (_error) {
      throw new RequestError("无法连接写作服务，请确认服务仍在运行", 0, "network_error");
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
      var message = typeof errorValue === "string"
        ? errorValue
        : errorValue.message || payload.message || "请求失败（" + response.status + "）";
      var code = isPlainObject(errorValue) && errorValue.code
        ? errorValue.code
        : payload.code || "request_failed";
      var details = isPlainObject(errorValue) && isPlainObject(errorValue.details)
        ? errorValue.details
        : payload.details;
      throw new RequestError(message, response.status, code, details);
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
      toast("浏览器无法保存本地历史", "warning");
    }
  }

  function clampText(value, limit) {
    var text = String(value == null ? "" : value);
    return text.length > limit ? text.slice(0, limit - 1) + "…" : text;
  }

  function nowTime() {
    return new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  }

  function nowDateTime() {
    return new Date().toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function formatDate(value) {
    if (!value) {
      return "时间未知";
    }
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return String(value);
    }
    return date.toLocaleString("zh-CN", {
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
      .trim() || "未命名章节";
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
    return String(left).localeCompare(String(right), "zh-CN", {
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
    var query = el.chapterSearch.value.trim().toLocaleLowerCase("zh-CN");
    return state.chapters.filter(function (chapter) {
      if (!query) {
        return true;
      }
      return (chapter.title + " " + chapter.filename).toLocaleLowerCase("zh-CN").indexOf(query) !== -1;
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
    el.chapterCount.textContent = state.chapters.length + " 个章节";

    if (!chapters.length) {
      var searching = Boolean(el.chapterSearch.value.trim());
      el.chapterEmpty.querySelector("p").textContent = searching ? "没有匹配的章节。" : "还没有章节。";
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
      title.textContent = chapter.title;
      var meta = document.createElement("small");
      meta.textContent = (chapter.extension || ".txt").slice(1).toUpperCase() + " · " + chapter.word_count + " 字 · " + formatDate(chapter.modified_at);
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
        var first = visibleChapters()[0] || state.chapters[0];
        await loadChapter(first.filename, { force: true, record: settings.record !== false });
      } else if (!state.chapters.length) {
        clearEditor();
      }
    } catch (error) {
      el.chapterErrorText.textContent = error.message || "无法读取章节。";
      showListState("error");
      toast(error.message || "无法读取章节", "error");
    }
  }

  function clearEditor() {
    state.activeFilename = "";
    state.activeSha256 = "";
    state.activeMeta = null;
    state.loadedContent = "";
    state.selection = null;
    state.rewrite = null;
    state.replacementUndo = [];
    state.conflict = false;
    el.editor.value = "";
    el.editor.disabled = true;
    el.editorTitle.textContent = "请选择章节";
    el.chapterMetadata.textContent = "等待载入";
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
    return window.confirm(message || "当前章节有未保存改动。放弃这些改动并继续吗？");
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
      state.activeFilename = chapter.filename || filename;
      state.activeSha256 = chapter.sha256 || String(payload.sha256 || "");
      state.activeMeta = chapter;
      state.loadedContent = content;
      state.selection = null;
      state.rewrite = null;
      state.replacementUndo = [];
      state.conflict = false;
      el.editor.value = content;
      el.editor.disabled = false;
      el.editorTitle.textContent = chapter.title;
      el.chapterMetadata.textContent = (chapter.extension || ".txt").slice(1).toUpperCase() + " · " + formatBytes(chapter.size_bytes);
      el.savedAt.textContent = chapter.modified_at ? "上次保存：" + formatDate(chapter.modified_at) : "已从磁盘读取";
      el.conflictBanner.hidden = true;
      resetRewriteResult();
      mergeChapter(chapter);
      renderChapters();
      if (settings.record !== false) {
        addHistory("open", "打开章节", chapter.title);
      }
      requestAnimationFrame(function () {
        el.editor.focus();
        el.editor.setSelectionRange(0, 0);
      });
    } catch (error) {
      toast(error.message || "无法读取章节", "error");
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
    el.selectionStat.textContent = "选区字数：" + selectedWords;
    el.chapterStat.textContent = "全文字数：" + totalWords;
    if (selected && selected.trim()) {
      state.selection = { start: start, end: end, text: selected };
      el.selectionStatus.textContent = "已选择 " + selectedWords + " 字";
      el.selectionStatus.classList.add("is-ready");
    } else {
      state.selection = null;
      el.selectionStatus.textContent = "尚未选择正文";
      el.selectionStatus.classList.remove("is-ready");
    }
    updateControls();
  }

  function updateEditorState() {
    updateEditorStats();
    if (state.saving) {
      setSaveState("saving", "正在保存…");
    } else if (state.conflict) {
      setSaveState("conflict", "保存冲突 · 草稿仍保留");
    } else if (isDirty()) {
      setSaveState("dirty", "尚未保存 · 仅在浏览器中");
      el.savedAt.textContent = "改动尚未写入磁盘";
    } else if (state.activeFilename) {
      setSaveState("saved", "已保存 · 手动保存");
    } else {
      setSaveState("saved", "本地优先 · 手动保存");
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
      ? "磁盘上的章节已更新，因此没有删除。请重新读取并确认内容后再试。"
      : "磁盘上的章节已更新。你的未保存内容仍保留在编辑器中" + (currentSha ? "，可复制后再重新读取。" : "。") ;
    el.conflictBanner.hidden = false;
    updateEditorState();
    toast("检测到并发冲突，当前草稿未丢失", "warning");
  }

  async function saveChapter() {
    if (!state.activeFilename || state.saving || !isDirty()) {
      return;
    }
    state.saving = true;
    state.conflict = false;
    el.conflictBanner.hidden = true;
    setButtonBusy(el.saveButton, true, "保存中…");
    updateEditorState();
    var contentToSave = el.editor.value;
    try {
      var payload = await api(chapterUrl(state.activeFilename), {
        method: "PUT",
        body: JSON.stringify({
          content: contentToSave,
          expected_sha256: state.activeSha256
        })
      });
      var chapter = extractChapter(payload, state.activeFilename);
      state.loadedContent = typeof payload.content === "string" ? payload.content : contentToSave;
      state.activeSha256 = chapter.sha256 || String(payload.sha256 || state.activeSha256);
      state.activeMeta = chapter;
      state.conflict = false;
      el.conflictBanner.hidden = true;
      el.savedAt.textContent = "刚刚保存（已自动备份）";
      mergeChapter(chapter);
      renderChapters();
      addHistory("save", "保存章节", chapter.title);
      toast("章节已保存，保存前版本已备份");
    } catch (error) {
      if (error.status === 409 || error.code === "chapter_conflict") {
        showConflict(error, "save");
      } else {
        setSaveState("error", "保存失败 · 草稿仍保留");
        toast(error.message || "保存失败", "error");
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
    if (isDirty() && !window.confirm("重新读取会放弃编辑器中的未保存内容。建议先复制当前草稿。确定继续吗？")) {
      return;
    }
    await loadChapter(state.activeFilename, { force: true });
    toast("已读取磁盘上的最新版本");
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
    copy.textContent = "改写结果会显示在这里。生成预览不会修改或保存原稿。";
    el.rewriteResult.appendChild(copy);
    el.rewriteStatus.textContent = "尚未生成";
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
      toast("请先打开一个章节", "warning");
      return;
    }
    if (!state.selection || !state.selection.text.trim()) {
      toast("请先在正文中选择要改写的段落", "warning");
      el.editor.focus();
      return;
    }
    if (state.selection.text.length > REWRITE_TEXT_LIMIT) {
      toast("选中文本超过 24,000 个字符，请缩小选区", "error");
      return;
    }
    if (!state.providerReady || state.provider === "off") {
      toast("AI provider 当前不可用", "warning");
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
    el.rewriteResult.textContent = "正在生成改写预览…";
    el.rewriteStatus.textContent = "生成中";
    setButtonBusy(el.rewriteButton, true, "正在生成…");
    updateControls();
    try {
      var payload = await api("/api/ai/rewrite", {
        method: "POST",
        body: JSON.stringify({
          text: snapshot.text,
          instruction: el.instruction.value.trim(),
          context: nearbyContext(snapshot)
        })
      });
      var rewritten = String(payload.result || payload.rewritten_text || payload.rewrite || payload.text || "").trim();
      if (!rewritten) {
        throw new RequestError("AI provider 没有返回改写内容", 502, "empty_ai_response");
      }
      state.rewrite = {
        text: rewritten,
        selection: snapshot,
        provider: String(payload.provider || state.provider)
      };
      el.rewriteResult.className = "rewrite-result is-ready";
      el.rewriteResult.textContent = rewritten;
      el.rewriteStatus.textContent = "预览完成 · 未写入";
      addHistory("rewrite", "生成改写预览", clampText(snapshot.text, 180));
      toast("改写预览已生成，原稿尚未改变");
    } catch (error) {
      el.rewriteResult.className = "rewrite-result is-error";
      el.rewriteResult.textContent = error.message || "生成改写预览失败";
      el.rewriteStatus.textContent = "生成失败";
      toast(error.message || "生成改写预览失败", "error");
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
      toast("正文已变化且无法唯一定位原选区，请重新选择", "error");
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
    addHistory("replace", "替换选中原文", clampText(replacement, 180));
    toast("已替换到编辑器；请手动保存后写入磁盘");
  }

  function undoReplacement() {
    var snapshot = state.replacementUndo.pop();
    if (!snapshot) {
      toast("没有可撤销的 AI 替换", "warning");
      return;
    }
    el.editor.value = snapshot.content;
    el.editor.focus();
    el.editor.setSelectionRange(snapshot.start, snapshot.end);
    updateEditorState();
    addHistory("undo", "撤销 AI 替换", state.activeMeta ? state.activeMeta.title : state.activeFilename);
    toast("已撤销上一次 AI 替换");
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
      toast("已复制到剪贴板");
    } catch (_error) {
      toast("复制失败，请手动选择并复制", "error");
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
      title.textContent = "暂无对话内容";
      var note = document.createElement("span");
      note.textContent = "向助手询问人物动机、伏笔或情节取舍。";
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
      who.textContent = message.role === "user" ? "你" : "写作助手";
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
      empty.textContent = "还没有本地操作记录。";
      el.historyList.appendChild(empty);
      return;
    }
    var fragment = document.createDocumentFragment();
    state.history.forEach(function (item) {
      var article = document.createElement("article");
      article.className = "history-row";
      var header = document.createElement("header");
      var title = document.createElement("strong");
      title.textContent = item.title || "写作操作";
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
    el.chatView.hidden = !showChat;
    el.historyView.hidden = showChat;
    el.chatTab.classList.toggle("is-active", showChat);
    el.historyTab.classList.toggle("is-active", !showChat);
    el.chatTab.setAttribute("aria-selected", showChat ? "true" : "false");
    el.historyTab.setAttribute("aria-selected", showChat ? "false" : "true");
    if (!showChat) {
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
    who.textContent = "写作助手";
    var time = document.createElement("time");
    time.textContent = "正在回答";
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
      toast("请先打开一个章节", "warning");
      return;
    }
    if (!state.providerReady || state.provider === "off") {
      toast("AI provider 当前不可用", "warning");
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
          history: previous
        })
      });
      var answer = String(payload.answer || payload.reply || payload.result || payload.content || "").trim();
      if (!answer) {
        throw new RequestError("AI provider 没有返回回答", 502, "empty_ai_response");
      }
      state.chat.push({
        role: "assistant",
        content: answer,
        provider: String(payload.provider || state.provider),
        time: nowTime()
      });
      addHistory("ask", "书情问答", clampText(question + "｜" + answer, 380));
    } catch (error) {
      state.chat.push({
        role: "assistant",
        content: "调用失败：" + (error.message || "未知错误"),
        provider: state.provider,
        time: nowTime(),
        error: true
      });
      toast(error.message || "书情问答失败", "error");
    } finally {
      state.asking = false;
      pending.remove();
      persistChat();
      renderChat();
      setButtonBusy(el.sendChatButton, false);
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
    setButtonBusy(el.createChapterButton, true, "创建中…");
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
      addHistory("create", "新建章节", chapter.title || title);
      toast("新章节已创建");
      await loadChapters(chapter.filename, { record: false });
    } catch (error) {
      toast(error.message || "新建章节失败", "error");
    } finally {
      setButtonBusy(el.createChapterButton, false);
      updateControls();
    }
  }

  function openDeleteDialog() {
    if (!state.activeFilename) {
      return;
    }
    if (isDirty() && !window.confirm("当前章节有未保存改动。删除会舍弃这些改动，仍要继续吗？")) {
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
    setButtonBusy(el.confirmDeleteButton, true, "删除中…");
    try {
      await api(chapterUrl(deleting), {
        method: "DELETE",
        body: JSON.stringify({ expected_sha256: state.activeSha256 })
      });
      closeDialog(el.deleteDialog);
      addHistory("delete", "删除章节", deleting);
      toast("章节已删除，删除前版本已备份");
      clearEditor();
      await loadChapters("", { record: false });
    } catch (error) {
      closeDialog(el.deleteDialog);
      if (error.status === 409 || error.code === "chapter_conflict") {
        showConflict(error, "delete");
      } else {
        toast(error.message || "删除章节失败", "error");
      }
    } finally {
      setButtonBusy(el.confirmDeleteButton, false);
      updateControls();
    }
  }

  function clearLocalHistory() {
    if ((state.history.length || state.chat.length) && !window.confirm("清空此浏览器中的写作操作与问答记录？这不会删除稿件。")) {
      return;
    }
    state.history = [];
    state.chat = [];
    writeLocal(HISTORY_STORAGE_KEY, []);
    writeLocal(CHAT_STORAGE_KEY, []);
    renderHistory();
    renderChat();
    toast("本地浏览器历史已清空");
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
    var label = document.createTextNode("未知状态");

    if (normalized === "mock") {
      el.providerBadge.classList.add("is-local");
      label = document.createTextNode("离线演示");
      el.privacyNote.classList.add("is-local");
      el.privacyText.textContent = "当前使用 mock provider：改写与问答在本地演示，不会把书稿发送到远程服务。";
    } else if (normalized === "off") {
      el.providerBadge.classList.add("is-off");
      label = document.createTextNode("AI 已关闭");
      el.privacyText.textContent = "AI 功能已关闭。章节读取、编辑、保存和备份不受影响。";
    } else if (normalized === "openai-compatible" || normalized === "openai") {
      el.providerBadge.classList.add("is-remote");
      label = document.createTextNode("远程 AI");
      el.privacyNote.classList.add("is-remote");
      el.privacyText.textContent = "远程模式已启用：生成改写时会发送选中文本与附近上下文；问答时会发送问题、当前章节上下文及最近对话给已配置的 provider。";
    } else {
      el.providerBadge.classList.add("is-checking");
      state.providerReady = false;
      el.privacyText.textContent = "无法确认 AI provider。为保护稿件，AI 操作暂不可用。";
    }
    el.providerBadge.appendChild(label);
    updateControls();
  }

  async function loadProviderStatus() {
    try {
      var payload = await api("/api/health");
      updateProvider(payload.provider || (payload.ai && payload.ai.provider) || "unknown");
    } catch (error) {
      updateProvider("unknown");
      toast(error.message || "无法读取服务状态", "error");
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
      toast("浏览器不支持此编辑操作", "warning");
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
      el.sortOrderButton.setAttribute("aria-label", asc ? "当前正序，切换为倒序" : "当前倒序，切换为正序");
      el.sortOrderButton.classList.toggle("is-desc", !asc);
      renderChapters();
      toast(asc ? "章节已按正序排列" : "章节已按倒序排列");
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
    el.copyConflictButton.addEventListener("click", function () { copyText(el.editor.value); });
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
    el.historyTab.addEventListener("click", function () { switchAssistantView("history"); });
    el.chatInput.addEventListener("input", updateControls);
    el.chatInput.addEventListener("keydown", function (event) {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        sendQuestion();
      }
    });
    el.sendChatButton.addEventListener("click", sendQuestion);
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
