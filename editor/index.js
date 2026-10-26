import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { marked } from "marked";
import DOMPurify from "dompurify";

export function preview(source, target) {
  target.innerHTML = DOMPurify.sanitize(
    marked.parse(source, { gfm: true, breaks: false }),
    {
      ALLOWED_TAGS: [
        "p",
        "br",
        "hr",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "strong",
        "em",
        "del",
        "blockquote",
        "ul",
        "ol",
        "li",
        "pre",
        "code",
        "a",
        "table",
        "thead",
        "tbody",
        "tr",
        "th",
        "td",
        "input",
      ],
      ALLOWED_ATTR: ["href", "title", "start", "type", "checked", "disabled"],
    },
  );
  target.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!/^(https?:\/\/|mailto:)/i.test(href)) a.removeAttribute("href");
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  target.querySelectorAll("input").forEach((i) => {
    i.type = "checkbox";
    i.disabled = true;
  });
}
export function createEditor(parent, initial, onChange, onComposition, onSave) {
  const editable = new Compartment();
  let raw = initial;
  let isDisabled = false;
  const extensions = [
    history(),
    markdown({ base: markdownLanguage }),
    keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          if (!view.composing) onSave();
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
    editable.of(EditorView.editable.of(true)),
    EditorView.contentAttributes.of({
      "aria-label": "本文（Markdown）",
      spellcheck: "false",
    }),
    syntaxHighlighting(
      HighlightStyle.define([
        { tag: tags.heading1, fontSize: "1.6em", fontWeight: "650" },
        { tag: tags.heading2, fontSize: "1.3em", fontWeight: "650" },
        {
          tag: [tags.heading3, tags.heading4],
          fontSize: "1.1em",
          fontWeight: "650",
        },
        { tag: tags.strong, fontWeight: "700" },
        { tag: tags.emphasis, fontStyle: "italic" },
        { tag: tags.strikethrough, textDecoration: "line-through" },
        { tag: tags.link, color: "var(--green)", textDecoration: "underline" },
        {
          tag: [tags.monospace, tags.url],
          fontFamily: "ui-monospace, monospace",
        },
        { tag: tags.processingInstruction, color: "var(--muted)" },
      ]),
    ),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        raw = update.state.sliceDoc();
        onChange(raw);
      }
    }),
    EditorView.domEventHandlers({
      compositionstart: () => {
        onComposition(true);
      },
      compositionend: () => {
        queueMicrotask(() => onComposition(false));
      },
    }),
    EditorView.theme({
      "&": {
        fontSize: "15px",
        color: "var(--ink)",
        backgroundColor: "var(--surface)",
      },
      ".cm-scroller": {
        fontFamily: "inherit",
        lineHeight: "1.85",
        overflow: "visible",
      },
      ".cm-content": {
        padding: "20px 24px",
        minHeight: "420px",
        caretColor: "var(--ink)",
      },
      ".cm-line": { padding: "0" },
      "&.cm-focused": { outline: "none" },
      ".cm-selectionBackground": { backgroundColor: "#4657b830 !important" },
      ".cm-cursor": { borderLeftColor: "var(--ink)" },
    }),
  ];
  function state(value) {
    const lineSeparator =
      value.includes("\r\n") && !/(?<!\r)\n/.test(value) ? "\r\n" : "\n";
    return EditorState.create({
      doc: value,
      extensions: [...extensions, EditorState.lineSeparator.of(lineSeparator)],
    });
  }
  const view = new EditorView({ parent, state: state(initial) });
  return {
    get value() {
      return raw;
    },
    set(value) {
      if (value === raw) return;
      raw = value;
      view.setState(state(value));
      if (isDisabled)
        view.dispatch({
          effects: editable.reconfigure(EditorView.editable.of(false)),
        });
    },
    focus() {
      view.focus();
    },
    disabled(value) {
      if (isDisabled === value) return;
      isDisabled = value;
      view.dispatch({
        effects: editable.reconfigure(EditorView.editable.of(!value)),
      });
    },
    destroy() {
      view.destroy();
    },
    format(before, after = before) {
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: {
          from,
          to,
          insert: before + view.state.sliceDoc(from, to) + after,
        },
        selection: { anchor: from + before.length, head: to + before.length },
        userEvent: "input",
      });
      view.focus();
    },
  };
}
