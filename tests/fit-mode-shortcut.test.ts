import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const modelBegin = source.indexOf(
  'const DISPLAY_KEY = "idea-boost-whiteboard-display-v1"',
);
const modelEnd = source.indexOf("function renderPicker()", modelBegin);
const keyBegin = source.indexOf('$("#fit-mode").onchange =');
const keyEnd = source.indexOf(
  'document.addEventListener("keydown", handleFitModeShortcut);',
  keyBegin,
);
assert.ok(
  modelBegin >= 0 &&
    modelEnd > modelBegin &&
    keyBegin >= 0 &&
    keyEnd > keyBegin,
  "実display modelとN/P実装境界",
);
const model = source.slice(modelBegin, modelEnd),
  shortcut = source.slice(keyBegin, keyEnd);
const scope = JSON.stringify([
  "github",
  "engineer-first",
  "idea-boost",
  3,
  16,
  "default",
]);
const legacyKey = `idea-boost-whiteboard-display-v1:${scope}`;
const selectionKey = `idea-boost-whiteboard-display-v2:${scope}`;
const rowsKey = `idea-boost-whiteboard-rows-v1:${scope}`;

// 実model/selection/onchange/keydownを実行し、storage・描画・DOMだけstub。
// pointer/実focus/スクロール/geometryの証拠とは区別してbrowser specへ委ねる。
function harness(saved: Record<string, unknown> = {}, total = 12) {
  const storage = new Map(
    Object.entries(saved).map(([key, value]) => [key, JSON.stringify(value)]),
  );
  type Node = {
    inBoard: boolean;
    lane?: string;
    closest: (selector: string) => unknown;
  };
  const node = (inBoard = false, lane?: string, writing = false): Node => ({
    inBoard,
    lane,
    closest(selector) {
      if (selector === ".board-row")
        return lane
          ? { querySelector: () => ({ dataset: { pbiRow: lane } }) }
          : null;
      return writing ? this : null;
    },
  });
  const body = node(),
    input = node(false, undefined, true);
  const overlays: { hidden: boolean; getClientRects: () => unknown[] }[] = [];
  let renders = 0,
    boardFocusCalls = 0;
  let shown: string[] = [];
  const document = { activeElement: body, querySelectorAll: () => overlays };
  const board = {
    ...node(true),
    dataset: { displayScope: scope },
    querySelector: () =>
      shown.length ? { dataset: { pbiRow: shown[0] } } : null,
    contains: (target: Node) => Boolean(target?.inBoard),
    focus(options: { preventScroll: boolean }) {
      assert.equal(options.preventScroll, true);
      boardFocusCalls++;
      document.activeElement = board;
    },
  };
  const changes: Event[] = [];
  const select = {
    value: "6",
    disabled: false,
    dataset: {} as Record<string, string>,
    onchange: () => {},
    dispatchEvent(event: Event) {
      changes.push(event);
      this.onchange();
      return true;
    },
  };
  const trigger = { dataset: {} as Record<string, string> };
  const context = vm.createContext({
    state: {
      lanes: Array.from({ length: total }, (_, i) => ({ id: `p${i}` })),
      scope: {
        owner: "engineer-first",
        repo: "idea-boost",
        projectNumber: 3,
        viewNumber: 16,
      },
    },
    selectedMilestone: "",
    adapter: {},
    page: 0,
    composing: false,
    commentComposing: false,
    dragged: null,
    // 背景read/保存中の全体pendingは表示のみのN/Pを止めない。
    loading: true,
    pending: true,
    storageFailed: false,
    toolbarSelects: null,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
    Event,
    document,
    $: (id: string) => {
      if (id === "#fit-mode") return select;
      if (id === "#fit-mode-trigger") return trigger;
      if (id === "#board") return board;
      if (id === "#board-scroll") return { scrollTop: 0 };
      assert.fail(`Unexpected DOM read ${id}`);
    },
    render() {
      renders++;
      const view = vm.runInContext(
        "(() => { const lanes = selectedLanes(), layout = displayLayout(), view = boardPage(lanes, layout); syncRowsControl(layout); return { ids: lanes.map(l => l.id), scope: displayScope(), ...view }; })()",
        context,
      );
      context.page = view.currentPage;
      board.dataset.displayScope = view.scope;
      shown = [...view.ids].slice(
        view.currentPage * view.rows,
        (view.currentPage + 1) * view.rows,
      );
      if (
        document.activeElement.lane &&
        !shown.includes(document.activeElement.lane)
      )
        document.activeElement = body;
    },
  });
  vm.runInContext(model + "\n" + shortcut, context);
  const run = (code: string) => vm.runInContext(code, context);
  run("render()");
  renders = 0;
  function press(key = "n", props: Record<string, unknown> = {}) {
    const event = {
      key,
      target: board,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...props,
    };
    context.event = event;
    run("handleFitModeShortcut(event)");
    return event;
  }
  return {
    press,
    run,
    context,
    select,
    trigger,
    board,
    body,
    input,
    document,
    overlays,
    changes,
    storage,
    shown: () => [...shown],
    renders: () => renders,
    boardFocusCalls: () => boardFocusCalls,
    focus(lane: string) {
      const target = node(true, lane);
      document.activeElement = target;
      return target;
    },
    choose(value: number | "all") {
      select.value = String(value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    preference: () => JSON.parse(storage.get(selectionKey) || "null"),
  };
}

test("実関数: N/Pは1〜6〜Allを一段ずつ変更、両端はwrapも余分renderもしない", () => {
  const h = harness();
  h.document.activeElement = h.board;
  for (const n of [5, 4, 3, 2, 1]) {
    assert.equal(h.press("n").defaultPrevented, true);
    assert.equal(h.select.value, String(n));
  }
  const atMin = h.changes.length;
  h.press("n");
  assert.equal(h.changes.length, atMin);
  for (const n of [2, 3, 4, 5, 6]) {
    h.press("p");
    assert.equal(h.select.value, String(n));
  }
  h.press("p");
  assert.equal(h.select.value, "all");
  const atMax = h.changes.length;
  h.press("p");
  assert.equal(h.select.value, "all");
  assert.equal(h.changes.length, atMax);
  h.press("n");
  assert.equal(h.select.value, "6");
  assert.equal(h.changes.length, 12);
  assert.equal(h.renders(), 12);
  assert.ok(
    h.changes.every((event) => event.type === "change" && event.bubbles),
  );
  assert.deepEqual(JSON.parse(h.storage.get(rowsKey)!), {
    value: 6,
    lastRows: 6,
  });
});

test("実関数: Allは記憶した3/5件によらずNで6へ、Pはno-op、anchorと保存を保持", () => {
  for (const lastRows of [3, 5]) {
    const h = harness({
      [legacyKey]: Array.from({ length: 12 }, (_, i) => `p${i}`),
      [rowsKey]: { value: "all", lastRows },
    });
    h.run(
      'displayLayout().anchorId="p6"; displayLayout().anchorIndex=6; render()',
    );
    const before = h.renders();
    h.press("p");
    assert.equal(h.select.value, "all");
    assert.equal(h.renders(), before);
    assert.deepEqual(JSON.parse(h.storage.get(rowsKey)!), {
      value: "all",
      lastRows,
    });
    h.press("n");
    assert.equal(h.select.value, "6");
    assert.deepEqual(h.shown(), ["p6", "p7", "p8", "p9", "p10", "p11"]);
    h.press("p");
    assert.equal(h.shown().length, 12);
    h.press("n");
    assert.deepEqual(h.shown(), ["p6", "p7", "p8", "p9", "p10", "p11"]);
    assert.deepEqual(JSON.parse(h.storage.get(rowsKey)!), {
      value: 6,
      lastRows: 6,
    });
  }
});

test("実関数: focus中PBIを優先して残し、外focusやAll以外の管理対象を変更しない", () => {
  const h = harness();
  const focused = h.focus("p5");
  h.press("n");
  assert.deepEqual(h.shown(), ["p5"]);
  assert.equal(h.document.activeElement, focused);
  assert.equal(h.boardFocusCalls(), 0);
  h.document.activeElement = h.body;
  h.press("n");
  assert.deepEqual(h.shown(), ["p4", "p5"]);
  assert.equal(h.document.activeElement, h.body);
  assert.deepEqual(h.preference().ids, ["p0", "p1", "p2", "p3", "p4", "p5"]);
});

test("実関数: 他key・修飾・repeat・IME・処理済みkeyはN/P状態を変更しない", () => {
  for (const key of ["n", "p"])
    for (const props of [
      ...["u", "f", "ArrowLeft", "Escape", ""].map((key) => ({ key })),
      { ctrlKey: true },
      { metaKey: true },
      { altKey: true },
      { shiftKey: true },
      { repeat: true },
      { isComposing: true },
      { defaultPrevented: true },
    ]) {
      const h = harness({ [rowsKey]: { value: 3, lastRows: 3 } });
      const event = h.press(key, props);
      assert.equal(
        event.defaultPrevented,
        Boolean("defaultPrevented" in props && props.defaultPrevented),
      );
      assert.equal(h.select.value, "3");
      assert.equal(h.changes.length, 0);
      assert.equal(h.renders(), 0);
    }
});

test("実関数: 入力target/focus・composition・drag・adapter無し・disabledと可視overlayを保護", () => {
  for (const key of ["n", "p"])
    for (const flag of [
      "composing",
      "commentComposing",
      "dragged",
      "adapter",
      "disabled",
      "target",
      "active",
      "overlay",
    ]) {
      const h = harness({ [rowsKey]: { value: 3, lastRows: 3 } });
      let target: unknown = h.board;
      if (flag === "adapter") h.context.adapter = null;
      else if (flag === "disabled") h.select.disabled = true;
      else if (flag === "target") target = h.input;
      else if (flag === "active") h.document.activeElement = h.input;
      else if (flag === "overlay")
        h.overlays.push({ hidden: false, getClientRects: () => [{}] });
      else h.context[flag] = true;
      assert.equal(h.press(key, { target }).defaultPrevented, false, flag);
      assert.equal(h.select.value, "3");
      assert.equal(h.changes.length, 0);
    }
  const hidden = harness({ [rowsKey]: { value: 3, lastRows: 3 } });
  hidden.overlays.push(
    { hidden: true, getClientRects: () => [{}] },
    { hidden: false, getClientRects: () => [] },
  );
  hidden.press("n");
  assert.equal(hidden.select.value, "2");
});

test("実model: legacy手動の空/missing/6超を切り捨てずv2へ、legacy値は書換えない", () => {
  for (const ids of [
    [],
    ["p0", "p2", "missing"],
    Array.from({ length: 12 }, (_, i) => `p${i}`),
  ]) {
    const h = harness({ [legacyKey]: ids });
    assert.deepEqual(h.preference(), { mode: "manual", ids, topN: 6 });
    assert.deepEqual(JSON.parse(h.storage.get(legacyKey)!), ids);
    h.press("n");
    assert.deepEqual(h.preference().ids, ids);
  }
});

test("実model: topは明示保存時のみ順序に追従しmanual backup/候補超Nを保持", () => {
  const ids = ["p2", "p5", "missing"];
  const h = harness({ [selectionKey]: { mode: "top", ids, topN: 30 } });
  assert.equal(h.run("selectedIds().length"), 12);
  h.run('state.lanes.unshift({id:"p-new"})');
  assert.equal(h.run("selectedIds()[0]"), "p-new");
  assert.deepEqual(h.preference(), { mode: "top", ids, topN: 30 });
  h.run(
    'saveDisplay(displayScope(), {mode:"manual", ids:displaySelection().ids, topN:30})',
  );
  assert.deepEqual([...h.run("selectedIds()")], ids);
  for (const value of [0, -1, 1.5, "", "NaN", Infinity]) {
    h.context.candidate = value;
    assert.equal(h.run("validTopCount(candidate)"), false);
  }
  for (const value of [1, 30, "100"]) {
    h.context.candidate = value;
    assert.equal(h.run("validTopCount(candidate)"), true);
  }
});

test("実model: 空候補でも明示top N/backup/件数を保持し復帰候補へ自動追従する", () => {
  const selection = { mode: "top", ids: ["p4", "missing"], topN: 3 };
  const h = harness({
    [selectionKey]: selection,
    [rowsKey]: { value: 2, lastRows: 2 },
  });
  h.context.state.lanes = [];
  h.run("render()");
  assert.deepEqual(h.shown(), []);
  assert.deepEqual(h.preference(), selection);
  assert.equal(h.select.value, "2");
  h.context.state.lanes = ["p8", "p1", "p5", "p9"].map((id) => ({ id }));
  h.run("render()");
  assert.deepEqual([...h.run("selectedIds()")], ["p8", "p1", "p5"]);
  assert.deepEqual(h.shown(), ["p8", "p1"]);
  assert.deepEqual(h.preference(), selection);
});

test("実model: milestone scopeごとに管理対象/auto意図/通常件数/Allを独立保持する", () => {
  const h = harness({ [selectionKey]: { mode: "top", ids: ["p4"], topN: 5 } });
  h.choose(3);
  h.context.selectedMilestone = "10";
  h.run("render()");
  assert.equal(h.select.value, "6");
  assert.deepEqual(
    [...h.run("selectedIds()")],
    ["p0", "p1", "p2", "p3", "p4", "p5"],
  );
  h.press("n");
  h.choose("all");
  const secondScope = h.run("displayScope()");
  h.run(
    'saveDisplay(displayScope(), {mode:"manual", ids:["p7","missing"], topN:8}); render()',
  );
  h.context.selectedMilestone = "";
  h.run("render()");
  assert.equal(h.select.value, "3");
  assert.deepEqual(h.preference(), { mode: "top", ids: ["p4"], topN: 5 });
  assert.deepEqual([...h.run("selectedIds()")], ["p0", "p1", "p2", "p3", "p4"]);
  h.context.selectedMilestone = "10";
  h.run("render()");
  assert.equal(h.select.value, "all");
  assert.deepEqual(h.shown(), ["p7"]);
  assert.deepEqual(
    JSON.parse(
      h.storage.get(`idea-boost-whiteboard-display-v2:${secondScope}`)!,
    ),
    { mode: "manual", ids: ["p7", "missing"], topN: 8 },
  );
  assert.deepEqual(
    JSON.parse(h.storage.get(`idea-boost-whiteboard-rows-v1:${secondScope}`)!),
    { value: "all", lastRows: 5 },
  );
  h.press("p");
  assert.equal(h.select.value, "all");
  h.press("n");
  assert.equal(h.select.value, "6");
});

test("実model: storage拒否は例外を外へ漏らさずページ内state維持、壊れJSONは安全fallback", () => {
  const denied = harness();
  denied.context.localStorage = {
    getItem() {
      throw new Error("storage blocked");
    },
    setItem() {
      throw new Error("storage blocked");
    },
  };
  assert.doesNotThrow(() =>
    denied.run("displaySelections.clear(); displayLayouts.clear(); render()"),
  );
  assert.equal(denied.context.storageFailed, true);
  denied.press("n");
  assert.equal(denied.select.value, "5");
  denied.run(
    'saveDisplay(displayScope(), {mode:"top",ids:["p4"],topN:3}); render()',
  );
  assert.deepEqual([...denied.run("selectedIds()")], ["p0", "p1", "p2"]);
  assert.equal(denied.select.value, "5");

  const corrupt = harness();
  corrupt.storage.set(selectionKey, "{invalid JSON");
  corrupt.storage.set(rowsKey, "{invalid JSON");
  corrupt.storage.set(legacyKey, JSON.stringify(["p2", "missing"]));
  assert.doesNotThrow(() =>
    corrupt.run("displaySelections.clear(); displayLayouts.clear(); render()"),
  );
  assert.deepEqual(corrupt.preference(), {
    mode: "manual",
    ids: ["p2", "missing"],
    topN: 6,
  });
  assert.equal(corrupt.select.value, "6");
  assert.deepEqual(corrupt.shown(), ["p2"]);
  corrupt.storage.set(selectionKey, "{invalid again");
  corrupt.storage.set(
    legacyKey,
    JSON.stringify({ invalid: "not an ID array" }),
  );
  corrupt.run("displaySelections.clear(); render()");
  assert.deepEqual(corrupt.preference(), {
    mode: "manual",
    ids: ["p0", "p1", "p2", "p3", "p4", "p5"],
    topN: 6,
  });
});
