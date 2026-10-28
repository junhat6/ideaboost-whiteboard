"use strict";
const iconMarkup = (name) => window.BoardIcons[name] || "";
const isMacKeyboard = /Mac|iPhone|iPad/.test(navigator.platform);
const saveKeys = `<span class="keycaps" aria-hidden="true"><kbd>${isMacKeyboard ? "⌘" : "Ctrl"}</kbd><kbd>↵</kbd></span>`;
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
  scopeSwitchPending = false,
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
  boardRenderQueued = false,
  pending = false,
  storageFailed = false,
  toastTimer,
  editMode = false,
  lastReceivedAt = null,
  lastAutoAttempt = 0,
  autoRefreshRequested = false,
  autoTimer = null,
  bootstrapAttempt = false,
  detailUnavailable = false,
  listContext = null,
  snapshotPending = false,
  highlightUnestimated = false,
  unestimatedScope = null,
  unestimatedObserver = null;
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
function assigneeAvatars(t, hints = true) {
  const hint = (name) => (hints ? ` title="${esc(name)}"` : "");
  const assigned = Array.isArray(t.assignees)
    ? t.assignees
    : t.assignee && t.assignee !== "none"
      ? [{ name: person(t) }]
      : [];
  if (!assigned.length)
    return `<span class="avatar none" role="img" aria-label="未割り当て"${hint("未割り当て")}><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="5" r="2.5"/><path d="M3 14v-1a5 5 0 0 1 10 0v1"/></svg></span>`;
  const shown = assigned
    .slice(0, 2)
    .map((a) => {
      const name = a.name || a.login || "担当者",
        url = safeAvatarUrl(a.avatarUrl),
        initial = Array.from(name.replace(/^デモ /, "").trim())[0] || "?";
      return `<span class="avatar" role="img" aria-label="${esc(name)}"${hint(name)}><span aria-hidden="true">${esc(initial)}</span>${url && !failedAvatarUrls.has(url) ? `<img class="avatar-image" src="${esc(url)}" alt="${esc(name)}"${hint(name)} width="16" height="16" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable="false">` : ""}</span>`;
    })
    .join("");
  const remaining = assigned.slice(2),
    more = remaining.length
      ? `<span class="avatar-count" role="img" aria-label="ほか ${remaining.length} 人: ${esc(remaining.map((a) => a.name || a.login || "担当者").join("・"))}"${hint(remaining.map((a) => a.name || a.login || "担当者").join("・"))}>+${remaining.length}</span>`
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
const issueTypeStyles = [
  { type: "Task", kind: "task", label: "Task" },
  { type: "競合調査", kind: "research", label: "競合調査" },
  { type: null, kind: "unknown", label: "その他・未設定" },
];
function issueTypeStyle(type) {
  return (
    issueTypeStyles.find(
      (style) => style.type !== null && style.type === type,
    ) || issueTypeStyles.at(-1)
  );
}
function renderTypeLegend() {
  const unknown = [
    ...new Set(
      state.tasks
        .filter((task) => issueTypeStyle(task.type).kind === "unknown")
        .map((task) =>
          typeof task.type === "string" && task.type ? task.type : "未設定",
        ),
    ),
  ];
  const root = $("#type-legend"),
    key = JSON.stringify(unknown);
  if (root.dataset.types === key) return;
  root.dataset.types = key;
  root.innerHTML =
    '<span class="type-legend-heading">付箋の色</span>' +
    issueTypeStyles
      .map((style) => {
        const description =
          style.kind === "unknown"
            ? `Task・競合調査以外とIssue type未設定${unknown.length ? `（${unknown.join("・")}）` : ""}`
            : style.label;
        return `<span class="type-legend-item" role="listitem" data-type-kind="${style.kind}" data-tooltip="${esc(description)}" title="${esc(description)}" aria-label="${esc(description)}"><i class="type-legend-swatch type-${style.kind}" aria-hidden="true"></i><span>${esc(style.label)}</span></span>`;
      })
      .join("");
}
function cardEstimate(t) {
  const ready =
    adapter &&
    !snapshotPending &&
    state.scope?.estimateHoursField === true &&
    estimateTarget(t) === true;
  if (ready && t.estimateHours === null)
    return { state: "unset", text: "未設定", label: "見積時間: 未設定" };
  if (
    ready &&
    typeof t.estimateHours === "number" &&
    Number.isFinite(t.estimateHours) &&
    t.estimateHours >= 0 &&
    t.estimateHours <= 1000
  )
    return {
      state: "set",
      text: `${t.estimateHours}h`,
      label: `見積時間: ${t.estimateHours}時間`,
    };
  return { state: "unavailable", text: "—", label: "見積時間を確認できません" };
}
function paintCardEstimates() {
  const tasks = new Map(state.tasks.map((task) => [task.id, task]));
  for (const card of $("#board").querySelectorAll("[data-task]")) {
    const estimate = card.querySelector(".task-estimate");
    if (!estimate) continue;
    const value = cardEstimate(tasks.get(card.dataset.task));
    estimate.dataset.state = value.state;
    estimate.removeAttribute("title");
    estimate.setAttribute("aria-label", value.label);
    estimate.querySelector(".estimate-value").textContent = value.text;
  }
}
let currentSprintAdapter = null,
  currentSprintKey = null,
  currentSprintEpoch = 0,
  currentSprintFlight = null,
  currentSprintQueued = false,
  currentSprintResult = null,
  currentSprintUntil = 0;
const sprintDateFormat = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function currentSprintContext() {
  return JSON.stringify([
    unestimatedScopeKey(),
    new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10),
  ]);
}
function clearCurrentSprint() {
  currentSprintEpoch++;
  currentSprintAdapter = null;
  currentSprintKey = null;
  currentSprintFlight = null;
  currentSprintQueued = false;
  currentSprintResult = null;
  currentSprintUntil = 0;
  paintCurrentSprint();
}
function paintCurrentSprint() {
  const root = $("#current-sprint");
  root.hidden = !adapter?.loadCurrentSprint;
  if (root.hidden) {
    root.removeAttribute("data-state");
    root.removeAttribute("aria-busy");
    $("#current-sprint-label").textContent = "";
    $("#current-sprint-label").removeAttribute("title");
    $("#current-sprint-dates").textContent = "";
    return;
  }
  const data =
    currentSprintAdapter === adapter &&
    currentSprintKey === currentSprintContext()
      ? currentSprintResult
      : null;
  const current = data?.currentSprint;
  const status =
    current &&
    (Date.now() < Date.parse(current.startAt) ||
      (current.endAt !== null && Date.now() >= Date.parse(current.endAt)))
      ? "loading"
      : data?.status || "loading";
  root.dataset.state = status;
  root.setAttribute("aria-busy", String(status === "loading"));
  const label =
    status === "current"
      ? `現在：${current.title}`
      : status === "none"
        ? "現在のSprintなし"
        : status === "unavailable"
          ? "現在のSprintを確認できません"
          : "現在のSprintを確認中…";
  const dates =
    status === "current"
      ? `${sprintDateFormat.format(new Date(current.startAt))}–${current.endAt === null ? "終了未定" : `${sprintDateFormat.format(new Date(current.endAt))}未満`} JST`
      : "";
  $("#current-sprint-label").title = label;
  if ($("#current-sprint-label").textContent !== label)
    $("#current-sprint-label").textContent = label;
  if ($("#current-sprint-dates").textContent !== dates)
    $("#current-sprint-dates").textContent = dates;
}
async function refreshCurrentSprint(force = false) {
  const source = adapter;
  if (!source?.loadCurrentSprint || snapshotPending) return;
  if (currentSprintAdapter !== source) {
    clearCurrentSprint();
    currentSprintAdapter = source;
  }
  const key = currentSprintContext();
  if (currentSprintKey !== key) {
    currentSprintEpoch++;
    currentSprintKey = key;
    currentSprintResult = null;
    currentSprintUntil = 0;
  }
  if (currentSprintFlight) {
    if (currentSprintFlight.key !== key) currentSprintQueued = true;
    paintCurrentSprint();
    return;
  }
  if (!force && currentSprintResult && Date.now() < currentSprintUntil) return;
  const token = { key, epoch: currentSprintEpoch };
  currentSprintFlight = token;
  paintCurrentSprint();
  try {
    const data = await source.loadCurrentSprint();
    if (source !== adapter || token.epoch !== currentSprintEpoch) return;
    if (key !== currentSprintContext()) {
      currentSprintQueued = true;
      return;
    }
    if (
      data?.ok !== true ||
      !["current", "none", "unavailable"].includes(data.status) ||
      !Number.isFinite(Date.parse(data.checkedAt))
    )
      throw Error("invalid_current_sprint");
    if (data.status === "current") {
      const sprint = data.currentSprint,
        start = Date.parse(sprint?.startAt),
        end = sprint?.endAt === null ? null : Date.parse(sprint?.endAt),
        now = Date.now();
      if (
        !Number.isSafeInteger(sprint?.number) ||
        sprint.number < 1 ||
        typeof sprint.title !== "string" ||
        !sprint.title.trim() ||
        sprint.policy !== "sprint-v2-exclusive-jst" ||
        !Number.isFinite(start) ||
        (start + 9 * 3600000) % 86400000 !== 0 ||
        (end !== null &&
          (!Number.isFinite(end) ||
            start >= end ||
            (end + 9 * 3600000) % 86400000 !== 0)) ||
        now < start ||
        (end !== null && now >= end)
      )
        throw Error("invalid_current_sprint");
    } else if (data.currentSprint !== null)
      throw Error("invalid_current_sprint");
    currentSprintResult = data;
    currentSprintUntil = Date.now() + 5 * 60000;
  } catch (error) {
    if (source !== adapter) return;
    if (
      error.code === "scope_not_public" ||
      error.httpStatus === 401 ||
      error.httpStatus === 403
    ) {
      stopPrivateScope(error.message);
      return;
    }
    if (token.epoch !== currentSprintEpoch) return;
    currentSprintResult = { status: "unavailable", currentSprint: null };
    currentSprintUntil = Date.now() + 60000;
  } finally {
    if (currentSprintFlight === token) {
      currentSprintFlight = null;
      paintCurrentSprint();
      if (currentSprintQueued) {
        currentSprintQueued = false;
        void refreshCurrentSprint(true);
      }
    }
  }
}
function unestimatedScopeKey() {
  const s = state.scope || {};
  return JSON.stringify([
    s.owner,
    s.repo,
    s.projectNumber,
    s.projectUrl,
    s.viewNumber,
    s.viewFilter,
  ]);
}
// null means target membership is unknown, not a confirmed exclusion.
function estimateTarget(t) {
  if (!t) return null;
  if (
    t.type === "PBI" ||
    t.projectItemId === null ||
    (Number.isSafeInteger(t.subIssueCount) && t.subIssueCount > 0) ||
    t.status === "見送り" ||
    (t.state === "CLOSED" && t.stateReason === "NOT_PLANNED")
  )
    return false;
  return t.subIssueCount === 0 &&
    typeof t.projectItemId === "string" &&
    t.projectItemId.length > 0 &&
    state.lanes.some((p) => p.id === t.lane && p.type === "PBI")
    ? true
    : null;
}
function unestimatedEligible(t) {
  return (
    highlightUnestimated &&
    adapter &&
    !snapshotPending &&
    state.scope?.estimateHoursField === true &&
    estimateTarget(t) === true &&
    t.estimateHours === null
  );
}
function confirmedNoUnestimated() {
  if (
    !adapter ||
    loading ||
    snapshotPending ||
    stale ||
    !navigator.onLine ||
    state.scope?.estimateHoursField !== true
  )
    return false;
  const tasks = new Map(state.tasks.map((t) => [t.id, t]));
  // Include every card in the displayed PBI rows, even clipped overflow pages.
  return [...$("#board").querySelectorAll("[data-task]")].every((card) => {
    const task = tasks.get(card.dataset.task),
      target = estimateTarget(task);
    return (
      target === false ||
      (target === true &&
        typeof task.estimateHours === "number" &&
        Number.isFinite(task.estimateHours) &&
        task.estimateHours >= 0)
    );
  });
}
function syncUnestimatedToggle() {
  const available = !!adapter && state.scope?.estimateHoursField === true;
  if (
    !available ||
    (unestimatedScope !== null && unestimatedScope !== unestimatedScopeKey())
  ) {
    highlightUnestimated = false;
    unestimatedScope = null;
  }
  const button = $("#highlight-unestimated");
  button.hidden = !available;
  button.disabled = loading || snapshotPending;
  button.setAttribute("aria-pressed", String(highlightUnestimated));
  button.dataset.tooltip = highlightUnestimated
    ? "未見積の強調を解除（U）"
    : "未見積を強調（U）";
}
function paintUnestimatedHighlights() {
  syncUnestimatedToggle();
  paintCardEstimates();
  unestimatedObserver?.disconnect();
  const tasks = new Map(state.tasks.map((t) => [t.id, t]));
  for (const card of $("#board").querySelectorAll("[data-task]")) {
    const active = !!unestimatedEligible(tasks.get(card.dataset.task));
    card.classList.toggle("unestimated-highlight", active);
    card.classList.remove("unestimated-visible");
    card.querySelector(".estimate-value").hidden = active;
    let cue = card.querySelector(".unestimated-cue"),
      motion = card.querySelector(".unestimated-motion");
    if (active) {
      if (!cue) {
        cue = document.createElement("span");
        cue.className = "unestimated-cue";
        cue.textContent = "未見積";
        card.querySelector(".task-estimate").append(cue);
      }
      if (!motion) {
        motion = document.createElement("span");
        motion.className = "unestimated-motion";
        motion.setAttribute("aria-hidden", "true");
        card.append(motion);
      }
      if (typeof IntersectionObserver === "function") {
        unestimatedObserver ||= new IntersectionObserver(
          (entries) => {
            for (const entry of entries)
              entry.target.classList.toggle(
                "unestimated-visible",
                entry.target.classList.contains("unestimated-highlight") &&
                  entry.isIntersecting &&
                  entry.intersectionRatio > 0,
              );
          },
          // A clipped/edge-adjacent card can intersect with zero area. A
          // positive threshold also notifies when it scrolls into real view.
          { threshold: [0, 0.001] },
        );
        unestimatedObserver.observe(card);
      } else card.classList.add("unestimated-visible");
    } else {
      cue?.remove();
      motion?.remove();
    }
  }
}
function clearUnestimatedHighlights() {
  highlightUnestimated = false;
  unestimatedScope = null;
  paintUnestimatedHighlights();
}
function card(t) {
  const { kind } = issueTypeStyle(t.type);
  const label = typeof t.type === "string" && t.type ? t.type : "未設定";
  const estimate = cardEstimate(t),
    job = issueSaves.get(t.id),
    saving = job?.phase === "posting",
    saveMessage = saving ? "保存中…" : job ? "保存結果の確認が必要です" : "";
  return `<article class="task type-${kind}" data-issue-type="${esc(label)}" aria-label="Issue type: ${esc(label)}${saveMessage ? ` / ${esc(saveMessage)}` : ""}" aria-busy="${saving}" data-save-state="${job ? (saving ? "posting" : "failed") : "idle"}" draggable="${canDragTask(t)}" data-task="${esc(t.id)}"><div class="task-top"><span class="task-issue-number">${esc(issueLabel(t))}</span></div><button class="task-title" data-open="${esc(t.id)}"><span class="task-title-text">${esc(t.title)}</span></button><div class="task-bottom"><span class="person" aria-label="担当者: ${esc(person(t))}">${assigneeAvatars(t, false)}</span><span class="task-estimate" data-state="${estimate.state}" aria-label="${esc(estimate.label)}"><span class="estimate-value">${esc(estimate.text)}</span></span></div></article>`;
}
// Fit only the presentation, never the Issue title. If the available area is
// genuinely too small at 11px, expose whole scrollable lines (and the drawer).
function fitCardTitles() {
  for (const button of document.querySelectorAll(".goal-text")) {
    const parent = button.parentElement;
    const css = getComputedStyle(parent);
    const line = parseFloat(getComputedStyle(button).lineHeight);
    const available =
      parent.clientHeight -
      parseFloat(css.paddingTop) -
      parseFloat(css.paddingBottom);
    button.style.maxHeight = `${Math.max(0, Math.floor(available / line)) * line}px`;
  }
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
  // Batch geometry reads and font writes: one layout per size, not per card.
  const entries = [...document.querySelectorAll(".task-title")]
    .map((button) => ({
      button,
      text: button.querySelector(".task-title-text"),
    }))
    .filter(
      ({ button, text }) => text && button.clientHeight && button.clientWidth,
    );
  let size = window.innerWidth >= 2300 ? 14 : 12;
  for (const { button, text } of entries) {
    text.style.maxHeight = "none";
    button.style.fontSize = `${size}px`;
  }
  let shrinking = entries;
  while (size > 11 && shrinking.length) {
    shrinking = shrinking.filter(
      ({ button, text }) => text.scrollHeight > button.clientHeight + 0.5,
    );
    size -= 0.5;
    for (const { button } of shrinking) button.style.fontSize = `${size}px`;
  }
  const dimensions = entries.map(({ button, text }) => {
    const lineHeight = parseFloat(getComputedStyle(button).lineHeight);
    return {
      button,
      text,
      height:
        Math.max(0, Math.floor((button.clientHeight + 0.01) / lineHeight)) *
        lineHeight,
    };
  });
  for (const { text, height } of dimensions)
    text.style.maxHeight = `${height}px`;
  const overflow = dimensions.map(({ button, text, height }) => ({
    button,
    overflow: text.scrollHeight > height + 1,
  }));
  for (const item of overflow)
    item.button.classList.toggle("title-overflow", item.overflow);
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
  if (element?.matches?.("[data-cell-step]")) {
    const key = element.closest(".task-cell").querySelector(".cell-viewport")
      .dataset.cellKey;
    return `[data-cell-key="${CSS.escape(key)}"] + .cell-navigation [data-cell-step="${element.dataset.cellStep}"]`;
  }
  for (const key of ["data-open", "data-pbi", "data-cell-key"]) {
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
// Session-only viewport state. Keys are stamped on rendered DOM, so a scope
// change cannot accidentally save the old cell position under the new scope.
const cellPositions = new Map();
const cellDimensions = new WeakMap();
function cellKey(lane, column) {
  return JSON.stringify([
    displayScope(),
    $("#search").value.trim(),
    $("#assignee-filter").value,
    lane,
    column,
  ]);
}
function rememberCell(port, explicit = false) {
  if (!port.isConnected || !port.clientHeight) return;
  const dimensions = cellDimensions.get(port);
  // Resize changes the old DOM before ResizeObserver calls render. Keep the
  // last pre-resize anchor instead of recapturing it in already changed geometry.
  if (
    !explicit &&
    dimensions &&
    (dimensions.height !== port.clientHeight ||
      dimensions.width !== port.clientWidth)
  )
    return;
  const bounds = port.getBoundingClientRect();
  const anchors = [...port.querySelectorAll("[data-task]")]
    .map((card) => ({
      id: card.dataset.task,
      rect: card.getBoundingClientRect(),
    }))
    .filter(
      ({ rect }) =>
        rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1,
    )
    .map(({ id, rect }) => ({
      id,
      offset: (rect.top - bounds.top) / port.clientHeight,
    }));
  cellPositions.delete(port.dataset.cellKey);
  cellPositions.set(port.dataset.cellKey, {
    anchors,
    position: port.scrollTop / port.clientHeight,
  });
  if (cellPositions.size > 200)
    cellPositions.delete(cellPositions.keys().next().value);
}
function updateCellRange(port) {
  const cell = port.closest(".task-cell"),
    total = Number(port.dataset.total);
  const half = port.clientHeight / 2;
  const first = Math.min(
    total,
    Math.floor((port.scrollTop + 1) / half) * 2 + 1,
  );
  const last = Math.min(
    total,
    Math.ceil((port.scrollTop + port.clientHeight - 1) / half) * 2,
  );
  cell.querySelector(".cell-range").textContent = `${first}–${last} / ${total}`;
  cell.querySelector('[data-cell-step="-1"]').disabled = port.scrollTop < 1;
  cell.querySelector('[data-cell-step="1"]').disabled =
    port.scrollTop + port.clientHeight >= port.scrollHeight - 1;
}
function restoreCells() {
  for (const port of document.querySelectorAll(".cell-viewport")) {
    const saved = cellPositions.get(port.dataset.cellKey);
    if (saved) {
      const bounds = port.getBoundingClientRect();
      const anchor = saved.anchors.find(({ id }) =>
        port.querySelector(`[data-task="${CSS.escape(id)}"]`),
      );
      if (anchor) {
        const card = port.querySelector(
          `[data-task="${CSS.escape(anchor.id)}"]`,
        );
        port.scrollTop +=
          card.getBoundingClientRect().top -
          bounds.top -
          anchor.offset * port.clientHeight;
      } else port.scrollTop = saved.position * port.clientHeight;
    }
    cellDimensions.set(port, {
      height: port.clientHeight,
      width: port.clientWidth,
    });
    rememberCell(port);
    updateCellRange(port);
    port.addEventListener(
      "scroll",
      () => {
        rememberCell(port);
        updateCellRange(port);
      },
      { passive: true },
    );
  }
}
function stepCell(port, step) {
  if (!port) return;
  port.scrollTop =
    (Math.round(port.scrollTop / port.clientHeight) + step) * port.clientHeight;
  rememberCell(port, true);
  updateCellRange(port);
}
function focusCellStart(port) {
  const index = Math.min(
    port.children.length - 1,
    Math.floor((port.scrollTop + 1) / port.clientHeight),
  );
  (port.children[index]?.querySelector("[data-open]") || port).focus({
    preventScroll: true,
  });
}
function revealCard(target) {
  const port = target?.closest(".cell-viewport");
  if (!port) return;
  const page = target.closest(".cell-page");
  const index = [...port.children].indexOf(page);
  const bounds = port.getBoundingClientRect(),
    rect = (target.closest("[data-task]") || target).getBoundingClientRect();
  if (rect.bottom > bounds.top + 1 && rect.top < bounds.bottom - 1) return;
  port.scrollTop = index * port.clientHeight;
  rememberCell(port, true);
  updateCellRange(port);
}
function renderAfterAsyncChange() {
  if (dragged) {
    boardRenderQueued = true;
    return;
  }
  render();
}
function render() {
  boardRenderQueued = false;
  if (dragged) clearDrag();
  syncUnestimatedToggle();
  renderTypeLegend();
  paintCurrentSprint();
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
  document
    .querySelectorAll(".cell-viewport")
    .forEach((port) => rememberCell(port));
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
  $("#choose-pbis").textContent = `▦ ${displayed.length} / ${MAX_PBIS}`;
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
        ...(state.warnings || []).filter(
          (message) =>
            !message.startsWith(
              "view 16 のフィルターはPBI行に適用しています。",
            ),
        ),
      ]
        .filter(Boolean)
        .join(" · ")
    : "GitHubからの読み込みを待っています。";
  $("#scope-note").hidden = !$("#scope-note").textContent;
  const connectionMessage = !navigator.onLine
    ? "オフライン · 表示は最新未確認"
    : lastReadError
      ? "接続エラー · 表示は最新未確認"
      : state.scope?.filterApplied === false || state.filterApplied === false
        ? "注意：GitHubビューの絞り込みは未適用"
        : "";
  $("#connection").hidden = !connectionMessage;
  $("#connection").textContent = connectionMessage;
  $("#connection").removeAttribute("title");
  const fetched = state.fetchedAt || lastReceivedAt;
  if (connectionMessage && fetched && !Number.isNaN(Date.parse(fetched)))
    $("#connection").textContent +=
      ` · 最終取得 ${new Date(fetched).toLocaleTimeString("ja-JP")}`;
  $("#visible-count").textContent =
    `${tasks.filter((t) => statusColumn(t.status)).length} タスク · 見送り ${tasks.filter((t) => t.status === "見送り").length}`;
  $("#board").innerHTML =
    `<div class="board-row board-head" role="row"><div class="cell" role="columnheader">PBI <span>${displayed.length}</span></div>${columns.map((s) => `<div class="cell" role="columnheader"><b class="status-chip board-status-label"><i aria-hidden="true" class="status-dot ${s.toLowerCase()}" style="--status-color:${statusColor(targetStatus[s])}"></i>${s}</b><span>${tasks.filter((t) => statusColumn(t.status) === s).length}</span></div>`).join("")}<div class="cell" role="columnheader">Demo goal</div></div>` +
    lanes
      .map((l) => {
        const own = tasks.filter((t) => t.lane === l.id),
          all = state.tasks.filter(
            (t) => t.lane === l.id && t.status !== "見送り",
          ),
          done = all.filter((t) => t.status === "完了").length;
        return `<div class="board-row" role="row"><div class="cell pbi-cell" role="rowheader" data-pbi-row="${esc(l.id)}"><button class="pbi-title" data-pbi="${esc(l.id)}"><span class="pbi-title-text">${esc(l.title)}</span></button><div class="pbi-context"><div class="pbi-assignees person" aria-label="PBI担当者: ${esc(person(l))}" title="${esc(person(l))}">${assigneeAvatars(l)}<span class="person-name">${esc(person(l))}</span></div><span class="story-points" data-story-points="${esc(l.id)}" hidden></span></div>${progressMarkup(done, all.length)}</div>${columns
          .map((s) => {
            const list = own.filter((t) => statusColumn(t.status) === s);
            const overflow = list.length > capacity;
            const pages = [];
            for (let i = 0; i < list.length; i += capacity)
              pages.push(list.slice(i, i + capacity));
            const content = overflow
              ? `<div class="cell-viewport" tabindex="0" aria-label="${esc(l.title)} / ${s} の付箋" data-cell-key="${esc(cellKey(l.id, s))}" data-total="${list.length}">${pages.map((items) => `<div class="task-grid cell-page" data-count="4">${items.map(card).join("")}</div>`).join("")}</div><div class="cell-navigation"><span class="cell-range"></span><button data-cell-step="-1" aria-label="前の4件" data-tooltip="前の4件 · Page Up">↑</button><button data-cell-step="1" aria-label="次の4件" data-tooltip="次の4件 · Page Down">↓</button></div>`
              : `<div class="task-grid" data-count="${list.length}">${list.map(card).join("")}</div>`;
            return `<div class="cell task-cell" role="cell" data-lane="${esc(l.id)}" data-status="${s}">${content}</div>`;
          })
          .join(
            "",
          )}<div class="cell goal-cell" role="cell"><button class="goal-text" data-pbi="${esc(l.id)}">${esc(goal(l.body))}</button></div></div>`;
      })
      .join("");
  restoreCells();
  paintUnestimatedHighlights();
  loadStoryPoints(lanes);
  $("#burndown-open").hidden = state.scope?.estimateHoursField !== true;
  renderHoursInput();
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
let saveBlocked = false,
  confirmedSaveEpoch = 0,
  mutationEpoch = 0;
function canDragTask(t) {
  return !!(
    adapter &&
    t &&
    !pending &&
    !scopeSwitchPending &&
    !snapshotPending &&
    !saveBlocked &&
    t.projectItemId !== null &&
    !issueSaves.has(t.id)
  );
}
async function move(id, column) {
  const t = issue("Task", id);
  if (
    !canDragTask(t) ||
    !columns.includes(column) ||
    statusColumn(t.status) === column
  )
    return;
  const baseline = clone(t),
    patch = { status: targetStatus[column] },
    draft = Object.fromEntries(
      editorFields.map((key) => [key, fieldValue(baseline, key)]),
    );
  Object.assign(draft, patch);
  await startIssueSave(
    { kind: "Task", id },
    baseline,
    draft,
    patch,
    adapter,
    false,
    true,
  );
}
let composer = null,
  composerModule = null,
  composerPromise = null;
let editorLatest = null,
  editorConflicts = {},
  editorOutcome = null;
let editorBusy = false,
  editorPosting = false,
  composing = false;
let editorSession = 0;
let editorBody = "",
  fillingDetail = false;
let titleEditing = false,
  titleBeforeEdit = "";
let pendingEditorRemote = undefined,
  editorSaved = false,
  refreshFlight = null;
// 保存はdrawerではなくIssue IDに所属する。送信後の下書きは別に扱う。
const issueSaves = new Map();
function hasOptimisticDragSave() {
  return [...issueSaves.values()].some(
    (job) => job.phase === "posting" && Object.hasOwn(job, "optimisticStatus"),
  );
}
function activeSave() {
  return editing && issueSaves.get(editing.id);
}
function showSaveProblems() {
  const root = $("#save-problems");
  root.replaceChildren();
  for (const job of issueSaves.values()) {
    if (!job.error) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `#${job.baseline.number} 保存を確認`;
    button.setAttribute(
      "aria-label",
      `#${job.baseline.number} ${job.baseline.title} の保存エラーと下書きを確認`,
    );
    button.onclick = () => {
      if (issue(job.target.kind, job.target.id)) {
        openIssue(job.target.kind, job.target.id);
      } else {
        job.showDraft = !job.showDraft;
        showSaveProblems();
      }
    };
    root.append(button);
    if (job.showDraft) {
      const panel = document.createElement("section");
      panel.className = "saved-draft-recovery";
      const message = document.createElement("p");
      message.textContent =
        "現在の表示範囲にないIssueです。下書きを選択してコピーできます。";
      const error = document.createElement("p");
      error.textContent = job.error;
      const fields = document.createElement("p");
      fields.textContent = `担当者: ${(job.draft.assignees || []).join(", ") || "未割当"} / Status: ${job.draft.status ?? "未設定"}${job.draft.storyPoints !== undefined ? ` / Story points: ${job.draft.storyPoints ?? "未設定"}` : ""}`;
      panel.append(message, error, fields);
      for (const [key, label] of [
        ["title", "タイトル"],
        ["body", "本文"],
      ]) {
        const field = document.createElement("textarea");
        field.readOnly = true;
        field.value = job.draft[key] || "";
        field.setAttribute("aria-label", `保存できなかった${label}`);
        panel.append(field);
      }
      root.append(panel);
    }
  }
  root.hidden = !root.childElementCount;
}
function restoreSave(job) {
  if (!job) return;
  editorBaseline = clone(job.viewBaseline || job.baseline);
  editorLatest = clone(job.baseline);
  for (const key of editorFields)
    writeField(key, (job.viewDraft || job.draft)[key]);
  editorOutcome = job.outcome || null;
  editorPosting = job.phase === "posting";
  editorBusy = editorPosting;
  if (job.error) {
    $("#detail-error").textContent = job.error;
    $("#detail-error").hidden = false;
  }
  updateDirty();
}
const editorFields = [
  "title",
  "body",
  "assignees",
  "status",
  "storyPoints",
  "estimateHours",
];
let editorHours,
  hoursEpoch = 0;
let editorPoints;
const fieldNames = {
  title: "タイトル",
  body: "本文",
  assignees: "担当者",
  status: "ステータス",
  storyPoints: "Story points",
  estimateHours: "見積時間",
};
function fieldValue(item, key) {
  if (key === "storyPoints" || key === "estimateHours") return item?.[key];
  return key === "assignees"
    ? (item.assignees || []).map((a) => a.login).sort()
    : (item[key] ?? null);
}
function equalField(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}
function editorDraft() {
  return {
    storyPoints: editorPoints,
    estimateHours: editorHours,
    title: $("#detail-title").value,
    body: editorBody,
    assignees: [...$("#detail-assignee").selectedOptions]
      .map((o) => o.value)
      .sort(),
    status: $("#detail-status").value || fieldValue(editorBaseline, "status"),
  };
}
function writeField(key, value) {
  if (key === "estimateHours") {
    editorHours = value;
    renderHoursInput();
  } else if (key === "storyPoints") {
    editorPoints = value;
    renderPointsChoices();
  } else if (key === "body") {
    editorBody = value || "";
    $("#detail-body").value = value || "";
    composer?.set(value || "");
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
    (key) =>
      !equalField(
        draft[key],
        activeSave()?.phase === "posting"
          ? Object.hasOwn(activeSave().queued || {}, key)
            ? activeSave().queued[key]
            : Object.hasOwn(activeSave().patch, key)
              ? activeSave().draft[key]
              : fieldValue(editorBaseline, key)
          : fieldValue(editorBaseline, key),
      ),
  );
  if (!fillingDetail && activeSave()?.phase === "posting")
    activeSave().viewDraft = clone(draft);
  if (editMode) editorSaved = false;
  syncEditorControls();
}
function setEdit() {
  updateDirty();
}
function syncEditorControls() {
  const retryCompletion =
    activeSave()?.retryReady === true && editorDraft().status === "完了";
  const dirty = editMode || composing || retryCompletion;
  $("#save-issue").disabled =
    !dirty ||
    editorBusy ||
    composing ||
    detailUnavailable ||
    !!editorOutcome ||
    Object.keys(editorConflicts).length > 0;
  const saveContent =
    editorPosting && !activeSave()?.automatic
      ? "保存中…"
      : editorBusy && !activeSave()?.automatic
        ? "確認中…"
        : retryCompletion
          ? "完了処理を再試行"
          : `保存 ${saveKeys}`;
  if ($("#save-issue").innerHTML !== saveContent)
    $("#save-issue").innerHTML = saveContent;
  $("#save-issue").setAttribute(
    "aria-label",
    `保存（${isMacKeyboard ? "Command Return" : "Ctrl Enter"}）`,
  );
  $("#cancel-edit").hidden = !dirty;
  $("#cancel-edit").disabled = editorPosting;
  $("#detail-fields").disabled = false;
  $("#detail-title").disabled = false;
  composer?.disabled(false);
  $("#recover-edit").hidden = !editorOutcome && !lastReadError;
  $("#recover-edit").disabled = editorBusy || loading;
  $("#recover-edit").textContent = editorOutcome?.durable
    ? "管理者による確認が必要"
    : editorOutcome
      ? "保存結果を確認"
      : "接続を再確認";
  if (editorOutcome?.durable) $("#recover-edit").disabled = true;
  updateDetailSync();
  syncCommentControls();
  renderDetailChoices();
  renderPointsChoices();
  renderHoursInput();
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
async function ensureComposer() {
  try {
    composerModule ||= await (composerPromise ||= import("./editor-bundle.js"));

    renderComments();
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

    composer.source(sourceVisible);
    $("#detail-body").hidden = true;
  } catch {
    composerPromise = null;

    $(".editor-hint").hidden = false;
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
const statusPalette = {
  GRAY: "var(--status-gray)",
  BLUE: "var(--status-blue)",
  GREEN: "var(--status-green)",
  YELLOW: "var(--status-yellow)",
  ORANGE: "var(--status-orange)",
  RED: "var(--status-red)",
  PURPLE: "var(--status-purple)",
  PINK: "var(--status-pink)",
};
function statusColor(name) {
  const color = state.scope?.statusColors?.find((o) => o.name === name)?.color;
  return statusPalette[color] || statusPalette.GRAY;
}
function avatarNode(person) {
  const fallback = document.createElement("span");
  fallback.className = "person-avatar";
  fallback.textContent = (person?.login || "?").slice(0, 1).toUpperCase();
  try {
    const u = new URL(person?.avatarUrl);
    if (
      u.protocol === "https:" &&
      u.hostname === "avatars.githubusercontent.com" &&
      !u.username &&
      !u.password &&
      !u.port
    ) {
      const image = document.createElement("img");
      image.src = u.href;
      image.alt = "";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
      image.onerror = () => image.remove();
      fallback.append(image);
    }
  } catch {}
  return fallback;
}
// Optional late-read capability. Production adapter does not enable it until
// the canonical field ID, public approval and server reader are configured.
let pointsSnapshot = null,
  pointsAdapter = null,
  pointsKey = "",
  pointsEpoch = 0;
let pointsValues = {},
  pointsScope = "",
  pointsFlight = null,
  pointsSkipSnapshot = null;
const pointsGenerations = new Map(),
  pointsVerifiedAt = new Map();
let pointsIdentities = new Map();
function paintStoryPoints() {
  for (const badge of document.querySelectorAll("[data-story-points]")) {
    const lane = state.lanes.find((l) => l.id === badge.dataset.storyPoints);
    const value =
      pointsSnapshot === state && lane?.type === "PBI"
        ? pointsValues[lane.number]
        : undefined;
    const available = typeof value === "number" && Number.isFinite(value);
    badge.hidden = !available;
    badge.textContent = available
      ? badge.id === "detail-story-points"
        ? `SP ${value}`
        : String(value)
      : "";
    if (available) badge.setAttribute("aria-label", `Story points ${value}`);
    else badge.removeAttribute("aria-label");
  }
  reconcilePointValue();
}
function hoursAvailable() {
  return (
    editing?.kind === "Task" &&
    state.scope?.estimateHoursField === true &&
    Object.hasOwn(issue(editing.kind, editing.id) || {}, "estimateHours")
  );
}
function renderHoursInput() {
  const ready = hoursAvailable();
  $("#estimate-hours-editor").hidden = !ready;
  if (!ready) return;
  const values = [0.5, 1, 2, 3, 4, 5, 6, 8, 12];
  // Preserve canonical arbitrary values without rounding or expanding the field schema.
  if (
    typeof editorHours === "number" &&
    Number.isFinite(editorHours) &&
    !values.includes(editorHours)
  )
    values.push(editorHours);
  values.sort((a, b) => a - b);
  renderNumberChoices(
    $("#estimate-hours-choices"),
    [...values, null],
    editorHours,
    (value) => (value === null ? "未設定" : `${value}h`),
    (value) => {
      editorHours = value;
      updateDirty();
      autoSaveField("estimateHours");
    },
  );
}
function invalidateHours() {
  hoursEpoch++;
  editorHours = undefined;
  if (editorBaseline) delete editorBaseline.estimateHours;
  if (editorLatest) delete editorLatest.estimateHours;
  $("#estimate-hours-choices").replaceChildren();
  delete $("#estimate-hours-choices").dataset.value;
  delete editorConflicts.estimateHours;
  renderConflicts();
  for (const task of state.tasks || []) delete task.estimateHours;
  if (state.scope) state.scope.estimateHoursField = false;
  clearUnestimatedHighlights();
  $("#burndown-open").hidden = true;
  burnPanel?.invalidate();
  renderHoursInput();
}
function renderNumberChoices(root, values, selected, label, choose) {
  const key = JSON.stringify([values, selected]);
  if (root.dataset.value === key) return;
  const focused = root.contains(document.activeElement)
    ? document.activeElement.dataset.value
    : null;
  root.dataset.value = key;
  root.replaceChildren(
    ...values.map((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.value = value === null ? "" : String(value);
      button.textContent = label(value);
      button.setAttribute("aria-pressed", String(selected === value));
      button.onclick = () => {
        if (!composing) choose(value);
      };
      return button;
    }),
  );
  if (focused !== null)
    [...root.children]
      .find((b) => b.dataset.value === focused)
      ?.focus({ preventScroll: true });
}
function pointsAvailable() {
  return (
    editing?.kind === "PBI" &&
    pointsSnapshot === state &&
    Object.hasOwn(pointsValues, editorLatest?.number)
  );
}
function renderPointsChoices() {
  const group = $("#story-point-editor");
  const ready = pointsAvailable();
  group.hidden = !ready;
  if (!ready) return;
  renderNumberChoices(
    $("#story-point-choices"),
    [0.1, 1, 2, 3, 5, 8, 13, null],
    editorPoints,
    (value) => (value === null ? "解除" : String(value)),
    (value) => {
      editorPoints = value;
      updateDirty();
      autoSaveField("storyPoints");
    },
  );
}
function reconcilePointValue() {
  if (!$("#details").open || !editorBaseline || !pointsAvailable()) {
    renderPointsChoices();
    return;
  }
  if (activeSave()?.phase === "posting") return;
  const remote = pointsValues[editorLatest.number],
    base = editorBaseline.storyPoints;
  if (
    editorPoints === base ||
    editorPoints === remote ||
    editorPoints === undefined
  ) {
    editorPoints = remote;
    editorBaseline.storyPoints = remote;
    delete editorConflicts.storyPoints;
  } else if (remote !== base) editorConflicts.storyPoints = { remote };
  editorLatest.storyPoints = remote;
  renderConflicts();
  updateDirty();
}
function loadStoryPoints(lanes) {
  const source = adapter;
  const pbis = lanes
    .filter((l) => l.type === "PBI")
    .map((l) => ({ id: l.id, number: l.number }));
  const key = pbis
    .map((l) => `${l.id}:${l.number}`)
    .sort()
    .join("|");
  const scope = JSON.stringify([
    displayScope(),
    state.scope?.viewFilter ?? null,
    state.scope?.filterApplied ?? null,
  ]);
  if (pointsAdapter !== source || pointsScope !== scope) {
    pointsEpoch++;
    pointsValues = {};
    pointsGenerations.clear();
    pointsVerifiedAt.clear();
    pointsIdentities.clear();
    pointsFlight = null;
    pointsKey = "";
    pointsSnapshot = null;
    pointsAdapter = source;
    pointsScope = scope;
  }
  const changed = pointsSnapshot !== state,
    selectionChanged = pointsKey !== key;
  if (selectionChanged) {
    pointsEpoch++;
    pointsFlight = null;
    const identities = new Map(pbis.map((p) => [p.number, p.id]));
    for (const number of Object.keys(pointsValues))
      if (
        pointsIdentities.get(Number(number)) !==
          identities.get(Number(number)) ||
        !identities.has(Number(number))
      )
        delete pointsValues[number];
    for (const number of pointsGenerations.keys())
      if (!identities.has(number)) pointsGenerations.delete(number);
    for (const number of pointsVerifiedAt.keys())
      if (!identities.has(number)) pointsVerifiedAt.delete(number);
    pointsIdentities = identities;
  }
  pointsSnapshot = state;
  pointsKey = key;
  if (state.storyPoints && Object.hasOwn(state.storyPoints, "values")) {
    // Board projection has already passed live field/type/scope checks. No N+1 late read.
    if (changed || selectionChanged) {
      pointsFlight = null;
      const values = state.storyPoints.values;
      const valid =
        values && typeof values === "object" && !Array.isArray(values);
      pointsValues = {};
      if (!valid || !Object.keys(values).length) {
        pointsEpoch++;
        pointsVerifiedAt.clear();
      } else
        for (const { number } of pbis) {
          const value = values[number];
          if (
            Object.hasOwn(values, number) &&
            (value === null ||
              (typeof value === "number" && Number.isFinite(value)))
          ) {
            pointsValues[number] = value;
            pointsVerifiedAt.set(number, Date.now());
          }
        }
    }
    paintStoryPoints();
    return;
  }
  if (typeof source?.loadStoryPoints !== "function") {
    pointsValues = {};
    paintStoryPoints();
    return;
  }
  if (
    (selectionChanged ||
      (changed &&
        (pointsSkipSnapshot !== state ||
          pbis.some(
            (p) =>
              !Object.hasOwn(pointsValues, p.number) ||
              Date.now() - (pointsVerifiedAt.get(p.number) || 0) >= 45000,
          )))) &&
    !pointsFlight &&
    pbis.length
  ) {
    const epoch = pointsEpoch;
    const generations = new Map(
      pbis.map((p) => [p.number, pointsGenerations.get(p.number) || 0]),
    );
    const current = () =>
      epoch === pointsEpoch && adapter === source && pointsFlight === flight;
    const unchanged = (number) =>
      generations.get(number) === (pointsGenerations.get(number) || 0);
    const flight = {};
    pointsFlight = flight;
    // Keep verified values during an in-flight refresh, not after a failed result.
    Promise.resolve()
      .then(() => source.loadStoryPoints(pbis))
      .then((result) => {
        if (!current()) return;
        const values = result?.values;
        const validObject =
          values && typeof values === "object" && !Array.isArray(values);
        // Empty projection can mean the public field definition has been revoked.
        if (!validObject || !Object.keys(values).length) {
          pointsValues = {};
          pointsVerifiedAt.clear();
          pointsEpoch++; // An older mutation readback cannot revive a revoked field.
        } else
          for (const { number } of pbis) {
            if (!unchanged(number)) continue;
            const value = values[number];
            if (
              Object.hasOwn(values, number) &&
              (value === null ||
                (typeof value === "number" && Number.isFinite(value)))
            ) {
              pointsValues[number] = value;
              pointsVerifiedAt.set(number, Date.now());
            } else delete pointsValues[number];
          }
        paintStoryPoints();
      })
      .catch((error) => {
        if (!current()) return;
        if (error.code === "scope_not_public") {
          stopPrivateScope(error.message);
          return;
        }
        for (const { number } of pbis)
          if (unchanged(number)) delete pointsValues[number];
        paintStoryPoints();
      })
      .finally(() => {
        if (pointsFlight === flight) pointsFlight = null;
      });
  }
  paintStoryPoints();
}
function detailStoryPoints(t) {
  const badge = $("#detail-story-points");
  badge.dataset.storyPoints = editing?.kind === "PBI" ? t.id : "";
  paintStoryPoints();
}
const authorRenderKeys = new WeakMap();
function renderAuthor(t) {
  const root = $("#issue-author"),
    a = t?.author;
  const key = JSON.stringify(a || null);
  if (root.childElementCount && authorRenderKeys.get(root) === key) return;
  authorRenderKeys.set(root, key);
  root.replaceChildren(avatarNode(a));
  const text = document.createElement("span");
  text.textContent = "作成者";
  root.append(text);
  const label = a?.name
    ? `${a.name} (@${a.login})`
    : a?.login || "削除済み・不明";
  let name = document.createElement("span");
  try {
    const u = new URL(a?.url);
    if (
      u.origin === "https://github.com" &&
      !u.username &&
      !u.password &&
      /^\/(?:apps\/)?[a-z\d-]+\/?$/i.test(u.pathname) &&
      !u.search &&
      !u.hash
    ) {
      name = document.createElement("a");
      name.href = u.href;
      name.target = "_blank";
      name.rel = "noopener noreferrer";
    }
  } catch {}
  name.textContent = label;
  name.title = label;
  root.append(name);
  if (a?.type === "Bot") {
    const bot = document.createElement("span");
    bot.textContent = "Bot";
    root.append(bot);
  }
}
function renderDetailChoices() {
  const select = $("#detail-assignee"),
    root = $("#assignee-tiles");
  const people = new Map(
    [
      ...(editorBaseline?.assignees || []),
      ...(editorLatest?.assignees || []),
      ...(state.assigneeOptions || []),
    ].map((a) => [a.login, a]),
  );
  const existing = new Map([...root.children].map((b) => [b.dataset.login, b]));
  const wanted = new Set();
  for (const option of select.options) {
    const login = option.value,
      person = people.get(login) || { login },
      key = JSON.stringify(person);
    wanted.add(login);
    let button = existing.get(login);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.login = login;
      button.className = "assignee-tile";
      root.append(button);
    }
    button.onclick = () => {
      option.selected = !option.selected;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };
    if (button.dataset.person !== key) {
      const label = document.createElement("span");
      label.textContent = person.name || login;
      button.replaceChildren(avatarNode(person), label);
      button.dataset.person = key;
    }
    button.title = person.name ? `${person.name} (@${login})` : login;
    button.setAttribute("aria-label", `担当者 ${button.title}`);
    button.setAttribute("aria-pressed", String(option.selected));
  }
  for (const [login, button] of existing)
    if (!wanted.has(login)) button.remove();
  const status = $("#detail-status"),
    choices = $("#status-choices");
  const old = new Map([...choices.children].map((b) => [b.dataset.status, b]));
  const names = new Set();
  for (const option of status.options) {
    const value = option.value;
    names.add(value);
    let button = old.get(value);
    if (!button) {
      button = document.createElement("button");
      button.type = "button";
      button.dataset.status = value;
      button.className = "status-choice status-chip";
      const dot = document.createElement("i"),
        label = document.createElement("span");
      dot.className = "status-dot";
      label.textContent = option.textContent;
      button.append(dot, label);
      choices.append(button);
      button.onclick = () => {
        if (status.disabled) return;
        status.value = value;
        status.dispatchEvent(new Event("change", { bubbles: true }));
      };
    }
    button
      .querySelector("i")
      .style.setProperty("--status-color", statusColor(value));
    button.setAttribute("aria-pressed", String(value === status.value));
    button.disabled = status.disabled;
  }
  for (const [value, b] of old) if (!names.has(value)) b.remove();
}
function progressMarkup(done, total) {
  const dense = total > 40;
  const explanation = dense
    ? `${done}/${total}件完了（多数のため連続表示）`
    : `${done}/${total}件完了`;
  const marks =
    total === 0
      ? ""
      : dense
        ? `<b style="width:${(done / total) * 100}%"></b>`
        : Array.from(
            { length: total },
            (_, i) =>
              `<span class="progress-segment${i < done ? " complete" : ""}"></span>`,
          ).join("");
  return `<div class="lane-progress"><div class="progress-track${dense ? " dense-progress" : ""}" role="progressbar" aria-label="タスク完了数" aria-valuemin="0" aria-valuemax="${total || 1}" aria-valuenow="${done}" aria-valuetext="${explanation}" title="${explanation}">${marks}</div><span class="progress-count">${done}/${total}</span></div>`;
}

function fillDetail() {
  fillingDetail = true;
  try {
    fillDetailFields();
  } finally {
    fillingDetail = false;
  }
}
function fillDetailFields() {
  sourceVisible = false;
  $("#markdown-source").setAttribute("aria-pressed", "false");
  $("#markdown-source").innerHTML = "原文を確認 <kbd>F8</kbd>";
  $("#editor-options").dataset.tooltip = "本文の補助操作（原文切替: F8）";
  composer?.source(false);
  const original = issue(editing.kind, editing.id);
  if (!original) return;
  const t = clone(original);
  if (
    pointsSnapshot === state &&
    Object.hasOwn(pointsValues, t.number) &&
    editing.kind === "PBI"
  )
    t.storyPoints = pointsValues[t.number];
  renderAuthor(t);
  detailStoryPoints(t);
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
  finishTitle(false);
  $("#detail-error").hidden = !editorOutcome;
  renderConflicts();
  updateDirty();
}
function updateDetailSync() {
  const indicator = $("#detail-sync");
  const message = editorOutcome
    ? "入力を保持しています。保存結果の確認が必要です。"
    : detailUnavailable
      ? "現在の表示範囲から外れています。入力は保持しています。"
      : Object.keys(editorConflicts).length
        ? "同じ項目にGitHub側の変更があります。内容を選んでください。"
        : lastReadError
          ? editorSaved
            ? "保存は完了しましたが、最新データを取得できません。接続を再確認してください。"
            : "同期できませんでした。入力は続けられます。"
          : "";
  indicator.hidden = !message;
  indicator.textContent = message;
  indicator.title = message;
  if (message) indicator.setAttribute("aria-label", message);
  else indicator.removeAttribute("aria-label");
}
function reconcileEditor(current) {
  if (!$("#details").open) return;
  if (activeSave()?.phase === "posting") return;
  if (composing) {
    pendingEditorRemote = current;
    return;
  }
  detailUnavailable = !current;
  if (!current) {
    syncEditorControls();
    return;
  }
  editorLatest = {
    ...clone(current),
    ...(!Object.hasOwn(current, "estimateHours") &&
    Object.hasOwn(editorBaseline, "estimateHours")
      ? { estimateHours: editorBaseline.estimateHours }
      : {}),
    ...(Object.hasOwn(editorBaseline, "storyPoints")
      ? { storyPoints: editorBaseline.storyPoints }
      : {}),
  };
  renderAuthor(current);
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
    if (
      ["storyPoints", "estimateHours"].includes(key) &&
      !Object.hasOwn(current, key)
    )
      continue;
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
  $("#detail-heading").textContent = $("#detail-title").value || current.title;
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
function reconcileDetail() {
  if (!$("#details").open) return;
  const current = issue(editing.kind, editing.id);
  reconcileEditor(current);
}
let linkedPrFlight = null,
  linkedPrItems = [],
  linkedPrCursor = null;
function clearLinkedPrs() {
  linkedPrFlight = null;
  linkedPrItems = [];
  linkedPrCursor = null;
  $("#linked-prs").replaceChildren();
  $("#linked-prs").hidden = true;
}
async function loadLinkedPrs(more = false) {
  if (!adapter?.loadPullRequests || !$("#details").open || linkedPrFlight)
    return;
  const session = editorSession,
    root = $("#linked-prs"),
    token = {};
  linkedPrFlight = token;
  if (!linkedPrItems.length) {
    root.hidden = false;
    root.textContent = "PR…";
  }
  try {
    const data = await adapter.loadPullRequests(
      editorLatest.number,
      more ? linkedPrCursor : null,
    );
    if (session !== editorSession || linkedPrFlight !== token) return;
    if (!Array.isArray(data.prs)) throw Error("invalid_pr_response");
    const safe = data.prs.filter(
      (p) =>
        Number.isSafeInteger(p.number) &&
        p.number > 0 &&
        p.url ===
          `https://github.com/engineer-first/idea-boost/pull/${p.number}` &&
        typeof p.title === "string" &&
        ["OPEN", "CLOSED", "MERGED"].includes(p.state),
    );
    linkedPrItems = [
      ...new Map(
        [...(more ? linkedPrItems : []), ...safe].map((p) => [p.number, p]),
      ).values(),
    ];
    linkedPrCursor = data.nextCursor || null;
    root.replaceChildren();
    for (const p of linkedPrItems) {
      const a = document.createElement("a"),
        label = document.createElement("span");
      const kind =
        p.state === "MERGED"
          ? "merged"
          : p.state === "CLOSED"
            ? "closed"
            : p.isDraft
              ? "draft"
              : "open";
      const names = {
        merged: "マージ済み",
        closed: "未マージでクローズ",
        draft: "ドラフト",
        open: "オープン",
      };
      a.className = "linked-pr pr-" + kind;
      a.href = p.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.title = `${names[kind]} · #${p.number} ${p.title}`;
      a.setAttribute("aria-label", a.title + "（新しいタブ）");
      const icons = {
        open: "git-pull-request",
        draft: "git-pull-request-draft",
        closed: "git-pull-request-closed",
        merged: "git-merge",
      };
      a.innerHTML = iconMarkup(icons[kind]);
      label.textContent = `#${p.number} ${p.title}`;
      a.append(label);
      root.append(a);
    }
    if (linkedPrCursor) {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = "ほかのPR";
      b.onclick = () => loadLinkedPrs(true);
      root.append(b);
    }
    root.hidden = !linkedPrItems.length && !linkedPrCursor;
  } catch (error) {
    if (session !== editorSession || linkedPrFlight !== token) return;
    if (error.code === "scope_not_public") {
      stopPrivateScope(error.message);
      return;
    }
    root.hidden = false;
    root.replaceChildren();
    const text = document.createElement("span"),
      retry = document.createElement("button");
    text.textContent = "関連PRを取得できません。";
    retry.type = "button";
    retry.textContent = "再試行";
    retry.onclick = () => loadLinkedPrs();
    root.append(text, retry);
  } finally {
    if (linkedPrFlight === token) linkedPrFlight = null;
  }
}
const commentDrafts = new Map();
let commentConfirmed = new Map();
let commentItems = [],
  commentNext = null,
  commentsLoading = false,
  commentRefreshQueued = null,
  commentComposing = false;
function commentEntry() {
  const n = editorLatest?.number;
  return n ? commentDrafts.get(n) : null;
}
function commentDirty() {
  return !!commentEntry()?.body.trim();
}
function commentPosting() {
  return !!commentEntry()?.posting;
}
function setupComments() {
  const n = editorLatest.number;
  if (!commentDrafts.has(n))
    commentDrafts.set(n, {
      body: "",
      requestId: null,
      outcome: null,
      posting: false,
    });
  commentItems = [];
  commentConfirmed.clear();
  commentNext = null;
  commentsLoading = false;
  commentRefreshQueued = null;
  commentComposing = false;
  $("#comment-body").value = commentEntry().body;
  $("#comments-list")
    .querySelectorAll(".comment-content")
    .forEach((n) => composerModule?.clearPreview(n));
  $("#comments-list").replaceChildren();
  $("#comments-status").textContent = "コメントを読み込み中…";
  $("#comment-state").textContent = "";
  syncCommentControls();
}
function syncCommentControls() {
  const entry = commentEntry();
  if (!entry) return;
  $("#comment-body").disabled = !!entry.posting;
  $("#post-comment").disabled =
    !entry.body.trim() ||
    !!entry.posting ||
    editorPosting ||
    !!entry.outcome ||
    commentComposing ||
    detailUnavailable ||
    $("#details").classList.contains("closing");
  $("#post-comment").textContent = entry.posting ? "投稿中…" : "コメントを投稿";
  $("#comment-error").hidden = !entry.outcome;
  $("#comment-error").textContent = entry.outcome || "";
  $("#comments-refresh").disabled = commentsLoading;
  $("#comments-refresh").setAttribute("aria-busy", String(commentsLoading));
  $("#comments-more").hidden = !commentNext;
  $("#comments-more").disabled = commentsLoading;
}
const commentRenderKeys = new WeakMap();
function renderComments() {
  const root = $("#comments-list");
  const existing = new Map(
    [...root.children].map((n) => [Number(n.dataset.commentId), n]),
  );
  const kept = new Set();
  let position = 0;
  const loadedIds = new Set(commentItems.map((c) => c.id));
  const displayed = [
    ...commentItems,
    ...[...commentConfirmed.values()].filter((c) => !loadedIds.has(c.id)),
  ].sort((a, b) => a.id - b.id);
  const wanted = new Set(displayed.map((c) => c.id));
  for (const [id, article] of existing) {
    if (!wanted.has(id)) {
      composerModule?.clearPreview(article.querySelector(".comment-content"));
      article.remove();
      existing.delete(id);
    }
  }
  for (const c of displayed) {
    const bodyKey = JSON.stringify([c.body, !!composerModule]);
    const metaKey = JSON.stringify([
      c.author,
      c.url,
      c.createdAt,
      loadedIds.has(c.id),
    ]);
    const previous = existing.get(c.id);
    const oldKeys = previous && commentRenderKeys.get(previous);
    const article = previous || document.createElement("article");
    const body =
      previous?.querySelector(".comment-content") ||
      document.createElement("div");
    article.className = "issue-comment";
    article.dataset.commentId = String(c.id);
    if (oldKeys?.body !== bodyKey) {
      if (composerModule) composerModule.preview(c.body, body);
      else body.textContent = c.body;
    }
    if (oldKeys?.meta !== metaKey) {
      const header = document.createElement("header"),
        author = document.createElement("strong"),
        link = document.createElement("a");
      body.className = "markdown-preview comment-content";
      author.textContent = c.author?.login || "削除されたユーザー";
      const avatar = c.author?.avatarUrl;
      if (
        typeof avatar === "string" &&
        /^https:\/\/avatars\.githubusercontent\.com\//.test(avatar)
      ) {
        const img = document.createElement("img");
        img.src = avatar;
        img.alt = "";
        img.width = 24;
        img.height = 24;
        header.append(img);
      }
      link.textContent = Number.isFinite(Date.parse(c.createdAt))
        ? new Date(c.createdAt).toLocaleString("ja-JP")
        : "GitHub";
      if (
        typeof c.url === "string" &&
        /^https:\/\/github\.com\/engineer-first\/idea-boost\/issues\/[1-9]\d*#issuecomment-\d+$/.test(
          c.url,
        )
      ) {
        link.href = c.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      header.append(author, link);
      if (!loadedIds.has(c.id)) {
        const note = document.createElement("span");
        note.textContent = "投稿したコメント（投稿時の内容）";
        header.append(note);
      }
      if (c.author?.type === "Bot") {
        const bot = document.createElement("span");
        bot.textContent = "GitHub App / Bot";
        header.append(bot);
      }
      const oldHeader = article.querySelector("header");
      if (oldHeader) oldHeader.replaceWith(header);
      else article.append(header, body);
    }
    commentRenderKeys.set(article, { body: bodyKey, meta: metaKey });
    if (root.children[position] !== article)
      root.insertBefore(article, root.children[position] || null);
    kept.add(article);
    position++;
  }
  for (const article of [...root.children])
    if (!kept.has(article)) {
      const body = article.querySelector(".comment-content");
      if (body) composerModule?.clearPreview(body);
      article.remove();
    }
}
function stopPrivateScope(message) {
  burnPanel?.close();
  invalidateHours();
  cellPositions.clear();
  state = clone(initial);
  issueSaves.clear();
  showSaveProblems();
  pointsEpoch++;
  pointsValues = {};
  paintStoryPoints();
  adapter = null;
  clearCurrentSprint();
  connectionError = message;
  initialLoading = false;
  saveBlocked = true;
  pending = false;
  loading = false;
  scopeSwitchPending = false;
  $("#refresh").disabled = false;
  $("#milestone-filter").disabled = false;
  editorSession++;
  clearLinkedPrs();
  composerModule?.clearPreview($("#detail-body-view"));
  $("#comments-list")
    .querySelectorAll(".comment-content")
    .forEach((n) => composerModule?.clearPreview(n));
  $("#comments-list").replaceChildren();
  commentItems = [];
  commentConfirmed.clear();
  commentDrafts.clear();
  commentRefreshQueued = null;
  editorBody = "";
  editorBaseline = null;
  editorLatest = null;
  editMode = false;
  composing = false;
  commentComposing = false;
  composer?.destroy();
  composer = null;
  $("#markdown-editor").replaceChildren();
  $("#detail-body").value = "";
  $("#detail-title").value = "";
  $("#comment-body").value = "";
  $("#details").close();
  $("#list-dialog").close();
  render();
}
function refreshCommentsAfterPost(session) {
  if (
    session !== editorSession ||
    !$("#details").open ||
    $("#details").classList.contains("closing") ||
    !adapter?.loadComments
  )
    return;
  if (commentsLoading) {
    commentRefreshQueued = session;
    return;
  }
  void loadComments();
}
async function loadComments(more = false) {
  if (commentsLoading || !adapter?.loadComments || !$("#details").open) return;
  const session = editorSession,
    number = editorLatest.number;
  commentsLoading = true;
  $("#comments-skeleton").hidden = commentItems.length > 0;
  $("#comments-list").setAttribute("aria-busy", "true");
  $("#comments-status").textContent = commentItems.length
    ? ""
    : "コメントを読み込み中…";
  syncCommentControls();
  try {
    const result = await adapter.loadComments(number, more ? commentNext : 1);
    if (session !== editorSession) return;
    if (!Array.isArray(result.comments))
      throw Error("コメントを確認できません。");
    commentItems = more
      ? [
          ...new Map(
            [...commentItems, ...result.comments].map((c) => [c.id, c]),
          ).values(),
        ]
      : result.comments;
    commentNext = result.nextPage;
    renderComments();
    $("#comments-status").textContent = commentItems.length
      ? `${commentItems.length}件のコメント`
      : "まだコメントはありません。";
    $("#comments-status").title = `取得: ${result.fetchedAt || "現在"}`;
  } catch (error) {
    if (error.code === "scope_not_public") {
      stopPrivateScope(error.message);
      return;
    }
    if (session === editorSession)
      $("#comments-status").textContent =
        "コメントを取得できませんでした。「更新」で再確認できます。";
  } finally {
    if (session === editorSession) {
      commentsLoading = false;
      $("#comments-skeleton").hidden = true;
      $("#comments-list").setAttribute("aria-busy", "false");
      syncCommentControls();
      if (commentRefreshQueued === session) {
        commentRefreshQueued = null;
        refreshCommentsAfterPost(session);
      }
    }
  }
}
$("#comment-body").addEventListener("input", () => {
  commentEntry().body = $("#comment-body").value;
  syncCommentControls();
});
$("#comment-body").addEventListener("compositionstart", () => {
  commentComposing = true;
  syncCommentControls();
});
$("#comment-body").addEventListener("compositionend", () => {
  commentComposing = false;
  syncCommentControls();
});
$("#comment-body").addEventListener("keydown", (e) => {
  if (
    (e.metaKey || e.ctrlKey) &&
    e.key === "Enter" &&
    !e.isComposing &&
    !commentComposing
  ) {
    e.preventDefault();
    $("#comment-form").requestSubmit();
  }
});
$("#comments-refresh").onclick = () => loadComments();
$("#comments-more").onclick = () => loadComments(true);
$("#comment-form").onsubmit = async (e) => {
  e.preventDefault();
  const entry = commentEntry();
  if (
    !$("#details").open ||
    $("#details").classList.contains("closing") ||
    !entry?.body.trim() ||
    entry.posting ||
    entry.outcome ||
    commentComposing ||
    detailUnavailable ||
    editorPosting
  )
    return;
  const session = editorSession,
    number = editorLatest.number;
  let refreshAfterPost = false;
  entry.posting = true;
  entry.requestId ||= crypto.randomUUID();
  syncCommentControls();
  try {
    const result = await adapter.postComment(
      number,
      entry.body,
      entry.requestId,
    );
    if (!result.ok || !(result.comment?.id || result.commentReceipt?.id))
      throw Error("投稿結果を確認できません。");
    entry.body = "";
    entry.requestId = null;
    entry.outcome = null;
    if (session === editorSession) {
      $("#comment-body").value = "";
      $("#comment-state").textContent = "";
      if (result.comment) {
        commentConfirmed.set(result.comment.id, result.comment);
        while (commentConfirmed.size > 10)
          commentConfirmed.delete(commentConfirmed.keys().next().value);
        commentItems.push(result.comment);
        renderComments();
      }
      refreshAfterPost = true;
    }
  } catch (error) {
    const uncertain =
      error.ambiguous ||
      !error.httpStatus ||
      error.serverError === "mutation_outcome_unresolved" ||
      error.serverError === "request_already_processed";
    if (uncertain)
      entry.outcome =
        "投稿結果を確定できません。下書きを保持し、再投稿を停止しました。コメント一覧・GitHubで確認し、管理者へ確認してください。自動再送はしません。";
    else {
      entry.requestId = null;
      if (session === editorSession)
        $("#comment-state").textContent =
          "投稿できませんでした。下書きは保持しています。内容・接続を確認して再度操作してください。";
    }
    if (error.code === "scope_not_public") stopPrivateScope(error.message);
    if (
      error.serverError === "estimate_hours_not_public" ||
      error.code === "estimate_hours_not_public"
    )
      invalidateHours();
  } finally {
    entry.posting = false;
    if (session === editorSession) syncCommentControls();
  }
  // An old list read must never own or release a subsequent comment POST lock.
  if (refreshAfterPost) refreshCommentsAfterPost(session);
};
let returnFocusSelector = null,
  returnCell = null;
function openIssue(kind, id) {
  if (commentPosting()) return;
  if ((pending && !loading) || !adapter || !issue(kind, id)) return;
  if (
    $("#details").open &&
    (editMode || composing || commentDirty()) &&
    !confirm("未保存の変更を破棄して別のIssueを開きますか？")
  )
    return;
  if ($("#details").open && commentEntry()) commentEntry().body = "";
  editorSession++;
  composer?.destroy();
  composer = null;
  $("#markdown-editor").replaceChildren();
  editorOutcome = null;
  editorSaved = false;
  editorBusy = false;
  editorPosting = false;
  composing = false;
  detailUnavailable = false;
  editing = { kind, id };
  returnFocusSelector = `[${kind === "PBI" ? "data-pbi" : "data-open"}="${CSS.escape(id)}"]`;
  returnFocus =
    document.querySelector(returnFocusSelector) || document.activeElement;
  returnCell = returnFocus.closest(".task-cell")
    ? {
        lane: returnFocus.closest(".task-cell").dataset.lane,
        column: returnFocus.closest(".task-cell").dataset.status,
      }
    : null;
  fillDetail();
  restoreSave(activeSave());
  setupComments();
  setEdit(false);
  $("#details").showModal();
  $("#markdown-editor").hidden = false;
  $("#detail-body").hidden = !!composer;
  ensureComposer();
  loadComments();
  clearLinkedPrs();
  loadLinkedPrs();
  updateDetailSync();
  $("#close-detail").focus();
}
function closeDetail() {
  if (composing || commentPosting() || commentComposing) return;
  if (
    (editMode || commentDirty()) &&
    !confirm("未保存の変更・コメントを破棄して閉じますか？")
  )
    return;
  const d = $("#details");
  if (d.classList.contains("closing")) return;
  if (commentEntry()) commentEntry().body = "";
  const job = activeSave();
  if (job?.phase === "posting" && job.viewDraft) {
    for (const key of editorFields)
      job.viewDraft[key] = Object.hasOwn(job.queued || {}, key)
        ? job.queued[key]
        : Object.hasOwn(job.patch, key)
          ? job.draft[key]
          : fieldValue(job.baseline, key);
  }
  composerModule?.clearPreview($("#detail-body-view"));
  $("#comments-list")
    .querySelectorAll(".comment-content")
    .forEach((n) => composerModule?.clearPreview(n));
  editorSession++; // Drawer cleanup never cancels an explicitly submitted Issue save.
  commentRefreshQueued = null;
  clearLinkedPrs();
  $("#editor-tools").hidePopover();
  d.classList.add("closing");
  {
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
    const originCell =
      returnCell &&
      document.querySelector(
        `[data-lane="${CSS.escape(returnCell.lane)}"][data-status="${returnCell.column}"]`,
      );
    const fallback =
      originCell?.querySelector(".cell-viewport, [data-open]") ||
      (returnCell &&
        document.querySelector(`[data-pbi="${CSS.escape(returnCell.lane)}"]`));
    revealCard(target);
    (target || fallback || $("#operations")).focus({ preventScroll: true });
  }
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
    more = e.target.closest("[data-cell-step]");
  if (task) openIssue("Task", task.dataset.open || task.dataset.task);
  if (pbi) openIssue("PBI", pbi.dataset.pbi || pbi.dataset.pbiRow);
  if (more) {
    const port = more.closest(".task-cell").querySelector(".cell-viewport");
    stepCell(port, Number(more.dataset.cellStep));
    if (e.detail === 0) focusCellStart(port);
  }
});
$("#board").addEventListener("keydown", (e) => {
  const port = e.target.closest(".task-cell")?.querySelector(".cell-viewport");
  if (!port || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
  if (["PageDown", "PageUp", "Home", "End"].includes(e.key)) {
    e.preventDefault();
    if (e.key === "PageDown" || e.key === "PageUp")
      stepCell(port, e.key === "PageDown" ? 1 : -1);
    if (e.key === "Home" || e.key === "End") {
      port.scrollTop = e.key === "Home" ? 0 : port.scrollHeight;
      rememberCell(port, true);
      updateCellRange(port);
    }
    focusCellStart(port);
  }
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
  if (!c || !canDragTask(issue("Task", c.dataset.task))) {
    e.preventDefault();
    return;
  }
  dragged = c.dataset.task;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", dragged);
  c.classList.add("dragging");
});
let dragScrollFrame = 0,
  dragScrollPort = null,
  dragScrollSpeed = 0;
function stopDragScroll() {
  cancelAnimationFrame(dragScrollFrame);
  dragScrollFrame = 0;
  dragScrollPort = null;
}
function tickDragScroll() {
  if (!dragged || !dragScrollPort?.isConnected) return stopDragScroll();
  dragScrollPort.scrollTop += dragScrollSpeed;
  dragScrollFrame = requestAnimationFrame(tickDragScroll);
}
$("#board").addEventListener("dragover", (e) => {
  const c = e.target.closest("[data-status]"),
    t = issue("Task", dragged);
  if (c && t && c.dataset.lane === t.lane) {
    e.preventDefault();
    document
      .querySelectorAll(".drag-over")
      .forEach((c) => c.classList.remove("drag-over"));
    c.classList.add("drag-over");
    const port = c.querySelector(".cell-viewport");
    const rect = port?.getBoundingClientRect();
    const speed = rect
      ? e.clientY < rect.top + 22
        ? -4
        : e.clientY > rect.bottom - 22
          ? 4
          : 0
      : 0;
    if (speed) {
      dragScrollPort = port;
      dragScrollSpeed = speed;
      if (!dragScrollFrame)
        dragScrollFrame = requestAnimationFrame(tickDragScroll);
    } else stopDragScroll();
  } else stopDragScroll();
});
function clearDrag() {
  stopDragScroll();
  dragged = null;
  if (boardRenderQueued)
    queueMicrotask(() => {
      if (!dragged && boardRenderQueued) render();
    });
  resumeAutoRefresh();
  document
    .querySelectorAll(".drag-over,.dragging")
    .forEach((c) => c.classList.remove("drag-over", "dragging"));
}
$("#board").addEventListener("dragleave", (e) => {
  const c = e.target.closest("[data-status]");
  if (c && !c.contains(e.relatedTarget)) {
    c.classList.remove("drag-over");
    stopDragScroll();
  }
});
$("#board").addEventListener("drop", (e) => {
  e.preventDefault();
  const c = e.target.closest("[data-status]"),
    t = issue("Task", dragged);
  const target =
    c && t && c.dataset.lane === t.lane
      ? { id: t.id, column: c.dataset.status }
      : null;
  clearDrag();
  if (target) void move(target.id, target.column);
});
window.addEventListener("dragend", clearDrag);
window.addEventListener("blur", () => {
  if (dragged) clearDrag();
});
function sizeTitle() {
  const input = $("#detail-title");
  input.style.height = "auto";
  input.style.height = `${input.scrollHeight}px`;
}
function finishTitle(cancel = false, focus = false) {
  if (cancel && titleEditing) $("#detail-title").value = titleBeforeEdit;
  titleEditing = false;
  $("#title-editor").hidden = true;
  $("#detail-heading").closest("h2").hidden = false;
  $("#rename-issue").hidden = false;
  $("#detail-heading").textContent =
    $("#detail-title").value || editorLatest?.title || "";
  updateDirty();
  if (focus) $("#rename-issue").focus();
}
$("#rename-issue").onclick = () => {
  titleBeforeEdit = $("#detail-title").value;
  titleEditing = true;
  $("#title-editor").hidden = false;
  $("#detail-heading").closest("h2").hidden = true;
  $("#rename-issue").hidden = true;
  sizeTitle();
  $("#detail-title").focus();
};
$("#detail-title").addEventListener("keydown", (e) => {
  if (e.isComposing || composing) return;
  if (e.key === "Escape" || (e.key === "Enter" && !e.metaKey && !e.ctrlKey)) {
    e.preventDefault();
    e.stopPropagation();
    finishTitle(e.key === "Escape", true);
  }
});
$("#detail-title").addEventListener("blur", () => {
  if (titleEditing && !composing) finishTitle();
});
$("#detail-title").addEventListener("input", sizeTitle);
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
$("#detail-fields").addEventListener("change", (event) => {
  updateDirty();
  const field = { "detail-assignee": "assignees", "detail-status": "status" }[
    event.target.id
  ];
  if (field) autoSaveField(field);
});
$("#detail-title").addEventListener("input", updateDirty);
let sourceVisible = false;
$("#markdown-source").onclick = () => {
  sourceVisible = !sourceVisible;
  $("#markdown-editor").hidden = false;
  $("#detail-body").hidden = !!composer;
  composer?.source(sourceVisible);
  $("#markdown-source").setAttribute("aria-pressed", String(sourceVisible));
  $("#markdown-source").innerHTML =
    `${sourceVisible ? "ライブ表示へ戻る" : "原文を確認"} <kbd>F8</kbd>`;
  $("#editor-tools").hidePopover();
  $("#editor-options").dataset.tooltip = sourceVisible
    ? "本文の補助操作（原文表示中・F8で戻る）"
    : "本文の補助操作（原文切替: F8）";
  composer?.focus();
};
document.addEventListener("keydown", (event) => {
  if (
    event.key !== "F8" ||
    event.repeat ||
    event.isComposing ||
    composing ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    event.shiftKey ||
    !$("#details").open ||
    $("#details").classList.contains("closing") ||
    !event.target.closest(
      "#markdown-editor, #detail-body, #editor-options, #editor-tools",
    )
  )
    return;
  event.preventDefault();
  $("#markdown-source").click();
});

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
    !$("#details").open ||
    $("#details").classList.contains("closing") ||
    (!editMode && !activeSave()?.retryReady) ||
    composing ||
    editorBusy ||
    editorOutcome ||
    detailUnavailable ||
    Object.keys(editorConflicts).length ||
    (issueSaves.has(editing.id) && !activeSave()?.retryReady)
  )
    return;
  const target = { ...editing },
    source = adapter;
  const baseline = clone(editorLatest),
    draft = clone(editorDraft()),
    patch = {};
  for (const key of editorFields)
    if (!equalField(draft[key], fieldValue(baseline, key)))
      patch[key] = draft[key];
  if (activeSave()?.retryReady && draft.status === "完了")
    patch.status = "完了";
  if (!Object.keys(patch).length) return;
  if (Object.hasOwn(patch, "storyPoints") && !pointsAvailable()) {
    $("#detail-error").textContent =
      "Story pointsの公開状態を確認できません。再取得してから保存してください。";
    $("#detail-error").hidden = false;
    return;
  }
  if (!draft.title.trim()) {
    $("#detail-error").textContent = "タイトルを入力してください。";
    $("#detail-error").hidden = false;
    return;
  }
  void startIssueSave(target, baseline, draft, patch, source);
};
function autoSaveField(key) {
  if (
    !editing ||
    !$("#details").open ||
    composing ||
    detailUnavailable ||
    editorOutcome ||
    Object.keys(editorConflicts).length
  )
    return;
  if (key === "storyPoints" && !pointsAvailable()) return;
  if (key === "estimateHours" && !hoursAvailable()) return;
  const draft = clone(editorDraft()),
    job = activeSave();
  if (job) {
    if (job.phase !== "posting") return;
    // Even a return to the original value is a new intent after a sent change.
    job.queued ||= {};
    job.queued[key] = draft[key];
    job.viewDraft = draft;
    updateDirty();
    return;
  }
  if (equalField(draft[key], fieldValue(editorLatest, key))) return;
  void startIssueSave(
    { ...editing },
    clone(editorLatest),
    draft,
    { [key]: draft[key] },
    adapter,
    true,
  );
}
async function startIssueSave(
  target,
  baseline,
  draft,
  patch,
  source,
  automatic = false,
  dragOrigin = false,
) {
  const job = {
    target,
    baseline,
    draft,
    patch,
    automatic,
    ...(dragOrigin ? { optimisticStatus: patch.status } : {}),
    viewBaseline: clone(
      editing?.id === target.id && $("#details").open
        ? editorBaseline
        : baseline,
    ),
    phase: "posting",
    closeIntent: patch.status === "完了",
    requestId: crypto.randomUUID(),
  };
  mutationEpoch++;
  issueSaves.set(target.id, job);
  if (dragOrigin) {
    const current = issue(target.kind, target.id);
    if (current) current.status = job.optimisticStatus;
  }
  if (editing?.id === target.id && $("#details").open) {
    editorPosting = true;
    editorBusy = true;
    updateDirty();
  }
  renderAfterAsyncChange();
  const isCurrent = () =>
    adapter === source &&
    $("#details").open &&
    !$("#details").classList.contains("closing") &&
    editing?.id === target.id;
  try {
    if (automatic) {
      // Short local batching, not network retry. Sent side effects are never undone.
      await new Promise((resolve) => setTimeout(resolve, 200));
      if (issueSaves.get(target.id) !== job || adapter !== source) return;
      Object.assign(patch, job.queued || {});
      Object.assign(draft, patch);
      job.queued = null;
      for (const key of Object.keys(patch))
        if (equalField(patch[key], fieldValue(baseline, key)))
          delete patch[key];
      job.closeIntent = patch.status === "完了";
      if (!Object.keys(patch).length) {
        issueSaves.delete(target.id);
        if (isCurrent()) updateDirty();
        return;
      }
    }
    // The server performs uncached preflight and canonical readback; do not fetch
    // the entire board first or tie this operation to the drawer session.
    if (
      Object.hasOwn(patch, "storyPoints") &&
      !Object.hasOwn(pointsValues, baseline.number)
    )
      throw new Error(
        "Story pointsの公開状態を確認できません。再取得してください。",
      );
    if (
      Object.hasOwn(patch, "estimateHours") &&
      (state.scope?.estimateHoursField !== true ||
        !Object.hasOwn(issue(target.kind, target.id) || {}, "estimateHours"))
    )
      throw new Error(
        "見積時間の公開状態を確認できません。再取得してください。",
      );
    const hourReadEpoch = hoursEpoch;
    const pointReadEpoch = pointsEpoch;
    const result = await source.saveIssue({
      kind: target.kind,
      id: target.id,
      patch,
      baseline,
      expectedRevision: baseline.revision,
      expectedStatus: baseline.status ?? null,
      requestId: job.requestId,
    });
    if (issueSaves.get(target.id) !== job || adapter !== source) return;
    if (!result || result.id !== target.id)
      throw Object.assign(new Error("保存結果を確認できません。"), {
        ambiguous: true,
      });
    confirmedSaveEpoch++;
    if (hourReadEpoch !== hoursEpoch) delete result.estimateHours;
    if (Object.hasOwn(result, "storyPoints"))
      pointsGenerations.set(
        result.number,
        (pointsGenerations.get(result.number) || 0) + 1,
      );
    const current = issue(target.kind, target.id);
    if (current) Object.assign(current, result);
    if (dragOrigin) announce("接続先の保存結果を確認しました");
    if (Object.hasOwn(patch, "estimateHours") || Object.hasOwn(patch, "status"))
      burnPanel?.refresh();
    if (
      Object.hasOwn(result, "storyPoints") &&
      pointReadEpoch === pointsEpoch
    ) {
      pointsValues[result.number] = result.storyPoints;
      if (state.storyPoints?.values)
        state.storyPoints.values[result.number] = result.storyPoints;
      pointsVerifiedAt.set(result.number, Date.now());
    }
    issueSaves.delete(target.id);
    if (isCurrent()) {
      for (const key of Object.keys(patch)) setBaseField(key, draft[key]);
      editorPosting = false;
      editorBusy = false;
      editorOutcome = null;
      reconcileEditor(result);
      editorSaved = !editMode;
      $("#detail-error").hidden = true;
    }
    const nextPatch = Object.fromEntries(
      Object.entries(job.queued || {}).filter(
        ([key, value]) => !equalField(value, fieldValue(result, key)),
      ),
    );
    const queuedConflict = Object.keys(nextPatch).some(
      (key) =>
        !Object.hasOwn(patch, key) &&
        Object.hasOwn(result, key) &&
        !equalField(fieldValue(result, key), fieldValue(baseline, key)),
    );
    if (queuedConflict) {
      job.phase = "failed";
      job.draft = clone(job.viewDraft || draft);
      Object.assign(job.draft, nextPatch);
      job.patch = nextPatch;
      job.queued = null;
      job.closeIntent = false; // The pending choice has not been sent.
      job.outcome = { code: "CONFLICT", uncertain: false, durable: false };
      job.error =
        "先の保存は完了しましたが、次の選択はGitHubの変更と競合しています。下書きを確認してください。";
      issueSaves.set(target.id, job);
      if (isCurrent()) {
        editorOutcome = job.outcome;
        $("#detail-error").textContent = job.error;
        $("#detail-error").hidden = false;
      }
    } else if (Object.keys(nextPatch).length) {
      const nextDraft = isCurrent()
        ? clone(editorDraft())
        : clone(job.viewDraft || draft);
      Object.assign(nextDraft, nextPatch);
      // Only acknowledged success releases the next explicit field selection.
      const nextBaseline = clone(result);
      if (
        !Object.hasOwn(nextBaseline, "estimateHours") &&
        Object.hasOwn(baseline, "estimateHours")
      )
        nextBaseline.estimateHours = baseline.estimateHours;
      // A status/body response need not contain the separately verified field.
      // Keep its prior expected value; the server rejects any concurrent change.
      if (
        !Object.hasOwn(nextBaseline, "storyPoints") &&
        Object.hasOwn(baseline, "storyPoints")
      )
        nextBaseline.storyPoints = baseline.storyPoints;
      void startIssueSave(
        target,
        nextBaseline,
        nextDraft,
        nextPatch,
        source,
        true,
      );
    } else {
      // Canonical mutation readback confirms the edited point; don't refetch every PBI.
      void refreshBoard(undefined, { silent: true, pointsConfirmed: true });
    }
  } catch (error) {
    if (issueSaves.get(target.id) !== job || adapter !== source) return;
    if (Object.hasOwn(job, "optimisticStatus")) {
      const current = issue(target.kind, target.id);
      if (current && current.status === job.optimisticStatus)
        current.status = baseline.status;
    }
    job.phase = "failed";
    job.draft = clone(job.viewDraft || draft);
    Object.assign(job.draft, job.queued || {});
    job.queued = null;
    job.outcome = {
      durable: error.serverError === "mutation_outcome_unresolved",
      uncertain: !!error.ambiguous,
      code: error.serverError || error.code,
    };
    job.error =
      error.message +
      (job.outcome.durable
        ? " 管理者による保存結果の確認が必要です。"
        : " 下書きを保持しています。自動再送はしません。");
    if (isCurrent()) {
      // Keep edits typed after submission as well as the original intent.
      job.draft = clone(editorDraft());
      editorOutcome = job.outcome;
      editorPosting = false;
      editorBusy = false;
      $("#detail-error").textContent = job.error;
      $("#detail-error").hidden = false;
      updateDirty();
    }
    if (error.code === "scope_not_public") stopPrivateScope(error.message);
    if (
      error.serverError === "estimate_hours_not_public" ||
      error.code === "estimate_hours_not_public"
    )
      invalidateHours();
    if (dragOrigin && source === adapter)
      announce(
        `${issueLabel(baseline)} の保存結果を確認してください。自動再送はしません。`,
      );
  } finally {
    if (source === adapter) {
      if (isCurrent() && issueSaves.get(target.id)?.phase !== "posting") {
        editorPosting = false;
        editorBusy = false;
        syncEditorControls();
      }
      showSaveProblems();
      renderAfterAsyncChange();
      resumeAutoRefresh();
    }
  }
}
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
function burnScopeKey(board) {
  return JSON.stringify([
    board.scope?.viewFilter,
    board.lanes.map((p) => [p.id, p.milestone?.number]).sort(),
    board.tasks
      .map((t) => [
        t.id,
        t.parentId,
        t.lane,
        t.status,
        t.state,
        t.stateReason,
        t.estimateHours,
        t.milestone?.number,
      ])
      .sort(),
  ]);
}
function refreshBoard(options, flags = {}) {
  if (refreshFlight) return refreshFlight;
  refreshFlight = performRefresh(options, flags).finally(() => {
    refreshFlight = null;
    resumeAutoRefresh();
  });
  return refreshFlight;
}
async function performRefresh(
  options,
  { silent = false, pointsConfirmed = false, forceCurrentSprint = false } = {},
) {
  if (!adapter || pending || pickerDraft) return false;
  if (dragged || hasOptimisticDragSave()) {
    autoRefreshRequested = true;
    return false;
  }
  const source = adapter;
  autoRefreshRequested = false;
  scopeSwitchPending = !!(options && Object.hasOwn(options, "milestone"));
  loading = true;
  $("#refresh").disabled = true;
  $("#milestone-filter").disabled = true;

  updateDetailSync();
  render();
  try {
    const readEpoch = confirmedSaveEpoch;
    const writeEpoch = mutationEpoch;
    const hoursReadEpoch = hoursEpoch;
    // A discarded scope-switch response must not change the next default read.
    const next = await source.load(options || { milestone: selectedMilestone });
    if (source !== adapter) return false;
    if (!valid(next)) throw new Error("無効なIssueデータです");
    if (next.scope?.estimateHoursField === false) invalidateHours();
    if (hoursReadEpoch !== hoursEpoch) {
      for (const task of next.tasks || []) delete task.estimateHours;
      if (next.scope) next.scope.estimateHoursField = false;
    }
    if (
      readEpoch !== confirmedSaveEpoch ||
      writeEpoch !== mutationEpoch ||
      hasOptimisticDragSave() ||
      dragged
    ) {
      const points = next.storyPoints?.values;
      if (
        next.scope?.storyPointsField === false ||
        (points &&
          typeof points === "object" &&
          !Array.isArray(points) &&
          !Object.keys(points).length)
      ) {
        // Discard the stale board, but never discard confirmed field revocation.
        pointsEpoch++;
        pointsFlight = null;
        pointsValues = {};
        pointsVerifiedAt.clear();
        if (state.storyPoints) state.storyPoints = { values: {} };
        if (state.scope && Object.hasOwn(state.scope, "storyPointsField"))
          state.scope.storyPointsField = false;
        paintStoryPoints();
      }
      autoRefreshRequested = true;
      return false;
    }
    if (state.scope?.viewFilter !== next.scope?.viewFilter)
      burnPanel?.invalidate();
    const previousBurnScope = burnPanel?.visible ? burnScopeKey(state) : null;
    state = clone(next);
    if (previousBurnScope !== null && previousBurnScope !== burnScopeKey(state))
      burnPanel.refresh();
    if (pointsConfirmed) pointsSkipSnapshot = state;
    if (options && Object.hasOwn(options, "milestone"))
      selectedMilestone = String(options.milestone ?? "");
    markFresh();
    queueMicrotask(() => void refreshCurrentSprint(forceCurrentSprint));
    reconcileDetail();
    if ($("#details").open) loadLinkedPrs();
    return true;
  } catch (e) {
    if (source !== adapter) return false;
    lastReadError = e.message;
    stale = true;
    if (e.code === "scope_not_public") {
      stopPrivateScope(e.message);
    } else if (e.httpStatus === 403 || e.code === "estimate_hours_not_public") {
      invalidateHours();
    }
    if (!silent) announce(`取得できませんでした：${e.message}`);
    return false;
  } finally {
    if (source === adapter) {
      loading = false;
      scopeSwitchPending = false;
      $("#refresh").disabled = false;
      $("#milestone-filter").disabled = false;
      syncEditorControls();
      updateDetailSync();
      renderAfterAsyncChange();
      resumeAutoRefresh();
    }
  }
}
$("#refresh").onclick = () =>
  adapter
    ? refreshBoard(undefined, { forceCurrentSprint: true })
    : window.Whiteboard.connectApi().catch((e) => announce(e.message));
$("#recover-edit").onclick = async () => {
  if (editorBusy || editorOutcome?.durable) return;
  const session = editorSession;
  editorBusy = true;
  syncEditorControls();
  const ok = await refreshBoard(undefined, { silent: true });
  if (session !== editorSession) return;
  if (ok && editorOutcome && !detailUnavailable) {
    const job = activeSave();
    if (job?.closeIntent && editorOutcome.uncertain) {
      $("#detail-error").textContent =
        "完了処理の結果が不明です。再送せず、管理者による保存結果の確認が必要です。";
      $("#detail-error").hidden = false;
      editorBusy = false;
      syncEditorControls();
      return;
    }
    if (job?.closeIntent && editorLatest.state !== "CLOSED") {
      job.baseline = clone(editorLatest);
      job.draft = clone(editorDraft());
      job.retryReady = true;
      job.outcome = null;
      job.error =
        "Statusの変更後、Issueを閉じる処理が完了していません。確認後に「完了処理を再試行」を押してください。";
      editorOutcome = null;
      $("#detail-error").textContent = job.error;
      $("#detail-error").hidden = false;
      editorBusy = false;
      showSaveProblems();
      syncEditorControls();
      return;
    }
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
      issueSaves.delete(editing.id);
      showSaveProblems();
      renderAfterAsyncChange();
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
let burnPanel = null,
  burnLoading = null,
  burnIntent = 0,
  burnHoverGeneration = 0,
  burnHoverBlocked = false,
  burnTimer = null;
async function openBurndown(hoverGeneration = null) {
  clearTimeout(burnTimer);
  burnTimer = null;
  if (
    (hoverGeneration !== null && burnLoading) ||
    dragged ||
    document.querySelector("dialog[open]") ||
    $("#burndown-open").hidden
  )
    return;
  const intent = ++burnIntent;
  try {
    if (!burnPanel) {
      burnLoading ||= import("./burndown.js")
        .then((module) => {
          burnPanel = module.createBurndown({
            onPrivate: () => stopPrivateScope("公開範囲を確認できません。"),
            onFieldPrivate: invalidateHours,
            onClose: () => {
              clearTimeout(burnTimer);
              burnTimer = null;
              burnHoverGeneration++;
              burnHoverBlocked = true;
            },
          });
        })
        .finally(() => {
          burnLoading = null;
        });
      await burnLoading;
    }
    if (
      intent === burnIntent &&
      (hoverGeneration === null || hoverGeneration === burnHoverGeneration) &&
      !dragged &&
      !document.querySelector("dialog[open]") &&
      !$("#burndown-open").hidden
    )
      burnPanel.open(selectedMilestone);
  } catch {
    if (
      intent === burnIntent &&
      (hoverGeneration === null || hoverGeneration === burnHoverGeneration)
    )
      announce("バーンダウンを開けませんでした。もう一度お試しください。");
  }
}
$("#burndown-open").onclick = () => openBurndown();
document.addEventListener("pointermove", (event) => {
  const near = event.clientX >= innerWidth * 0.965;
  // Toolbar actions at the right edge are not a request to open the chart.
  // Cancel a pending board-edge hover as soon as the pointer enters a control.
  if (
    !near ||
    $("#chrome").contains(event.target) ||
    $("#operations").contains(event.target)
  ) {
    burnHoverGeneration++;
    burnHoverBlocked = false;
    clearTimeout(burnTimer);
    burnTimer = null;
    return;
  }
  if (
    dragged ||
    event.buttons ||
    burnHoverBlocked ||
    document.querySelector("dialog[open]") ||
    $("#burndown-open").hidden
  )
    return;
  if (!burnTimer)
    burnTimer = setTimeout(() => {
      burnTimer = null;
      openBurndown(burnHoverGeneration);
    }, 180);
});
document.addEventListener("dragstart", () => {
  burnHoverGeneration++;
  clearTimeout(burnTimer);
  burnTimer = null;
});
// Reveal only after intentional movement at the top edge, not a stationary
// pointer at (0,0) during initial layout or a hidden overlay bounding box.
document.addEventListener("pointermove", (event) => {
  if (document.querySelector("dialog[open]")) return;
  const header = $(".board-head").getBoundingClientRect();
  const inBand =
    event.clientY <= header.top + header.height / 2 &&
    event.clientX >= header.left &&
    event.clientX <= header.right;
  const inToolbar = $("#chrome").contains(event.target);
  if (!inBand && !inToolbar) {
    controlsHoverBlocked = false;
    controlsHovered = false;
    syncControls();
    return;
  }
  if (event.clientX < 12 || (!event.movementX && !event.movementY)) return;
  if (inBand && !controlsHoverBlocked) {
    controlsHovered = true;
    syncControls();
  }
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
$("#highlight-unestimated").onclick = () => {
  const button = $("#highlight-unestimated");
  if (button.hidden || button.disabled || dragged) return;
  highlightUnestimated = !highlightUnestimated;
  unestimatedScope = highlightUnestimated ? unestimatedScopeKey() : null;
  paintUnestimatedHighlights();
  if (highlightUnestimated && confirmedNoUnestimated())
    announce("未見積もりのタスクは0件です");
};
document.addEventListener("keydown", (e) => {
  if (
    e.key.toLowerCase() !== "u" ||
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.shiftKey ||
    e.isComposing ||
    composing ||
    commentComposing ||
    dragged ||
    document.querySelector("dialog[open]")
  )
    return;
  const writing = (node) =>
    node?.closest?.("input,textarea,select,[contenteditable],.cm-editor");
  if (writing(e.target) || writing(document.activeElement)) return;
  const button = $("#highlight-unestimated");
  if (button.hidden || button.disabled) return;
  e.preventDefault();
  button.click();
});
document.addEventListener("keydown", (e) => {
  if (
    e.key.toLowerCase() !== "f" ||
    e.repeat ||
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    e.shiftKey ||
    e.isComposing ||
    composing ||
    commentComposing ||
    document.querySelector("dialog[open]")
  )
    return;
  const writing = (node) =>
    node?.closest?.("input,textarea,select,[contenteditable],.cm-editor");
  if (writing(e.target) || writing(document.activeElement)) return;
  e.preventDefault();
  $("#fullscreen").click();
});
document.addEventListener("fullscreenchange", () => {
  $("#fullscreen").setAttribute(
    "aria-pressed",
    String(!!document.fullscreenElement),
  );
  $("#fullscreen").title = document.fullscreenElement
    ? "全画面を終了（F）"
    : "全画面（F）";
  render();
});
$("#about").onclick = () => {
  $("#about-mode").hidden = !!adapter;
  $("#about-mode").textContent = "サンプル表示です。GitHubには反映されません。";
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
    if (
      pending ||
      loading ||
      hasOptimisticDragSave() ||
      pickerDraft ||
      ($("#details").open && editMode)
    )
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
    const hoursReadEpoch = hoursEpoch;
    try {
      snapshot = await next.load();
      if (hoursReadEpoch !== hoursEpoch) {
        for (const task of snapshot.tasks || []) delete task.estimateHours;
        if (snapshot.scope) snapshot.scope.estimateHoursField = false;
      }
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
    void refreshCurrentSprint();
    if (snapshotPending) autoRefresh();
  },
  applySnapshot(snapshot) {
    if (
      pending ||
      loading ||
      hasOptimisticDragSave() ||
      pickerDraft ||
      ($("#details").open && editMode)
    )
      return false;
    if (!valid(snapshot)) throw new Error("無効なIssueデータです");
    state = clone(snapshot);
    markFresh();
    render();
    void refreshCurrentSprint();
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
    refreshFlight ||
    dragged ||
    hasOptimisticDragSave() ||
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
  if (
    issueSaves.size > 0 ||
    editMode ||
    composing ||
    commentDirty() ||
    commentPosting() ||
    (pending && !loading)
  ) {
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

// Conventional icons retain explicit names and keyboard focus, without permanent prose.
for (const [id, label, icon] of [
  ["refresh", "最新を取得", "sync"],
  ["fullscreen", "全画面切替（F）", "screen-full"],
  ["theme", "配色切替", "moon"],
  ["about", "ヘルプ", "question"],
  ["comments-refresh", "コメントを更新", "sync"],
  ["editor-options", "本文の補助操作（原文切替: F8）", "kebab-horizontal"],
  ["rename-issue", "タイトルを変更", "pencil"],
]) {
  const b = document.getElementById(id);
  if (!b) continue;
  b.innerHTML = iconMarkup(icon);
  b.dataset.tooltip = label;
  b.removeAttribute("title");
  b.setAttribute("aria-label", label);
  b.classList.add("compact-icon");
}
$("#choose-pbis").dataset.tooltip = "表示するPBIを選択（最大6件）";
$("#choose-pbis").setAttribute("aria-label", "表示するPBIを選択");
