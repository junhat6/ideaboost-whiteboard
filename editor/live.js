import { disclosures } from "./disclosures.js";
import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";

const activity = StateEffect.define();
export const sourceMode = StateEffect.define();
class Inline extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) {
    return this.text === other.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "live-marker";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() {
    return false;
  }
}
class Block extends WidgetType {
  constructor(source, render, clear) {
    super();
    this.source = source;
    this.render = render;
    this.clear = clear;
  }
  eq(other) {
    return this.source === other.source;
  }
  toDOM(view) {
    const root = document.createElement("div");
    root.className = "live-block";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "live-block-edit";
    edit.textContent = "✎";
    edit.title = "この部分を編集";
    edit.setAttribute("aria-label", "この部分を編集");
    const content = document.createElement("div");
    content.className = "markdown-preview";
    this.render(this.source, content);
    root.append(edit, content);
    edit.onclick = () => {
      const pos = view.posAtDOM(root);
      view.dispatch({ selection: { anchor: pos } });
      view.focus();
    };
    return root;
  }
  destroy(dom) {
    this.clear(dom.querySelector(".markdown-preview"));
  }
}
export function livePreview(render, clear) {
  let disclosureDoc = null,
    disclosureRanges = [];
  const field = StateField.define({
    create(state) {
      return {
        focused: false,
        composing: false,
        source: false,
        decorations: build(state, false, false, false),
      };
    },
    update(value, tr) {
      let { focused, composing, source } = value;
      for (const e of tr.effects) {
        if (e.is(activity)) ({ focused, composing } = e.value);
        if (e.is(sourceMode)) source = e.value;
      }
      return {
        focused,
        composing,
        source,
        decorations: build(tr.state, focused, composing, source),
      };
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.decorations),
  });
  function build(state, focused, composing, source) {
    if (source || composing) return Decoration.none;
    const ranges = [];
    const active = (from, to) =>
      focused &&
      state.selection.ranges.some((r) => {
        const first = state.doc.lineAt(r.from).from,
          last = state.doc.lineAt(r.to).to;
        return from <= last && to >= first;
      });
    const hide = (from, to, widget) => {
      if (to > from)
        ranges.push(
          Decoration.replace(widget ? { widget } : {}).range(from, to),
        );
    };
    if (disclosureDoc !== state.doc) {
      disclosureDoc = state.doc;
      disclosureRanges = disclosures(state.doc.toString());
    }
    for (const d of disclosureRanges)
      if (!active(d.from, d.to))
        ranges.push(
          Decoration.replace({
            block: true,
            widget: new Block(state.sliceDoc(d.from, d.to), render, clear),
          }).range(d.from, d.to),
        );
    syntaxTree(state).iterate({
      enter(n) {
        if (disclosureRanges.some((d) => n.from >= d.from && n.to <= d.to))
          return false;
        const name = n.name,
          text = state.sliceDoc(n.from, n.to);
        if (name === "HTMLBlock" && !/^<img\s/i.test(text.trim())) return false;
        if (
          ["Table", "FencedCode", "CodeBlock"].includes(name) ||
          (["Paragraph", "HTMLBlock"].includes(name) &&
            /^(?:https:\/\/github\.com\/user-attachments\/assets\/|!\[|<img\s)/.test(
              text.trim(),
            ))
        ) {
          if (!active(n.from, n.to)) {
            ranges.push(
              Decoration.replace({
                block: true,
                widget: new Block(text, render, clear),
              }).range(n.from, n.to),
            );
            return false;
          }
        }
        if (/^ATXHeading[1-6]$/.test(name))
          ranges.push(
            Decoration.line({
              class: `live-heading live-h${name.slice(-1)}`,
            }).range(state.doc.lineAt(n.from).from),
          );
        if (active(n.from, n.to)) return;
        if (name === "HeaderMark")
          hide(n.from, Math.min(n.to + 1, state.doc.lineAt(n.to).to));
        if (["EmphasisMark", "StrikethroughMark", "CodeMark"].includes(name))
          hide(n.from, n.to);
        if (name === "ListMark")
          hide(n.from, n.to, new Inline(/^\d/.test(text) ? text : "•"));
        if (name === "TaskMarker")
          hide(n.from, n.to, new Inline(/x/i.test(text) ? "☑" : "☐"));
        if (name === "QuoteMark") hide(n.from, n.to, new Inline("▎"));
        if (name === "Link") {
          const match = text.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
          if (match) {
            hide(n.from, n.from + 1);
            hide(n.from + 1 + match[1].length, n.to);
            ranges.push(
              Decoration.mark({
                class: "live-link",
                attributes: { title: match[2] },
              }).range(n.from + 1, n.from + 1 + match[1].length),
            );
            return false;
          }
        }
      },
    });
    return Decoration.set(ranges, true);
  }
  // view.composing can remain false until the first composition document change.
  // DOM composition events own this state from the start, independently of that lag.
  let composingSession = false;
  const notify = (view) => {
    if (!view.dom.isConnected) return;
    const v = view.state.field(field, false);
    if (v && (v.focused !== view.hasFocus || v.composing !== composingSession))
      view.dispatch({
        effects: activity.of({
          focused: view.hasFocus,
          composing: composingSession,
        }),
      });
  };
  return [
    field,
    EditorView.domEventHandlers({
      focus: (_, v) => {
        queueMicrotask(() => notify(v));
      },
      blur: (_, v) => {
        queueMicrotask(() => notify(v));
      },
      compositionstart: (_, v) => {
        composingSession = true;
        queueMicrotask(() => notify(v));
      },
      compositionend: (_, v) => {
        composingSession = false;
        requestAnimationFrame(() => notify(v));
      },
    }),
  ];
}
