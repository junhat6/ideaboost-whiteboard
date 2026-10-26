"use strict";
const columns = ["ToDo", "Doing", "Wait", "Done"];
const rawStatuses = [
  "未整理",
  "壁打ち中",
  "着手可能",
  "作業中",
  "レビュー中",
  "完了",
  "見送り",
];
const targetStatus = {
  ToDo: "未整理",
  Doing: "作業中",
  Wait: "レビュー中",
  Done: "完了",
};
const statusColumn = (s) =>
  s === "未整理"
    ? "ToDo"
    : ["壁打ち中", "着手可能", "作業中"].includes(s)
      ? "Doing"
      : s === "レビュー中"
        ? "Wait"
        : s === "完了"
          ? "Done"
          : null;
const people = { a: "デモ A", b: "デモ B", c: "デモ C", none: "未割り当て" };
const initial = { lanes: [], tasks: [] };
const clone = (x) => JSON.parse(JSON.stringify(x));
const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state = clone(initial),
  stale = false,
  loading = false,
  selectedMilestone = "",
  editorBaseline = null,
  adapter = null,
  connectionError = "",
  page = 0,
  editing = null,
  returnFocus = null,
  dragged = null,
  pending = false,
  storageFailed = false,
  toastTimer,
  editMode = false,
  lastReceivedAt = null,
  lastAutoAttempt = 0;
function valid(s) {
  return (
    s &&
    Array.isArray(s.lanes) &&
    Array.isArray(s.tasks) &&
    s.lanes.every(
      (l) =>
        l.id &&
        typeof l.title === "string" &&
        typeof l.body === "string" &&
        (l.status == null || typeof l.status === "string"),
    ) &&
    s.tasks.every(
      (t) =>
        t.id &&
        typeof t.title === "string" &&
        typeof t.body === "string" &&
        (t.status == null || typeof t.status === "string") &&
        (t.lane == null || typeof t.lane === "string"),
    )
  );
}

function announce(text) {
  $("#announcement").textContent = text;
  $("#announcement").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => $("#announcement").classList.remove("visible"),
    4500,
  );
}
// Display preferences only: never included in Issue save payloads.
const DISPLAY_KEY = "idea-boost-whiteboard-display-v1",
  MAX_PBIS = 6;
const displaySelections = new Map();
let pickerDraft = null,
  pickerScope = null,
  pickerLanes = [];
function displayScope() {
  const s = state.scope || {};
  return JSON.stringify([
    adapter ? "github" : "sample",
    s.owner || "",
    s.repo || "",
    s.projectNumber || s.projectUrl || "",
    s.viewNumber || "",
    String(
      selectedMilestone || s.selectedMilestone || s.milestone || "default",
    ),
  ]);
}
function saveDisplay(key, ids) {
  displaySelections.set(key, [...ids]);
  try {
    localStorage.setItem(DISPLAY_KEY + ":" + key, JSON.stringify(ids));
  } catch {
    storageFailed = true;
  }
}
function selectedIds() {
  const key = displayScope();
  if (!displaySelections.has(key)) {
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(DISPLAY_KEY + ":" + key));
    } catch {
      storageFailed = true;
    }
    const ids =
      Array.isArray(saved) && saved.every((id) => typeof id === "string")
        ? [...new Set(saved)].slice(0, MAX_PBIS)
        : state.lanes.slice(0, MAX_PBIS).map((l) => l.id);
    saveDisplay(key, ids);
  }
  return displaySelections.get(key);
}
function selectedLanes() {
  const ids = new Set(selectedIds());
  return state.lanes.filter((l) => ids.has(l.id));
}
function renderPicker() {
  const q = $("#pbi-search").value.trim().toLocaleLowerCase(),
    ids = new Set(pickerDraft),
    missing = pickerDraft.filter((id) => !pickerLanes.some((l) => l.id === id));
  $("#pbi-selection-count").textContent = `${pickerDraft.length} / ${MAX_PBIS}`;
  $("#pbi-options").innerHTML =
    pickerLanes
      .filter(
        (l) =>
          !q ||
          `${l.number ? "#" + l.number : l.id} ${l.title}`
            .toLocaleLowerCase()
            .includes(q),
      )
      .map(
        (l) =>
          `<label class="pbi-option"><input type="checkbox" data-select-pbi="${esc(l.id)}" ${ids.has(l.id) ? "checked" : ""} ${!ids.has(l.id) && ids.size >= MAX_PBIS ? "disabled" : ""}><span><small>${esc(issueLabel(l))}</small> ${esc(l.title)}</span></label>`,
      )
      .join("") || "<p>一致するPBIはありません。</p>";
  $("#pbi-missing").innerHTML = missing.length
    ? "<p>選択済みですが現在の範囲にないPBIです。自動で別のPBIには置き換えません。</p>" +
      missing
        .map(
          (id) =>
            `<label class="pbi-option"><input type="checkbox" data-select-pbi="${esc(id)}" checked><span>範囲外 / ${esc(id)}</span></label>`,
        )
        .join("")
    : "";
}
function openPicker() {
  if (pending || loading || dragged || ($("#details").open && editMode))
    return false;
  pickerScope = displayScope();
  pickerDraft = [...selectedIds()];
  pickerLanes = clone(state.lanes);
  $("#pbi-search").value = "";
  renderPicker();
  $("#pbi-picker").showModal();
  $("#pbi-search").focus();
  return true;
}
function closePicker() {
  pickerDraft = null;
  pickerScope = null;
  pickerLanes = [];
  $("#pbi-picker").close();
  $("#choose-pbis").focus();
}
function togglePbi(id, checked) {
  if (
    !pickerDraft ||
    (!pickerLanes.some((l) => l.id === id) && !pickerDraft.includes(id))
  )
    return false;
  if (checked && !pickerDraft.includes(id)) {
    if (pickerDraft.length >= MAX_PBIS) return false;
    pickerDraft.push(id);
  } else if (!checked) pickerDraft = pickerDraft.filter((x) => x !== id);
  renderPicker();
  return true;
}
function applyPicker() {
  if (!pickerDraft || pickerScope !== displayScope()) return false;
  saveDisplay(pickerScope, pickerDraft);
  closePicker();
  page = 0;
  render();
  announce(
    storageFailed
      ? "表示するPBIを変更しました。このページ内のみ保持します。"
      : "表示するPBIをこのブラウザーに保存しました。Issueは変更していません。",
  );
  return true;
}
function issue(kind, id) {
  return (kind === "PBI" ? state.lanes : state.tasks).find((t) => t.id === id);
}
function goal(body) {
  const clean = body.replace(/<!--[\s\S]*?(?:-->|$)/g, "");
  let fence = null,
    sections = [],
    current = null;
  for (const line of clean.split("\n")) {
    const f = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (f) {
      if (!fence) fence = f[1];
      else if (
        f[1][0] === fence[0] &&
        f[1].length >= fence.length &&
        !f[2].trim()
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const h = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/);
    if (h) {
      if (current && h[1].length <= current.level) current = null;
      const name = h[2].trim();
      if (
        [
          "ユーザーに提供する体験",
          "受け入れ条件・デモ確認内容",
          "受け入れ条件",
          "デモゴール",
          "提供したい体験",
          "Demo goal",
          "デモのゴール",
        ].includes(name)
      ) {
        current = { name, level: h[1].length, lines: [] };
        sections.push(current);
        continue;
      }
    }
    if (current) current.lines.push(line);
  }
  for (const name of [
    "ユーザーに提供する体験",
    "受け入れ条件・デモ確認内容",
    "受け入れ条件",
    "デモゴール",
    "提供したい体験",
    "Demo goal",
    "デモのゴール",
  ]) {
    const matches = sections.filter((s) => s.name === name);
    if (matches.length)
      return matches
        .map((s) => s.lines.join("\n").trim())
        .filter(Boolean)
        .join("\n\n");
  }
  return "";
}
function person(t) {
  return t.assignees
    ? t.assignees.map((a) => a.name || a.login).join("・") || "未割り当て"
    : people[t.assignee] || t.assignee || "未割り当て";
}
// Use only the avatar URL supplied by GitHub; never infer one from a login.
const failedAvatarUrls = new Set();
function safeAvatarUrl(value) {
  if (typeof value !== "string" || !value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname === "avatars.githubusercontent.com" &&
      !url.username &&
      !url.password &&
      !url.port
      ? url.href
      : "";
  } catch {
    return "";
  }
}
function assigneeAvatars(t) {
  const assigned = Array.isArray(t.assignees)
    ? t.assignees
    : t.assignee && t.assignee !== "none"
      ? [{ name: person(t) }]
      : [];
  if (!assigned.length)
    return '<span class="avatar none" role="img" aria-label="未割り当て" title="未割り当て"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="5" r="2.5"/><path d="M3 14v-1a5 5 0 0 1 10 0v1"/></svg></span>';
  const shown = assigned
    .slice(0, 2)
    .map((a) => {
      const name = a.name || a.login || "担当者",
        url = safeAvatarUrl(a.avatarUrl),
        initial = Array.from(name.replace(/^デモ /, "").trim())[0] || "?";
      return `<span class="avatar" role="img" aria-label="${esc(name)}" title="${esc(name)}"><span aria-hidden="true">${esc(initial)}</span>${url && !failedAvatarUrls.has(url) ? `<img class="avatar-image" src="${esc(url)}" alt="${esc(name)}" title="${esc(name)}" width="16" height="16" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">` : ""}</span>`;
    })
    .join("");
  const remaining = assigned.slice(2),
    more = remaining.length
      ? `<span class="avatar-count" role="img" aria-label="ほか ${remaining.length} 人: ${esc(remaining.map((a) => a.name || a.login || "担当者").join("・"))}" title="${esc(remaining.map((a) => a.name || a.login || "担当者").join("・"))}">+${remaining.length}</span>`
      : "";
  return `<span class="avatar-stack">${shown}${more}</span>`;
}
function handleAvatarError(event) {
  const img = event.target;
  if (!img.matches?.("img.avatar-image")) return;
  failedAvatarUrls.add(img.getAttribute("src"));
  img.remove(); // Reveal initials beneath it; no replacement URL or retry loop.
}
function issueLabel(t) {
  return adapter ? (t.number ? `#${t.number}` : "Issue") : `DEMO-${t.id}`;
}
function card(t) {
  return `<article class="task ${esc(t.color || "yellow")}" draggable="${!pending && !(adapter && t.projectItemId === null)}" data-task="${esc(t.id)}"><div class="task-top"><span>${esc(issueLabel(t))}</span><span aria-hidden="true">⠿</span></div><button class="task-title" data-open="${esc(t.id)}" title="${esc(t.title)}"><span class="task-title-text">${esc(t.title)}</span></button><div class="task-bottom"><span class="person" title="${esc(person(t))}">${assigneeAvatars(t)}<span class="person-name">${esc(person(t))}</span></span><span class="raw-status">${esc(t.status || "Status未設定")}</span></div></article>`;
}
// Fit only the presentation, never the Issue title. If the available area is
// genuinely too small at 10.5px, expose whole scrollable lines (and the drawer).
function fitCardTitles() {
  for (const button of document.querySelectorAll(".pbi-title")) {
    const text = button.querySelector(".pbi-title-text");
    if (!text) continue;
    text.style.maxHeight = "none";
    const css = getComputedStyle(button);
    const line = parseFloat(css.lineHeight);
    const available =
      button.getBoundingClientRect().height -
      parseFloat(css.paddingTop) -
      parseFloat(css.paddingBottom);
    text.style.maxHeight = `${Math.max(0, Math.floor((available + 0.05) / line)) * line}px`;
  }
  for (const button of document.querySelectorAll(".task-title")) {
    const text = button.querySelector(".task-title-text");
    if (!text || !button.clientHeight || !button.clientWidth) continue;
    text.style.maxHeight = "none";
    let size = window.innerWidth >= 2300 ? 14 : 12;
    for (; size > 10.5; size -= 0.5) {
      button.style.fontSize = `${size}px`;
      if (text.scrollHeight <= button.clientHeight + 0.5) break;
    }
    button.style.fontSize = `${size}px`;
    const lineHeight = parseFloat(getComputedStyle(button).lineHeight),
      lines = Math.floor((button.clientHeight + 0.01) / lineHeight);
    // A complete-line viewport avoids the old half-glyph clipping at the footer.
    text.style.maxHeight = `${Math.max(0, lines) * lineHeight}px`;
    button.classList.toggle(
      "title-overflow",
      text.scrollHeight > lines * lineHeight + 1,
    );
  }
}
function matching() {
  const q = $("#search").value.trim().toLocaleLowerCase(),
    a = $("#assignee-filter").value;
  const ids = new Set(selectedLanes().map((l) => l.id));
  return state.tasks.filter(
    (t) =>
      ids.has(t.lane) &&
      (!a ||
        (t.assignees
          ? t.assignees.some((p) => p.login === a)
          : t.assignee === a)) &&
      (!q ||
        `${t.title} ${t.body} ${state.lanes.find((l) => l.id === t.lane)?.title}`
          .toLocaleLowerCase()
          .includes(q)),
  );
}
function markFresh() {
  saveBlocked = false;
  $("#detail-error").hidden = true;
  stale = false;
  lastReceivedAt = new Date().toISOString();
}
function focusSelector(element) {
  for (const key of ["data-open", "data-pbi"]) {
    const value = element?.getAttribute?.(key);
    if (value) return `[${key}="${CSS.escape(value)}"]`;
  }
  return null;
}
function render() {
  const focused = focusSelector(document.activeElement);
  const milestones = state.scope?.milestones || [];
  $("#milestone-filter").hidden = !adapter || !milestones.length;
  const milestoneOptions =
    '<option value="">既定のビュー範囲</option>' +
    milestones
      .map(
        (m) =>
          `<option value="${esc(m.number)}">${esc(m.title || m.name || m.number)}</option>`,
      )
      .join("");
  if ($("#milestone-filter").innerHTML !== milestoneOptions)
    $("#milestone-filter").innerHTML = milestoneOptions;
  $("#milestone-filter").value = selectedMilestone;
  const displayed = selectedLanes();
  $("#choose-pbis").textContent =
    `表示するPBI ${displayed.length} / ${MAX_PBIS}`;
  $("#choose-pbis").disabled = pending || loading || editMode;
  const tasks = matching(),
    height = $("#board-scroll").clientHeight,
    maxRows =
      $("#fit-mode").value === "pages"
        ? Math.max(1, Math.floor((height - 44) / 190))
        : Math.max(1, displayed.length),
    pages = Math.max(1, Math.ceil(displayed.length / maxRows));
  page = Math.min(page, pages - 1);
  const lanes = displayed.slice(page * maxRows, (page + 1) * maxRows),
    rowHeight = (height - 44) / Math.max(1, lanes.length),
    capacity = 4;
  $("#board").style.setProperty("--rows", Math.max(1, lanes.length));
  $("#board").style.setProperty("--row-height", `${rowHeight}px`);
  $("#board").classList.toggle("compact", rowHeight < 190);
  $("#board").classList.toggle("dense", rowHeight < 80);
  $("#page-info").textContent =
    `PBI ${displayed.length ? page * maxRows + 1 : 0}–${Math.min((page + 1) * maxRows, displayed.length)} / ${displayed.length}`;
  $("#prev-page").disabled = page === 0;
  $("#next-page").disabled = page === pages - 1;
  $("#pagination").hidden = pages === 1;
  $("#scope-note").textContent = adapter
    ? [
        state.scope?.filterApplied === false || state.filterApplied === false
          ? "注意：GitHubビューの絞り込みは未適用"
          : "",
        ...(state.warnings || []),
      ]
        .filter(Boolean)
        .join(" · ")
    : "GitHubからの読み込みを待っています。";
  $("#connection").textContent = adapter
    ? pending
      ? loading
        ? "最新データを取得中…"
        : "接続先に保存中…"
      : stale
        ? "接続エラー · 表示は最新未確認"
        : state.scope?.filterApplied === false || state.filterApplied === false
          ? "GitHub接続 · ビュー絞り込み未適用"
          : adapter.label || "GitHub接続済み"
    : "GitHub 未接続";
  if (adapter) {
    const fetched = state.fetchedAt || lastReceivedAt;
    if (fetched && !Number.isNaN(Date.parse(fetched))) {
      $("#connection").textContent +=
        ` · 最終取得 ${new Date(fetched).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      $("#connection").title =
        `最終取得: ${fetched}${stale ? "（最新未確認）" : ""}`;
    }
  }
  $("#visible-count").textContent =
    `${tasks.filter((t) => statusColumn(t.status)).length} タスク · 見送り ${tasks.filter((t) => t.status === "見送り").length}`;
  $("#board").innerHTML =
    `<div class="board-row board-head" role="row"><div class="cell" role="columnheader">PBI <span>${displayed.length}</span></div>${columns.map((s) => `<div class="cell" role="columnheader"><i class="status-dot ${s.toLowerCase()}"></i>${s}<span>${tasks.filter((t) => statusColumn(t.status) === s).length}</span></div>`).join("")}<div class="cell" role="columnheader">Demo goal</div></div>` +
    lanes
      .map((l) => {
        const own = tasks.filter((t) => t.lane === l.id),
          all = state.tasks.filter(
            (t) => t.lane === l.id && t.status !== "見送り",
          ),
          done = all.filter((t) => t.status === "完了").length;
        return `<div class="board-row" role="row"><div class="cell pbi-cell" role="rowheader" data-pbi-row="${esc(l.id)}"><button class="pbi-title" data-pbi="${esc(l.id)}"><span class="pbi-title-text">${esc(l.title)}</span></button><div class="lane-progress"><i><b style="width:${all.length ? (done / all.length) * 100 : 0}%"></b></i>${done}/${all.length}</div></div>${columns
          .map((s) => {
            const list = own.filter((t) => statusColumn(t.status) === s),
              show = list.slice(0, capacity);
            return `<div class="cell task-cell" role="cell" data-lane="${esc(l.id)}" data-status="${s}"><div class="task-grid" data-count="${show.length}">${show.map(card).join("")}</div>${list.length > capacity ? `<button class="overflow-button" data-overflow="${esc(l.id)}" data-column="${s}">ほか ${list.length - capacity} 件 · 全 ${list.length} 件を開く</button>` : ""}</div>`;
          })
          .join(
            "",
          )}<div class="cell goal-cell" role="cell"><button class="goal-text" data-pbi="${esc(l.id)}">${esc(goal(l.body))}</button></div></div>`;
      })
      .join("");
  fitCardTitles();
  if (focused) document.querySelector(focused)?.focus({ preventScroll: true });
  $("#empty").hidden = !connectionError && tasks.length !== 0;
  $("#empty").textContent =
    connectionError ||
    (displayed.length
      ? "一致するタスクはありません。操作から検索条件を変更できます。"
      : "表示するPBIがありません。操作 →「表示するPBI」で選択できます。");
  $("#deferred-count").textContent = tasks.filter(
    (t) => t.status === "見送り",
  ).length;
  $("#unmapped-count").textContent = tasks.filter(
    (t) =>
      (!statusColumn(t.status) || !state.lanes.some((l) => l.id === t.lane)) &&
      t.status !== "見送り",
  ).length;
}
// Adapter contract: load() -> snapshot; saveIssue({kind,id,patch,expectedRevision})
// -> canonical issue (with revision). Reject with code CONFLICT on stale revisions.
// A real adapter owns authentication/server validation; this demo never stores tokens.
let saveBlocked = false;
async function updateIssue(kind, id, patch, baseline = null) {
  if (pending || saveBlocked || !adapter) return false;
  $("#detail-error").hidden = true;
  const t = issue(kind, id),
    before = clone(state);
  if (adapter && t.projectItemId === null && Object.hasOwn(patch, "status")) {
    announce("Project外の参照PBIのStatusはここでは変更できません。");
    return false;
  }
  pending = true;
  let savedRemotely = false;
  const optimistic = clone(patch);
  if (adapter && optimistic.assignees)
    optimistic.assignees = optimistic.assignees.map(
      (login) =>
        (state.assigneeOptions || []).find((a) => a.login === login) ||
        (t.assignees || []).find((a) => a.login === login) || { login },
    );
  Object.assign(t, optimistic);
  render();
  try {
    if (adapter) {
      const result = await adapter.saveIssue({
        kind,
        id,
        patch: clone(patch),
        expectedRevision: (baseline || issueFrom(before, kind, id)).revision,
        expectedStatus:
          (baseline || issueFrom(before, kind, id)).status ?? null,
      });
      if (!result || result.id !== id)
        throw new Error("接続先の応答を確認できません");
      Object.assign(t, result);
      savedRemotely = true;
      const fresh = await adapter.load();
      if (!valid(fresh)) throw new Error("再取得データを確認できません");
      state = clone(fresh);
      markFresh();
    }
    announce(
      adapter
        ? "接続先の保存結果を確認しました"
        : storageFailed
          ? "このページ内だけに変更しました。GitHub未連携です。"
          : "このブラウザーに保存しました。GitHub未連携です。",
    );
    return true;
  } catch (error) {
    saveBlocked = true;
    $("#detail-error").hidden = false;
    $("#detail-error").textContent =
      error.message +
      " 最新を取得するまで追加の保存を停止します。入力内容はコピーできます。";
    if (savedRemotely) {
      stale = true;
      announce(
        "GitHubへの保存は確認済みですが、再取得できませんでした。「最新を取得」で確認してください。",
      );
      return true;
    }
    state = before;
    stale = !!adapter;
    announce(
      error.partial || error.ambiguous
        ? `表示は保存前の内容です。GitHubの変更は取り消していません。最新を取得してください。${error.message}`
        : error.code === "CONFLICT"
          ? "他の更新と競合しました。変更を戻しました。再読み込みして確認してください。"
          : `保存結果を確認できません。画面を変更前に戻しました。「最新を取得」で確認してください：${error.message}`,
    );
    return false;
  } finally {
    pending = false;
    render();
  }
}
function issueFrom(snapshot, kind, id) {
  return (kind === "PBI" ? snapshot.lanes : snapshot.tasks).find(
    (t) => t.id === id,
  );
}
async function move(id, column) {
  const t = issue("Task", id);
  if (!t || !columns.includes(column) || statusColumn(t.status) === column)
    return;
  await updateIssue("Task", id, { status: targetStatus[column] });
}
function setEdit(value) {
  editMode = value;
  $("#save-issue").disabled = !value || pending || saveBlocked;
  $("#detail-fields").disabled = !value || pending;
  $("#edit-issue").hidden = value;
  $("#save-issue").hidden = !value;
  $("#cancel-edit").hidden = !value;
  $("#detail-fields").classList.toggle("read-only", !value);
  $("#detail-body").hidden = !value;
  $("#detail-body-view").hidden = value;
}
function fillDetail() {
  const t = issue(editing.kind, editing.id);
  editorBaseline = clone(t);
  $("#detail-heading").textContent = t.title;
  $("#detail-meta").textContent =
    `${adapter ? "GITHUB" : "SAMPLE"} ${issueLabel(t)}`;
  $("#detail-badges").textContent = [
    t.state,
    t.type || editing.kind,
    t.lane
      ? `Parent: ${state.lanes.find((l) => l.id === t.lane)?.title || "—"}`
      : null,
    t.repository,
  ]
    .filter(Boolean)
    .join(" · ");
  $("#detail-title").value = t.title;
  $("#detail-body").value = t.body;
  $("#detail-body-view").textContent = t.body || "本文はありません。";
  $("#detail-status").innerHTML =
    (!rawStatuses.includes(t.status)
      ? `<option value="">${esc(t.status || "Status未設定")}（変更なし）</option>`
      : "") + rawStatuses.map((s) => `<option>${s}</option>`).join("");
  $("#detail-status").value = rawStatuses.includes(t.status) ? t.status : "";
  const selected = t.assignees
    ? t.assignees.map((a) => a.login)
    : [t.assignee || "none"];
  const opts = adapter
    ? [...(state.assigneeOptions || []), ...(t.assignees || [])].reduce(
        (o, a) => {
          o[a.login] = a.name || a.login;
          return o;
        },
        {},
      )
    : people;
  $("#detail-assignee").multiple = !!adapter;
  $("#detail-assignee").size = adapter
    ? Math.min(8, Math.max(3, Object.keys(opts).length))
    : 1;
  $("#detail-assignee").innerHTML = Object.entries(opts)
    .map(
      ([id, name]) =>
        `<option value="${esc(id)}" ${selected.includes(id) ? "selected" : ""}>${esc(name)}</option>`,
    )
    .join("");
  $("#detail-source").hidden = !/^https:\/\//.test(t.url || "");
  if (!$("#detail-source").hidden) $("#detail-source").href = t.url;
  $("#detail-note").textContent = adapter
    ? "GitHubの保存結果を確認し、ボードを再取得します。完了・担当変更でProjectの自動処理が動く場合があります。"
    : "サンプルIssueです。変更はこのブラウザーのみ。GitHubには反映されません。";
  $("#body-hint").hidden = editing.kind !== "PBI";
  $("#edit-issue").disabled = pending;
  $("#detail-status").disabled = !!adapter && t.projectItemId === null;
  if ($("#detail-status").disabled)
    $("#detail-note").textContent =
      "対象Project外の親PBIです。タイトル・本文・担当者は編集できます。Project Statusは変更できません。";
}
let returnFocusSelector = null;
function openIssue(kind, id) {
  if (pending || !adapter) return;
  editing = { kind, id };
  returnFocus = document.activeElement;
  returnFocusSelector = focusSelector(returnFocus);
  fillDetail();
  setEdit(false);
  $("#details").showModal();
  $("#close-detail").focus();
}
function closeDetail() {
  if (pending) return;
  if (editMode && !confirm("未保存の変更を破棄して閉じますか？")) return;
  const d = $("#details");
  d.classList.add("closing");
  setTimeout(() => {
    d.close();
    setEdit(false);
    d.classList.remove("closing");
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    else if (returnFocusSelector)
      document
        .querySelector(returnFocusSelector)
        ?.focus({ preventScroll: true });
  }, 160);
}
function openList(lane, column) {
  const list = matching().filter((t) =>
    column === "未分類"
      ? (!statusColumn(t.status) ||
          !state.lanes.some((l) => l.id === t.lane)) &&
        t.status !== "見送り"
      : column === "見送り"
        ? t.status === "見送り"
        : t.lane === lane && statusColumn(t.status) === column,
  );
  $("#list-heading").textContent = ["見送り", "未分類"].includes(column)
    ? `${column} · ${list.length} 件`
    : `${state.lanes.find((l) => l.id === lane).title} / ${column} · ${list.length} 件`;
  $("#issue-list").innerHTML =
    list
      .map(
        (t) =>
          `<button class="list-item" data-list-task="${esc(t.id)}"><strong>${esc(t.title)}</strong><span>${esc(person(t))} · ${esc(t.status || "Status未設定")}</span></button>`,
      )
      .join("") || "<p>該当するIssueはありません。</p>";
  $("#list-dialog").showModal();
}
$("#board").addEventListener("click", (e) => {
  dismissControls();
  const task =
      e.target.closest("[data-open]") || e.target.closest("[data-task]"),
    pbi = e.target.closest("[data-pbi]") || e.target.closest("[data-pbi-row]"),
    more = e.target.closest("[data-overflow]");
  if (task) openIssue("Task", task.dataset.open || task.dataset.task);
  if (pbi) openIssue("PBI", pbi.dataset.pbi || pbi.dataset.pbiRow);
  if (more) openList(more.dataset.overflow, more.dataset.column);
});
// Image errors do not bubble, so listen in capture phase across board rerenders.
$("#board").addEventListener("error", handleAvatarError, true);
$("#issue-list").addEventListener("click", (e) => {
  const b = e.target.closest("[data-list-task]");
  if (b) {
    $("#list-dialog").close();
    openIssue("Task", b.dataset.listTask);
  }
});
$("#board").addEventListener("dragstart", (e) => {
  const c = e.target.closest("[data-task]");
  if (
    !c ||
    pending ||
    (adapter && issue("Task", c.dataset.task)?.projectItemId === null)
  ) {
    e.preventDefault();
    return;
  }
  dragged = c.dataset.task;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragged);
  c.classList.add("dragging");
});
$("#board").addEventListener("dragover", (e) => {
  const c = e.target.closest("[data-status]"),
    t = issue("Task", dragged);
  if (c && t && c.dataset.lane === t.lane) {
    e.preventDefault();
    document
      .querySelectorAll(".drag-over")
      .forEach((c) => c.classList.remove("drag-over"));
    c.classList.add("drag-over");
  }
});
function clearDrag() {
  dragged = null;
  document
    .querySelectorAll(".drag-over,.dragging")
    .forEach((c) => c.classList.remove("drag-over", "dragging"));
}
$("#board").addEventListener("dragleave", (e) => {
  const c = e.target.closest("[data-status]");
  if (c && !c.contains(e.relatedTarget)) c.classList.remove("drag-over");
});
$("#board").addEventListener("drop", (e) => {
  e.preventDefault();
  const c = e.target.closest("[data-status]"),
    t = issue("Task", dragged);
  if (c && t && c.dataset.lane === t.lane) move(t.id, c.dataset.status);
  clearDrag();
});
$("#board").addEventListener("dragend", clearDrag);
$("#edit-issue").onclick = () => {
  if (pending) return;
  fillDetail();
  setEdit(true);
  $("#detail-title").focus();
};
$("#cancel-edit").onclick = () => {
  if (!confirm("未保存の変更を破棄しますか？")) return;
  fillDetail();
  setEdit(false);
};
$("#close-detail").onclick = closeDetail;
$("#details").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDetail();
});
$("#detail-form").onsubmit = async (e) => {
  e.preventDefault();
  if (!editMode || pending || saveBlocked) return;
  const old = editorBaseline,
    patch = {};
  if ($("#detail-title").value !== old.title)
    patch.title = $("#detail-title").value;
  if ($("#detail-body").value !== old.body)
    patch.body = $("#detail-body").value;
  if (
    !$("#detail-status").disabled &&
    $("#detail-status").value &&
    $("#detail-status").value !== old.status
  )
    patch.status = $("#detail-status").value;
  if (adapter) {
    const selected = [...$("#detail-assignee").selectedOptions].map(
      (o) => o.value,
    );
    const prev = (old.assignees || []).map((a) => a.login);
    if (
      JSON.stringify([...selected].sort()) !== JSON.stringify([...prev].sort())
    )
      patch.assignees = selected;
  } else patch.assignee = $("#detail-assignee").value;
  if ("title" in patch && !patch.title.trim()) return;
  if (!Object.keys(patch).length) {
    setEdit(false);
    return;
  }
  $("#save-issue").disabled = true;
  $("#cancel-edit").disabled = true;
  $("#detail-fields").disabled = true;
  const ok = await updateIssue(editing.kind, editing.id, patch, editorBaseline);
  $("#save-issue").disabled = saveBlocked;
  $("#cancel-edit").disabled = false;
  $("#detail-fields").disabled = false;
  if (ok) {
    if (issue(editing.kind, editing.id)) fillDetail();
    else {
      $("#details").close();
      announce("保存を確認しました。このIssueは現在の表示範囲から外れました。");
    }
    setEdit(false);
  }
};
$("#search").oninput = () => {
  page = 0;
  render();
};
$("#assignee-filter").onchange = render;
$("#fit-mode").onchange = () => {
  page = 0;
  render();
};
$("#prev-page").onclick = () => {
  page--;
  render();
};
$("#next-page").onclick = () => {
  page++;
  render();
};
$("#show-deferred").onclick = () => openList(null, "見送り");
$("#show-unmapped").onclick = () => openList(null, "未分類");
async function refreshBoard(options, { silent = false } = {}) {
  if (!adapter || pending || pickerDraft) return false;
  if ($("#details").open && editMode) {
    announce("編集中の内容を保存またはキャンセルしてください。");
    return false;
  }
  pending = true;
  loading = true;
  $("#refresh").disabled = true;
  $("#milestone-filter").disabled = true;
  $("#edit-issue").disabled = true;
  render();
  try {
    const next = await adapter.load(options);
    if (!valid(next)) throw new Error("無効なIssueデータです");
    state = clone(next);
    if (options && Object.hasOwn(options, "milestone"))
      selectedMilestone = String(options.milestone ?? "");
    markFresh();
    if ($("#details").open) {
      if (issue(editing.kind, editing.id)) fillDetail();
      else $("#details").close();
    }
    render();
    if (!silent) announce("最新のデータを取得しました。");
    return true;
  } catch (e) {
    stale = true;
    render();
    if (!silent) announce(`取得できませんでした：${e.message}`);
    return false;
  } finally {
    pending = false;
    loading = false;
    $("#refresh").disabled = false;
    $("#milestone-filter").disabled = false;
    $("#edit-issue").disabled = false;
    render();
  }
}
$("#refresh").onclick = () =>
  adapter
    ? refreshBoard()
    : window.Whiteboard.connectApi().catch((e) => announce(e.message));
$("#recover-edit").onclick = async () => {
  if (pending) return;
  if (
    editMode &&
    !confirm(
      "入力内容を破棄してGitHubから最新を取得しますか？必要なら先にコピーしてください。",
    )
  )
    return;
  setEdit(false);
  await refreshBoard();
};
$("#milestone-filter").onchange = async () => {
  const previous = selectedMilestone;
  if (!(await refreshBoard({ milestone: $("#milestone-filter").value })))
    $("#milestone-filter").value = String(previous);
};

$("#choose-pbis").onclick = openPicker;
$("#pbi-search").oninput = renderPicker;
$("#pbi-options").addEventListener("change", (e) => {
  if (e.target.dataset.selectPbi)
    togglePbi(e.target.dataset.selectPbi, e.target.checked);
});
$("#pbi-missing").addEventListener("change", (e) => {
  if (e.target.dataset.selectPbi)
    togglePbi(e.target.dataset.selectPbi, e.target.checked);
});
$("#pbi-top-six").onclick = () => {
  pickerDraft = pickerLanes.slice(0, MAX_PBIS).map((l) => l.id);
  renderPicker();
};
$("#pbi-clear").onclick = () => {
  pickerDraft = [];
  renderPicker();
};
$("#pbi-cancel").onclick = closePicker;
$("#pbi-apply").onclick = applyPicker;
$("#pbi-picker").addEventListener("cancel", (e) => {
  e.preventDefault();
  closePicker();
});
// Keep visibility in one state machine: CSS hover/focus must not override dismissal.
let controlsPinned = false,
  controlsHovered = false,
  controlsFocused = false,
  controlsHoverBlocked = false;
function syncControls() {
  const open = controlsPinned || controlsHovered || controlsFocused;
  $("#chrome").classList.toggle("controls-open", open);
  $("#operations").setAttribute("aria-expanded", String(open));
}
function dismissControls() {
  controlsHoverBlocked = controlsHoverBlocked || controlsHovered;
  controlsPinned = false;
  controlsHovered = false;
  controlsFocused = false;
  // Blank cells do not receive focus by default; release the old toolbar focus too.
  if ($("#chrome").contains(document.activeElement))
    document.activeElement.blur();
  syncControls();
}
$("#board").addEventListener("pointerdown", dismissControls);
// Reveal only after intentional movement at the top edge, not a stationary
// pointer at (0,0) during initial layout or a hidden overlay bounding box.
$(".top-edge").addEventListener("pointermove", (event) => {
  if (event.clientX < 12 || (!event.movementX && !event.movementY)) return;
  if (!controlsHoverBlocked) {
    controlsHovered = true;
    syncControls();
  }
});
$("#chrome").addEventListener("pointerleave", () => {
  controlsHoverBlocked = false;
  controlsHovered = false;
  syncControls();
});
$("#chrome").addEventListener("focusin", () => {
  controlsFocused = true;
  syncControls();
});
$("#chrome").addEventListener("focusout", (e) => {
  controlsFocused = $("#chrome").contains(e.relatedTarget);
  syncControls();
});
$("#operations").onclick = () => {
  if (controlsPinned || controlsHovered || controlsFocused) dismissControls();
  else {
    controlsPinned = true;
    syncControls();
  }
};
$("#fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) {
      try {
        await document.documentElement.requestFullscreen({
          navigationUI: "hide",
        });
      } catch (e) {
        if (e instanceof TypeError)
          await document.documentElement.requestFullscreen();
        else throw e;
      }
    } else announce("このブラウザーは全画面APIに対応していません。");
  } catch {
    announce(
      "全画面表示を開始できませんでした。ブラウザーの全画面操作を利用してください。",
    );
  }
};
document.addEventListener("fullscreenchange", () => {
  $("#fullscreen").textContent = document.fullscreenElement
    ? "全画面を終了"
    : "全画面";
  render();
});
$("#about").onclick = () => {
  $("#about-mode").textContent = adapter
    ? "GitHub Appで接続しています。表示するIssueと担当者はGitHubのデータです。保存はGitHubに反映され、続けて最新のボードを再取得します。"
    : "GitHub未接続です。最新を取得してください。";
  $("#about-dialog").showModal();
};
document
  .querySelectorAll(".close-dialog")
  .forEach((b) => (b.onclick = () => b.closest("dialog").close()));
window.Whiteboard = {
  statusColumn,
  goal,
  getSnapshot: () => clone(state),
  setConnectionError(message) {
    connectionError = String(message);
    render();
  },
  async setAdapter(next) {
    if (pending || pickerDraft || ($("#details").open && editMode))
      throw new Error(
        "操作中です。保存またはキャンセル後に再接続してください。",
      );
    if (
      !next ||
      typeof next.load !== "function" ||
      typeof next.saveIssue !== "function"
    )
      throw new Error("load/saveIssueが必要です");
    pending = true;
    loading = true;
    let snapshot;
    try {
      snapshot = await next.load();
    } finally {
      pending = false;
      loading = false;
    }
    if (!valid(snapshot)) throw new Error("無効なIssueデータです");
    connectionError = "";
    adapter = next;
    state = clone(snapshot);
    selectedMilestone = String(
      snapshot.scope?.selectedMilestone ?? snapshot.scope?.milestone ?? "",
    );
    markFresh();
    page = 0;
    if ($("#details").open) $("#details").close();
    $("#refresh").hidden = false;
    $("#assignee-filter").innerHTML =
      '<option value="">担当者：全員</option>' +
      (snapshot.assigneeOptions || [])
        .map(
          (a) =>
            `<option value="${esc(a.login)}">${esc(a.name || a.login)}</option>`,
        )
        .join("");
    render();
  },
  applySnapshot(snapshot) {
    if (pending || pickerDraft || ($("#details").open && editMode))
      return false;
    if (!valid(snapshot)) throw new Error("無効なIssueデータです");
    state = clone(snapshot);
    markFresh();
    render();
    if ($("#details").open) {
      if (issue(editing.kind, editing.id)) fillDetail();
      else closeDetail();
    }
    return true;
  },
};
// Read-only reconciliation of external GitHub edits; never replace an open draft.
async function autoRefresh() {
  if (
    !adapter ||
    document.visibilityState === "hidden" ||
    pending ||
    loading ||
    editMode ||
    dragged ||
    pickerDraft
  )
    return false;
  const now = Date.now();
  if (now - lastAutoAttempt < 5000) return false;
  lastAutoAttempt = now;
  return refreshBoard(undefined, { silent: true });
}
new ResizeObserver(() => render()).observe($("#board-scroll"));
render();
if (document.fonts) document.fonts.ready.then(() => fitCardTitles());

setInterval(autoRefresh, 45000);
window.addEventListener("focus", autoRefresh);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") autoRefresh();
});

window.addEventListener("beforeunload", (e) => {
  if (editMode || pending) {
    e.preventDefault();
    e.returnValue = "";
  }
});
try {
  document.documentElement.dataset.theme =
    localStorage.getItem("ideaboost-theme") === "dark" ? "dark" : "light";
} catch {}
$("#theme").onclick = () => {
  const theme =
    document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("ideaboost-theme", theme);
  } catch {}
};
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !document.querySelector("dialog[open]"))
    dismissControls();
});
