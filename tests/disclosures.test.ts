import { test } from "node:test";
import assert from "node:assert/strict";
import { disclosures } from "../editor/disclosures.js";
test("disclosure source ranges are complete, inert and exclude fenced code", () => {
  const raw =
    '<details id="x" onclick="bad()" open>\r\n<summary>経緯 <strong>原文</strong></summary>\r\n\r\n## 見出し\r\n\r\n- 項目\r\n</details>';
  const d = disclosures(raw)[0];
  assert.equal(d.valid, true);
  assert.equal(d.open, true);
  assert.equal(d.raw, raw);
  assert.equal(d.to, raw.length);
  assert.equal(d.summary, "経緯 原文");
  assert.match(d.body, /\r\n## 見出し/);
  assert.deepEqual(disclosures("```html\n" + raw + "\n```"), []);
  for (const text of [
    "<details>本文</details>",
    "<details><summary>題</summary>本文",
  ])
    assert.equal(disclosures(text)[0].valid, false);
  const nested =
    "<details><summary>題</summary>\n".repeat(6) +
    "本文" +
    "\n</details>".repeat(6);
  assert.equal(disclosures(nested)[0].valid, false);
});
