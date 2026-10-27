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
    daily.set(observation.day, observation);
  const points = [...daily.values()].sort((a, b) => a.at.localeCompare(b.at));
  if (!points.length) {
    root.append(node("p", "履歴の記録を開始しています。", "burn-empty"));
    return root;
  }
  const svg = svgNode("svg", {
    viewBox: "0 0 720 380",
    role: "img",
    "aria-label": "未完了作業Issueの見積合計の観測推移。単位は時間。",
  });
  const max = Math.max(1, ...points.map((p) => p.remainingHours));
  const times = points.map((p) => Date.parse(p.at)),
    first = Math.min(...times),
    last = Math.max(...times, first + 86400000);
  const x = (t) => 60 + ((t - first) / (last - first)) * 620,
    y = (v) => 310 - (v / max) * 260;
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
    );
    svg.append(
      svgNode(
        "text",
        { x: 50, y: y(value) + 5, "text-anchor": "end", class: "burn-axis" },
        hours(value),
      ),
    );
  }
  svg.append(svgNode("text", { x: 12, y: 24, class: "burn-axis" }, "h"));
  let d = "",
    previous = null;
  points.forEach((p, i) => {
    if (!p.estimated) {
      previous = null;
      return;
    }
    const px = x(times[i]),
      py = y(p.remainingHours);
    d += previous ? ` H ${px} V ${py}` : ` M ${px} ${py}`;
    previous = p;
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
        `${p.day}: ${hours(p.remainingHours)}h / 未見積${p.unestimated}件`,
      ),
    );
    svg.append(circle);
  });
  svg.append(svgNode("path", { d, class: "burn-actual", fill: "none" }));
  if (points.length)
    for (const i of new Set([0, points.length - 1]))
      svg.append(
        svgNode(
          "text",
          {
            x: x(times[i]),
            y: 340,
            "text-anchor": "middle",
            class: "burn-axis",
          },
          points[i].day.slice(5),
        ),
      );
  root.append(svg);
  const tableWrap = node("details"),
    summary = node("summary", "観測の内訳"),
    table = node("table");
  const head = node("tr");
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
    heading = node("h2", "バーンダウン");
  heading.id = "burndown-heading";
  const close = node("button", "×", "icon-button");
  close.type = "button";
  close.setAttribute("aria-label", "バーンダウンを閉じる");
  top.append(heading, close);
  const select = node("select");
  select.setAttribute("aria-label", "バーンダウンのスプリント");
  const content = node("div", undefined, "burn-content");
  content.setAttribute("aria-live", "polite");
  dialog.append(top, select, content);
  document.body.append(dialog);
  let controller,
    generation = 0,
    origin,
    selected = null;
  const hide = () => {
    if (!dialog.open) return;
    generation++;
    controller?.abort();
    dialog.close();
    content.replaceChildren();
    origin?.focus?.({ preventScroll: true });
    onClose();
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
  async function load() {
    controller?.abort();
    controller = new AbortController();
    const session = ++generation;
    content.replaceChildren(node("p", "記録を読み込んでいます…", "burn-empty"));
    try {
      const response = await fetch(
        `api/burndown${selected ? `?milestone=${selected}` : ""}`,
        { signal: controller.signal, cache: "no-store" },
      );
      const data = await response.json();
      if (session !== generation || !dialog.open) return;
      if (!response.ok) {
        if (response.status === 403) {
          hide();
          if (data.error === "scope_not_public") onPrivate();
          else onFieldPrivate();
          return;
        }
        throw new Error("記録を取得できませんでした。");
      }
      if (
        !data.ok ||
        !Array.isArray(data.milestones) ||
        !Array.isArray(data.observations) ||
        !data.current
      )
        throw new Error("記録を確認できませんでした。");
      select.replaceChildren(
        ...data.milestones.map((m) => {
          const o = node("option", m.title);
          o.value = m.number;
          return o;
        }),
      );
      selected = data.milestone;
      select.value = String(selected);
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
      const note = node(
        "p",
        "実消費時間ではなく、見積時間の推移です。記録開始前の履歴はありません。",
        "burn-note",
      );
      const observed = node(
        "p",
        `観測: ${new Date(data.observedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST`,
        "burn-note",
      );
      content.replaceChildren(
        summary,
        chart(data),
        note,
        node(
          "p",
          "開始日・開始時点の見積が未確定のため、理想線は表示していません。",
          "burn-note",
        ),
        observed,
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
    } catch (error) {
      if (session !== generation || error.name === "AbortError") return;
      const retry = node("button", "再試行");
      retry.type = "button";
      retry.onclick = load;
      content.replaceChildren(node("p", error.message), retry);
    }
  }
  select.onchange = () => {
    selected = Number(select.value);
    load();
  };
  return {
    open(milestone) {
      origin = document.activeElement;
      selected = milestone ? Number(milestone) : null;
      dialog.showModal();
      close.focus();
      load();
    },
    close: hide,
  };
}
