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
  const pbiPick = $("#team-note-pbi");
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
  // 関係する PBI を選び直している付箋（ADR 020）。
  let pbiEditingId = null;
  // 詳しいメモを書いている付箋と、メモを開いている付箋（ADR 021）。
  let memoEditingId = null;
  const openMemos = new Set();
  const MEMO_MAX = 2000;
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
    note_already_issued: "この付箋はすでに別の Issue と結び付いています。",
    invalid_issue: "Issue の番号を確かめられませんでした。",
    issue_not_from_note:
      "この付箋から作った Issue として確かめられませんでした。最新を取得してください。",
    invalid_pbi: "PBI の番号を確かめられませんでした。選び直してください。",
    invalid_memo: `メモは ${MEMO_MAX} 文字までです。`,
  };

  // ---- 関係する PBI（ADR 020） ----
  // 付箋は PBI の番号だけを持つ。題はボードの読み取り（GitHub が正本）から引き、
  // ボードに無い番号は「#番号」だけを出す。
  function boardLanes() {
    try {
      // ボード全体を複製しない軽い読み取り（無ければ従来の複製）。
      const lanes =
        window.Whiteboard?.pbiLanes?.() ||
        window.Whiteboard?.getSnapshot?.()?.lanes ||
        [];
      return lanes.filter(
        (l) =>
          l.type === "PBI" && Number.isSafeInteger(l.number) && l.number > 0,
      );
    } catch {
      return [];
    }
  }

  function pbiLabel(number, lanes = boardLanes()) {
    const lane = lanes.find((l) => l.number === number);
    return lane ? `#${number} ${lane.title}` : `#${number}`;
  }

  /** PBI の選択肢（なし・ボードに表示中・その他の open な PBI）。selected が候補に無ければ番号だけで足す。 */
  function pbiOptions(select, selected, noneLabel) {
    const { shown, others } = boardPbis();
    const groups = [];
    for (const [label, list] of [
      ["ボードに表示中", shown],
      ["その他の PBI", others],
    ]) {
      if (!list.length) continue;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const l of list)
        group.append(new Option(`#${l.number} ${l.title}`, String(l.number)));
      groups.push(group);
    }
    const extra =
      selected && ![...shown, ...others].some((l) => l.number === selected)
        ? [new Option(pbiLabel(selected), String(selected))]
        : [];
    select.replaceChildren(new Option(noneLabel, ""), ...extra, ...groups);
    select.value = selected ? String(selected) : "";
  }

  function selectedPbi() {
    const n = Number(pbiPick?.value);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  }

  // 開く直前に、今のボードから選択肢を作り直す（選んだ値は保つ）。
  function refreshPbiPick() {
    if (pbiPick) pbiOptions(pbiPick, selectedPbi(), "なし");
  }

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

  async function api(method, body, path = "api/team-notes", timeout = 20000) {
    let response;
    try {
      response = await fetch(new URL(path, new URL(".", location.href)), {
        method,
        credentials: "same-origin",
        cache: "no-store",
        signal: AbortSignal.timeout(timeout),
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
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
    const lanes = boardLanes();
    listEl.replaceChildren(...open.map((n) => item(n, lanes)));
    doneEl.replaceChildren(...done.map((n) => item(n, lanes)));
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
    if (pbiPick) {
      pbiPick.disabled = input.disabled;
      if (document.activeElement !== pbiPick) refreshPbiPick();
    }
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

  function item(note, lanes = boardLanes()) {
    const li = document.createElement("li");
    li.className = "team-note" + (note.done ? " done" : "");
    li.tabIndex = 0;
    li.dataset.noteId = note.id;
    li.setAttribute(
      "aria-label",
      note.text +
        (note.pbi ? `（PBI ${pbiLabel(note.pbi, lanes)}）` : "") +
        (note.issue ? `（Issue #${note.issue.number}）` : "") +
        (note.done ? "（済み）" : ""),
    );
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
    const tools = el("span", "team-note-tools");
    if (editingId !== note.id && memoEditingId !== note.id) {
      const memo = el("button", "team-note-memo-button", "メモ");
      memo.type = "button";
      memo.tabIndex = -1;
      memo.setAttribute("aria-label", "詳しいメモを書く（M）");
      memo.title = "詳しいメモを書く（M）";
      memo.onclick = () => startMemoEdit(note);
      tools.append(memo);
    }
    if (editingId !== note.id && pbiEditingId !== note.id) {
      const pick = el("button", "team-note-pbi-button", "PBI");
      pick.type = "button";
      pick.tabIndex = -1;
      pick.setAttribute("aria-label", "関係する PBI を選ぶ（P）");
      pick.title = "関係する PBI を選ぶ（P）";
      pick.onclick = () => startPbiEdit(note);
      tools.append(pick);
    }
    if (!note.issue && !note.done && editingId !== note.id) {
      const toIssue = el("button", "team-note-issue", "Issue に");
      toIssue.type = "button";
      toIssue.tabIndex = -1;
      toIssue.setAttribute("aria-label", "Issue にする（I）");
      toIssue.title = "Issue にする（I）";
      toIssue.onclick = () => openIssueDialog(note);
      tools.append(toIssue);
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "team-note-remove";
    remove.tabIndex = -1;
    remove.textContent = "×";
    remove.setAttribute("aria-label", "剥がす");
    remove.title = "剥がす（Delete）";
    remove.onclick = () => removeNote(note);
    tools.append(remove);
    li.append(tools);
    if (pbiEditingId === note.id) li.append(pbiEditor(note));
    else if (note.pbi) {
      const tag = el("button", "team-note-pbi", pbiLabel(note.pbi, lanes));
      tag.type = "button";
      tag.tabIndex = -1;
      tag.setAttribute(
        "aria-label",
        `関係する PBI: ${pbiLabel(note.pbi, lanes)}（P で選び直す）`,
      );
      tag.onclick = () => startPbiEdit(note);
      li.append(tag);
    }
    if (memoEditingId === note.id) li.append(memoEditor(note));
    else if (note.memo) li.append(memoBlock(note));
    if (note.issue) {
      const href = issueHref(note.issue);
      if (href) {
        const link = el(
          "a",
          "team-note-issue-link",
          `Issue #${note.issue.number}`,
        );
        link.href = href;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.referrerPolicy = "no-referrer";
        link.setAttribute(
          "aria-label",
          `この付箋から作った Issue #${note.issue.number} を GitHub で開く`,
        );
        li.append(link);
      }
    }
    if (editingId !== note.id && !note.done)
      for (const s of note.suggestions || [])
        li.append(suggestionBlock(note, s));
    if (note.attachments?.length)
      li.append(attachmentsBlock(note, note.attachments));
    return li;
  }

  // 付箋の上の PBI の選び直し。一覧（listbox）で選び、Enter かクリックで保存、Escape で取り消す。
  // 矢印で選ぶたびには保存しない（閉じた select の change は矢印ごとに起きるため）。
  function pbiEditor(note) {
    const select = document.createElement("select");
    select.className = "team-note-pbi-edit";
    select.setAttribute(
      "aria-label",
      "関係する PBI を選ぶ（Enter で決定、Escape で取り消し）",
    );
    pbiOptions(select, note.pbi || null, "PBI なし（外す）");
    select.size = Math.min(6, Math.max(2, select.options.length));
    let done = false;
    let chosen = false;
    // Enter の連打・押しっぱなし・ダブルクリックでも 1 回だけ送る（2 回目は古い rev で偽の競合になる）。
    const choose = () => {
      if (chosen) return;
      chosen = true;
      done = true;
      const n = Number(select.value);
      savePbi(note, Number.isSafeInteger(n) && n > 0 ? n : null);
    };
    const cancel = () => {
      if (done) return;
      done = true;
      pbiEditingId = null;
      render();
      focusNote(note.id);
    };
    select.onkeydown = (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) choose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
      e.stopPropagation();
    };
    select.onclick = (e) => {
      if (e.target.tagName !== "OPTION") return;
      choose();
    };
    select.onblur = () => {
      if (pbiEditingId === note.id) cancel();
    };
    queueMicrotask(() => select.focus());
    return select;
  }

  // メモ: 一言の下に折りたたむ。開閉は描き直しをまたいで覚えておく。
  function memoBlock(note) {
    const box = el("details", "team-note-memo");
    box.open = openMemos.has(note.id);
    box.ontoggle = () => {
      if (box.open) openMemos.add(note.id);
      else openMemos.delete(note.id);
    };
    box.append(el("summary", "", "メモ"));
    const body = el("p", "team-note-memo-text", note.memo);
    body.ondblclick = () => startMemoEdit(note);
    box.append(body);
    return box;
  }

  // メモの編集。Enter は改行、⌘/Ctrl+Enter かフォーカスを外すと保存、Escape で取り消す。
  function memoEditor(note) {
    const wrap = el("div", "team-note-memo-edit");
    const field = document.createElement("textarea");
    field.value = note.memo || "";
    field.maxLength = MEMO_MAX;
    field.rows = 5;
    field.setAttribute(
      "aria-label",
      "詳しいメモ（⌘/Ctrl+Enter で保存、Escape で取り消し）",
    );
    field.placeholder =
      "背景・気づき・Why など（Issue にするとき Why の初期値になる）";
    const hint = el(
      "p",
      "team-note-memo-hint",
      "⌘/Ctrl+Enter で保存・Escape で取り消し",
    );
    let closed = false;
    field.onkeydown = (e) => {
      e.stopPropagation();
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        closed = true;
        saveMemo(note, field.value);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closed = true;
        memoEditingId = null;
        render();
        focusNote(note.id);
      }
    };
    field.onblur = () => {
      if (!closed && memoEditingId === note.id) {
        closed = true;
        saveMemo(note, field.value);
      }
    };
    wrap.append(field, hint);
    queueMicrotask(() => {
      field.focus();
      field.setSelectionRange(field.value.length, field.value.length);
    });
    return wrap;
  }

  function startMemoEdit(note) {
    if (busy || mode === "loading" || mode === "error") return;
    editingId = null;
    pbiEditingId = null;
    memoEditingId = note.id;
    render();
  }

  async function saveMemo(note, value) {
    memoEditingId = null;
    const memo = value.replace(/\r\n?/g, "\n").trim();
    if (memo === (note.memo || "")) {
      render();
      return focusNote(note.id);
    }
    if ([...memo].length > MEMO_MAX) {
      render();
      return setStatus(messages.invalid_memo, "error");
    }
    while (busy) await inflight;
    const ok = await write(
      { op: "memo", id: note.id, rev: note.rev, memo },
      (data) => {
        if (data?.note) return replace(data.note);
        const next = { ...note, rev: note.rev + 1 };
        if (memo) next.memo = memo;
        else delete next.memo;
        replace(next);
      },
    );
    if (ok && memo) openMemos.add(note.id);
    if (ok) render();
    focusNote(note.id);
  }

  function startPbiEdit(note) {
    if (busy || mode === "loading" || mode === "error") return;
    editingId = null;
    memoEditingId = null;
    pbiEditingId = note.id;
    render();
  }

  async function savePbi(original, pbi) {
    pbiEditingId = null;
    // 選んでいる間に再取得で変わっていれば、その rev と値で比べる。
    const note = notes.find((n) => n.id === original.id) || original;
    if ((note.pbi || null) === pbi) {
      render();
      return focusNote(note.id);
    }
    while (busy) await inflight;
    await write({ op: "pbi", id: note.id, rev: note.rev, pbi }, (data) => {
      if (data?.note) return replace(data.note);
      const next = { ...note, rev: note.rev + 1 };
      if (pbi) next.pbi = pbi;
      else delete next.pbi;
      replace(next);
    });
    focusNote(note.id);
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
    const pbi = selectedPbi();
    const sentPick = pbiPick?.value ?? "";
    const ok = await write(
      { op: "create", texts, ...(pbi ? { pbi } : {}) },
      (data) => {
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
            ...(pbi ? { pbi } : {}),
          }));
        notes = sortNotes([...created, ...notes]);
      },
    );
    if (ok !== false) {
      input.value = "";
      // 選ばなければ今までと同じ付箋になるよう、貼ったら「なし」へ戻す。
      // 送っている間に別の PBI を選び直していたら、その選択は残す。
      if (pbiPick && pbiPick.value === sentPick) pbiPick.value = "";
    }
    autosize();
    input.focus();
  }

  function startEdit(note) {
    if (busy) return;
    pbiEditingId = null;
    memoEditingId = null;
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

  // ---- 付箋を Issue にする（ADR 019） ----
  // 編集画面で必須の欄を埋め、Worker が付箋ごとの DO を通して GitHub に作る。
  // 作れたら付箋にその Issue を結び付けて済みにする。結果不明は自動で再送しない。
  const issueDialog = document.getElementById("note-issue-dialog");
  const issueForm = document.getElementById("note-issue-form");
  const ISSUE_BASE = "https://github.com/engineer-first/idea-boost/issues/";
  const ISSUE_FIELDS = {
    PBI: ["story", "why", "experience", "notes"],
    Task: ["why", "how", "acceptance", "notes"],
  };
  const REQUIRED = { PBI: ["title", "story", "why"], Task: ["title", "why"] };
  const FIELD_NAMES = {
    title: "タイトル",
    story: "ユーザーストーリー",
    why: "Why",
  };
  const STEP_NAMES = {
    type: "種類",
    parent: "親 PBI",
    project: "Project への追加",
    status: "Status",
  };
  const issueMessages = {
    invalid_title: "タイトルは 1〜256 文字で書いてください。",
    required_why: "Why を書いてください。",
    required_story: "ユーザーストーリーを書いてください。",
    field_too_long: "1 つの欄は 10000 文字までです。",
    parent_not_pbi:
      "親に選んだ Issue が見つからないか、PBI ではありません。選び直してください。",
    parent_closed: "親に選んだ PBI は閉じています。選び直してください。",
    status_option_missing:
      "Project にこの Status がありません。別の Status を選んでください。",
    github_writes_disabled: "この環境では GitHub へ書き込めません。",
    scope_not_public:
      "公開範囲を確認できないため作りませんでした。再読み込みしてください。",
    rate_limited: "操作が多すぎます。少し待ってから作ってください。",
    mutation_queue_full:
      "保存が混み合っています。少し待ってから作ってください。",
    github_request_failed:
      "GitHub が Issue の作成を受け付けませんでした。内容を確かめてもう一度作ってください。",
    sign_in_required: "ログインし直してください。",
    origin_mismatch:
      "このページからの操作として確認できませんでした。再読み込みしてください。",
  };
  const issueDrafts = new Map();
  // 結果不明になった付箋。同じ画面からは作り直させない（DO 側でも止まる）。
  const issueBlocked = new Set();
  let issueNote = null;
  let issueReturn = null;
  let issueBusy = false;

  function issueHref(issue) {
    return Number.isSafeInteger(issue?.number) &&
      issue.number > 0 &&
      issue.url === ISSUE_BASE + issue.number
      ? issue.url
      : null;
  }

  const issueField = (name) => issueForm.elements.namedItem(name);
  const issueType = () =>
    issueForm.querySelector('input[name="type"]:checked')?.value === "PBI"
      ? "PBI"
      : "Task";

  function setIssueType(type) {
    for (const node of issueForm.querySelectorAll("[data-for]"))
      node.hidden = node.dataset.for !== type;
    document.getElementById("note-issue-notes-label").textContent =
      type === "PBI" ? "補足" : "関連Issue・補足";
  }

  function boardPbis() {
    let snapshot = null;
    let visible = [];
    try {
      snapshot = window.Whiteboard?.pbiLanes
        ? { lanes: window.Whiteboard.pbiLanes() }
        : window.Whiteboard?.getSnapshot?.();
      visible = window.Whiteboard?.visibleLaneIds?.() || [];
    } catch {
      /* ボードがまだ読めていなくても、親なしで作れる */
    }
    const lanes = (snapshot?.lanes || []).filter(
      (l) =>
        l.type === "PBI" &&
        Number.isSafeInteger(l.number) &&
        l.number > 0 &&
        l.state !== "CLOSED",
    );
    const shown = new Set(visible);
    return {
      shown: lanes.filter((l) => shown.has(l.id)),
      others: lanes.filter((l) => !shown.has(l.id)),
    };
  }

  function fillParents(selected) {
    const select = issueField("parent");
    const none = new Option("親 PBI なし（ボードには出ません）", "");
    const groups = [];
    const { shown, others } = boardPbis();
    for (const [label, list] of [
      ["ボードに表示中", shown],
      ["その他の PBI", others],
    ]) {
      if (!list.length) continue;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const l of list)
        group.append(new Option(`#${l.number} ${l.title}`, String(l.number)));
      groups.push(group);
    }
    select.replaceChildren(none, ...groups);
    select.value =
      selected && select.querySelector(`option[value="${selected}"]`)
        ? String(selected)
        : "";
  }

  function keptAttachments(note) {
    return (note.attachments || [])
      .filter((a) => a.state === "kept")
      .map((a) =>
        a.kind === "url"
          ? `- ${a.label ? a.label + ": " : ""}${a.value}`
          : `- ${a.value.replace(/\s*\n\s*/g, " ")}`,
      )
      .join("\n");
  }

  function readIssueForm() {
    const value = (name) => issueField(name)?.value ?? "";
    return {
      type: issueType(),
      title: value("title"),
      parent: value("parent"),
      status: value("status"),
      story: value("story"),
      why: value("why"),
      experience: value("experience"),
      how: value("how"),
      acceptance: value("acceptance"),
      notes: value("notes"),
    };
  }

  function writeIssueForm(draft) {
    for (const radio of issueForm.querySelectorAll('input[name="type"]'))
      radio.checked = radio.value === draft.type;
    for (const name of [
      "title",
      "status",
      "story",
      "why",
      "experience",
      "how",
      "acceptance",
      "notes",
    ])
      issueField(name).value = draft[name] ?? "";
    if (!issueField("status").value) issueField("status").value = "未整理";
    fillParents(draft.parent);
    setIssueType(draft.type);
  }

  // 閉じた後や別の付箋を開いている間に結果が返ったら、ダイアログではなく棚の状態行に出す。
  function reportIssueError(note, text, link) {
    if (issueDialog.open && issueNote?.id === note.id)
      return showIssueError(text, link);
    setStatus(
      `「${note.text.slice(0, 20)}」: ${text}`,
      "error",
      link && {
        label: link.label,
        run: () => window.open(link.href, "_blank", "noopener,noreferrer"),
      },
    );
  }

  function showIssueError(text, link) {
    const box = document.getElementById("note-issue-error");
    box.replaceChildren();
    box.hidden = !text;
    if (!text) return;
    box.append(document.createTextNode(text));
    if (link) {
      const a = el("a", "", link.label);
      a.href = link.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.referrerPolicy = "no-referrer";
      box.append(" ", a);
    }
  }

  function syncIssueControls() {
    const submit = document.getElementById("note-issue-submit");
    submit.disabled = issueBusy || !issueNote || issueBlocked.has(issueNote.id);
    submit.textContent = issueBusy ? "作成中…" : "Issue を作る";
    if (issueBusy) issueDialog.setAttribute("aria-busy", "true");
    else issueDialog.removeAttribute("aria-busy");
  }

  function openIssueDialog(note) {
    if (!issueDialog || note.issue || note.done) return;
    if (mode !== "api" && mode !== "sample") return;
    if (issueDialog.open) return;
    issueNote = note;
    issueReturn = note.id;
    document.getElementById("note-issue-source").textContent = note.text;
    writeIssueForm(
      issueDrafts.get(note.id) || {
        type: "Task",
        title: note.text,
        status: "未整理",
        // 付箋に付けた PBI を親の初期値にする（ADR 020）。open でない PBI は候補に無いので「なし」になる。
        parent: note.pbi ? String(note.pbi) : "",
        // 人が書いたメモを Why の初期値にする（ADR 021）。下書きがあれば下書きが優先。
        why: note.memo || "",
        notes: keptAttachments(note),
      },
    );
    for (const node of issueForm.querySelectorAll("[aria-invalid]"))
      node.removeAttribute("aria-invalid");
    if (issueBlocked.has(note.id))
      showIssueError(
        "前回の作成の結果を確認できていません。二重に作らないよう、この付箋からは作れません。GitHub で確かめてください。",
        { label: "GitHub の Issue 一覧", href: ISSUE_BASE },
      );
    else if (mode === "sample")
      showIssueError("サンプル表示です。Issue は作られません。");
    else showIssueError("");
    syncIssueControls();
    issueDialog.showModal();
    issueField("title").focus();
    issueField("title").select();
  }

  function closeIssueDialog() {
    if (!issueDialog.open) return;
    // 書いた内容は、この画面を開いている間は付箋ごとに残す（閉じても消えない）。
    if (issueNote && !issueBusy) issueDrafts.set(issueNote.id, readIssueForm());
    issueDialog.close();
  }

  function issueResultStatus(issue, warning) {
    statusEl.textContent = "";
    statusEl.className = "team-note-status" + (warning ? " error" : "");
    statusEl.hidden = false;
    const href = issueHref(issue);
    statusEl.append(
      document.createTextNode(
        warning ? `Issue #${issue.number} を作りました。${warning}` : "",
      ),
    );
    if (!warning) statusEl.append(document.createTextNode("Issue "));
    if (href) {
      const a = el("a", "", `#${issue.number}`);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.referrerPolicy = "no-referrer";
      if (warning) statusEl.append(" ", a);
      else statusEl.append(a);
    }
    if (!warning)
      statusEl.append(
        document.createTextNode(" を作り、付箋を済みにしました。"),
      );
  }

  async function linkIssue(note, issue) {
    while (busy) await inflight;
    return write(
      { op: "issue", id: note.id, number: issue.number, url: issue.url },
      (data) =>
        replace(
          data?.note || {
            ...note,
            done: true,
            issue: { number: issue.number, url: issue.url },
            rev: note.rev + 1,
          },
        ),
    );
  }

  async function submitIssue() {
    if (issueBusy || !issueNote || issueBlocked.has(issueNote.id)) return;
    const note = issueNote;
    const form = readIssueForm();
    for (const node of issueForm.querySelectorAll("[aria-invalid]"))
      node.removeAttribute("aria-invalid");
    const missing = REQUIRED[form.type].filter((k) => !form[k].trim());
    if (missing.length) {
      for (const k of missing)
        issueField(k).setAttribute("aria-invalid", "true");
      showIssueError(
        "必須の欄を書いてください: " +
          missing.map((k) => FIELD_NAMES[k]).join("、"),
      );
      issueField(missing[0]).focus();
      return;
    }
    if (mode === "sample") {
      showIssueError("サンプル表示です。Issue は作られません。");
      return;
    }
    const body = {
      requestId: requestId(),
      noteId: note.id,
      type: form.type,
      title: form.title,
      status: form.status,
      ...(form.type === "Task" && form.parent
        ? { parent: Number(form.parent) }
        : {}),
    };
    for (const k of ISSUE_FIELDS[form.type])
      if (form[k].trim()) body[k] = form[k];
    issueDrafts.set(note.id, form);
    issueBusy = true;
    showIssueError("");
    syncIssueControls();
    let issue = null;
    let warning = "";
    try {
      // サーバーは GitHub を数回続けて呼ぶので、付箋の書き込みより長く待つ。待ちきれなければ結果不明。
      const data = await api(
        "POST",
        body,
        `api/team-notes/${note.id}/issue`,
        90000,
      );
      issue = data.issue;
    } catch (e) {
      if (e.data?.issue && issueHref(e.data.issue)) {
        issue = e.data.issue;
        if (e.code === "note_already_issued")
          warning =
            "（この付箋からは前に作っていました。新しくは作っていません）";
        else if (e.code === "partial_issue")
          warning =
            "ただし次が済んでいません。再送はしないので、GitHub で直してください: " +
            (e.data.failed || []).map((x) => STEP_NAMES[x] || x).join("、") +
            "。";
        else
          warning =
            "ただし Project・Status・親 PBI が反映されたか確かめられませんでした。GitHub で確かめてください。";
      } else if (e.ambiguous) {
        issueBlocked.add(note.id);
        reportIssueError(
          note,
          "Issue が作られたか確認できません。再送はしていません。二重に作らないよう、GitHub で確かめてください。",
          { label: "GitHub の Issue 一覧", href: ISSUE_BASE },
        );
      } else {
        reportIssueError(
          note,
          issueMessages[e.code] ||
            "Issue を作れませんでした。内容を確かめてください。",
        );
      }
    } finally {
      issueBusy = false;
      syncIssueControls();
    }
    if (!issue) return;
    if (issueNote?.id === note.id && issueDialog.open) issueDialog.close();
    const linked = await linkIssue(note, issue);
    // 下書きは結び付けに成功してから消す。失敗したら押し直しで同じ内容のまま受領を取りにいける。
    if (linked) issueDrafts.delete(note.id);
    if (linked) issueResultStatus(issue, warning);
    else
      // Issue はできている。付箋への結び付けだけ失敗した。もう一度「Issue に」を押すと、
      // 新しくは作らずに同じ Issue を結び付け直す（DO が付箋ごとの受領を返す）。
      issueResultStatus(
        issue,
        "付箋への結び付けに失敗しました。最新を取得し、もう一度「Issue に」を押すと同じ Issue を結び付けます。",
      );
    window.Whiteboard?.refreshAfterNoteIssue?.()?.catch?.(() => {});
    focusNote(note.id);
  }

  if (issueDialog && issueForm) {
    issueForm.addEventListener("change", (e) => {
      if (e.target.name === "type") setIssueType(issueType());
    });
    issueForm.addEventListener("submit", (e) => {
      e.preventDefault();
      submitIssue();
    });
    issueForm.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        submitIssue();
      }
      // 入力欄・ラジオ・選択の Enter で送らない（IME の確定や暗黙の送信で作ってしまわない）。
      // 送るのは ⌘/Ctrl+Enter か「Issue を作る」ボタンだけ。
      else if (
        e.key === "Enter" &&
        ["INPUT", "SELECT"].includes(e.target.tagName)
      )
        e.preventDefault();
    });
    issueDialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeIssueDialog();
    });
    issueDialog.addEventListener("close", () => {
      issueNote = null;
      const id = issueReturn;
      issueReturn = null;
      // close は後から届く。その間に同じ付箋の中で入力（PBI の一覧・本文やメモの編集）を
      // 始めていれば、フォーカスを奪わない（奪うと blur で入力が閉じる）。
      const li = id && shelf.querySelector(`[data-note-id="${id}"]`);
      const active = document.activeElement;
      const typing =
        li?.contains(active) && active.matches("select,textarea");
      if (li && !typing) li.focus();
    });
    document.getElementById("note-issue-close").onclick = closeIssueDialog;
    document.getElementById("note-issue-cancel").onclick = closeIssueDialog;
    // 暗幕（dialog の外）のクリックだけで閉じる。dialog の余白のクリックでは閉じない。
    issueDialog.addEventListener("click", (e) => {
      if (e.target !== issueDialog) return;
      const r = issueDialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        closeIssueDialog();
    });
  }

  if (pbiPick) {
    pbiPick.addEventListener("focus", refreshPbiPick);
    pbiPick.addEventListener("pointerdown", () => {
      if (document.activeElement !== pbiPick) refreshPbiPick();
    });
    // 選択中の 1 文字でボードのショートカットを発火させない。Escape は一言入力へ戻る。
    pbiPick.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        input.focus();
      }
      if (!e.metaKey && !e.ctrlKey) e.stopPropagation();
    });
  }

  /** ボードの PBI 行の入口から、その PBI を選んだ状態で一言入力へ移る。 */
  let laneKey = "";
  window.TeamNotes = {
    /** ボードが描き直された。PBI の番号と題が変わったときだけ棚を描き直す（編集中は待つ）。 */
    boardChanged() {
      if (mode !== "api" && mode !== "sample") return;
      // 題を出すのは PBI 付きの付箋だけ。無ければボードの読み取りを複製しない。
      if (!notes.some((n) => n.pbi)) return;
      const key = JSON.stringify(
        boardLanes().map((l) => [l.number, l.title, l.state]),
      );
      if (key === laneKey || editingId || pbiEditingId || memoEditingId) return;
      laneKey = key;
      render();
    },
    composeFor(number) {
      if (!pbiPick || shelf.hidden) return false;
      if (mode !== "api" && mode !== "sample") return false;
      if (!Number.isSafeInteger(number) || number < 1) return false;
      if (shelf.classList.contains("collapsed")) setCollapsed(false);
      pbiOptions(pbiPick, number, "なし");
      input.focus();
      return true;
    },
  };

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
      e.key.toLowerCase() === "i" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      handled();
      if (!note.issue && !note.done) openIssueDialog(note);
    } else if (
      e.key.toLowerCase() === "p" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      handled();
      startPbiEdit(note);
    } else if (
      e.key.toLowerCase() === "m" &&
      !e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey
    ) {
      handled();
      startMemoEdit(note);
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
    if (
      mode !== "api" ||
      busy ||
      editingId ||
      pbiEditingId ||
      memoEditingId ||
      document.hidden
    )
      return;
    load();
  };
  setInterval(refresh, 30000);
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", refresh);

  render();
  load();
})();
