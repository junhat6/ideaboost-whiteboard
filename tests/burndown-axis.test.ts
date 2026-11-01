import test from "node:test";
import assert from "node:assert/strict";
import { chart } from "../web/burndown.js";

// Minimal read-only DOM for executing the actual chart export without Chromium.
class Element {
  children: Element[] = [];
  attributes: Record<string, string> = {};
  className = "";
  textContent = "";
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
}
function render(input: any, legacy = false) {
  // API接続以外の軸テストは、既知の合成状態から返る再計算payloadを明示する。
  const data =
    legacy || input.rebase
      ? input
      : {
          ...input,
          rebase: {
            policy: "latest-scope-observed-completion-v1",
            observations: input.observations.map((p: any) => ({
              at: p.at,
              day: p.day,
              remainingHours: p.estimated ? p.remainingHours : null,
            })),
          },
        };
  const before = globalThis.document;
  globalThis.document = {
    createElement: (tag: string) => new Element(tag),
    createElementNS: (_ns: string, tag: string) => new Element(tag),
  } as unknown as Document;
  try {
    return chart(data) as unknown as Element;
  } finally {
    globalThis.document = before;
  }
}
function nodes(root: Element, className: string): Element[] {
  return [
    root,
    ...root.children.flatMap((child) => nodes(child, className)),
  ].filter((element) =>
    (element.attributes.class || element.className)
      .split(" ")
      .includes(className),
  );
}
const summary = {
  estimatedHours: 60,
  remainingHours: 23,
  estimated: 14,
  unestimated: 10,
  total: 24,
  cancelled: 1,
  excludedChildren: 1,
};
const observation = (day: string, at: string, remainingHours: number) => ({
  ...summary,
  day,
  at,
  remainingHours,
});
const data = {
  observedAt: "2026-10-28T18:02:47.093Z",
  current: summary,
  schedule: {
    schoolDays: [
      "2026-10-29",
      "2026-11-02",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-09",
    ],
    revision: "saved",
  },
  observations: [
    observation("2026-10-28", "2026-10-28T10:13:18.433Z", 53),
    observation("2026-10-29", "2026-10-28T18:02:40.037Z", 23),
  ],
};
test("学校日開始前の観測は描画から除外し、保存日程と履歴は変更しない", () => {
  const before = structuredClone(data),
    root = render(data),
    points = nodes(root, "burn-point");
  assert.equal(points.length, 1);
  assert.match(points[0].children[0].textContent, /2026-10-29.*23h/);
  assert.deepEqual(data, before, "描画で学校日や保存履歴を変更しない");
});
function pathPoints(root: Element, className: string) {
  return [
    ...nodes(root, className)[0].attributes.d.matchAll(
      /([ML])\s+(-?[\d.]+)\s+(-?[\d.]+)/g,
    ),
  ].map((match) => ({
    command: match[1],
    x: Number(match[2]),
    y: Number(match[3]),
  }));
}
function at(day: string, remaining: number) {
  return observation(day, `${day}T08:00:00Z`, remaining);
}
test("学校日だけの場合は既存青線の座標と60/43の異なる指標を保持", () => {
  const root = render({
    ...data,
    observedAt: "2026-11-04T08:00:00Z",
    current: { ...summary, remainingHours: 43 },
    schedule: { schoolDays: ["2026-10-29", "2026-11-02", "2026-11-04"] },
    observations: [at("2026-10-29", 43)],
  });
  assert.equal(nodes(root, "burn-ideal")[0].attributes.d, "M 60 50 L 680 310");
  assert.ok(Number(nodes(root, "burn-point")[0].attributes.cy) > 50);
  assert.match(
    nodes(root, "burn-point")[0].attributes["aria-label"],
    /43h.*未見積10件/,
  );
});
test("学校日間の実観測は暦日比率で配置し、青は直線、未観測学校日で赤を切る", () => {
  const root = render({
    ...data,
    observedAt: "2026-11-04T08:00:00Z",
    current: { ...summary, remainingHours: 0 },
    schedule: { schoolDays: ["2026-10-29", "2026-11-02", "2026-11-04"] },
    observations: [
      at("2026-10-29", 43),
      at("2026-10-30", 35),
      at("2026-11-04", 0),
    ],
  });
  const ideal = pathPoints(root, "burn-ideal"),
    actual = pathPoints(root, "burn-actual");
  assert.equal(ideal.length, 2);
  assert.deepEqual(
    ideal.map((point) => point.y),
    [50, 310],
  );
  assert.equal(actual[2].x, 60 + 310 / 4);
  assert.deepEqual(
    actual.map((point) => point.command),
    ["M", "L", "L", "M"],
  );
  assert.equal(actual.at(-1)!.y, 310, "実際に完了した0hは正当な赤点");
  assert.equal(nodes(root, "burn-point").length, 3);
});
test("学校期間の前後の観測は非表示、境界学校日だけに軸を限定", () => {
  const root = render({
    ...data,
    observedAt: "2026-11-10T08:00:00Z",
    schedule: { schoolDays: ["2026-10-29", "2026-11-02"] },
    observations: [at("2026-10-28", 53), at("2026-11-10", 12)],
  });
  assert.equal(nodes(root, "burn-point").length, 0);
  assert.deepEqual(
    pathPoints(root, "burn-ideal").map((p) => p.x),
    [60, 680],
  );
  assert.equal(nodes(root, "burn-actual")[0].attributes.d, "M 60 50");
});
test("同日の順不同観測は最後の保存時刻を選び原JST時刻も示す", () => {
  const root = render({
    ...data,
    observations: [
      observation("2026-10-29", "2026-10-28T18:01:18.433Z", 53),
      observation("2026-10-29", "2026-10-28T16:00:00Z", 58),
    ],
  });
  const points = nodes(root, "burn-point");
  assert.equal(points.length, 1);
  assert.match(points[0].children[0].textContent, /53h.*3:01:18/);
});
test("未見積だけの観測は完了0hとして描かず、学校日外のunknownで赤線を切る", () => {
  const unknown = {
    ...at("2026-10-30", 0),
    estimated: 0,
    estimatedHours: 0,
    unestimated: 24,
  };
  const empty = render({ ...data, current: unknown, observations: [unknown] });
  assert.equal(nodes(empty, "burn-point").length, 0);
  assert.equal(nodes(empty, "burn-ideal").length, 0);
  assert.match(nodes(empty, "burn-empty")[0].textContent, /未設定/);
  const root = render({
    ...data,
    observedAt: "2026-11-02T08:00:00Z",
    schedule: { schoolDays: ["2026-10-29", "2026-11-02"] },
    observations: [at("2026-10-29", 43), unknown, at("2026-11-02", 23)],
  });
  assert.deepEqual(
    pathPoints(root, "burn-actual").map((point) => point.command),
    ["M", "L", "M"],
  );
  assert.equal(nodes(root, "burn-point").length, 2);
});
test("記録上限時に現在23hから未保存の赤点を作らない", () => {
  const root = render({
    ...data,
    recordingLimited: true,
    observations: [at("2026-10-29", 53)],
    observedAt: "2026-10-29T08:00:00Z",
  });
  assert.equal(nodes(root, "burn-point").length, 1);
  assert.match(nodes(root, "burn-point")[0].children[0].textContent, /53h/);
  assert.doesNotMatch(
    nodes(root, "burn-point")[0].children[0].textContent,
    /23h/,
  );
});
test("historical61hは現scopeの0や境界時刻以降の観測で書き換えない", () => {
  const cutoff = "2026-10-27T15:00:00Z",
    observedAt = "2026-10-27T14:59:59.999Z",
    root = render({
      ...data,
      current: {
        ...summary,
        remainingHours: 0,
        estimatedHours: 0,
        estimated: 0,
        total: 0,
      },
      display: {
        mode: "historical",
        summary: { ...summary, estimatedHours: 95.5, remainingHours: 61 },
        observedAt,
        cutoff,
      },
      schedule: {
        schoolDays: [
          "2026-10-21",
          "2026-10-22",
          "2026-10-23",
          "2026-10-26",
          "2026-10-27",
          "2026-10-28",
        ],
      },
      observations: [
        observation("2026-10-27", observedAt, 61),
        observation("2026-10-28", cutoff, 0),
      ],
    });
  const points = nodes(root, "burn-point");
  assert.equal(points.length, 1);
  assert.match(points[0].children[0].textContent, /61h.*23:59:59/);
  assert.equal(nodes(root, "burn-ideal")[0].attributes.d, "M 60 50 L 680 310");
  assert.equal(
    nodes(root, "burn-ideal-label")[0].textContent,
    "理想（最終記録の全体見積）",
  );
});
for (const schoolDays of [[], ["2026-10-29"]])
  test(`学校日${schoolDays.length}日の時は保存点を残すが理想を作らない`, () => {
    const root = render({ ...data, schedule: { schoolDays } });
    assert.equal(nodes(root, "burn-point").length, schoolDays.length ? 1 : 2);
    assert.equal(nodes(root, "burn-ideal").length, 0);
  });
test("historical未記録は現在scopeや現在値で過去点を補完しない", () => {
  const root = render({
    ...data,
    observations: [],
    display: {
      mode: "historical",
      summary: null,
      observedAt: null,
      cutoff: "2026-10-27T15:00:00Z",
    },
  });
  assert.equal(nodes(root, "burn-point").length, 0);
  assert.equal(nodes(root, "burn-empty")[0].textContent, "記録なし");
});

// 最小層で守る契約: scope変更は青の開始値のみ引き直し、日次履歴・軸を改変しない。
test("再見積後も学校日は等間隔、休校日は無ラベルの内挿点、未来の実績を作らない", () => {
  const observations = [
    at("2026-10-29", 30),
    at("2026-10-30", 31),
    at("2026-10-31", 31),
    at("2026-11-01", 31),
    at("2026-11-02", 0),
  ];
  const root = render({
    ...data,
    current: { ...summary, estimatedHours: 87 },
    observedAt: "2026-11-01T08:00:00Z",
    observations,
  });
  const ticks = nodes(root, "burn-axis").filter(
    (p) => p.attributes["aria-label"],
  );
  assert.equal(ticks.length, 6);
  assert.deepEqual(
    ticks.map((p) => Number(p.attributes.x)),
    [60, 184, 308, 432, 556, 680],
  );
  assert.deepEqual(
    nodes(root, "burn-point").map((p) => Number(p.attributes.cx)),
    [60, 91, 122, 153],
  );
  assert.deepEqual(pathPoints(root, "burn-ideal"), [
    { command: "M", x: 60, y: 50 },
    { command: "L", x: 680, y: 310 },
  ]);
  assert.equal(
    Number(nodes(root, "burn-point")[0].attributes.cy),
    310 - (30 / 87) * 260,
  );
  assert.match(
    nodes(root, "burn-point")[3].attributes["aria-label"],
    /2026-11-01.*学校日外/,
  );
});

// 同日の開始基準と実観測を両立し、欠測は成果0や旧残量へ見せかけない。
test("再計算の開始基準は青と一致し、同日の完了分を縦線で残し欠測で切る", () => {
  const observations = [
    at("2026-10-29", 20),
    at("2026-10-30", 20),
    at("2026-11-01", 10),
  ];
  const root = render({
    ...data,
    observedAt: "2026-11-01T09:00:00Z",
    current: { ...summary, estimatedHours: 87 },
    observations,
    rebase: {
      policy: "latest-scope-observed-completion-v1",
      observations: observations.map((p, i) => ({
        at: p.at,
        day: p.day,
        remainingHours: [70, null, 40][i],
        assumedIncompleteTasks: i === 0 ? 1 : 0,
      })),
    },
  });
  const baseline = nodes(root, "burn-baseline")[0];
  assert.equal(baseline.attributes.cy, "50");
  assert.match(
    baseline.attributes["aria-label"],
    /開始基準 87h.*実測ではありません/,
  );
  assert.deepEqual(
    pathPoints(root, "burn-actual").map((p) => p.command),
    ["M", "L", "M"],
  );
  assert.deepEqual(
    nodes(root, "burn-point").map((p) => Number(p.attributes.cx)),
    [60, 153],
  );
  assert.match(
    nodes(root, "burn-point")[0].attributes["aria-label"],
    /70h.*再計算/,
  );
  assert.ok(
    nodes(root, "burn-note").some((p) => p.textContent.includes("記録が不足")),
  );
  assert.ok(
    nodes(root, "burn-note").some((p) =>
      p.textContent.includes("未完了として再計算"),
    ),
  );
});
test("再計算データの欠落は旧残量へfallbackせず、未来には開始基準を作らない", () => {
  const root = render({
    ...data,
    rebase: { policy: "latest-scope-observed-completion-v1", observations: [] },
  });
  assert.equal(nodes(root, "burn-point").length, 0);
  const future = render({
    ...data,
    observedAt: "2026-10-28T08:00:00Z",
    rebase: { policy: "latest-scope-observed-completion-v1", observations: [] },
  });
  assert.equal(nodes(future, "burn-baseline").length, 0);
});

test("旧API応答の保存残量を新しい赤線として表示しない", () => {
  const root = render(data, true);
  assert.equal(nodes(root, "burn-point").length, 0);
  assert.equal(nodes(root, "burn-baseline").length, 0);
  assert.ok(
    nodes(root, "burn-note").some((p) =>
      p.textContent.includes("再計算データを取得できません"),
    ),
  );
});
