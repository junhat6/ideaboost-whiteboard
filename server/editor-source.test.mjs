import test from "node:test";
import assert from "node:assert/strict";
import { EditorState } from "@codemirror/state";
import { patchRaw } from "../editor/raw.js";
test("editing selected text preserves untouched mixed CRLF and LF, including undo", () => {
  const raw = "## 日本語\r\n\r\nbody\n```\r\nURL\n```";
  const state = EditorState.create({ doc: raw });
  const from = state.doc.toString().indexOf("body");
  const tr = state.update({
    changes: { from, to: from + 4, insert: "新しい本文" },
  });
  const updated = patchRaw(raw, tr.changes, tr.state.lineBreak);
  assert.equal(updated, raw.replace("body", "新しい本文"));
  const undone = patchRaw(
    updated,
    tr.changes.invert(state.doc),
    state.lineBreak,
  );
  assert.equal(undone, raw);
});
