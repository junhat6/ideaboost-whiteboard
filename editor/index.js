import { prepareDiagrams, releaseDiagrams } from "./diagrams.js";
import { observeThumbnails, releaseThumbnails } from "./thumbnail-loader.js";
import { observeImages, releaseImages } from "./media-loader.js";
import { patchRaw } from "./raw.js";
import { livePreview, sourceMode } from "./live.js";
import { GFM } from "@lezer/markdown";
import { EditorState, Compartment, StateEffect } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import {
  defaultKeymap,
  history,
  historyKeymap,
  invertedEffects,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { marked } from "marked";
import DOMPurify from "dompurify";

const renderedSources = new WeakMap();
export function preview(source, target) {
  if (renderedSources.get(target) === source) return;
  clearPreview(target);
  renderedSources.set(target, source);
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
        "class",
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
  fragment.querySelectorAll("[class]").forEach(el=>{if(el.tagName!=="CODE"||el.className!=="language-mermaid")el.removeAttribute("class");});
  const images = [];
  const thumbnails = [];
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
    const media = mediaFigure(url, alt, "image", images, thumbnails);
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
        mediaFigure(url, "GitHubの添付ファイル", "unknown", images, thumbnails),
      );
  });
  fragment.querySelectorAll("input").forEach((i) => {
    i.type = "checkbox";
    i.disabled = true;
  });
  target.replaceChildren(fragment);
  prepareDiagrams(target);
  observeImages(target, images);
  observeThumbnails(target, thumbnails);
}
export function clearPreview(target) {
  renderedSources.delete(target);
  releaseDiagrams(target);
  releaseThumbnails(target);
  releaseImages(target);
  target.querySelectorAll("video").forEach((video) => {
    video.onerror = null;
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
const detectedKinds = new Map();
function rememberKind(url, kind) {
  detectedKinds.delete(url);
  detectedKinds.set(url, { kind, at: Date.now() });
  if (detectedKinds.size > 64)
    detectedKinds.delete(detectedKinds.keys().next().value);
}
function mediaFigure(url, alt, kind, images, thumbnails) {
  const figure = document.createElement("figure"),
    frame = document.createElement("div"),
    link = document.createElement("a"),
    status = document.createElement("span");
  figure.className = "media-shell";
  frame.className = "media-frame";
  status.className = "media-status";
  status.textContent = "近づくとプレビューを読み込みます";
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.textContent = "元の添付を開く ↗";
  figure.append(frame, link);
  frame.append(status);
  const known = detectedKinds.get(url);
  if (known && Date.now() - known.at < 300000) kind = known.kind;
  if (kind === "image") {
    const img = document.createElement("img");
    img.alt = alt;
    img.decoding = "async";
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.onload = () => (status.hidden = true);
    img.onerror = () => {
      status.hidden = false;
      status.textContent = "画像を表示できません。元の添付をご確認ください。";
      img.remove();
    };
    img.dataset.mediaSrc = url;
    frame.append(img);
    images.push(img);
  } else {
    thumbnails.push({
      figure,
      start: (signal) =>
        new Promise((resolve) => {
          let media = null,
            manual = false,
            settled = false;
          const done = () => {
            if (!settled) {
              settled = true;
              resolve();
            }
          };
          const valid = () =>
            !signal.aborted &&
            figure.isConnected &&
            !figure.closest("dialog")?.classList.contains("closing");
          const fail = () => {
            if (!valid()) return;
            status.hidden = false;
            status.textContent =
              "プレビューを表示できません。形式・アクセス権をご確認ください。";
            done();
          };
          signal.addEventListener(
            "abort",
            () => {
              if (media) {
                media.onload =
                  media.onerror =
                  media.onloadedmetadata =
                  media.onloadeddata =
                  media.onplay =
                    null;
                if (media.tagName === "VIDEO") {
                  media.pause();
                  media.removeAttribute("src");
                  media.load();
                } else media.removeAttribute("src");
                media.remove();
              }
              if (signal.reason === "timeout") {
                status.hidden = false;
                status.textContent =
                  "プレビューが時間内に取得できませんでした。元の添付から確認できます。";
              }
              done();
            },
            { once: true },
          );
          const videoPreview = () => {
            if (!valid()) {
              done();
              return;
            }
            const video = document.createElement("video");
            media = video;
            video.controls = true;
            video.preload = "metadata";
            video.playsInline = true;
            video.setAttribute("aria-label", alt || "添付動画");
            status.hidden = false;
            status.textContent = "動画の先頭画面を読み込み中…";
            frame.replaceChildren(status, video);
            video.onplay = () => {
              manual = true;
              status.hidden = true;
              done();
            };
            video.onloadedmetadata = () => {
              if (!valid() || manual) return;
              rememberKind(url, "video");
              if (
                video.readyState < 2 &&
                Number.isFinite(video.duration) &&
                video.duration > 0
              )
                video.currentTime = Math.min(0.001, video.duration / 2);
            };
            video.onloadeddata = () => {
              if (!valid() || manual) return;
              video.preload = "none";
              status.hidden = true;
              figure.dataset.preview = "video";
              done();
            };
            video.onerror = fail;
            video.src = url;
          };
          if (!valid()) {
            done();
            return;
          }
          if (kind === "video") {
            videoPreview();
            return;
          }
          const image = new Image();
          media = image;
          image.alt = alt;
          image.decoding = "async";
          image.referrerPolicy = "no-referrer";
          status.textContent = "添付のプレビューを読み込み中…";
          frame.append(image);
          image.onload = () => {
            if (!valid()) return;
            rememberKind(url, "image");
            status.hidden = true;
            figure.dataset.preview = "image";
            done();
          };
          image.onerror = () => {
            image.onload = image.onerror = null;
            image.removeAttribute("src");
            image.remove();
            videoPreview();
          };
          image.src = url;
        }),
    });
  }
  return figure;
}
export function createEditor(parent, initial, onChange, onComposition, onSave) {
  const editable = new Compartment();
  const restoreRaw = StateEffect.define();
  let raw = initial;
  let isDisabled = false;
  let isSource = false;
  function format(before, after = before) {
    if (isDisabled || view.composing) return;
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
  }
  const extensions = [
    history(),
    invertedEffects.of((tr) => (tr.docChanged ? [restoreRaw.of(raw)] : [])),
    markdown({ base: markdownLanguage, extensions: [GFM] }),
    livePreview(preview, clearPreview),
    keymap.of([
      {
        key: "Mod-Enter",
        run: () => {
          if (!view.composing) onSave();
          return true;
        },
      },
      ...[
        ["Mod-b", "**", "**"],
        ["Mod-i", "*", "*"],
        ["Mod-Shift-h", "## ", ""],
        ["Mod-Shift-l", "- ", ""],
        ["Mod-e", "`", "`"],
      ].map(([key, before, after]) => ({
        key,
        run: () => {
          format(before, after);
          return true;
        },
      })),
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    EditorView.lineWrapping,
    editable.of([EditorView.editable.of(true), EditorState.readOnly.of(false)]),
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
        const restored = update.transactions
          .flatMap((tr) => tr.effects)
          .findLast((e) => e.is(restoreRaw));
        raw = restored
          ? restored.value
          : patchRaw(raw, update.changes, raw.includes("\r\n") ? "\r\n" : "\n");
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
    return EditorState.create({ doc: value, extensions });
  }
  const view = new EditorView({ parent, state: state(initial) });
  return {
    source(value) {
      isSource = value;
      view.dispatch({ effects: sourceMode.of(value) });
    },
    get value() {
      return raw;
    },
    set(value) {
      if (value === raw) return;
      raw = value;
      view.setState(state(value));
      if (isSource) view.dispatch({ effects: sourceMode.of(true) });
      if (isDisabled)
        view.dispatch({
          effects: editable.reconfigure([
            EditorView.editable.of(false),
            EditorState.readOnly.of(true),
          ]),
        });
    },
    focus() {
      view.focus();
    },
    disabled(value) {
      if (isDisabled === value) return;
      isDisabled = value;
      view.dispatch({
        effects: editable.reconfigure([
          EditorView.editable.of(!value),
          EditorState.readOnly.of(value),
        ]),
      });
    },
    destroy() {
      view.destroy();
    },
    format,
  };
}
