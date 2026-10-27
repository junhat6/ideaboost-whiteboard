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
export function chart(data) {
  const root = node("section", undefined, "burn-chart");
  if (!data.current.estimated) {
    root.append(
      node(
        "p",
        data.current.total
          ? `見積時間が未設定です（${data.current.unestimated}件）。`
          : "このスプリントのProject内作業Issueはありません。",
        "burn-empty",
      ),
    );
    return root;
  }
  const daily = new Map();
  for (const observation of data.observations)
    if (Date.parse(observation.at) <= Date.parse(data.observedAt))
      daily.set(observation.day, observation);
  const points = [...daily.values()].sort((a, b) => a.at.localeCompare(b.at));
  const schoolDays = data.schedule?.schoolDays || [];
  const days = schoolDays.length ? schoolDays : points.map((p) => p.day);
  if (!days.length) {
    root.append(node("p", "履歴の記録を開始しています。", "burn-empty"));
    return root;
  }
  const visiblePoints = points.filter((p) => days.includes(p.day));
  const ideal = schoolDays.length >= 2 ? data.current.estimatedHours : null;
  const svg = svgNode("svg", {
    viewBox: "0 0 720 380",
    role: "img",
    "aria-label":
      "学校日ごとの残り見積時間。青は現在の全体見積から計算した理想、赤は実際の観測。単位は時間。",
  });
  const max = Math.max(
    1,
    ideal || 0,
    ...visiblePoints.map((p) => p.remainingHours),
  );
  const x = (day) =>
    60 + (days.length === 1 ? 0 : days.indexOf(day) / (days.length - 1)) * 620;
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
  if (ideal !== null)
    svg.append(
      svgNode("path", {
        d: `M 60 ${y(ideal)} L 680 ${y(0)}`,
        class: "burn-ideal",
        fill: "none",
      }),
    );
  let path = "",
    previous = null;
  for (const point of visiblePoints) {
    if (!point.estimated) {
      previous = null;
      continue;
    }
    const px = x(point.day),
      py = y(point.remainingHours);
    path += previous ? ` L ${px} ${py}` : ` M ${px} ${py}`;
    previous = point;
    const circle = svgNode("circle", {
      cx: px,
      cy: py,
      r: 4,
      class: "burn-point",
    });
    circle.append(
      svgNode(
        "title",
        {},
        `${point.day}: ${hours(point.remainingHours)}h / 未見積${point.unestimated}件`,
      ),
    );
    svg.append(circle);
  }
  svg.append(svgNode("path", { d: path, class: "burn-actual", fill: "none" }));
  const stride = Math.max(1, Math.ceil(days.length / 10));
  days.forEach((day, i) => {
    if (i % stride === 0 || i === days.length - 1)
      svg.append(
        svgNode(
          "text",
          { x: x(day), y: 340, "text-anchor": "middle", class: "burn-axis" },
          day.slice(5).replace("-", "/"),
        ),
      );
  });
  root.append(svg);
  const legend = node("div", undefined, "burn-legend");
  if (ideal !== null)
    legend.append(node("span", "理想（現在の全体見積）", "burn-ideal-label"));
  legend.append(node("span", "実際（観測した残り見積）", "burn-actual-label"));
  root.append(legend);
  if (!visiblePoints.length)
    root.append(
      node(
        "p",
        "学校日の観測はまだありません。過去の実線は推定しません。",
        "burn-note",
      ),
    );
  const tableWrap = node("details"),
    summary = node("summary", "観測の内訳"),
    table = node("table"),
    head = node("tr");
  for (const text of [
    "観測日（JST）",
    "未完了見積",
    "未見積",
    "対象作業",
    "範囲・見積の変化",
  ])
    head.append(node("th", text));
  table.append(head);
  for (const p of points) {
    const row = node("tr");
    for (const text of [
      p.day,
      `${hours(p.remainingHours)} h`,
      `${p.unestimated}件`,
      `${p.total}件`,
      p.changes
        ? [
            p.changes.added && `追加${p.changes.added}`,
            p.changes.removed && `除外${p.changes.removed}`,
            p.changes.reestimated && `再見積${p.changes.reestimated}`,
            p.changes.reopened && `再開${p.changes.reopened}`,
          ]
            .filter(Boolean)
            .join(" / ") || "—"
        : "—",
    ])
      row.append(node("td", text));
    table.append(row);
  }
  tableWrap.append(summary, table);
  root.append(tableWrap);
  return root;
}
export function createBurndown({ onPrivate, onFieldPrivate, onClose }) {
  const dialog = node("dialog", undefined, "burn-panel");
  dialog.id = "burndown-panel";
  dialog.setAttribute("aria-labelledby", "burndown-heading");
  const top = node("div", undefined, "burn-top"),
    heading = node("h2", "バーンダウン"),
    close = node("button", "×", "icon-button");
  heading.id = "burndown-heading";
  close.type = "button";
  close.setAttribute("aria-label", "バーンダウンを閉じる");
  top.append(heading, close);
  const select = node("select");
  select.setAttribute("aria-label", "バーンダウンのスプリント");
  const content = node("div", undefined, "burn-content"),
    notice = node("p", undefined, "burn-notice");
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const settings = node("details", undefined, "burn-settings"),
    settingsLabel = node("summary", "学校日程"),
    form = node("form"),
    label = node("label", "学校がある日（1行に1日、YYYY-MM-DD）"),
    dates = node("textarea"),
    start = node("input"),
    propose = node("button", "期日までの平日を候補にする"),
    save = node("button", "日程を保存"),
    error = node("p", undefined, "burn-settings-error");
  dates.rows = 6;
  dates.id = "burn-school-days";
  label.htmlFor = dates.id;
  start.type = "date";
  start.setAttribute("aria-label", "候補の開始日");
  propose.type = "button";
  save.type = "submit";
  error.setAttribute("role", "alert");
  error.hidden = true;
  const proposal = node("div", undefined, "burn-proposal");
  proposal.append(start, propose);
  form.append(
    label,
    dates,
    proposal,
    node("p", "祝日・休講は日付を取り除いて調整できます。", "burn-note"),
    save,
    error,
  );
  settings.append(settingsLabel, form);
  dialog.append(top, select, content, notice, settings);
  document.body.append(dialog);
  const cache = new Map();
  let defaultMilestone = null,
    scope = null,
    currentData = null,
    controller,
    generation = 0,
    origin,
    selected = null,
    loading = false,
    refreshQueued = false,
    settingsDirty = false,
    saving = false;
  const key = () => (selected === null ? defaultMilestone : selected);
  const hide = () => {
    if (!dialog.open) return;
    generation++;
    refreshQueued = false;
    dialog.close();
    content.replaceChildren();
    notice.hidden = true;
    origin?.focus?.({ preventScroll: true });
    onClose();
  };
  const invalidate = () => {
    cache.clear();
    defaultMilestone = null;
    currentData = null;
    scope = null;
    generation++;
    settingsDirty = false;
    dates.value = "";
    settings.hidden = true;
    hide();
  };
  close.onclick = hide;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    hide();
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
  function render(data) {
    currentData = data;
    select.replaceChildren(
      ...data.milestones.map((m) => {
        const o = node("option", m.title);
        o.value = m.number;
        return o;
      }),
    );
    select.value = String(data.milestone);
    const summary = node("div", undefined, "burn-summary");
    summary.append(
      node(
        "strong",
        data.current.estimated
          ? `${hours(data.current.remainingHours)} h`
          : "—",
      ),
      node("span", `未完了の見積合計 · 未見積 ${data.current.unestimated}件`),
    );
    content.replaceChildren(
      summary,
      chart(data),
      node(
        "p",
        "実消費時間ではなく、見積時間の推移です。青線は現在の対象全体の見積から再計算します。",
        "burn-note",
      ),
      node(
        "p",
        `観測: ${new Date(data.observedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`,
        "burn-note",
      ),
    );
    if ((data.schedule?.schoolDays?.length || 0) < 2)
      content.append(
        node("p", "学校日程を設定すると理想線を表示します。", "burn-note"),
      );
    if (data.current.excludedChildren)
      content.append(
        node(
          "p",
          `Projectの対象外と確認した直接の子Issue ${data.current.excludedChildren}件は含みません。`,
          "burn-note",
        ),
      );
    if (data.recordingLimited)
      content.append(
        node(
          "p",
          "本日の記録上限に達しました。上の数値は現在値、図は直近の保存済み観測です。",
          "burn-note",
        ),
      );
    settings.hidden = !data.milestone;
    propose.disabled = !data.milestones.find((m) => m.number === data.milestone)
      ?.dueOn;
    if (!settingsDirty && !saving) {
      dates.value = (data.schedule?.schoolDays || []).join("\n");
      form.dataset.revision = data.schedule?.revision || "0";
    }
  }
  function showPrevious() {
    const old = cache.get(key());
    if (old) {
      render(old);
      return true;
    }
    currentData = null;
    settings.hidden = true;
    content.replaceChildren(node("p", "記録を読み込んでいます…", "burn-empty"));
    return false;
  }
  function remember(data) {
    if (scope !== null && scope !== data.scope) {
      cache.clear();
    }
    scope = data.scope;
    cache.delete(data.milestone);
    cache.set(data.milestone, data);
    while (cache.size > 12) cache.delete(cache.keys().next().value);
  }
  async function load() {
    if (loading) {
      refreshQueued = true;
      generation++;
      return;
    }
    loading = true;
    controller?.abort();
    controller = new AbortController();
    const session = ++generation,
      requested = selected;
    notice.hidden = true;
    if (!currentData || currentData.milestone !== key()) showPrevious();
    try {
      const response = await fetch(
          `api/burndown${requested ? `?milestone=${requested}` : ""}`,
          { signal: controller.signal, cache: "no-store" },
        ),
        data = await response.json();
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
        settings.hidden = true;
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
      if (requested === null) defaultMilestone = data.milestone;
      selected = data.milestone;
      render(data);
    } catch (e) {
      if (session !== generation || e.name === "AbortError") return;
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
        settings.hidden = true;
      }
    } finally {
      loading = false;
      if (refreshQueued && dialog.open) {
        refreshQueued = false;
        void load();
      }
    }
  }
  dates.oninput = () => {
    settingsDirty = true;
    error.hidden = true;
  };
  propose.onclick = () => {
    const due = currentData?.milestones.find(
      (m) => m.number === currentData.milestone,
    )?.dueOn;
    if (!start.value || !due) {
      error.textContent = "開始日を選択してください。";
      error.hidden = false;
      return;
    }
    const end = Date.parse(
        new Date(due).toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) +
          "T00:00:00Z",
      ),
      begin = Date.parse(start.value + "T00:00:00Z"),
      values = [];
    if (end < begin || end - begin > 180 * 86400000) {
      error.textContent = "開始日から期日までを180日以内にしてください。";
      error.hidden = false;
      return;
    }
    for (let t = begin; t <= end; t += 86400000) {
      const d = new Date(t);
      if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6)
        values.push(d.toISOString().slice(0, 10));
    }
    dates.value = values.join("\n");
    settingsDirty = true;
    error.hidden = true;
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (saving || !currentData) return;
    const days = dates.value
      .split(/[\s,]+/)
      .filter(Boolean)
      .sort();
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
      JSON.stringify(days) ===
      JSON.stringify(currentData.schedule?.schoolDays || [])
    ) {
      settingsDirty = false;
      error.hidden = true;
      return;
    }
    const target = currentData.milestone,
      session = ++generation;
    saving = true;
    save.disabled = true;
    error.hidden = true;
    try {
      const response = await fetch(
          `api/burndown/schedule?milestone=${target}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              schoolDays: days,
              expectedRevision: form.dataset.revision,
              requestId: crypto.randomUUID(),
            }),
          },
        ),
        data = await response.json();
      if (response.status === 403 || response.status === 401) {
        invalidate();
        if (response.status === 401 || data.error === "scope_not_public")
          onPrivate();
        else onFieldPrivate();
        return;
      }
      if (session !== generation || !dialog.open) return;
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
      const existing = cache.get(target);
      if (existing) {
        const next = { ...existing, schedule: data.schedule };
        remember(next);
        settingsDirty = false;
        render(next);
      } else settingsDirty = false;
    } catch (e) {
      if (session !== generation || !dialog.open) return;
      error.replaceChildren(node("span", e.message));
      const reset = node("button", "最新の日程に戻す");
      reset.type = "button";
      reset.onclick = () => {
        settingsDirty = false;
        error.hidden = true;
        if (currentData) render(currentData);
        void load();
      };
      error.append(reset);
      error.hidden = false;
    } finally {
      saving = false;
      save.disabled = false;
      if (dialog.open) {
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
    settingsDirty = false;
    settings.open = false;
    error.hidden = true;
    generation++;
    showPrevious();
    void load();
  };
  return {
    open(milestone) {
      origin = document.activeElement;
      selected = milestone ? Number(milestone) : null;
      settingsDirty = false;
      settings.open = false;
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
    close: hide,
    invalidate,
  };
}
