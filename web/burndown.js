import {
  createSchoolCalendar,
  weekdayProposal,
  todayJst,
} from "./school-calendar.js";

const ns = "http://www.w3.org/2000/svg";
const node = (tag, text, className) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (className) n.className = className;
  return n;
};
const svgNode = (tag, attributes, text) => {
  const n = document.createElementNS(ns, tag);
  for (const [key, value] of Object.entries(attributes))
    n.setAttribute(key, String(value));
  if (text !== undefined) n.textContent = text;
  return n;
};
const hours = (value) =>
  new Intl.NumberFormat("ja-JP", { maximumFractionDigits: 2 }).format(value);
const displayFor = (data) =>
  data.display?.mode === "historical"
    ? data.display
    : { mode: "live", summary: data.current, observedAt: data.observedAt };
const observedLabel = (display) =>
  display.observedAt
    ? `${display.mode === "historical" ? "最終記録" : "観測"}: ${new Date(display.observedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`
    : "記録なし";
export function chart(data) {
  const root = node("section", undefined, "burn-chart");
  const display = displayFor(data),
    summary = display.summary,
    historical = display.mode === "historical",
    rebased = data.rebase?.policy === "latest-scope-observed-completion-v1",
    projected = new Map(
      (rebased ? data.rebase.observations || [] : []).map((p) => [p.at, p]),
    );
  const daily = new Map();
  for (const observation of data.observations)
    if (
      Date.parse(observation.at) <= Date.parse(display.observedAt) &&
      (!daily.has(observation.day) ||
        Date.parse(daily.get(observation.day).at) < Date.parse(observation.at))
    )
      daily.set(observation.day, {
        ...observation,
        estimated: summary?.estimated ?? 0,
        unestimated: summary?.unestimated ?? 0,
        remainingHours: projected.get(observation.at)?.remainingHours ?? null,
        assumedIncompleteTasks:
          projected.get(observation.at)?.assumedIncompleteTasks ?? 0,
      });
  const points = [...daily.values()].sort((a, b) => a.day.localeCompare(b.day));
  if (!summary?.estimated && !points.some((p) => p.estimated)) {
    root.append(
      node(
        "p",
        !summary
          ? "記録なし"
          : summary.total
            ? `見積時間が未設定です（${summary.unestimated}件）。`
            : "このスプリントのProject内作業Issueはありません。",
        "burn-empty",
      ),
    );
    return root;
  }
  const schoolDays = [...(data.schedule?.schoolDays || [])].sort();
  // 学校日が軸の正本。範囲外の履歴は保存したまま描画だけ除外する。
  const visiblePoints = schoolDays.length
    ? points.filter(
        (point) => point.day >= schoolDays[0] && point.day <= schoolDays.at(-1),
      )
    : points;
  const days = [
    ...new Set([...schoolDays, ...visiblePoints.map((p) => p.day)]),
  ].sort();
  const ticks = schoolDays.length ? schoolDays : days;
  if (!days.length) {
    root.append(node("p", "記録なし", "burn-empty"));
    return root;
  }
  const ideal =
    schoolDays.length >= 2 && summary?.estimated
      ? summary.estimatedHours
      : null;
  const svg = svgNode("svg", {
    viewBox: "0 0 720 380",
    role: "img",
    "aria-label": `学校日を等間隔にした残り見積時間。学校日間の観測は日付の比率で配置。青は${historical ? "最終記録の" : "現在の"}全体見積から計算した理想、赤は${rebased ? "同じ全体見積から観測時の完了分を引いた再計算。中空点は開始基準で実測ではありません" : "再計算データ未取得"}。単位は時間。`,
  });
  const max = Math.max(
    1,
    ideal || 0,
    ...visiblePoints.map((p) => p.remainingHours),
  );
  const x = (day) => {
    if (ticks.length === 1) return 60;
    let index = ticks.indexOf(day);
    if (index < 0) {
      const next = ticks.findIndex((tick) => tick > day);
      // day は保存済みJST暦日。UTC midnightは日数差の計算だけに使い、
      // 観測時刻や端末のtimezoneで日付を再解釈しない。
      const time = (date) => Date.parse(`${date}T00:00:00Z`);
      index =
        next -
        1 +
        (time(day) - time(ticks[next - 1])) /
          (time(ticks[next]) - time(ticks[next - 1]));
    }
    return 60 + (index / (ticks.length - 1)) * 620;
  };
  const y = (value) => 310 - (value / max) * 260;
  for (let i = 0; i <= 4; i++) {
    const value = (max * i) / 4;
    svg.append(
      svgNode("line", {
        x1: 60,
        x2: 680,
        y1: y(value),
        y2: y(value),
        class: "burn-grid",
      }),
      svgNode(
        "text",
        { x: 50, y: y(value) + 5, "text-anchor": "end", class: "burn-axis" },
        hours(value),
      ),
    );
  }
  svg.append(svgNode("text", { x: 12, y: 24, class: "burn-axis" }, "h"));
  if (ideal !== null) {
    // 最新の全体見積を最初から引き直す。追加見積の日にも折れ曲げない。
    const idealPath = `M ${x(schoolDays[0])} ${y(ideal)} L ${x(schoolDays.at(-1))} ${y(0)}`;
    svg.append(
      svgNode("path", {
        d: idealPath,
        class: "burn-ideal",
        fill: "none",
      }),
    );
  }
  const baseline =
    rebased &&
    ideal !== null &&
    schoolDays[0] <= todayJst(new Date(display.observedAt).getTime());
  let path = baseline ? `M ${x(schoolDays[0])} ${y(ideal)}` : "",
    previous = null;
  let marker;
  const pointMarkers = [];
  if (baseline) {
    const label = `${schoolDays[0]}: 開始基準 ${hours(ideal)}h（全体見積・実測ではありません）`;
    marker = svgNode("circle", {
      cx: x(schoolDays[0]),
      cy: y(ideal),
      r: 6,
      class: "burn-baseline",
      "aria-label": label,
    });
    marker.append(svgNode("title", {}, label));
  }
  for (const point of visiblePoints) {
    if (!point.estimated || !Number.isFinite(point.remainingHours)) {
      previous = null;
      continue;
    }
    const px = x(point.day),
      py = y(point.remainingHours);
    const adjacent =
      (previous &&
        days.indexOf(point.day) === days.indexOf(previous.day) + 1) ||
      (baseline && point === visiblePoints[0] && point.day === schoolDays[0]);
    path += adjacent ? ` L ${px} ${py}` : ` M ${px} ${py}`;
    previous = point;
    const observationLabel = `${point.day}: ${hours(point.remainingHours)}h${rebased ? "（最新見積で再計算）" : ""} / 未見積${point.unestimated}件 / ${schoolDays.includes(point.day) ? "学校日の観測" : "学校日外の観測"} / ${new Date(point.at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`;
    const circle = svgNode("circle", {
      "aria-label": observationLabel,
      cx: px,
      cy: py,
      r: 4,
      class: "burn-point",
    });
    circle.append(svgNode("title", {}, observationLabel));
    pointMarkers.push(circle);
  }
  svg.append(svgNode("path", { d: path, class: "burn-actual", fill: "none" }));
  if (marker) svg.append(marker);
  svg.append(...pointMarkers);
  const stride = Math.max(1, Math.ceil(ticks.length / 10));
  ticks.forEach((day, i) => {
    if (i % stride === 0 || i === ticks.length - 1) {
      const label = `${day} ${schoolDays.includes(day) ? "学校日" : "学校日外の観測日"}`;
      const tick = svgNode(
        "text",
        {
          x: x(day),
          y: 340,
          "text-anchor": "middle",
          class: "burn-axis",
          "aria-label": label,
        },
        day.slice(5).replace("-", "/"),
      );
      tick.append(svgNode("title", {}, label));
      svg.append(tick);
    }
  });
  root.append(svg);
  const legend = node("div", undefined, "burn-legend");
  if (ideal !== null)
    legend.append(
      node(
        "span",
        historical ? "理想（最終記録の全体見積）" : "理想（現在の全体見積）",
        "burn-ideal-label",
      ),
    );
  legend.append(node("span", "実際（最新見積で再計算）", "burn-actual-label"));
  root.append(legend);
  if (!rebased)
    root.append(
      node(
        "p",
        "再計算データを取得できません。最新を取得してください。",
        "burn-note",
      ),
    );
  if (baseline)
    root.append(
      node(
        "p",
        "中空点は全体見積の開始基準（実測ではありません）。",
        "burn-note",
      ),
    );
  if (rebased && visiblePoints.some((p) => !Number.isFinite(p.remainingHours)))
    root.append(
      node("p", "完了状況の記録が不足する日は空白です。", "burn-note"),
    );
  if (visiblePoints.some((p) => p.assumedIncompleteTasks > 0))
    root.append(
      node(
        "p",
        "当時の記録にない現在のIssueは未完了として再計算しています。",
        "burn-note",
      ),
    );
  if (!visiblePoints.length) root.append(node("p", "記録なし", "burn-note"));
  return root;
}
export function createBurndown({ onPrivate, onFieldPrivate, onClose }) {
  const dialog = node("dialog", undefined, "burn-panel");
  dialog.id = "burndown-panel";
  dialog.setAttribute("aria-labelledby", "burndown-heading");
  const top = node("div", undefined, "burn-top"),
    heading = node("h2", "バーンダウン"),
    actions = node("div", undefined, "burn-top-actions"),
    settingsToggle = node("button", undefined, "burn-settings-toggle"),
    close = node("button", "×", "icon-button");
  heading.id = "burndown-heading";
  close.type = "button";
  close.setAttribute("aria-label", "バーンダウンを閉じる");
  settingsToggle.id = "burn-settings-toggle";
  settingsToggle.type = "button";
  settingsToggle.setAttribute("aria-label", "学校日程");
  settingsToggle.setAttribute("aria-haspopup", "dialog");
  settingsToggle.setAttribute("aria-expanded", "false");
  settingsToggle.setAttribute("aria-controls", "burn-settings-popover");
  settingsToggle.hidden = true;
  if (window.BoardIcons?.calendar)
    settingsToggle.innerHTML = window.BoardIcons.calendar;
  settingsToggle.append(node("span", "学校日程"));
  actions.append(settingsToggle, close);
  top.append(heading, actions);
  const select = node("select");
  select.setAttribute("aria-label", "バーンダウンのスプリント");
  const content = node("div", undefined, "burn-content"),
    notice = node("p", undefined, "burn-notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const settings = node("section", undefined, "burn-settings"),
    settingsTop = node("div", undefined, "burn-settings-top"),
    settingsLabel = node("h3", "学校日程"),
    settingsClose = node("button", "×", "icon-button"),
    form = node("form"),
    proposal = node("p", undefined, "burn-note burn-calendar-proposal"),
    save = node("button", "日程を保存", "burn-settings-save"),
    error = node("p", undefined, "burn-settings-error");
  settings.id = "burn-settings-popover";
  settings.hidden = true;
  settings.setAttribute("role", "dialog");
  settings.setAttribute("aria-labelledby", "burn-settings-heading");
  settingsLabel.id = "burn-settings-heading";
  settingsClose.type = "button";
  settingsClose.setAttribute("aria-label", "学校日程を閉じる");
  settingsTop.append(settingsLabel, settingsClose);
  const calendar = createSchoolCalendar({
    onChange(days) {
      const draft = activeDraft();
      if (!draft) return;
      draft.days = days;
      draft.dirty = true;
      draft.proposal = false;
      draft.error = null;
      renderSettings(currentData);
    },
  });
  save.type = "submit";
  error.setAttribute("role", "alert");
  error.hidden = true;
  form.append(calendar.element, proposal, save, error);
  settings.append(settingsTop, form);
  top.append(settings);
  dialog.append(top, select, content, notice);
  document.body.append(dialog);
  const cache = new Map(),
    scheduleDrafts = new Map(),
    verified = new Map(),
    attempted = new Map();
  let defaultMilestone = null,
    scope = null,
    currentData = null,
    controller,
    generation = 0,
    sourceGeneration = 0,
    origin,
    selected = null,
    loading = false,
    refreshQueued = false,
    wakeQueued = null;
  const key = () => (selected === null ? defaultMilestone : selected);
  function closeSettings(restoreFocus = false) {
    settings.hidden = true;
    settingsToggle.setAttribute("aria-expanded", "false");
    if (restoreFocus && dialog.open && !settingsToggle.hidden)
      settingsToggle.focus({ preventScroll: true });
  }
  const hide = () => {
    wakeQueued = null;
    if (!dialog.open) return;
    closeSettings();
    generation++;
    refreshQueued = false;
    dialog.close();
    content.replaceChildren();
    notice.hidden = true;
    origin?.focus?.({ preventScroll: true });
    onClose();
  };
  const invalidate = () => {
    sourceGeneration++;
    controller?.abort();
    verified.clear();
    attempted.clear();
    cache.clear();
    scheduleDrafts.clear();
    defaultMilestone = null;
    selected = null;
    select.replaceChildren();
    delete select.dataset.options;
    content.replaceChildren();
    currentData = null;
    scope = null;
    generation++;
    calendar.setState({ days: [], month: todayJst().slice(0, 7) });
    delete form.dataset.milestone;
    delete form.dataset.revision;
    settingsToggle.hidden = true;
    hide();
  };
  close.onclick = hide;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    if (!settings.hidden) closeSettings(true);
    else hide();
  });
  settingsClose.onclick = () => closeSettings(true);
  dialog.addEventListener("pointerdown", (event) => {
    if (
      !settings.hidden &&
      !settings.contains(event.target) &&
      !settingsToggle.contains(event.target)
    )
      closeSettings();
  });
  dialog.addEventListener("focusin", (event) => {
    if (
      !settings.hidden &&
      !settings.contains(event.target) &&
      !settingsToggle.contains(event.target)
    )
      closeSettings();
  });
  dialog.onclick = (e) => {
    if (e.target === dialog) {
      const r = dialog.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        hide();
    }
  };
  function draftFor(data) {
    let draft = scheduleDrafts.get(data.milestone);
    if (!draft) {
      draft = {
        days: [],
        revision: "0",
        dirty: false,
        saving: false,
        error: null,
        initialized: false,
        proposal: false,
        month: null,
      };
      scheduleDrafts.set(data.milestone, draft);
    }
    if (!draft.dirty && !draft.saving) {
      draft.days = [...(data.schedule?.schoolDays || [])];
      draft.revision = data.schedule?.revision || "0";
    }
    return draft;
  }
  const activeDraft = () =>
    currentData && form.dataset.milestone === String(currentData.milestone)
      ? scheduleDrafts.get(currentData.milestone)
      : null;
  function renderSettings(data) {
    const previous = scheduleDrafts.get(Number(form.dataset.milestone));
    if (previous) previous.month = calendar.month;
    const changed = form.dataset.milestone !== String(data.milestone);
    const draft = draftFor(data);
    settingsToggle.hidden = !data.milestone;
    if (!data.milestone) closeSettings();
    calendar.setState({
      days: draft.days,
      ...(changed
        ? { month: draft.month || (draft.days[0] || todayJst()).slice(0, 7) }
        : {}),
    });
    proposal.hidden = !draft.proposal;
    proposal.textContent = draft.proposal ? "平日を仮選択中（未保存）" : "";
    form.dataset.milestone = String(data.milestone);
    form.dataset.revision = draft.revision;
    save.disabled = draft.saving;
    error.hidden = !draft.error;
    if (draft.error) {
      error.replaceChildren(node("span", draft.error));
      const reset = node("button", "最新の日程に戻す");
      reset.type = "button";
      reset.onclick = () => {
        if (activeDraft() !== draft) return;
        draft.dirty = false;
        draft.proposal = false;
        draft.error = null;
        renderSettings(currentData);
        void load();
      };
      error.append(reset);
    }
  }
  settingsToggle.onclick = () => {
    if (!settings.hidden) {
      closeSettings(true);
      return;
    }
    if (!currentData) return;
    const draft = activeDraft();
    if (!draft) return;
    if (
      !draft.initialized &&
      !draft.dirty &&
      !draft.saving &&
      !draft.days.length &&
      currentData.schedule?.revision === "0"
    ) {
      const due = currentData.milestones.find(
        (m) => m.number === currentData.milestone,
      )?.dueOn;
      const days = weekdayProposal(due);
      if (days.length) {
        draft.days = days;
        draft.dirty = true;
        draft.proposal = true;
      }
    }
    draft.initialized = true;
    settings.hidden = false;
    settingsToggle.setAttribute("aria-expanded", "true");
    renderSettings(currentData);
    calendar.element
      .querySelector('button[data-day][tabindex="0"]')
      ?.focus({ preventScroll: true });
  };
  function render(data) {
    currentData = data;
    const display = displayFor(data),
      shown = display.summary,
      historical = display.mode === "historical";
    const optionsKey = JSON.stringify(data.milestones);
    if (select.dataset.options !== optionsKey) {
      select.dataset.options = optionsKey;
      select.replaceChildren(
        ...data.milestones.map((m) => {
          const o = node("option", m.title);
          o.value = m.number;
          return o;
        }),
      );
    }
    select.value = String(data.milestone);
    const renderKey = JSON.stringify([
      data.scope,
      data.milestone,
      data.current,
      data.display,
      data.observations,
      data.rebase,
      data.schedule?.schoolDays,
      data.recordingLimited,
    ]);
    if (
      content.dataset.renderKey !== renderKey ||
      !content.querySelector(".burn-summary")
    ) {
      content.dataset.renderKey = renderKey;
      const summary = node("div", undefined, "burn-summary");
      summary.append(
        node(
          "strong",
          shown?.estimated
            ? `残り：${hours(shown.remainingHours)}h`
            : "残り：—",
        ),
        node(
          "span",
          shown
            ? `未完了の見積合計 · 未見積 ${shown.unestimated}件`
            : "記録なし",
        ),
      );
      content.replaceChildren(
        summary,
        chart(data),
        node("p", observedLabel(display), "burn-note burn-observed"),
      );
      if (shown?.excludedChildren)
        content.append(
          node(
            "p",
            `Projectの対象外と確認した直接の子Issue ${shown.excludedChildren}件は含みません。`,
            "burn-note",
          ),
        );
      if (data.recordingLimited && !historical)
        content.append(
          node(
            "p",
            "本日の記録上限に達しました。上の数値は現在値、図は直近の保存済み観測です。",
            "burn-note",
          ),
        );
    } else {
      content.querySelector(".burn-observed").textContent =
        observedLabel(display);
    }
    renderSettings(data);
  }
  function showPrevious() {
    const old = cache.get(key());
    if (old) {
      render(old);
      return true;
    }
    currentData = null;
    settingsToggle.hidden = true;
    closeSettings();
    content.replaceChildren(node("p", "記録を読み込んでいます…", "burn-empty"));
    return false;
  }
  function remember(data) {
    if (scope !== null && scope !== data.scope) {
      cache.clear();
      scheduleDrafts.clear();
      verified.clear();
      attempted.clear();
    }
    scope = data.scope;
    cache.delete(data.milestone);
    cache.set(data.milestone, data);
    while (cache.size > 12) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
      verified.delete(oldest);
      attempted.delete(oldest);
      // Unsaved choices and the once-only proposal decision survive cache eviction.
    }
  }
  async function load() {
    if (loading || scheduleDrafts.get(key())?.saving) {
      refreshQueued = true;
      generation++;
      return;
    }
    refreshQueued = false;
    loading = true;
    controller?.abort();
    controller = new AbortController();
    const session = ++generation,
      source = sourceGeneration,
      requested = selected,
      attempt = { at: Date.now(), day: todayJst() };
    attempted.set(key(), attempt);
    notice.hidden = true;
    if (!currentData || currentData.milestone !== key()) showPrevious();
    try {
      const response = await fetch(
          `api/burndown${requested ? `?milestone=${requested}` : ""}`,
          { signal: controller.signal, cache: "no-store" },
        ),
        data = await response.json();
      if (source !== sourceGeneration) return;
      if (response.status === 403 || response.status === 401) {
        invalidate();
        if (response.status === 401 || data.error === "scope_not_public")
          onPrivate();
        else onFieldPrivate();
        return;
      }
      if (session !== generation || !dialog.open) return;
      if (response.status === 404) {
        cache.delete(key());
        currentData = null;
        content.replaceChildren();
        settingsToggle.hidden = true;
        closeSettings();
        throw new Error("このスプリントは現在の対象にありません。");
      }
      if (!response.ok)
        throw new Error("更新できませんでした。前回の観測を表示しています。");
      if (
        !data.ok ||
        !Array.isArray(data.milestones) ||
        !Array.isArray(data.observations) ||
        !data.current ||
        typeof data.scope !== "string"
      )
        throw new Error("記録を確認できませんでした。");
      remember(data);
      // A read begun yesterday may finish after midnight with yesterday's
      // observation. Do not count that flight as today's verification.
      verified.set(data.milestone, { at: Date.now(), day: attempt.day });
      attempted.set(data.milestone, attempt);
      if (requested === null) defaultMilestone = data.milestone;
      selected = data.milestone;
      render(data);
    } catch (e) {
      if (
        source !== sourceGeneration ||
        session !== generation ||
        e.name === "AbortError"
      )
        return;
      notice.replaceChildren(
        node("span", currentData ? e.message : "記録を取得できませんでした。"),
      );
      const retry = node("button", "再試行");
      retry.type = "button";
      retry.onclick = load;
      notice.append(retry);
      notice.hidden = false;
      if (!currentData) {
        content.replaceChildren();
        settingsToggle.hidden = true;
        closeSettings();
      }
    } finally {
      loading = false;
      if (refreshQueued && dialog.open) {
        refreshQueued = false;
        wakeQueued = null;
        void load();
      } else if (wakeQueued) {
        const queued = wakeQueued;
        wakeQueued = null;
        wake(queued.boardMilestone);
      }
    }
  }
  form.onsubmit = async (event) => {
    event.preventDefault();
    const draft = activeDraft();
    if (!draft || draft.saving) return;
    const days = [...draft.days].sort(),
      submittedDraft = JSON.stringify(days);
    if (
      days.length > 60 ||
      new Set(days).size !== days.length ||
      days.some(
        (d) =>
          !/^20\d{2}-\d{2}-\d{2}$/.test(d) ||
          !Number.isFinite(Date.parse(d + "T00:00:00Z")) ||
          new Date(d + "T00:00:00Z").toISOString().slice(0, 10) !== d,
      ) ||
      (days.length > 1 &&
        Date.parse(days.at(-1)) - Date.parse(days[0]) > 180 * 86400000)
    ) {
      error.textContent =
        "実在する日付を重複なく60日以内・期間180日以内で指定してください。";
      error.hidden = false;
      return;
    }
    if (
      !(days.length === 0 && currentData.schedule?.revision === "0") &&
      JSON.stringify(days) ===
        JSON.stringify(currentData.schedule?.schoolDays || [])
    ) {
      draft.dirty = false;
      draft.proposal = false;
      draft.error = null;
      renderSettings(currentData);
      return;
    }
    const target = currentData.milestone,
      source = sourceGeneration,
      targetScope = scope,
      submittedData = currentData;
    generation++;
    draft.saving = true;
    draft.error = null;
    renderSettings(currentData);
    try {
      const response = await fetch(
          `api/burndown/schedule?milestone=${target}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schoolDays: days,
              expectedRevision: draft.revision,
              requestId: crypto.randomUUID(),
            }),
          },
        ),
        data = await response.json();
      if (source !== sourceGeneration) return;
      if (response.status === 403 || response.status === 401) {
        invalidate();
        if (response.status === 401 || data.error === "scope_not_public")
          onPrivate();
        else onFieldPrivate();
        return;
      }
      if (scheduleDrafts.get(target) !== draft || scope !== targetScope) return;
      if (!response.ok)
        throw new Error(
          response.status === 409
            ? "日程が別の操作で更新されました。再取得して確認してください。"
            : "保存結果を確認できません。再取得して確認してください。",
        );
      if (
        !Array.isArray(data.schedule?.schoolDays) ||
        typeof data.schedule?.revision !== "string"
      )
        throw new Error(
          "保存結果を確認できません。再取得して確認してください。",
        );
      draft.dirty = JSON.stringify(draft.days) !== submittedDraft;
      if (!draft.dirty) draft.proposal = false;
      draft.revision = data.schedule.revision;
      const next = {
        ...(cache.get(target) || submittedData),
        schedule: data.schedule,
      };
      remember(next);
      if (dialog.open && key() === target) render(next);
    } catch (e) {
      if (scheduleDrafts.get(target) !== draft || scope !== targetScope) return;
      draft.error = e.message;
    } finally {
      draft.saving = false;
      if (
        dialog.open &&
        currentData?.milestone === target &&
        scheduleDrafts.get(target) === draft
      )
        renderSettings(currentData);
      if (dialog.open && source === sourceGeneration) {
        wakeQueued = null;
        refreshQueued = true;
        if (!loading) {
          refreshQueued = false;
          void load();
        }
      }
    }
  };
  select.onchange = () => {
    selected = Number(select.value);
    closeSettings();
    error.hidden = true;
    generation++;
    showPrevious();
    void load();
  };
  function wake(boardMilestone) {
    if (
      !dialog.open ||
      document.visibilityState === "hidden" ||
      !navigator.onLine
    )
      return;
    const target = key(),
      checked = verified.get(target),
      attempt = attempted.get(target),
      now = Date.now(),
      day = todayJst(now),
      outsideBoard = boardMilestone !== "" && Number(boardMilestone) !== target;
    if (
      checked &&
      checked.day === day &&
      (!outsideBoard || now - checked.at < 45000)
    )
      return;
    // Repeated focus/online wakes neither invalidate a fresh flight nor turn a
    // failed read into a 5-second poll. A new JST day remains an immediate wake.
    if (attempt?.day === day && now - attempt.at < 45000) return;
    if (loading || scheduleDrafts.get(target)?.saving) {
      // Passive wakes do not invalidate a complete read already in flight.
      // Recheck freshness and visibility after it settles; keep at most one.
      wakeQueued = { boardMilestone };
      return;
    }
    void load();
  }
  return {
    open(milestone) {
      origin = document.activeElement;
      selected = milestone ? Number(milestone) : selected;
      closeSettings();
      error.hidden = true;
      dialog.showModal();
      showPrevious();
      close.focus();
      void load();
    },
    get visible() {
      return dialog.open;
    },
    refresh() {
      if (dialog.open) void load();
    },
    wake,
    close: hide,
    invalidate,
  };
}
