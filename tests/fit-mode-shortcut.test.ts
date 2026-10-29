import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const begin = source.indexOf('$("#fit-mode").onchange = () => {');
const end = source.indexOf(
  'document.addEventListener("keydown", handleFitModeShortcut);',
  begin,
);
assert.ok(begin >= 0 && end > begin, "表示mode change/shortcutの実装境界");
const application = source.slice(begin, end);

// 実onchange＋実keydownを実行し、DOM/adapterだけstubする。
// native focus・描画・popover・dragの実挙動はbrowser specで別途検証する。
function harness() {
  const node = (writing = false) => {
    const result = {
      closest: (_selector: string): unknown => (writing ? result : null),
    };
    return result;
  };
  const body = node(),
    task = node(),
    otherTask = node(),
    input = node(true);
  const inBoard = new Set<unknown>([task, otherTask]);
  const overlays: { hidden: boolean; getClientRects: () => unknown[] }[] = [];
  let boardFocusCalls = 0;
  let renders = 0;
  let renderFocus: "keep" | "removed" | "retained-task" = "keep";
  const document = {
    activeElement: task,
    querySelectorAll(_selector: string) {
      return overlays;
    },
  };
  const board = {
    closest: () => null,
    contains(target: unknown) {
      return target === board || inBoard.has(target);
    },
    focus(options: { preventScroll: boolean }) {
      assert.equal(options.preventScroll, true);
      boardFocusCalls++;
      document.activeElement = board;
    },
  };
  const changes: Event[] = [];
  const select = {
    value: "fit",
    disabled: false,
    onchange: () => {},
    dispatchEvent(event: Event) {
      changes.push(event);
      this.onchange();
      return true;
    },
  };
  const context = vm.createContext({
    page: 1,
    composing: false,
    commentComposing: false,
    dragged: null,
    adapter: {},
    // Display-only toggles deliberately remain usable during a background read.
    loading: true,
    pending: true,
    Event,
    document,
    $: (selector: string) => {
      if (selector === "#fit-mode") return select;
      if (selector === "#board") return board;
      assert.fail(`unexpected element: ${selector}`);
    },
    render() {
      renders++;
      if (renderFocus === "removed") document.activeElement = body;
      if (renderFocus === "retained-task") document.activeElement = otherTask;
    },
  });
  vm.runInContext(application, context);
  function press(props: Record<string, unknown> = {}) {
    const event = {
      key: "p",
      target: board,
      defaultPrevented: false,
      preventDefault() {
        this.defaultPrevented = true;
      },
      ...props,
    };
    context.event = event;
    vm.runInContext("handleFitModeShortcut(event)", context);
    return event;
  }
  return {
    press,
    context,
    select,
    changes,
    document,
    board,
    task,
    input,
    body,
    overlays,
    renderFocus(mode: typeof renderFocus) {
      renderFocus = mode;
    },
    renders: () => renders,
    boardFocusCalls: () => boardFocusCalls,
  };
}

test("実関数: Pは既存changeを1回通してfit/pagesを往復し各回page 0へ戻す", () => {
  const h = harness();
  for (const value of ["pages", "fit", "pages", "fit"]) {
    h.context.page = 1;
    assert.equal(h.press().defaultPrevented, true);
    assert.equal(h.select.value, value);
    assert.equal(h.context.page, 0);
  }
  assert.equal(h.changes.length, 4);
  assert.equal(h.renders(), 4);
  assert.ok(
    h.changes.every((event) => event.type === "change" && event.bubbles),
  );
  assert.equal(h.boardFocusCalls(), 0);
});

test("実関数: 他shortcut・修飾・repeat・IME・処理済みkeyは表示を変えない", () => {
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
    const h = harness();
    const event = h.press(props);
    assert.equal(
      event.defaultPrevented,
      Boolean("defaultPrevented" in props && props.defaultPrevented),
      JSON.stringify(props),
    );
    assert.equal(h.select.value, "fit");
    assert.equal(h.changes.length, 0);
    assert.equal(h.renders(), 0);
  }
});

test("実関数: 入力targetまたはfocus、composition、drag、未接続とdisabledを保護する", () => {
  for (const flag of [
    "composing",
    "commentComposing",
    "dragged",
    "adapter",
    "disabled",
    "target",
    "active",
  ]) {
    const h = harness();
    let target = h.board as unknown;
    if (flag === "adapter") h.context.adapter = null;
    else if (flag === "disabled") h.select.disabled = true;
    else if (flag === "target") target = h.input;
    else if (flag === "active") h.document.activeElement = h.input;
    else h.context[flag] = true;
    assert.equal(h.press({ target }).defaultPrevented, false, flag);
    assert.equal(h.select.value, "fit", flag);
    assert.equal(h.changes.length, 0, flag);
  }
});

test("実関数: 可視overlayは遮断し、hidden/描画されないoverlayでは切替できる", () => {
  const h = harness();
  h.overlays.push({ hidden: false, getClientRects: () => [{}] });
  assert.equal(h.press().defaultPrevented, false);
  assert.equal(h.select.value, "fit");
  h.overlays[0].hidden = true;
  assert.equal(h.press().defaultPrevented, true);
  assert.equal(h.select.value, "pages");
  h.overlays[0].hidden = false;
  h.overlays[0].getClientRects = () => [];
  assert.equal(h.press().defaultPrevented, true);
  assert.equal(h.select.value, "fit");
});

test("実関数: 消えた付箋focusだけboardへ戻し、残る付箋とtoolbarfocusを奪わない", () => {
  const removed = harness();
  removed.renderFocus("removed");
  removed.press();
  assert.equal(removed.document.activeElement, removed.board);
  assert.equal(removed.boardFocusCalls(), 1);
  const retained = harness();
  retained.renderFocus("retained-task");
  retained.press();
  assert.equal(retained.boardFocusCalls(), 0);
  assert.notEqual(retained.document.activeElement, retained.task);
  const outside = harness();
  outside.document.activeElement = outside.body;
  outside.press();
  assert.equal(outside.document.activeElement, outside.body);
  assert.equal(outside.boardFocusCalls(), 0);
});
