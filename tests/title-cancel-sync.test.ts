import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
function take(from: string, to: string) {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `実装の抽出境界: ${from} / ${to}`);
  return source.slice(start, end);
}

// ブラウザー試験の代替ではない。実際の同期・取消・イベント処理を読み込み、
// DOM・editorDraft/writeFieldの入出力・非対象描画をstubし、保存前の状態契約を検証する。
const application = [
  take("let titleEditing =", "let pendingEditorRemote ="),
  take("const editorFields =", "let editorHours"),
  take("function fieldValue(", "function editorDraft("),
  take("function setBaseField(", "function setEdit("),
  take("function setComposition(", "async function ensureComposer("),
  take("function reconcileEditor(", "function renderConflicts("),
  take("function sizeTitle(", "let sourceVisible = false;"),
].join("\n");

function harness() {
  const baseline = {
    id: "synthetic-title-task",
    title: "元タイトル",
    body: "元本文",
    assignees: [],
    status: "未整理",
    revision: "synthetic-original",
  };
  const draft: Record<string, unknown> = { ...baseline, assignees: [] };
  const elements = new Map<string, any>();
  const headingParent = { hidden: false };
  const element = (id: string) => {
    if (!elements.has(id)) {
      const listeners = new Map<string, ((event: any) => void)[]>();
      elements.set(id, {
        value: id === "#detail-title" ? baseline.title : "",
        open: true,
        hidden: false,
        options: [],
        style: {},
        scrollHeight: 26,
        focus() {},
        closest: () => headingParent,
        addEventListener(name: string, handler: (event: any) => void) {
          listeners.set(name, [...(listeners.get(name) || []), handler]);
        },
        dispatch(name: string, properties: Record<string, unknown> = {}) {
          const event = {
            target: this,
            preventDefault() {},
            stopPropagation() {},
            ...properties,
          };
          for (const handler of listeners.get(name) || []) handler(event);
        },
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    clone: structuredClone,
    $: element,
    state: { assigneeOptions: [] },
    adapter: {},
    editing: { kind: "Task", id: baseline.id },
    editorSession: 1,
    editorBaseline: structuredClone(baseline),
    editorLatest: structuredClone(baseline),
    editorConflicts: {},
    pendingEditorRemote: undefined,
    composing: false,
    fillingDetail: false,
    editorSaved: false,
    editMode: false,
    activeSave: () => null,
    renderAuthor() {},
    renderConflicts() {},
    syncEditorControls() {},
    ensureComposer() {},
    editorDraft: () => ({ ...draft, title: element("#detail-title").value }),
    writeField(key: string, value: unknown) {
      if (key === "title") element("#detail-title").value = value;
      else draft[key] = value;
    },
  });
  vm.runInContext(application, context);
  const run = (code: string) => vm.runInContext(code, context);
  const refresh = (title: string, body = baseline.body) => {
    context.remote = { ...baseline, title, body, revision: `remote-${title}` };
    run("reconcileEditor(remote)");
  };
  const type = (value: string) => {
    element("#detail-title").value = value;
    element("#detail-title").dispatch("input");
  };
  return {
    start: () => element("#rename-issue").onclick(),
    type,
    refresh,
    clear: () => run("clearTitleEdit()"),
    hasAnchor: () => run("titleCancelAnchor !== null") as boolean,
    changeOwner(owner: "source" | "session" | "id" | "kind") {
      run(
        {
          source: "adapter = {}",
          session: "editorSession++",
          id: 'editing = { ...editing, id: "another-synthetic-task" }',
          kind: 'editing = { ...editing, kind: "PBI" }',
        }[owner],
      );
    },
    body(value: string) {
      draft.body = value;
      run("updateDirty()");
    },
    key: (key: string) => element("#detail-title").dispatch("keydown", { key }),
    blur: () => element("#detail-title").dispatch("blur"),
    composition: (phase: "start" | "end") =>
      element("#detail-title").dispatch(`composition${phase}`),
    read: () =>
      JSON.parse(
        run(`JSON.stringify({
          title: $("#detail-title").value,
          baseTitle: editorBaseline.title,
          latestTitle: editorLatest.title,
          body: editorDraft().body,
          baseBody: editorBaseline.body,
          conflicts: editorConflicts,
          dirty: editMode,
          titleEditing,
          composing,
        })`),
      ),
  };
}

function assertClean(h: ReturnType<typeof harness>, title: string) {
  assert.deepEqual(h.read(), {
    title,
    baseTitle: title,
    latestTitle: title,
    body: "元本文",
    baseBody: "元本文",
    conflicts: {},
    dirty: false,
    titleEditing: false,
    composing: false,
  });
}

test("実関数: 未入力の鉛筆中に同期したタイトルはEscape後も最新かつclean", () => {
  const h = harness();
  h.start();
  h.refresh("最新タイトル");
  assert.equal(h.read().dirty, false);
  h.key("Escape");
  assertClean(h, "最新タイトル");
});

test("実関数: 今回のタイトル取消はtitle競合だけ解消し本文の下書きと競合を残す", () => {
  const h = harness();
  h.body("利用者の本文下書き");
  h.start();
  h.type("今回のタイトル下書き");
  h.refresh("最新タイトル", "外部の本文");
  assert.deepEqual(h.read().conflicts, {
    title: { remote: "最新タイトル" },
    body: { remote: "外部の本文" },
  });
  h.key("Escape");
  assert.deepEqual(h.read(), {
    title: "最新タイトル",
    baseTitle: "最新タイトル",
    latestTitle: "最新タイトル",
    body: "利用者の本文下書き",
    baseBody: "元本文",
    conflicts: { body: { remote: "外部の本文" } },
    dirty: true,
    titleEditing: false,
    composing: false,
  });
});

test("実関数: 受け入れ済み未保存Draft1はDraft2の取消で破棄しない", () => {
  const h = harness();
  h.start();
  h.type("Draft1");
  h.key("Enter");
  h.start();
  h.type("Draft2");
  h.refresh("外部タイトル");
  h.key("Escape");
  assert.deepEqual(h.read(), {
    title: "Draft1",
    baseTitle: "元タイトル",
    latestTitle: "外部タイトル",
    body: "元本文",
    baseBody: "元本文",
    conflicts: { title: { remote: "外部タイトル" } },
    dirty: true,
    titleEditing: false,
    composing: false,
  });
});

test("実関数: 複数回の同期と鉛筆再開の取消は最後の最新値を保持する", () => {
  const h = harness();
  h.start();
  h.refresh("外部更新1");
  h.refresh("外部更新2");
  h.key("Escape");
  assertClean(h, "外部更新2");
  h.start();
  h.type("追加下書き");
  h.refresh("外部更新3");
  h.key("Escape");
  assertClean(h, "外部更新3");
});

test("実関数: 外部更新なしのEscapeは今回の入力だけ取り消す", () => {
  const h = harness();
  h.start();
  h.type("今回の入力");
  h.key("Escape");
  assertClean(h, "元タイトル");
});

test("実関数: IME中はEscapeを無視し終了後のEscapeで受信済み最新値へ戻す", () => {
  const h = harness();
  h.start();
  h.type("変換中の入力");
  h.composition("start");
  h.refresh("変換中の外部更新");
  h.key("Escape");
  assert.equal(h.read().title, "変換中の入力");
  assert.equal(h.read().titleEditing, true);
  assert.equal(h.read().composing, true);
  h.composition("end");
  assert.deepEqual(h.read().conflicts, {
    title: { remote: "変換中の外部更新" },
  });
  h.key("Escape");
  assertClean(h, "変換中の外部更新");
});

for (const accept of ["Enter", "blur"] as const) {
  test(`実関数: ${accept}は取消と異なり今回の入力と競合を受け入れる`, () => {
    const h = harness();
    h.start();
    h.type("受け入れるタイトル");
    h.refresh("外部更新");
    if (accept === "Enter") h.key("Enter");
    else h.blur();
    assert.equal(h.read().title, "受け入れるタイトル");
    assert.equal(h.read().titleEditing, false);
    assert.equal(h.read().dirty, true);
    assert.deepEqual(h.read().conflicts, { title: { remote: "外部更新" } });
    h.start();
    h.type("次の編集だけ取り消す");
    h.key("Escape");
    assert.equal(h.read().title, "受け入れるタイトル");
    assert.deepEqual(h.read().conflicts, { title: { remote: "外部更新" } });
  });
}

test("実関数: clearTitleEditは取消値を破棄し後続Escapeで復元しない", () => {
  const h = harness();
  h.start();
  h.type("クリア直前の入力");
  assert.equal(h.hasAnchor(), true);
  h.clear();
  assert.equal(h.hasAnchor(), false);
  assert.equal(h.read().titleEditing, false);
  h.key("Escape");
  assert.equal(h.read().title, "クリア直前の入力");
  assert.equal(h.read().dirty, true);
  assert.equal(h.hasAnchor(), false);
});

for (const owner of ["source", "session"] as const) {
  test(`実関数: ${owner}が変わった取消値を現在の入力へ適用しない`, () => {
    const h = harness();
    h.start();
    h.type("保持する現在の入力");
    h.refresh("前の所有者の外部更新");
    const before = h.read();
    h.changeOwner(owner);
    h.key("Escape");
    assert.deepEqual(h.read(), { ...before, titleEditing: false });
    assert.equal(h.hasAnchor(), false);
  });
}

test("実関数: Issueのidまたはkindが変わった取消値を現在の入力へ適用しない", () => {
  for (const owner of ["id", "kind"] as const) {
    const h = harness();
    h.start();
    h.type("保持する現在の入力");
    h.refresh("前のIssueの外部更新");
    const before = h.read();
    h.changeOwner(owner);
    h.key("Escape");
    assert.deepEqual(h.read(), { ...before, titleEditing: false }, owner);
    assert.equal(h.hasAnchor(), false, owner);
  }
});
