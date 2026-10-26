import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { linkAt } from "../editor/links.js";
test("syntax-aware live links resolve inline/autolink/reference and reject code/images/unsafe URLs", () => {
  const source =
    "[inline](https://example.com/a)\n<https://example.com/b>\n[reference][id]\n\n[id]: https://example.com/c\n\n[javascript](javascript:alert(1))\n![image](https://example.com/image)\n`https://example.com/code`\n\n```\nhttps://example.com/fence\n```";
  const state = EditorState.create({
    doc: source,
    extensions: [markdown({ extensions: [GFM] })],
  });
  for (const [text, url] of [
    ["inline", "https://example.com/a"],
    ["https://example.com/b", "https://example.com/b"],
    ["reference", "https://example.com/c"],
  ])
    assert.equal(linkAt(state, source.indexOf(text) + 2)?.url, url);
  for (const text of [
    "javascript]",
    "image]",
    "https://example.com/code",
    "https://example.com/fence",
  ])
    assert.equal(linkAt(state, source.indexOf(text) + 2), null);
});
