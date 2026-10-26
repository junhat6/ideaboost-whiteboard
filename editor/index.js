import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { marked } from "marked";
import DOMPurify from "dompurify";

export function preview(source, target) {
  clearPreview(target);
  const fragment = DOMPurify.sanitize(
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
        "img",
      ],
      RETURN_DOM_FRAGMENT: true,
      ALLOWED_ATTR: [
        "href",
        "title",
        "start",
        "type",
        "checked",
        "disabled",
        "src",
        "alt",
      ],
    },
  );
  const images = [];
  fragment.querySelectorAll("img").forEach((img) => {
    const url = safeMediaUrl(img.getAttribute("src"));
    const alt = img.getAttribute("alt") || "添付画像";
    img.setAttribute("data-original-src", img.getAttribute("src") || "");
    img.removeAttribute("src");
    if (!url) {
      const fallback = document.createElement("a");
      fallback.textContent = alt + "（元の画像）";
      const source = img.getAttribute("data-original-src");
      if (source && /^https?:\/\//i.test(source)) {
        fallback.href = source;
        fallback.target = "_blank";
        fallback.rel = "noopener noreferrer";
      }
      img.replaceWith(fallback);
      return;
    }
    const media = mediaFigure(url, alt, "image", images);
    img.replaceWith(media);
  });
  fragment.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href") || "";
    if (!/^(https?:\/\/|mailto:)/i.test(href)) a.removeAttribute("href");
    a.target = "_blank";
    a.rel = "noopener noreferrer";
  });
  fragment.querySelectorAll("a").forEach((a) => {
    const url = safeMediaUrl(a.getAttribute("href"));
    if (
      !url ||
      a.closest("pre, code, figure") ||
      a.textContent.trim() !== a.getAttribute("href")
    )
      return;
    const parent = a.parentElement;
    if (
      parent?.tagName === "P" &&
      parent.textContent.trim() === a.textContent.trim()
    )
      parent.replaceWith(
        mediaFigure(url, "GitHubの添付ファイル", "unknown", images),
      );
  });
  fragment.querySelectorAll("input").forEach((i) => {
    i.type = "checkbox";
    i.disabled = true;
  });
  target.replaceChildren(fragment);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          const img = entry.target;
          observer.unobserve(img);
          if (target.contains(img)) {
            img.src = img.dataset.mediaSrc;
            delete img.dataset.mediaSrc;
          }
        }
    },
    { root: target.closest("dialog"), rootMargin: "200px" },
  );
  observers.set(target, observer);
  images.forEach((img) => observer.observe(img));
}
const observers = new WeakMap();
export function clearPreview(target) {
  observers.get(target)?.disconnect();
  observers.delete(target);
  target.querySelectorAll("img").forEach((img) => img.removeAttribute("src"));
  target.querySelectorAll("video").forEach((video) => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  });
  target.replaceChildren();
}
export function safeMediaUrl(value) {
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      u.search ||
      u.hash
    )
      return null;
    if (
      u.hostname === "github.com" &&
      /^\/user-attachments\/assets\/[a-f0-9-]{36}$/i.test(u.pathname)
    )
      return u.href;
    if (
      u.hostname === "user-images.githubusercontent.com" &&
      /^\/[0-9]+\/[A-Za-z0-9._-]+$/.test(u.pathname)
    )
      return u.href;
  } catch {}
  return null;
}
function mediaFigure(url, alt, kind, images) {
  const figure = document.createElement("figure"),
    frame = document.createElement("div"),
    link = document.createElement("a"),
    status = document.createElement("span");
  figure.className = "media-shell";
  frame.className = "media-frame";
  status.className = "media-status";
  status.textContent =
    kind === "image"
      ? "画像は表示位置に近づくと読み込みます"
      : "添付ファイルは操作後に読み込みます";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "元の添付を開く ↗";
  figure.append(frame, link);
  frame.append(status);
  const addImage = (lazy) => {
    frame.replaceChildren(status);
    status.textContent = "画像を読み込み中…";
    const img = document.createElement("img");
    img.alt = alt;
    img.decoding = "async";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onload = () => {
      status.hidden = true;
    };
    img.onerror = () => {
      status.hidden = false;
      status.textContent = "画像を表示できません。元の添付をご確認ください。";
      img.remove();
    };
    if (lazy) {
      img.dataset.mediaSrc = url;
      images.push(img);
    } else img.src = url;
    frame.append(img);
  };
  if (kind === "image") addImage(true);
  else {
    const controls = document.createElement("div");
    controls.className = "media-choices";
    const videoButton = document.createElement("button"),
      imageButton = document.createElement("button");
    videoButton.type = imageButton.type = "button";
    videoButton.textContent = "動画として再生";
    imageButton.textContent = "画像として表示";
    imageButton.onclick = () => addImage(false);
    videoButton.onclick = () => {
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "none";
      video.playsInline = true;
      video.setAttribute("aria-label", alt);
      video.src = url;
      video.onerror = () => {
        status.hidden = false;
        status.textContent =
          "このブラウザで再生できません。元の添付をご確認ください。";
      };
      status.hidden = true;
      frame.replaceChildren(status, video);
      video.play().catch(() => {
        status.hidden = false;
        status.textContent = "プレーヤーの再生ボタンを押してください。";
      });
    };
    controls.append(videoButton, imageButton);
    frame.append(controls);
  }
  return figure;
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
        fontSize: "16px",
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
