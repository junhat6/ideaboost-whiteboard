"use strict";
/*
 * チームの付箋の棚。Issue ではない小さな仕事を、一言 Enter で貼る。
 * 保存先は Worker の /api/team-notes（Durable Object）。GitHub には書かない。
 * 通信結果が不明な書き込みは自動で再送しない。利用者に最新の取得を促す。
 */
(() => {
  const shelf = document.getElementById("team-shelf");
  if (!shelf) return;
  const $ = (s) => shelf.querySelector(s);
  const input = $("#team-note-input");
  const listEl = $("#team-note-list");
  const doneEl = $("#team-note-done");
  const doneWrap = $("#team-note-done-wrap");
  const countEl = $("#team-note-count");
  const statusEl = $("#team-note-status");
  const toggle = $("#team-shelf-toggle");
  const MAX = 200;
  const BATCH = 20;
  const COLLAPSE_KEY = "ideaboost.teamShelf.collapsed";

  let mode = "loading"; // loading | api | sample | error
  let notes = [];
  let busy = false;
  let editingId = null;
  let lastRemoved = null;
  let seq = 0;

  const sample = [
    "ハッカソン告知文を考える",
    "会場の電源と延長コードを確認",
    "スポンサーへのお礼メール",
  ].map((text, i) => ({
    id: "n_sample" + String(i).padStart(4, "0"),
    text,
    done: false,
    rev: 1,
  }));

  const requestId = () =>
    "tn_" +
    Date.now().toString(36) +
    "_" +
    (++seq).toString(36) +
    "_" +
    Math.random().toString(36).slice(2, 10);

  const messages = {
    note_conflict: "他の人が先にこの付箋を変更しました。最新を表示しています。",
    note_not_found: "この付箋はもうありません。最新を表示しています。",
    notes_full:
      "付箋が上限（300 枚）に達しています。済んだものを剥がしてください。",
    invalid_text: `付箋は 1〜${MAX} 文字で書いてください。`,
    too_many_notes: `一度に貼れるのは ${BATCH} 枚までです。`,
    notes_queue_full:
      "保存が混み合っています。少し待ってから操作してください。",
    rate_limited: "操作が多すぎます。少し待ってから操作してください。",
    origin_mismatch:
      "このページからの操作として確認できませんでした。再読み込みしてください。",
    sign_in_required: "ログインし直してください。",
  };

  function setStatus(text, kind = "", action) {
    statusEl.textContent = "";
    statusEl.className = "team-note-status" + (kind ? " " + kind : "");
    statusEl.hidden = !text;
    if (!text) return;
    const span = document.createElement("span");
    span.textContent = text;
    statusEl.append(span);
    if (action) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = action.label;
      b.onclick = action.run;
      statusEl.append(b);
    }
  }

  async function api(method, body) {
    let response;
    try {
      response = await fetch(
        new URL("api/team-notes", new URL(".", location.href)),
        {
          method,
          credentials: "same-origin",
          cache: "no-store",
          signal: AbortSignal.timeout(20000),
          headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        },
      );
    } catch {
      const e = new Error("network");
      e.ambiguous = method === "POST";
      throw e;
    }
    let data = null;
    try {
      data = await response.json();
    } catch {
      /* 静的サーバーなど JSON でない応答 */
    }
    if (!response.ok || !data || data.ok === false) {
      const e = new Error((data && data.error) || "http_" + response.status);
      e.status = response.status;
      e.code = data && data.error;
      e.ambiguous = !!(data && data.ambiguous);
      e.data = data;
      throw e;
    }
    return data;
  }

  function sortNotes(list) {
    return [...list].sort((a, b) => Number(a.done) - Number(b.done));
  }

  function render() {
    const open = notes.filter((n) => !n.done);
    const done = notes.filter((n) => n.done);
    countEl.textContent = String(open.length);
    shelf.dataset.mode = mode;
    const focused = document.activeElement?.closest?.("[data-note-id]");
    const focusId = focused?.dataset.noteId;
    listEl.replaceChildren(...open.map(item));
    doneEl.replaceChildren(...done.map(item));
    doneWrap.hidden = !done.length;
    $("#team-note-done-count").textContent = String(done.length);
    $("#team-note-empty").hidden = !!open.length || mode === "loading";
    input.disabled = mode === "loading" || mode === "error";
    if (focusId) shelf.querySelector(`[data-note-id="${focusId}"]`)?.focus();
  }

  function item(note) {
    const li = document.createElement("li");
    li.className = "team-note" + (note.done ? " done" : "");
    li.tabIndex = 0;
    li.dataset.noteId = note.id;
    li.setAttribute("aria-label", note.text + (note.done ? "（済み）" : ""));
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = note.done;
    check.tabIndex = -1;
    check.setAttribute("aria-label", note.done ? "済みを外す" : "済みにする");
    check.onchange = () => setDone(note, check.checked);
    li.append(check);
    if (editingId === note.id) {
      const field = document.createElement("textarea");
      field.className = "team-note-edit";
      field.value = note.text;
      field.maxLength = MAX;
      field.rows = 2;
      field.setAttribute("aria-label", "付箋を編集");
      field.onkeydown = (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          saveEdit(note, field.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          editingId = null;
          render();
          focusNote(note.id);
        }
        e.stopPropagation();
      };
      field.onblur = () => {
        if (editingId === note.id) saveEdit(note, field.value);
      };
      li.append(field);
      queueMicrotask(() => {
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      });
    } else {
      const text = document.createElement("span");
      text.className = "team-note-text";
      text.textContent = note.text;
      text.ondblclick = () => startEdit(note);
      li.append(text);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "team-note-remove";
    remove.tabIndex = -1;
    remove.textContent = "×";
    remove.setAttribute("aria-label", "剥がす");
    remove.title = "剥がす（Delete）";
    remove.onclick = () => removeNote(note);
    li.append(remove);
    return li;
  }

  function focusNote(id) {
    shelf.querySelector(`[data-note-id="${id}"]`)?.focus();
  }

  function replace(note) {
    notes = sortNotes(notes.map((n) => (n.id === note.id ? note : n)));
  }

  async function load() {
    try {
      const data = await api("GET");
      notes = sortNotes(data.notes || []);
      mode = "api";
      if (statusEl.classList.contains("stale")) setStatus("");
    } catch (e) {
      if (e.status === 404 && mode !== "api") {
        // このページに付箋の API が無い（サンプル表示）。ブラウザー内だけで動かす。
        mode = "sample";
        notes = sample.map((n) => ({ ...n }));
        setStatus("サンプル表示です。付箋は保存されません。", "sample");
      } else if (mode === "loading") {
        mode = "error";
        setStatus("付箋を読み込めませんでした。", "error", {
          label: "もう一度読み込む",
          run: () => {
            mode = "loading";
            render();
            load();
          },
        });
      } else {
        setStatus("最新の付箋を確認できませんでした。", "stale error", {
          label: "最新を取得",
          run: load,
        });
      }
    }
    render();
  }

  function failWrite(e) {
    if (e.ambiguous) {
      // 書き込みが済んだかどうか分からない。自動で再送せず、人に最新を確かめてもらう。
      setStatus(
        "保存結果を確認できません。再送せず、最新を取得して確かめてください。",
        "error",
        {
          label: "最新を取得",
          run: load,
        },
      );
      return;
    }
    setStatus(messages[e.code] || "保存できませんでした。", "error");
    if (["note_conflict", "note_not_found"].includes(e.code)) load();
  }

  async function write(body, apply) {
    if (mode === "sample") {
      apply(null);
      render();
      return true;
    }
    busy = true;
    shelf.setAttribute("aria-busy", "true");
    try {
      const data = await api("POST", { requestId: requestId(), ...body });
      apply(data);
      setStatus("");
      return true;
    } catch (e) {
      failWrite(e);
      return false;
    } finally {
      busy = false;
      shelf.removeAttribute("aria-busy");
      render();
    }
  }

  function linesOf(value) {
    return value
      .split(/\r?\n/)
      .map((l) => l.replace(/^\s*(?:[-*・•]|\d+[.)．])\s+/, "").trim())
      .filter(Boolean);
  }

  async function create() {
    if (busy) return;
    const texts = linesOf(input.value);
    if (!texts.length) return;
    if (texts.length > BATCH)
      return setStatus(messages.too_many_notes, "error");
    if (texts.some((t) => [...t].length > MAX))
      return setStatus(messages.invalid_text, "error");
    const ok = await write({ op: "create", texts }, (data) => {
      const created =
        data?.notes ||
        texts.map((text) => ({
          id:
            "n_sample" +
            requestId()
              .replace(/[^a-z0-9]/g, "")
              .slice(-16),
          text,
          done: false,
          rev: 1,
        }));
      notes = sortNotes([...created, ...notes]);
    });
    if (ok !== false) input.value = "";
    autosize();
    input.focus();
  }

  function startEdit(note) {
    if (busy) return;
    editingId = note.id;
    render();
  }

  async function saveEdit(note, value) {
    const text = value.replace(/\s+/g, " ").trim();
    editingId = null;
    if (!text || text === note.text) {
      render();
      return focusNote(note.id);
    }
    if ([...text].length > MAX) {
      render();
      return setStatus(messages.invalid_text, "error");
    }
    await write({ op: "edit", id: note.id, rev: note.rev, text }, (data) =>
      replace(data?.note || { ...note, text, rev: note.rev + 1 }),
    );
    focusNote(note.id);
  }

  async function setDone(note, done) {
    if (busy) return render();
    await write({ op: "done", id: note.id, rev: note.rev, done }, (data) =>
      replace(data?.note || { ...note, done, rev: note.rev + 1 }),
    );
    focusNote(note.id);
  }

  async function removeNote(note) {
    if (busy) return;
    const siblings = [...shelf.querySelectorAll("[data-note-id]")];
    const index = siblings.findIndex((el) => el.dataset.noteId === note.id);
    const ok = await write(
      { op: "remove", id: note.id, rev: note.rev },
      (data) => {
        lastRemoved = data?.note || { ...note, rev: note.rev + 1 };
        notes = notes.filter((n) => n.id !== note.id);
      },
    );
    if (ok === false) return;
    setStatus("付箋を剥がしました。", "undo", {
      label: "元に戻す",
      run: undo,
    });
    const rest = [...shelf.querySelectorAll("[data-note-id]")];
    (rest[Math.min(index, rest.length - 1)] || input).focus();
  }

  async function undo() {
    const note = lastRemoved;
    if (!note || busy) return;
    lastRemoved = null;
    const ok = await write(
      { op: "restore", id: note.id, rev: note.rev },
      (data) => {
        notes = sortNotes([
          data?.note || { ...note, rev: note.rev + 1 },
          ...notes,
        ]);
      },
    );
    if (ok !== false) focusNote(note.id);
  }

  function autosize() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  }

  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      create();
    } else if (e.key === "ArrowDown" && !input.value) {
      e.preventDefault();
      shelf.querySelector("[data-note-id]")?.focus();
    } else if (e.key === "Escape") {
      input.blur();
    }
    e.stopPropagation();
  });

  shelf.addEventListener("keydown", (e) => {
    const li = e.target.closest?.("[data-note-id]");
    if (!li || e.target !== li) return;
    const note = notes.find((n) => n.id === li.dataset.noteId);
    if (!note) return;
    const all = [...shelf.querySelectorAll("[data-note-id]")];
    const at = all.indexOf(li);
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === "ArrowDown") {
      handled();
      all[at + 1]?.focus();
    } else if (e.key === "ArrowUp") {
      handled();
      (all[at - 1] || input).focus();
    } else if (e.key === "Enter" || e.key === "F2") {
      handled();
      startEdit(note);
    } else if (e.key === " ") {
      handled();
      setDone(note, !note.done);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      handled();
      removeNote(note);
    } else if (e.key === "Escape") {
      handled();
      input.focus();
    } else if (
      e.key.toLowerCase() === "z" &&
      (e.metaKey || e.ctrlKey) &&
      !e.shiftKey
    ) {
      handled();
      undo();
    } else if (!e.metaKey && !e.ctrlKey && !e.altKey) {
      // ボード側の 1 文字ショートカット（F・N など）を付箋の上では発火させない。
      e.stopPropagation();
    }
  });

  function setCollapsed(collapsed) {
    shelf.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute(
      "aria-label",
      collapsed ? "付箋の棚を開く" : "付箋の棚をたたむ",
    );
    toggle.title = collapsed ? "付箋の棚を開く" : "付箋の棚をたたむ";
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {
      /* 保存できなくても動作は変わらない */
    }
    window.dispatchEvent(new Event("resize"));
  }
  toggle.onclick = () => setCollapsed(!shelf.classList.contains("collapsed"));
  try {
    if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
  } catch {
    /* 既定は開いた状態 */
  }

  // T で一言入力へ（棚がたたまれていれば開く）。入力中や全画面では反応しない。
  document.addEventListener("keydown", (e) => {
    if (
      e.key.toLowerCase() !== "t" ||
      e.repeat ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.shiftKey ||
      e.isComposing ||
      document.fullscreenElement ||
      document.querySelector("dialog[open]")
    )
      return;
    const writing = (node) =>
      node?.closest?.(
        "input,textarea,select,[role=combobox],[contenteditable],.cm-editor",
      );
    if (writing(e.target) || writing(document.activeElement)) return;
    e.preventDefault();
    if (shelf.classList.contains("collapsed")) setCollapsed(false);
    input.focus();
  });

  const refresh = () => {
    if (mode !== "api" || busy || editingId || document.hidden) return;
    load();
  };
  setInterval(refresh, 30000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);

  render();
  load();
})();
