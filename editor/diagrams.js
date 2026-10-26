import DOMPurify from "dompurify";
const jobs = new WeakMap();
let queue = [],
  active = null,
  worker = null,
  serial = 0;
function valid(j) {
  const d = j.figure.closest("dialog");
  return (
    !j.disposed &&
    j.figure.isConnected &&
    (!d || (d.open && !d.classList.contains("closing")))
  );
}
function stopWorker() {
  worker?.terminate();
  worker = null;
}
function finish(j, result) {
  clearTimeout(j.timer);
  if (active === j) active = null;
  if (valid(j)) {
    if (result?.svg) {
      const fragment = DOMPurify.sanitize(result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        RETURN_DOM_FRAGMENT: true,
        FORBID_TAGS: [
          "script",
          "style",
          "foreignObject",
          "a",
          "image",
          "animate",
          "animateMotion",
          "animateTransform",
          "set",
        ],
      });
      for (const el of fragment.querySelectorAll("*"))
        for (const a of [...el.attributes]) {
          if (
            (/href$/i.test(a.name) && !a.value.startsWith("#")) ||
            (/url\s*\(/i.test(a.value) && !/^(?:url\(#[\w-]+\))$/.test(a.value))
          )
            el.removeAttribute(a.name);
        }
      j.canvas.replaceChildren(fragment);
      j.figure.dataset.renderMs = String(Math.round(result.ms));
      j.message.hidden = true;
      j.tools.hidden = false;
      j.svg = j.canvas.querySelector("svg");
      fit(j);
    } else {
      j.message.textContent =
        "図を表示できません。構文またはサイズを確認してください。";
      j.source.hidden = false;
    }
  }
  queueMicrotask(pump);
}
function pump() {
  if (active) return;
  let j;
  while ((j = queue.shift())) {
    if (valid(j)) break;
  }
  if (!j || !valid(j)) return;
  active = j;
  j.message.textContent = "図を描画中…";
  try {
    if (!worker) {
      worker = new Worker(new URL("./diagram-worker.js", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }) => {
        if (active?.id === data.id) finish(active, data);
      };
      worker.onerror = () => {
        const current = active;
        stopWorker();
        if (current) finish(current, null);
      };
    }
    j.timer = setTimeout(() => {
      stopWorker();
      finish(j, null);
    }, 3000);
    worker.postMessage({ id: j.id, source: j.code });
  } catch {
    finish(j, null);
  }
}
function fit(j) {
  j.scale = 1;
  j.canvas.dataset.zoomed = "false";
  if (j.svg) {
    const box = j.svg.viewBox.baseVal;
    j.fitWidth = Math.min(
      box.width || 600,
      j.canvas.clientWidth || 600,
      ((box.width || 600) * 480) / (box.height || 480),
    );
    j.svg.style.width = `${j.fitWidth}px`;
    j.svg.style.maxWidth = "none";
    j.svg.style.height = "auto";
  }
  j.canvas.scrollLeft = j.canvas.scrollTop = 0;
}
export function prepareDiagrams(target) {
  const items = [];
  for (const code of target.querySelectorAll("pre > code.language-mermaid")) {
    const source = code.textContent;
    const pre = code.parentElement;
    const figure = document.createElement("figure"),
      message = document.createElement("p"),
      tools = document.createElement("div"),
      canvas = document.createElement("div"),
      details = document.createElement("details"),
      summary = document.createElement("summary");
    figure.className = "diagram-shell";
    canvas.className = "diagram-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute(
      "aria-label",
      "Mermaid図。拡大はボタン、拡大後はドラッグで移動。ホイールは本文をスクロールします",
    );
    tools.className = "diagram-tools";
    tools.hidden = true;
    message.className = "diagram-status";
    message.textContent = "近づくと図を描画します";
    summary.textContent = "図の原文";
    details.append(summary, pre.cloneNode(true));
    details.hidden = true;
    const j = {
      figure,
      code: source,
      message,
      tools,
      canvas,
      source: details,
      scale: 1,
      id: ++serial,
      disposed: false,
      observer: null,
      timer: null,
      svg: null,
    };
    for (const [label, text, action] of [
      ["拡大", "＋", () => zoom(j, 1.25)],
      ["縮小", "−", () => zoom(j, 0.8)],
      ["全体を表示", "⤢", () => fit(j)],
      [
        "原文を表示",
        "</>",
        () => {
          details.hidden = !details.hidden;
          details.open = !details.hidden;
        },
      ],
    ]) {
      const b = document.createElement("button");
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.textContent = text;
      b.onclick = action;
      tools.append(b);
    }
    let drag = null;
    canvas.onpointerdown = (e) => {
      if (j.scale <= 1 || e.button !== 0) return;
      drag = {
        x: e.clientX,
        y: e.clientY,
        left: canvas.scrollLeft,
        top: canvas.scrollTop,
      };
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    };
    canvas.onpointermove = (e) => {
      if (drag) {
        canvas.scrollLeft = drag.left + drag.x - e.clientX;
        canvas.scrollTop = drag.top + drag.y - e.clientY;
      }
    };
    canvas.onpointerup = canvas.onpointercancel = () => {
      drag = null;
    };
    canvas.onkeydown = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key === "+" || e.key === "=") {
        zoom(j, 1.25);
        e.preventDefault();
      } else if (e.key === "-") {
        zoom(j, 0.8);
        e.preventDefault();
      } else if (e.key === "0") {
        fit(j);
        e.preventDefault();
      }
    };
    figure.append(tools, message, canvas, details);
    pre.replaceWith(figure);
    jobs.set(figure, j);
    items.push(j);
  }
  queueMicrotask(() => {
    for (const j of items) {
      if (!valid(j)) continue;
      const root = j.figure.closest("dialog");
      j.observer = new IntersectionObserver(
        (es) => {
          if (es.some((e) => e.isIntersecting)) {
            j.observer.disconnect();
            if (queue.length >= 20 || j.code.length > 12000) {
              finish(j, null);
              return;
            }
            queue.push(j);
            setTimeout(pump, 80);
          }
        },
        { root, rootMargin: "150px" },
      );
      j.observer.observe(j.figure);
    }
  });
}
function zoom(j, factor) {
  if (!j.svg) return;
  j.scale = Math.max(1, Math.min(4, j.scale * factor));
  j.svg.style.width = `${j.scale * j.fitWidth}px`;
  j.canvas.dataset.zoomed = String(j.scale > 1);
}
export function releaseDiagrams(target) {
  for (const f of target.querySelectorAll(".diagram-shell")) {
    const j = jobs.get(f);
    if (!j) continue;
    j.disposed = true;
    j.observer?.disconnect();
    clearTimeout(j.timer);
    queue = queue.filter((x) => x !== j);
    if (active === j) {
      stopWorker();
      active = null;
    }
    jobs.delete(f);
  }
  queueMicrotask(pump);
}
