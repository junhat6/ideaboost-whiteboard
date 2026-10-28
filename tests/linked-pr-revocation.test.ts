import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../web/app.js", import.meta.url), "utf8");
const begin = source.indexOf("let linkedPrFlight = null,");
const end = source.indexOf("const commentDrafts =", begin);
assert.ok(begin >= 0 && end > begin, "関連PRの実装抽出境界を確認");
const application = source.slice(begin, end);

const pr = (number: number, title: string) => ({
  number,
  title,
  url: `https://github.com/engineer-first/idea-boost/pull/${number}`,
  state: "OPEN",
  isDraft: false,
});
class Element {
  children: Element[] = [];
  attributes: Record<string, string> = {};
  hidden = false;
  private text = "";
  constructor(public tag: string) {}
  set textContent(value: string) {
    this.text = value;
    this.children = [];
  }
  get textContent(): string {
    return this.text + this.children.map((child) => child.textContent).join("");
  }
  append(...children: Element[]) {
    this.children.push(...children);
  }
  replaceChildren(...children: Element[]) {
    this.text = "";
    this.children = children;
  }
  setAttribute(key: string, value: string) {
    this.attributes[key] = value;
  }
}

// 実際のasync読取/世代判定を実行する。DOMと接続先だけstubする単体試験で、
// 実ブラウザー・stopPrivateScope内部の消去処理は別のbrowser specが検証する。
function harness() {
  let release!: (result: unknown) => void;
  let reject!: (error: Error) => void;
  const gate = new Promise((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  const root = new Element("section");
  const details = { open: true };
  const stops: string[] = [];
  const calls: number[] = [];
  const adapter = {
    loadPullRequests(number: number) {
      calls.push(number);
      return number === 100
        ? gate
        : Promise.resolve({ prs: [pr(701, "BのPR")], nextCursor: null });
    },
  };
  const context = vm.createContext({
    adapter,
    editorSession: 1,
    editorLatest: { number: 100 },
    $: (id: string) => (id === "#details" ? details : root),
    document: { createElement: (tag: string) => new Element(tag) },
    iconMarkup: () => "",
    stopPrivateScope(message: string) {
      stops.push(message);
    },
  });
  vm.runInContext(application, context);
  const run = (code: string) => vm.runInContext(code, context);
  const pending: Promise<void> = run("loadLinkedPrs()");
  return {
    pending,
    calls,
    stops,
    root,
    async openB() {
      run("editorSession++; clearLinkedPrs(); editorLatest = { number: 101 };");
      details.open = true;
      await run("loadLinkedPrs()");
      assert.equal(root.textContent, "#701 BのPR");
    },
    close() {
      run("editorSession++; clearLinkedPrs();");
      details.open = false;
    },
    // setAdapter changes ownership independently of the old read's session/token.
    // No new drawer read is required for an old source to become obsolete.
    replaceSource() {
      context.adapter = {
        loadPullRequests: async () => ({ prs: [], nextCursor: null }),
      };
      details.open = false;
    },
    ok() {
      release({ prs: [pr(700, "古いAのPR")], nextCursor: null });
      return pending;
    },
    fail(code: string) {
      reject(Object.assign(new Error(code), { code }));
      return pending;
    },
  };
}

test("実関数: 同sourceのA読取後にBを開いても遅着403は公開失効を通知する", async () => {
  const h = harness();
  await h.openB();
  await h.fail("scope_not_public");
  assert.deepEqual(h.stops, ["scope_not_public"]);
  assert.deepEqual(h.calls, [100, 101]);
});

test("実関数: drawerを閉じただけでも同sourceの遅着403を捨てない", async () => {
  const h = harness();
  h.close();
  await h.fail("scope_not_public");
  assert.deepEqual(h.stops, ["scope_not_public"]);
  assert.deepEqual(h.calls, [100]);
});

test("実関数: source交換後の旧403はsession/tokenが同じでも新接続を失効させない", async () => {
  const h = harness();
  h.replaceSource();
  await h.fail("scope_not_public");
  assert.deepEqual(h.stops, []);
  assert.deepEqual(h.calls, [100]);
});

test("実関数: 遅い成功は別Issueにも別sourceにもPRを混入させない", async () => {
  for (const owner of ["session", "source"]) {
    const h = harness();
    if (owner === "session") await h.openB();
    else h.replaceSource();
    const text = h.root.textContent;
    const children = [...h.root.children];
    await h.ok();
    assert.equal(h.root.textContent, text, owner);
    assert.deepEqual(h.root.children, children, owner);
    assert.deepEqual(h.stops, []);
  }
});

test("実関数: 遅い503は別Issue/別sourceの表示をエラーに置換しない", async () => {
  for (const owner of ["session", "source"]) {
    const h = harness();
    if (owner === "session") await h.openB();
    else h.replaceSource();
    const text = h.root.textContent;
    const children = [...h.root.children];
    await h.fail("github_unavailable");
    assert.equal(h.root.textContent, text, owner);
    assert.deepEqual(h.root.children, children, owner);
    assert.deepEqual(h.stops, []);
  }
});
