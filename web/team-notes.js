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

  // loading | api | sample | error | off（Worker で無効。棚を出さない）
  let mode = "loading";
  let notes = [];
  let proposals = [];
  // 添付の折りたたみは描き直しをまたいで覚えておく（付箋 ID）。
  const openAttachments = new Set();
  let busy = false;
  let inflight = Promise.resolve();
  let editingId = null;
  let lastRemoved = null;
  let seq = 0;

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
    item_not_found: "この案はもうありません。最新を表示しています。",
    attachments_full: "残せる添付の上限（10 件）に達しています。",
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
      /* 前段の 502/524 の HTML など JSON でない応答 */
    }
    if (!response.ok || !data || data.ok === false) {
      const e = new Error((data && data.error) || "http_" + response.status);
      e.status = response.status;
      e.code = data && data.error;
      // JSON で答えなかった POST は、DO で反映済みかどうか分からない（api-adapter.js と同じ扱い）。
      e.ambiguous = !!(data && data.ambiguous) || (!data && method === "POST");
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
    $("#team-note-proposals").hidden = !proposals.length;
    $("#team-note-proposal-count").textContent = String(proposals.length);
    $("#team-note-proposal-list").replaceChildren(
      ...proposals.map(proposalItem),
    );
    $("#team-note-empty").hidden =
      !!open.length || !!proposals.length || mode === "loading";
    input.disabled = mode === "loading" || mode === "error";
    if (focusId) shelf.querySelector(`[data-note-id="${focusId}"]`)?.focus();
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, className, run, ariaLabel) {
    const b = el("button", "team-note-action " + className, label);
    b.type = "button";
    if (ariaLabel) b.setAttribute("aria-label", ariaLabel);
    b.onclick = run;
    return b;
  }

  /** http/https だけをリンクにする。それ以外（javascript: など）は null。 */
  function safeUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === "https:" || url.protocol === "http:"
        ? url.href
        : null;
    } catch {
      return null;
    }
  }

  // 直し案（赤ペン）: 元の文に取り消し線、案の文を並べ、人が採用か却下を選ぶ。
  function suggestionBlock(note, s) {
    const box = el("div", "team-note-suggestion");
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "AI の直し案");
    box.append(el("span", "team-note-badge", "直し案"));
    const diff = el("p", "team-note-diff");
    const before = el("del", "", s.before);
    before.setAttribute("aria-label", "元の文: " + s.before);
    const after = el("ins", "", s.after);
    after.setAttribute("aria-label", "案: " + s.after);
    diff.append(before, el("span", "team-note-arrow", "→"), after);
    box.append(diff);
    const stale = s.before !== note.text;
    if (stale)
      box.append(
        el(
          "p",
          "team-note-stale",
          "本文が変わったため採用できません。却下してください。",
        ),
      );
    const actions = el("div", "team-note-actions");
    const accept = button(
      "採用",
      "accept",
      () => decide("accept", note, s.id),
      "直し案を採用: " + s.after,
    );
    accept.disabled = stale;
    actions.append(
      accept,
      button(
        "却下",
        "reject",
        () => decide("reject", note, s.id),
        "直し案を却下: " + s.after,
      ),
    );
    box.append(actions);
    return box;
  }

  function attachmentContent(a) {
    const href = a.kind === "url" ? safeUrl(a.value) : null;
    if (href) {
      const link = el("a", "team-note-link", a.label || a.value);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.referrerPolicy = "no-referrer";
      if (a.label) link.title = a.value;
      return link;
    }
    // 文の添付（と、万一安全でない URL）は文字としてだけ見せる。
    return el("p", "team-note-attachment-text", a.value);
  }

  // 添付: 付箋の下に折りたたむ。採用待ちは「残す」「却下」を選ぶ。
  function attachmentsBlock(note, attachments) {
    const box = el("details", "team-note-attachments");
    box.open = openAttachments.has(note.id);
    box.ontoggle = () => {
      if (box.open) openAttachments.add(note.id);
      else openAttachments.delete(note.id);
    };
    const pending = attachments.filter((a) => a.state === "pending").length;
    box.append(
      el(
        "summary",
        "",
        `添付 ${attachments.length}` +
          (pending ? `（採用待ち ${pending}）` : ""),
      ),
    );
    const list = el("ul", "team-note-attachment-list");
    for (const a of attachments) {
      const li = el("li", "team-note-attachment " + a.state);
      if (a.state === "pending")
        li.append(el("span", "team-note-badge", "採用待ち"));
      li.append(attachmentContent(a));
      if (a.state === "pending") {
        const actions = el("div", "team-note-actions");
        const name = a.label || a.value.slice(0, 40);
        actions.append(
          button(
            "残す",
            "accept",
            () => decide("accept", note, a.id),
            "添付を残す: " + name,
          ),
          button(
            "却下",
            "reject",
            () => decide("reject", note, a.id),
            "添付を却下: " + name,
          ),
        );
        li.append(actions);
      }
      list.append(li);
    }
    box.append(list);
    return box;
  }

  // 提案付箋: 通常の付箋と枠・色に加えて「提案」の文字で見分ける。
  function proposalItem(p) {
    const li = el("li", "team-note proposal");
    li.dataset.proposalId = p.id;
    li.append(el("span", "team-note-badge", "提案"));
    li.append(el("span", "team-note-text", p.text));
    const actions = el("div", "team-note-actions");
    actions.append(
      button(
        "採用",
        "accept",
        () => decideProposal("accept", p),
        "提案を採用: " + p.text,
      ),
      button(
        "却下",
        "reject",
        () => decideProposal("reject", p),
        "提案を却下: " + p.text,
      ),
    );
    li.append(actions);
    return li;
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
    if (editingId !== note.id && !note.done)
      for (const s of note.suggestions || [])
        li.append(suggestionBlock(note, s));
    if (note.attachments?.length)
      li.append(attachmentsBlock(note, note.attachments));
    return li;
  }

  function focusNote(id) {
    shelf.querySelector(`[data-note-id="${id}"]`)?.focus();
  }

  function replace(note) {
    notes = sortNotes(notes.map((n) => (n.id === note.id ? note : n)));
  }

  // 棚は HTML で hidden のまま始め、付箋が使えると分かってから出す。
  // 無効な本番（404）ではボードの幅も見た目も棚の導入前と変わらない。
  // 棚が現れるとボードの幅が変わり、ボードは描き直される。進行中の native drag の
  // カードを DOM から外さないよう、ドラッグ中なら終わる（dragend/drop）まで後へ回す。
  let revealDeferred = false;
  function reveal() {
    if (!shelf.hidden) return;
    if (document.querySelector("#board .dragging")) {
      if (revealDeferred) return;
      revealDeferred = true;
      const after = () => {
        document.removeEventListener("dragend", after, true);
        document.removeEventListener("drop", after, true);
        revealDeferred = false;
        // ボード側の drop 処理（clearDrag）が終わってから出す。
        setTimeout(reveal, 0);
      };
      document.addEventListener("dragend", after, true);
      document.addEventListener("drop", after, true);
      return;
    }
    shelf.hidden = false;
    window.dispatchEvent(new Event("resize"));
  }

  async function load() {
    try {
      const data = await api("GET");
      notes = sortNotes(data.notes || []);
      proposals = data.proposals || [];
      if (data.sample === true && mode !== "api") {
        // 静的プレビュー（scripts/preview.mjs）だけが返す見本。保存しない。
        mode = "sample";
        setStatus("サンプル表示です。付箋は保存されません。", "sample");
      } else {
        mode = "api";
        if (statusEl.classList.contains("stale")) setStatus("");
      }
    } catch (e) {
      if (e.status === 404 && mode !== "api") {
        // Worker で付箋が無効（TEAM_NOTES_ENABLED が "true" でない）。棚を出さない。
        mode = "off";
        shelf.dataset.mode = mode;
        return;
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
    reveal();
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
    if (["note_conflict", "note_not_found", "item_not_found"].includes(e.code))
      load();
  }

  async function write(body, apply) {
    if (mode === "sample") {
      apply(null);
      render();
      return true;
    }
    busy = true;
    let release;
    inflight = new Promise((resolve) => (release = resolve));
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
      release();
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
    // blur で他の書き込みと重なったら、終わるのを待ってから順に送る。rev は編集を
    // 始めたときの値のままなので、間に同じ付箋が変わっていれば競合として止まる。
    while (busy) await inflight;
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

  // 直し案・添付の採否。人だけが行う（サーバーでも強制）。
  async function decide(op, note, itemId) {
    if (busy) return;
    await write({ op, id: note.id, item: itemId }, (data) => {
      if (data?.note) return replace(data.note);
      // サンプル表示: ブラウザー内だけで同じ結果を作る。
      const s = (note.suggestions || []).find((x) => x.id === itemId);
      const next = {
        ...note,
        suggestions: (note.suggestions || []).filter((x) => x.id !== itemId),
        attachments: (note.attachments || [])
          .filter((x) => x.id !== itemId || op === "accept")
          .map((x) => (x.id === itemId ? { ...x, state: "kept" } : x)),
      };
      if (s && op === "accept") {
        next.text = s.after;
        next.rev = note.rev + 1;
      }
      replace(next);
    });
    const li = shelf.querySelector(`[data-note-id="${note.id}"]`);
    (li?.querySelector(".team-note-action:not(:disabled)") || li)?.focus();
  }

  async function decideProposal(op, p) {
    if (busy) return;
    const at = proposals.findIndex((x) => x.id === p.id);
    const ok = await write({ op, id: p.id }, (data) => {
      proposals = proposals.filter((x) => x.id !== p.id);
      if (op === "accept") {
        const note = data?.note || { ...p, rev: p.rev + 1 };
        delete note.proposal;
        notes = sortNotes([note, ...notes]);
      }
    });
    if (ok === false) return;
    if (op === "accept") return focusNote(p.id);
    const rest = [...shelf.querySelectorAll("[data-proposal-id] .accept")];
    (rest[Math.min(at, rest.length - 1)] || input).focus();
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
    if (!li || e.target !== li) {
      // 採用・却下のボタンや添付のリンクの上でも、ボードの 1 文字ショートカットを発火させない。
      if (
        e.target.closest?.("button,summary,a") &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey
      )
        e.stopPropagation();
      return;
    }
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
      shelf.hidden ||
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
