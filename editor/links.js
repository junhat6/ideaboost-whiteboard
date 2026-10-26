import { StateField, StateEffect } from "@codemirror/state";
import { EditorView, hoverTooltip, showTooltip } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { marked } from "marked";
const refs = new WeakMap();
function safeUrl(value) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function linkAt(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, -1),
    candidate = null;
  for (let n = node; n; n = n.parent) {
    if (
      ["FencedCode", "CodeBlock", "InlineCode", "Image", "HTMLBlock"].includes(
        n.name,
      )
    )
      return null;
    if (["Link", "Autolink"].includes(n.name)) candidate = n;
    else if (n.name === "URL" && !candidate) candidate = n;
  }
  if (!candidate) return null;
  const text = state.sliceDoc(candidate.from, candidate.to);
  let href;
  if (candidate.name === "URL") href = text;
  else {
    let links = refs.get(state.doc);
    if (!links) {
      links = marked.lexer(state.doc.toString(), { gfm: true }).links;
      refs.set(state.doc, links);
    }
    const lexer = new marked.Lexer({ gfm: true });
    lexer.tokens.links = links;
    href = lexer.inlineTokens(text).find((t) => t.type === "link")?.href;
  }
  const url = safeUrl(href);
  return url ? { from: candidate.from, to: candidate.to, url } : null;
}
function tooltip(link) {
  return {
    pos: link.from,
    end: link.to,
    above: true,
    arrow: true,
    create() {
      const dom = document.createElement("a");
      dom.className = "editor-link-open";
      dom.href = link.url;
      dom.target = "_blank";
      dom.rel = "noopener noreferrer";
      dom.textContent = "↗";
      dom.setAttribute("aria-label", "リンクを開く（新しいタブ）");
      dom.dataset.tooltip = link.url;
      return { dom };
    },
  };
}
export function editableLinks() {
  const focus = StateEffect.define();
  const focused = StateField.define({
    create: () => false,
    update(value, tr) {
      for (const e of tr.effects) if (e.is(focus)) value = e.value;
      return value;
    },
  });
  return [
    focused,
    showTooltip.computeN([focused, "selection", "doc"], (state) => {
      if (!state.field(focused) || !state.selection.main.empty) return [];
      const link = linkAt(state, state.selection.main.head);
      return link ? [tooltip(link)] : [];
    }),
    hoverTooltip(
      (view, pos) => {
        if (view.composing) return null;
        const link = linkAt(view.state, pos);
        if (!link) return null;
        const current = linkAt(view.state, view.state.selection.main.head);
        if (
          view.hasFocus &&
          current?.url === link.url &&
          current?.from === link.from
        )
          return null;
        return tooltip(link);
      },
      { hoverTime: 0, hideOnChange: true },
    ),
    EditorView.domEventHandlers({
      focus(_event, view) {
        queueMicrotask(() => {
          if (view.dom.isConnected) view.dispatch({ effects: focus.of(true) });
        });
      },
      blur(event, view) {
        if (event.relatedTarget?.closest?.(".editor-link-open")) return;
        queueMicrotask(() => {
          if (view.dom.isConnected) view.dispatch({ effects: focus.of(false) });
        });
      },
      compositionstart(_event, view) {
        queueMicrotask(() => {
          if (view.dom.isConnected) view.dispatch({ effects: focus.of(false) });
        });
      },
      compositionend(_event, view) {
        queueMicrotask(() => {
          if (view.dom.isConnected)
            view.dispatch({ effects: focus.of(view.hasFocus) });
        });
      },
      mousedown(event, view) {
        const mac = /Mac|iPhone|iPad/.test(navigator.platform);
        if (
          event.button !== 0 ||
          event.altKey ||
          event.shiftKey ||
          view.composing ||
          !(mac
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey)
        )
          return false;
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) return false;
        const link = linkAt(view.state, pos);
        if (!link) return false;
        event.preventDefault();
        window.open(link.url, "_blank", "noopener,noreferrer");
        return true;
      },
    }),
  ];
}
