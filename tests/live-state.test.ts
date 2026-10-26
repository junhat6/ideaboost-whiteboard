import { test } from "node:test";
import assert from "node:assert/strict";
import { EditorState, StateEffect } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { livePreview, sourceMode } from "../editor/live.js";
test("unrelated transactions reuse decorations while document and source transitions recompute", () => {
  const ext = livePreview(
      () => {},
      () => {},
    ),
    field = ext[0];
  let state = EditorState.create({
    doc: "## 原文\n\n**本文**\n\n- [x] 項目",
    extensions: [markdown({ extensions: [GFM] }), ext],
  });
  const initial = state.field(field);
  state = state.update({ effects: StateEffect.define().of("unrelated") }).state;
  assert.equal(state.field(field), initial);
  state = state.update({ selection: { anchor: 4 } }).state;
  assert.equal(state.field(field), initial);
  state = state.update({ changes: { from: 3, insert: "追加" } }).state;
  assert.notEqual(state.field(field), initial);
  state = state.update({ effects: sourceMode.of(true) }).state;
  assert.equal(state.field(field).decorations.size, 0);
  state = state.update({ effects: sourceMode.of(false) }).state;
  assert.ok(state.field(field).decorations.size > 0);
  assert.equal(state.doc.toString(), "## 追加原文\n\n**本文**\n\n- [x] 項目");
});
