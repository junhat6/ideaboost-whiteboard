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
  initialLoading = true,
  initialSlow = false,
  initialTimer = null,
  lastReadError = "",
  page = 0,
  editing = null,
  returnFocus = null,
  dragged = null,
  pending = false,
  storageFailed = false,
  toastTimer,
  editMode = false,
  lastReceivedAt = null,
  lastAutoAttempt = 0,
  autoRefreshRequested = false,
  autoTimer = null,
  bootstrapAttempt = false,
  detailUpdated = false,
  detailUnavailable = false,
  listContext = null,
  snapshotPending = false;
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
  resumeAutoRefresh();
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
  return `<article class="task ${esc(t.color || "yellow")}" draggable="${!pending && !snapshotPending && !(adapter && t.projectItemId === null)}" data-task="${esc(t.id)}"><div class="task-top"><span>${esc(issueLabel(t))}</span><span aria-hidden="true">⠿</span></div><button class="task-title" data-open="${esc(t.id)}" title="${esc(t.title)}"><span class="task-title-text">${esc(t.title)}</span></button><div class="task-bottom"><span class="person" title="${esc(person(t))}">${assigneeAvatars(t)}<span class="person-name">${esc(person(t))}</span></span><span class="raw-status">${esc(t.status || "Status未設定")}</span></div></article>`;
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
  lastReadError = "";
  snapshotPending = state.readState?.kind === "snapshot";
  saveBlocked = snapshotPending;
  if (!editorOutcome) $("#detail-error").hidden = true;
  stale = snapshotPending;
  lastReceivedAt = new Date().toISOString();
}
function focusSelector(element) {
  for (const key of ["data-open", "data-pbi"]) {
    const value = element?.getAttribute?.(key);
    if (value) return `[${key}="${CSS.escape(value)}"]`;
  }
  return null;
}
function renderInitial() {
  $("#sync-warning").hidden = true;
  const height = $("#board-scroll").clientHeight;
  $("#board").style.setProperty("--rows", 6);
  $("#board").style.setProperty("--row-height", `${(height - 44) / 6}px`);
  $("#board").setAttribute("aria-busy", String(initialLoading));
  $("#board").classList.toggle("is-loading", initialLoading);
  $("#board").innerHTML =
    `<div class="board-row board-head" role="row">${["PBI", ...columns, "Demo goal"].map((name) => `<div class="cell" role="columnheader">${name}</div>`).join("")}</div>` +
    Array.from(
      { length: 6 },
      () =>
        `<div class="board-row skeleton-row" aria-hidden="true">${Array.from({ length: 6 }, (_, col) => `<div class="cell">${col === 0 || col === 5 ? '<div class="skeleton-line"></div><div class="skeleton-line short"></div>' : '<div class="skeleton-grid"><div class="skeleton-note"></div><div class="skeleton-note"></div></div>'}</div>`).join("")}</div>`,
    ).join("");
  $("#empty").hidden = false;
  $("#empty-message").textContent = initialLoading
    ? initialSlow
      ? "GitHubの応答を待っています。通常より時間がかかっています…"
      : "GitHubから読み込み中…"
    : connectionError || "GitHubに接続できません。もう一度読み込んでください。";
  $("#retry-load").hidden = initialLoading;
  $("#connection").textContent = initialLoading
    ? "GitHubから読み込み中…"
    : "接続できません · 再試行できます";
  $("#choose-pbis").disabled = true;
  $("#pagination").hidden = true;
}
function beginConnection() {
  initialLoading = true;
  initialSlow = false;
  connectionError = "";
  clearTimeout(initialTimer);
  initialTimer = setTimeout(() => {
    initialSlow = true;
    if (!adapter && initialLoading) render();
  }, 7000);
  render();
}
function syncAssigneeFilter() {
  const select = $("#assignee-filter"),
    chosen = select.value;
  const users = new Map(
    [
      ...(state.assigneeOptions || []),
      ...[...state.lanes, ...state.tasks].flatMap((i) => i.assignees || []),
    ].map((a) => [a.login, a]),
  );
  if (chosen && !users.has(chosen))
    users.set(chosen, { login: chosen, name: chosen + "（現在の候補外）" });
  const html =
    '<option value="">担当者：全員</option>' +
    [...users.values()]
      .map(
        (a) =>
          `<option value="${esc(a.login)}">${esc(a.name || a.login)}</option>`,
      )
      .join("");
  if (select.innerHTML !== html) {
    select.innerHTML = html;
    select.value = chosen;
  }
}
function render() {
  if (dragged) clearDrag();
  if (!adapter) {
    renderInitial();
    return;
  }
  syncAssigneeFilter();
  if ($("#list-dialog").open) renderIssueList();
  $("#sync-warning").hidden = !stale || !lastReadError || loading;
  $("#sync-warning-message").textContent = lastReadError
    ? `同期できませんでした。前回の表示を保持しています。${lastReadError}`
    : "";
  $("#board").setAttribute("aria-busy", String(loading));
  $("#board").classList.remove("is-loading");
  $("#retry-load").hidden = true;
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
        ? "GitHubと同期中…"
        : "接続先に保存中…"
      : editMode
        ? "編集中 · 入力を保持して自動同期"
        : stale
          ? "接続エラー · 表示は最新未確認"
          : state.scope?.filterApplied === false ||
              state.filterApplied === false
            ? "GitHub接続 · ビュー絞り込み未適用"
            : adapter.label || "GitHub接続済み"
    : "GitHub 未接続";
  if (snapshotPending)
    $("#connection").textContent = lastReadError
      ? "直近の取得結果 · 最新確認失敗"
      : "直近の取得結果 · 最新確認中";
  if (!navigator.onLine)
    $("#connection").textContent = "オフライン · 表示は最新未確認";
  if (adapter) {
    const fetched = state.fetchedAt || lastReceivedAt;
    if (fetched && !Number.isNaN(Date.parse(fetched))) {
      $("#connection").textContent +=
        ` · 最終取得 ${new Date(fetched).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
      if (snapshotPending)
        $("#connection").textContent +=
          `（${Math.max(0, Math.floor((Date.now() - Date.parse(fetched)) / 1000))}秒前）`;
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
  $("#empty-message").textContent =
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
  if (pending || snapshotPending || saveBlocked || !adapter) return false;
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
    resumeAutoRefresh();
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
let composer = null,
  composerModule = null,
  composerPromise = null;
let editorLatest = null,
  editorConflicts = {},
  editorOutcome = null;
let editorBusy = false,
  editorPosting = false,
  composing = false,
  previewMode = false;
let editorSession = 0;
let editorBody = "";
let pendingEditorRemote = undefined,
  editorSaved = false,
  refreshFlight = null;
const editorFields = ["title", "body", "assignees", "status"];
const fieldNames = {
  title: "タイトル",
  body: "本文",
  assignees: "担当者",
  status: "ステータス",
};
function fieldValue(item, key) {
  return key === "assignees"
    ? (item.assignees || []).map((a) => a.login).sort()
    : (item[key] ?? null);
}
function equalField(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function editorDraft() {
  return {
    title: $("#detail-title").value,
    body: editorBody,
    assignees: [...$("#detail-assignee").selectedOptions]
      .map((o) => o.value)
      .sort(),
    status: $("#detail-status").value || fieldValue(editorBaseline, "status"),
  };
}
function writeField(key, value) {
  if (key === "body") {
    editorBody = value || "";
    $("#detail-body").value = value || "";
    composer?.set(value || "");
    renderPreview();
  } else if (key === "assignees") {
    for (const login of value || [])
      if (![...$("#detail-assignee").options].some((o) => o.value === login))
        $("#detail-assignee").add(new Option(login, login));
    for (const option of $("#detail-assignee").options)
      option.selected = (value || []).includes(option.value);
  } else if (key === "status") {
    const optionValue = value || "";
    if (![...$("#detail-status").options].some((o) => o.value === optionValue))
      $("#detail-status").add(new Option(value || "未設定", optionValue));
    $("#detail-status").value = optionValue;
  } else $("#detail-title").value = value || "";
}
function setBaseField(key, value) {
  if (key === "assignees")
    editorBaseline.assignees = (value || []).map((login) => ({ login }));
  else editorBaseline[key] = value;
}
function updateDirty() {
  if (!editorBaseline) return;
  const draft = editorDraft();
  editMode = editorFields.some(
    (key) => !equalField(draft[key], fieldValue(editorBaseline, key)),
  );
  if (editMode) editorSaved = false;
  syncEditorControls();
}
function setEdit() {
  updateDirty();
}
function syncEditorControls() {
  const dirty = editMode || composing;
  $("#save-issue").disabled =
    !dirty ||
    editorBusy ||
    composing ||
    detailUnavailable ||
    !!editorOutcome ||
    Object.keys(editorConflicts).length > 0;
  $("#save-issue").innerHTML = editorPosting
    ? "保存中…"
    : editorBusy
      ? "確認中…"
      : "保存 <kbd>⌘↵</kbd>";
  $("#cancel-edit").hidden = !dirty;
  $("#cancel-edit").disabled = editorPosting;
  $("#detail-fields").disabled = editorPosting;
  $("#detail-title").disabled = editorPosting;
  composer?.disabled(editorPosting);
  $("#recover-edit").hidden = !editorOutcome && !lastReadError;
  $("#recover-edit").disabled = editorBusy || loading;
  $("#recover-edit").textContent = editorOutcome?.durable
    ? "管理者による確認が必要"
    : editorOutcome
      ? "保存結果を確認"
      : "接続を再確認";
  if (editorOutcome?.durable) $("#recover-edit").disabled = true;
  updateDetailSync();
}
function setComposition(value) {
  composing = value;
  if (!value && pendingEditorRemote !== undefined) {
    const incoming = pendingEditorRemote;
    pendingEditorRemote = undefined;
    reconcileEditor(incoming);
  }
  updateDirty();
}
function renderPreview() {
  if (previewMode && composerModule)
    composerModule.preview(editorBody, $("#detail-body-view"));
}
function setPreview(value) {
  previewMode = value;
  $("#markdown-editor").hidden = value;
  $("#detail-body").hidden = value || !!composer;
  $("#detail-body-view").hidden = !value;
  $("#markdown-write").setAttribute("aria-pressed", String(!value));
  $("#markdown-preview").setAttribute("aria-pressed", String(value));
  $(".format-actions").hidden = value || !composer;
  renderPreview();
}
async function ensureComposer() {
  try {
    composerModule ||= await (composerPromise ||= import("./editor-bundle.js"));
    $("#markdown-preview").disabled = false;
    if (!$("#details").open || composer || composing) return;
    // Do not replace a native editor while it owns caret/history or a draft.
    if (document.activeElement === $("#detail-body") || editMode) return;
    composer = composerModule.createEditor(
      $("#markdown-editor"),
      editorBody,
      (value) => {
        editorBody = value;
        $("#detail-body").value = value;
        updateDirty();
      },
      setComposition,
      () => $("#detail-form").requestSubmit(),
    );
    $("#markdown-preview").disabled = false;
    setPreview(previewMode);
  } catch {
    composerPromise = null;
    $("#markdown-preview").disabled = true;
    $(".editor-hint").textContent =
      "本文はこの入力欄で編集できます。⌘/Ctrl + Enterで保存";
  }
}
function canonicalIssueUrl(t) {
  try {
    const u = new URL(t.url);
    return u.origin === "https://github.com" &&
      /^\/engineer-first\/idea-boost\/issues\/[1-9]\d*$/.test(u.pathname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
function fillDetail() {
  const t = issue(editing.kind, editing.id);
  if (!t) return;
  editorBaseline = clone(t);
  editorLatest = clone(t);
  editorConflicts = {};
  pendingEditorRemote = undefined;
  $("#detail-heading").textContent = t.title;
  const url = canonicalIssueUrl(t);
  if (url) $("#detail-heading").href = url;
  else $("#detail-heading").removeAttribute("href");
  $("#detail-meta").textContent = issueLabel(t);
  $("#detail-status").innerHTML = rawStatuses
    .map((s) => `<option>${esc(s)}</option>`)
    .join("");
  const users = new Map(
    [...(state.assigneeOptions || []), ...(t.assignees || [])].map((a) => [
      a.login,
      a,
    ]),
  );
  $("#detail-assignee").multiple = true;
  $("#detail-assignee").size = Math.min(7, Math.max(3, users.size));
  $("#detail-assignee").innerHTML = [...users.values()]
    .map(
      (a) =>
        `<option value="${esc(a.login)}">${esc(a.name || a.login)}</option>`,
    )
    .join("");
  for (const key of editorFields) writeField(key, fieldValue(t, key));
  $("#detail-status").disabled = t.projectItemId === null;
  $("#detail-note").hidden = t.projectItemId !== null;
  $("#detail-note").textContent =
    "このIssueはProject外のため、ステータスは変更できません。";
  $("#body-hint").hidden = editing.kind !== "PBI";
  $("#title-editor").hidden = true;
  $("#detail-error").hidden = !editorOutcome;
  renderConflicts();
  updateDirty();
}
function updateDetailSync() {
  const indicator = $("#detail-sync");
  indicator.hidden = false;
  indicator.textContent = editorPosting
    ? "GitHubに保存中…"
    : editorBusy
      ? "保存前に最新の内容を確認しています…"
      : editorOutcome
        ? "入力を保持しています。保存結果の確認が必要です。"
        : detailUnavailable
          ? "現在の表示範囲から外れています。入力は保持しています。"
          : Object.keys(editorConflicts).length
            ? "同じ項目にGitHub側の変更があります。内容を選んでください。"
            : composing || editMode
              ? "未保存の変更" + (loading ? " · 同期中（入力は保持）" : "")
              : snapshotPending
                ? "直近の取得結果 · 最新確認中（入力できます）"
                : loading
                  ? "同期中（入力できます）"
                  : lastReadError
                    ? editorSaved
                      ? "保存しました。ボードの再同期は接続回復後に行います。"
                      : "同期できませんでした。入力は続けられます。"
                    : editorSaved
                      ? "保存しました"
                      : detailUpdated
                        ? "GitHub側の変更を反映しました"
                        : "すべての変更を保存済み";
}
function detailVersion(i) {
  return (
    i &&
    JSON.stringify([
      i.revision,
      i.fingerprint,
      i.title,
      i.body,
      i.status,
      i.assignees,
    ])
  );
}
function reconcileEditor(current) {
  if (!$("#details").open) return;
  if (composing) {
    pendingEditorRemote = current;
    return;
  }
  detailUnavailable = !current;
  if (!current) {
    syncEditorControls();
    return;
  }
  editorLatest = clone(current);
  for (const person of [
    ...(state.assigneeOptions || []),
    ...(current.assignees || []),
  ]) {
    const option = [...$("#detail-assignee").options].find(
      (o) => o.value === person.login,
    );
    if (option) option.textContent = person.name || person.login;
    else
      $("#detail-assignee").add(
        new Option(person.name || person.login, person.login),
      );
  }
  const draft = editorDraft();
  for (const key of editorFields) {
    const base = fieldValue(editorBaseline, key),
      remote = fieldValue(current, key),
      local = draft[key];
    if (equalField(local, base) || equalField(local, remote)) {
      if (!equalField(local, remote)) writeField(key, remote);
      setBaseField(key, remote);
      delete editorConflicts[key];
    } else if (!equalField(remote, base)) editorConflicts[key] = { remote };
    else delete editorConflicts[key];
  }
  $("#detail-heading").textContent = current.title;
  renderConflicts();
  updateDirty();
}
function renderConflicts() {
  const root = $("#editor-conflicts");
  root.replaceChildren();
  root.hidden = !Object.keys(editorConflicts).length;
  for (const [key, { remote }] of Object.entries(editorConflicts)) {
    const section = document.createElement("section");
    section.className = "field-conflict";
    const title = document.createElement("strong");
    title.textContent = fieldNames[key] + "がGitHubでも更新されました";
    section.append(title);
    const details = document.createElement("details"),
      summary = document.createElement("summary"),
      pre = document.createElement("pre");
    summary.textContent = "GitHubの変更を確認";
    pre.textContent = Array.isArray(remote)
      ? remote.join(", ")
      : (remote ?? "未設定");
    details.append(summary, pre);
    section.append(details);
    for (const [choice, label] of [
      ["mine", "自分の変更を残す"],
      ["remote", "GitHubの変更を使う"],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.dataset.resolve = key;
      b.dataset.choice = choice;
      b.onclick = () => {
        if (choice === "remote") writeField(key, remote);
        setBaseField(key, remote);
        delete editorConflicts[key];
        renderConflicts();
        updateDirty();
      };
      section.append(b);
    }
    root.append(section);
  }
}
function reconcileDetail(previous) {
  if (!$("#details").open) return;
  const current = issue(editing.kind, editing.id);
  detailUpdated =
    detailUpdated || detailVersion(previous) !== detailVersion(current);
  reconcileEditor(current);
}
let returnFocusSelector = null;
function openIssue(kind, id) {
  if ((pending && !loading) || !adapter || !issue(kind, id)) return;
  if (
    $("#details").open &&
    (editMode || composing) &&
    !confirm("未保存の変更を破棄して別のIssueを開きますか？")
  )
    return;
  editorSession++;
  composer?.destroy();
  composer = null;
  $("#markdown-editor").replaceChildren();
  editorOutcome = null;
  editorSaved = false;
  editorBusy = false;
  editorPosting = false;
  composing = false;
  previewMode = false;
  detailUpdated = false;
  detailUnavailable = false;
  editing = { kind, id };
  returnFocus = document.activeElement;
  returnFocusSelector = focusSelector(returnFocus);
  fillDetail();
  setEdit(false);
  $("#details").showModal();
  setPreview(false);
  ensureComposer();
  updateDetailSync();
  $("#close-detail").focus();
}
function closeDetail() {
  if (composing || editorPosting) return;
  if (editMode && !confirm("未保存の変更を破棄して閉じますか？")) return;
  const d = $("#details");
  if (d.classList.contains("closing")) return;
  editorSession++; // Accepted close cancels a pending preflight before animation.
  d.classList.add("closing");
  setTimeout(() => {
    d.close();
    editMode = false;
    editorBusy = false;
    editorOutcome = null;
    composing = false;
    composer?.destroy();
    composer = null;
    $("#markdown-editor").replaceChildren();
    resumeAutoRefresh();
    d.classList.remove("closing");
    const target = returnFocus?.isConnected
      ? returnFocus
      : returnFocusSelector && document.querySelector(returnFocusSelector);
    (target || $("#operations")).focus({ preventScroll: true });
  }, 160);
}
function openList(lane, column) {
  listContext = { lane, column };
  renderIssueList();
  $("#list-dialog").showModal();
}
function renderIssueList() {
  if (!listContext) return;
  const { lane, column } = listContext;
  const focused = document.activeElement?.dataset?.listTask;
  const root = state.lanes.find((l) => l.id === lane);
  if (!["見送り", "未分類"].includes(column) && !root) {
    $("#list-heading").textContent = "対象のPBIは表示範囲から外れました";
    $("#issue-list").innerHTML =
      "<p>最新のボードで対象PBIを選び直してください。</p>";
    if (focused) $("#list-dialog .close-dialog").focus();
    return;
  }
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
    : `${root.title} / ${column} · ${list.length} 件`;
  $("#issue-list").innerHTML =
    list
      .map(
        (t) =>
          `<button class="list-item" data-list-task="${esc(t.id)}"><strong>${esc(t.title)}</strong><span>${esc(person(t))} · ${esc(t.status || "Status未設定")}</span></button>`,
      )
      .join("") || "<p>該当するIssueはありません。</p>";
  if (focused)
    (
      document.querySelector(`[data-list-task="${CSS.escape(focused)}"]`) ||
      $("#list-dialog .close-dialog")
    ).focus();
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
    snapshotPending ||
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
  resumeAutoRefresh();
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
$("#rename-issue").onclick = () => {
  $("#title-editor").hidden = false;
  $("#detail-title").focus();
};
$("#finish-title").onclick = () => {
  $("#title-editor").hidden = true;
  $("#rename-issue").focus();
};
$("#detail-title").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.isComposing) {
    e.preventDefault();
    $("#finish-title").click();
  }
});
for (const id of ["#detail-title", "#detail-body"]) {
  $(id).addEventListener("compositionstart", () => setComposition(true));
  $(id).addEventListener("compositionend", () => {
    setComposition(false);
    ensureComposer();
  });
}
$("#detail-body").addEventListener("blur", () => ensureComposer());
$("#detail-body").addEventListener("input", () => {
  editorBody = $("#detail-body").value;
});
$("#detail-fields").addEventListener("input", updateDirty);
$("#detail-fields").addEventListener("change", updateDirty);
$("#detail-title").addEventListener("input", updateDirty);
$("#markdown-write").onclick = () => {
  setPreview(false);
  composer?.focus();
};
$("#markdown-preview").onclick = () => setPreview(true);
$(".format-actions").onclick = (e) => {
  const kind = e.target.closest("[data-format]")?.dataset.format;
  if (!kind || !composer) return;
  const formats = {
    bold: ["**", "**"],
    heading: ["## ", ""],
    list: ["- ", ""],
    code: ["`", "`"],
  };
  composer.format(...formats[kind]);
};
$("#cancel-edit").onclick = () => {
  if (!confirm("未保存の変更を破棄しますか？")) return;
  const outcome = editorOutcome;
  fillDetail();
  editorOutcome = outcome;
  syncEditorControls();
};
$("#close-detail").onclick = closeDetail;
$("#details").addEventListener("click", (e) => {
  if (e.target !== $("#details")) return;
  const bounds = $("#details").getBoundingClientRect();
  if (
    e.clientX < bounds.left ||
    e.clientX > bounds.right ||
    e.clientY < bounds.top ||
    e.clientY > bounds.bottom
  )
    closeDetail();
});
$("#details").addEventListener("cancel", (e) => {
  e.preventDefault();
  closeDetail();
});
$("#detail-form").addEventListener("keydown", (e) => {
  if (
    (e.metaKey || e.ctrlKey) &&
    e.key === "Enter" &&
    !e.isComposing &&
    !composing
  ) {
    e.preventDefault();
    $("#detail-form").requestSubmit();
  }
});
$("#detail-form").onsubmit = async (e) => {
  e.preventDefault();
  if (
    !editMode ||
    composing ||
    editorBusy ||
    editorOutcome ||
    detailUnavailable ||
    Object.keys(editorConflicts).length
  )
    return;
  const target = { ...editing };
  const session = editorSession;
  editorBusy = true;
  syncEditorControls();
  try {
    const fresh = await refreshBoard(undefined, { silent: true });
    if (!$("#details").open || editorSession !== session) return;
    if (
      !fresh ||
      detailUnavailable ||
      composing ||
      Object.keys(editorConflicts).length
    )
      return;
    const latest = editorLatest,
      draft = editorDraft(),
      patch = {};
    for (const key of editorFields)
      if (!equalField(draft[key], fieldValue(latest, key)))
        patch[key] = draft[key];
    if (!Object.keys(patch).length) {
      editorSaved = true;
      return;
    }
    if (!draft.title.trim()) {
      $("#detail-error").textContent = "タイトルを入力してください。";
      $("#detail-error").hidden = false;
      return;
    }
    editorPosting = true;
    pending = true;
    syncEditorControls();
    const result = await adapter.saveIssue({
      kind: target.kind,
      id: target.id,
      patch,
      expectedRevision: latest.revision,
      expectedStatus: latest.status ?? null,
    });
    if (!result || result.id !== target.id)
      throw Object.assign(new Error("保存結果を確認できません。"), {
        ambiguous: true,
      });
    const current = issue(target.kind, target.id);
    if (current) Object.assign(current, result);
    reconcileEditor(result);
    editorSaved = true;
    editorOutcome = null;
    $("#detail-error").hidden = true;
    editorPosting = false;
    pending = false;
    editorBusy = false;
    syncEditorControls();
    await refreshBoard(undefined, { silent: true });
    if (editorSession === session) editorSaved = !editMode;
  } catch (error) {
    const durable = error.serverError === "mutation_outcome_unresolved";
    editorOutcome = {
      durable,
      uncertain: !!(error.ambiguous || error.partial),
      code: error.serverError || error.code,
    };
    $("#detail-error").textContent =
      error.message +
      (durable
        ? " 管理者がGitHubの状態を確認するまで追加保存できません。"
        : " 入力は保持しています。自動再送はしません。");
    $("#detail-error").hidden = false;
  } finally {
    if (editorSession === session && $("#details").open) {
      editorPosting = false;
      pending = false;
      editorBusy = false;
      syncEditorControls();
      render();
      resumeAutoRefresh();
    }
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
function refreshBoard(options, flags = {}) {
  if (refreshFlight) return refreshFlight;
  refreshFlight = performRefresh(options, flags).finally(() => {
    refreshFlight = null;
  });
  return refreshFlight;
}
async function performRefresh(options, { silent = false } = {}) {
  if (!adapter || pending || pickerDraft) return false;
  autoRefreshRequested = false;
  pending = true;
  loading = true;
  $("#refresh").disabled = true;
  $("#milestone-filter").disabled = true;

  updateDetailSync();
  render();
  try {
    const next = await adapter.load(options);
    if (!valid(next)) throw new Error("無効なIssueデータです");
    const previous = editing && issue(editing.kind, editing.id);
    state = clone(next);
    if (options && Object.hasOwn(options, "milestone"))
      selectedMilestone = String(options.milestone ?? "");
    markFresh();
    reconcileDetail(previous);
    if (!silent) announce("最新のデータを取得しました。");
    return true;
  } catch (e) {
    lastReadError = e.message;
    stale = true;
    if (e.code === "scope_not_public") {
      state = clone(initial);
      adapter = null;
      connectionError = e.message;
      initialLoading = false;
      saveBlocked = true;
      $("#details").close();
      $("#list-dialog").close();
    }
    if (!silent) announce(`取得できませんでした：${e.message}`);
    return false;
  } finally {
    pending = false;
    loading = false;
    $("#refresh").disabled = false;
    $("#milestone-filter").disabled = false;
    syncEditorControls();
    updateDetailSync();
    render();
    resumeAutoRefresh();
  }
}
$("#refresh").onclick = () =>
  adapter
    ? refreshBoard()
    : window.Whiteboard.connectApi().catch((e) => announce(e.message));
$("#recover-edit").onclick = async () => {
  if (editorBusy || editorOutcome?.durable) return;
  const session = editorSession;
  editorBusy = true;
  syncEditorControls();
  const ok = await refreshBoard(undefined, { silent: true });
  if (session !== editorSession) return;
  if (ok && editorOutcome && !detailUnavailable) {
    const same = editorFields.every((key) =>
      equalField(editorDraft()[key], fieldValue(editorLatest, key)),
    );
    if (
      same ||
      confirm(
        "GitHubの現在の内容を取得しました。入力を保持したまま保存の停止を解除しますか？\n差分を確認してから、必要な場合だけ再度保存してください。",
      )
    ) {
      editorOutcome = null;
      $("#detail-error").hidden = true;
      editorSaved = same;
    }
  }
  editorBusy = false;
  syncEditorControls();
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
  beginConnection,
  setConnectionError(message) {
    initialLoading = false;
    clearTimeout(initialTimer);
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
    initialLoading = false;
    clearTimeout(initialTimer);
    adapter = next;
    state = clone(snapshot);
    selectedMilestone = String(
      snapshot.scope?.selectedMilestone ?? snapshot.scope?.milestone ?? "",
    );
    markFresh();
    page = 0;
    if ($("#details").open) $("#details").close();
    $("#refresh").hidden = false;
    render();
    if (snapshotPending) autoRefresh();
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
$("#retry-sync").onclick = () => refreshBoard();
$("#retry-load").onclick = () =>
  window.Whiteboard.connectApi().catch((e) =>
    window.Whiteboard.setConnectionError("接続できません：" + e.message),
  );
// Coalesce wake-ups, not mutations. At most one UI read is active.
function resumeAutoRefresh() {
  if (autoRefreshRequested) queueMicrotask(drainAutoRefresh);
}
function autoRefresh() {
  autoRefreshRequested = true;
  return drainAutoRefresh();
}
async function drainAutoRefresh() {
  if (!autoRefreshRequested) return false;
  if (!adapter && !connectionError) {
    autoRefreshRequested = false;
    return false;
  }
  if (
    document.visibilityState === "hidden" ||
    !navigator.onLine ||
    pending ||
    loading ||
    dragged ||
    pickerDraft ||
    bootstrapAttempt
  ) {
    updateDetailSync();
    return false;
  }
  const delay = 5000 - (Date.now() - lastAutoAttempt);
  if (delay > 0) {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(drainAutoRefresh, delay);
    return false;
  }
  autoRefreshRequested = false;
  lastAutoAttempt = Date.now();
  if (adapter) return refreshBoard(undefined, { silent: true });
  bootstrapAttempt = true;
  try {
    return await window.Whiteboard.connectApi();
  } catch {
    return false;
  } finally {
    bootstrapAttempt = false;
    resumeAutoRefresh();
  }
}
new ResizeObserver(() => render()).observe($("#board-scroll"));
render();
if (document.fonts) document.fonts.ready.then(() => fitCardTitles());
setInterval(autoRefresh, 45000);
window.addEventListener("focus", autoRefresh);
window.addEventListener("online", autoRefresh);
window.addEventListener("offline", () => {
  if (adapter) {
    stale = true;
    lastReadError = "オフラインです。接続が戻ると自動的に再確認します。";
    updateDetailSync();
    render();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") autoRefresh();
});

window.addEventListener("beforeunload", (e) => {
  if (editMode || composing || (pending && !loading)) {
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
